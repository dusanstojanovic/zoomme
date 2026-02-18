# Domain Pitfalls: Webcam + Face Detection + Browser Zoom Chrome Extension

**Domain:** Chrome Extension (MV3) — Webcam ML face detection + zoom control
**Researched:** 2026-02-15
**Confidence note:** All findings from training data (cutoff Jan 2025). No external tools available during this session. Claims marked HIGH/MEDIUM/LOW accordingly.

---

## Critical Pitfalls

Mistakes that cause rewrites, crashes, or permission denials with no recovery path.

---

### Pitfall 1: getUserMedia Cannot Run in a Service Worker

**What goes wrong:** You attempt to call `navigator.mediaDevices.getUserMedia()` directly in `background.js` (the service worker). The call throws immediately — service workers have no DOM, no `navigator.mediaDevices`, and no access to hardware APIs.

**Why it happens:** Developers assume the background script is "always available" and put all logic there for convenience.

**Consequences:** Total feature failure. The camera never opens. Chrome gives a cryptic error in the service worker console. This forces a full architecture rethink because webcam access requires a document context.

**Prevention:**
- Webcam access must happen inside an offscreen document or a content script running in a real browser tab.
- For this project: create an offscreen document via `chrome.offscreen.createDocument()` with reason `USER_MEDIA`.
- Route webcam lifecycle (open/close, frame capture) entirely through the offscreen document.
- Background service worker only sends commands (`START`, `STOP`) and receives distance readings back via `chrome.runtime.sendMessage`.

**Detection (warning signs):**
- You see `TypeError: Cannot read properties of undefined (reading 'getUserMedia')` in the service worker console.
- Any attempt to reference `document`, `navigator`, `window` in background.js.

**Confidence:** HIGH — service workers lack DOM APIs; this is a fundamental web platform constraint, not a Chrome-specific quirk.

**Phase:** Address in the very first implementation phase before any other webcam code is written.

---

### Pitfall 2: Only One Offscreen Document Allowed Per Extension at a Time

**What goes wrong:** You call `chrome.offscreen.createDocument()` a second time (e.g., after the service worker restarts) without checking if one already exists. Chrome throws an error: `"Only a single offscreen document may be created"`. The extension breaks silently or throws an uncaught rejection.

**Why it happens:** MV3 service workers are ephemeral — they shut down after inactivity and restart on next event. Any in-memory state (including "did I create an offscreen document?") is lost. On restart, code tries to create the document again.

**Consequences:** Extension crashes on second use after browser is idle. Users report "it stopped working after a while."

**Prevention:**
```javascript
// Always check before creating
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return; // Already exists
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Webcam access for face distance detection'
  });
}
```
- Call `ensureOffscreenDocument()` before every command message to offscreen.
- Store a readiness signal in `chrome.storage.session` (cleared on browser close, persists across service worker restarts within a session).

**Detection (warning signs):**
- Extension works first time, fails intermittently after ~30 seconds of inactivity (service worker timeout is ~30s idle).
- Error: `"Only a single offscreen document may be created"` in service worker console.

**Confidence:** HIGH — `chrome.runtime.getContexts` is the documented pattern for this exact problem (Chrome 116+).

**Phase:** Implement guard in the same phase as offscreen document creation.

---

### Pitfall 3: Webcam Permission Grant Does Not Persist Across Offscreen Document Recreations

**What goes wrong:** The user grants camera permission when the offscreen document asks. The offscreen document is closed (e.g., user disables zoom). When re-enabled, a new offscreen document is created. On some Chrome versions/platforms, `getUserMedia` re-prompts the user, or worse, silently fails with `NotAllowedError` if the permission was granted to the old document context.

**Why it happens:** Camera permissions in Chrome are tied to the origin. For extensions, the offscreen document runs on a chrome-extension:// origin. Permissions granted once should persist, but the browser permission dialog behavior can vary if the extension's permission state wasn't set to "allow" explicitly (it may have been "ask" with a one-time grant).

**Consequences:** Users see repeated camera permission prompts. Trust degrades. Some users deny on re-prompt, breaking the feature permanently for them.

**Prevention:**
- Add `"camera"` to the `"permissions"` array in `manifest.json`. This requests camera permission at extension install time, not at first use. Chrome will prompt once at install (via CWS) rather than per-session.
- Even with manifest permission, still catch `NotAllowedError` from `getUserMedia` and display a recovery UI.
- Never auto-retry silently — if permission is denied, surface a clear message with a link to `chrome://settings/content/camera`.

**Detection (warning signs):**
- `DOMException: NotAllowedError` from `getUserMedia` even though user previously granted access.
- Camera permission prompt appearing more than once.

**Confidence:** MEDIUM — behavior varies between Chrome versions. The `"camera"` manifest permission approach is standard but exact behavior on re-prompt needs testing on target Chrome versions.

**Phase:** Permissions model must be finalized in manifest before first camera access implementation.

---

### Pitfall 4: ML Model Loading Blocks the Offscreen Document and Stalls First Frame

**What goes wrong:** TensorFlow.js or MediaPipe model is loaded synchronously (or `await`-ed) before any frame processing starts. Model files are large (2–20MB for face detection models). On first load, there is a 2–8 second freeze before any detection runs. Users see no feedback and assume the extension is broken.

**Why it happens:** Model initialization is treated as a one-time cost, so developers put it at the top of the script and await it. On slow connections or cold cache, this stalls everything.

**Consequences:** 3–8 second black-box wait on first enable. Users toggle the feature off and never enable it again.

**Prevention:**
- Show UI state "Initializing..." in popup immediately when enabled (send a `STATUS: LOADING_MODEL` message back to popup before `await model.load()`).
- Load the model lazily, only after user explicitly enables the feature.
- Bundle the model file locally inside the extension package (in `/models/`) instead of fetching from CDN. Eliminates network dependency and speeds up subsequent loads from disk cache.
- For MediaPipe tasks: use `wasmFilePath` option pointing to locally bundled WASM, not the CDN URL.

**Detection (warning signs):**
- First enable takes >2 seconds before any zoom changes occur.
- Network tab shows large `.bin` or `.tflite` file fetched from `cdn.jsdelivr.net` or `storage.googleapis.com`.

**Confidence:** HIGH — model loading latency is a known, well-documented pain point for any in-browser ML.

**Phase:** Must be addressed in the ML integration phase. Loading strategy must be designed before implementation begins.

---

### Pitfall 5: Running Face Detection on Every Frame at 30fps Pegs the CPU

**What goes wrong:** Face detection is triggered on every `requestAnimationFrame` or `setInterval` tick at 30fps. Inference on even a lightweight model takes 30–80ms per frame on mid-range hardware. At 30fps (33ms between frames), the offscreen document becomes CPU-bound. The system fan spins up, battery drains, other tabs lag.

**Why it happens:** Developers benchmark on a high-end developer machine where 30fps inference seems fine (10–15ms). Real users on 2019 MacBook Airs or budget Windows laptops experience 3–6x slower inference.

**Consequences:** Extension is perceived as a battery hog. 1-star reviews: "slows down my browser." Users uninstall.

**Prevention:**
- Cap inference at 5–10fps (detect every 3rd–6th frame). Distance changes from head movement are slow relative to 5fps.
- Use `setInterval(detect, 150)` (approx 7fps) instead of `requestAnimationFrame`.
- Check frame delta: skip inference if the last frame was processed less than 150ms ago.
- Choose the lightest viable model: MediaPipe FaceMesh Lite or BlazeFace (single face, bounding box only — you don't need landmarks for distance estimation, just bounding box width/height).
- Avoid TensorFlow.js full face-landmarks-detection with 478 keypoints — overkill for distance estimation from bounding box area.

**Detection (warning signs):**
- CPU usage >15% sustained when extension is active.
- Activity Monitor / Task Manager shows the Chrome Helper (GPU) or renderer process spiking.
- `performance.now()` timing of inference loop shows >50ms per detection.

**Confidence:** HIGH — this is the most commonly reported issue in browser-based ML projects. BlazeFace benchmarks at ~5–10ms on mid-range hardware.

**Phase:** Performance budget must be defined in the design phase. Throttle approach must be implemented from the start, not bolted on later.

---

### Pitfall 6: Zoom Jitter from Frame-to-Frame Bounding Box Noise

**What goes wrong:** Face bounding box size fluctuates ±5–15% between frames due to model noise even when the user is perfectly still. Mapping bounding box area directly to zoom level causes the page to flicker/jump zoom 2–4 times per second. This is visually nauseating and makes the feature unusable.

**Why it happens:** ML models produce slightly different bounding boxes each frame. Developers map raw bounding box area → zoom level without any smoothing.

**Consequences:** Unusable feature. Even a technically correct distance estimate feels broken. Users associate the jitter with poor quality.

**Prevention:**
- Apply a running average (exponential moving average, EMA) to the bounding box area before mapping to zoom:
  ```javascript
  const ALPHA = 0.1; // smoothing factor: lower = more smooth, higher = more responsive
  smoothedArea = ALPHA * rawArea + (1 - ALPHA) * smoothedArea;
  ```
- Apply a dead zone: only update zoom if the smoothed distance changes by more than a threshold (e.g., 5% of current zoom range).
- Quantize zoom to discrete steps (e.g., 0.75, 0.90, 1.0, 1.1, 1.25) — don't use continuous float zoom levels. This limits the number of zoom transitions.
- Debounce the `chrome.tabs.setZoom()` call (50–100ms minimum between calls).

**Detection (warning signs):**
- Zoom level visibly changes while sitting still.
- `chrome.tabs.getZoom()` called in a loop shows fluctuating values.

**Confidence:** HIGH — smoothing and dead zones are standard solutions for this exact problem in any gesture-to-control system.

**Phase:** Zoom mapping logic phase. Smoothing must be part of the initial implementation, not an afterthought.

---

### Pitfall 7: chrome.tabs.setZoom() Requires the `tabs` Permission and an Active Tab ID

**What goes wrong:** `chrome.tabs.setZoom()` is called without specifying a tab ID (expecting it to default to the active tab), or it's called from the offscreen document context where there is no concept of an "active tab." The call fails silently or throws.

**Why it happens:** Documentation examples often show `chrome.tabs.setZoom(tabId, zoom)` but developers omit `tabId` expecting it to operate on the current tab. From a background service worker or offscreen document, there is no implicit "current tab."

**Consequences:** Zoom never changes. Debugging is difficult because `chrome.runtime.lastError` may not surface in the offscreen document.

**Prevention:**
- Always query the active tab explicitly before calling setZoom:
  ```javascript
  // In background service worker
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.tabs.setZoom(tab.id, zoomFactor);
  ```
- Offscreen document sends distance readings to background via `chrome.runtime.sendMessage`. Background handles tab query and zoom application. Never call `chrome.tabs` from offscreen document directly (it may lack the permission context).
- Add `"tabs"` to manifest permissions.

**Detection (warning signs):**
- `chrome.runtime.lastError`: "No tab with id: undefined."
- Zoom API calls in offscreen document console show no effect.

**Confidence:** HIGH — tab ID requirement is explicit in Chrome API docs.

**Phase:** Architecture design phase. Message routing must be defined before any API calls are implemented.

---

### Pitfall 8: Service Worker Termination Kills Ongoing Webcam State Mid-Session

**What goes wrong:** The MV3 service worker terminates after ~30 seconds of inactivity (no events, no open ports). If the offscreen document relies on the service worker being alive to relay zoom updates, that relay breaks silently. The webcam keeps running in the offscreen document (burning CPU/battery), but zoom stops updating because the service worker is gone.

**Why it happens:** Developers assume the service worker is persistent (as in MV2). It is not. MV3 service workers are ephemeral.

**Consequences:** Webcam runs indefinitely consuming power, but zoom stops working. User can't tell the difference until they notice the extension icon state is wrong.

**Prevention:**
- Use `chrome.storage.session` to hold the "is active" flag — persists across service worker restarts within a browser session.
- On service worker restart (`chrome.runtime.onStartup`, or detection via message failure), re-establish message ports.
- Use a long-lived `chrome.runtime.connect()` port between offscreen document and background instead of one-shot `sendMessage`. This keeps the service worker alive while the port is open.
- Alternatively: offscreen document polls `chrome.storage.session` for "should I be running?" every N seconds as a heartbeat fallback.

**Detection (warning signs):**
- Zoom stops updating after ~30 seconds of no popup interaction.
- Extension icon state shows "active" but zoom is frozen.
- Service worker status shows "stopped" in `chrome://extensions`.

**Confidence:** HIGH — service worker lifetime in MV3 is well-documented. The 30-second idle termination is explicitly documented behavior.

**Phase:** Architecture phase. Port-based communication must be chosen over one-shot messaging for the webcam relay.

---

## Moderate Pitfalls

---

### Pitfall 9: No Face Detected ≠ User Left the Desk (Zoom Should Not Reset)

**What goes wrong:** When the face detection model returns no bounding box (face temporarily out of frame — user looked away, reached for coffee, leaned far back), the code resets zoom to 100% immediately.

**Why it happens:** Treating `null` detection as "distance = infinity" and mapping that to the minimum zoom level (or default).

**Consequences:** Zoom snaps to 100% whenever user moves slightly out of frame. Extremely annoying; the feature feels unreliable.

**Prevention:**
- Implement a "no detection timeout" — only reset zoom after N consecutive frames (e.g., 30 frames at 7fps = ~4 seconds) with no detection.
- Hold the last known zoom level when no face is detected.
- Never map "no detection" directly to a zoom value.

**Detection (warning signs):** Zoom resets whenever user turns head or briefly looks away.

**Confidence:** HIGH — timeout-based holdover is standard in face-tracking UX design.

**Phase:** Zoom mapping logic phase.

---

### Pitfall 10: Webcam Stays On After Extension Popup Closes or Tab Changes

**What goes wrong:** `getUserMedia()` stream is never stopped. The webcam LED stays on permanently. Users notice this and are alarmed.

**Why it happens:** Cleanup on "disable" or popup close is not implemented. The `MediaStream` is just abandoned, not `.stop()`-ed.

**Consequences:** Privacy alarm bell. Trust destroyed. Immediate uninstall.

**Prevention:**
- Store the `MediaStream` reference in the offscreen document scope.
- On `STOP` command from service worker: call `stream.getTracks().forEach(t => t.stop())`.
- Also handle `chrome.runtime.onSuspend` in the offscreen document to stop the stream before the document is closed.
- Test explicitly: enable → disable → verify webcam LED is off.

**Detection (warning signs):**
- Webcam LED stays on after clicking the disable toggle.
- `chrome.runtime` shows offscreen document still alive after disable.

**Confidence:** HIGH — stream cleanup is a fundamental media API requirement.

**Phase:** Webcam lifecycle phase (enable/disable toggle).

---

### Pitfall 11: Excluded Sites List Breaks on chrome.tabs.setZoom When Tab is a Chrome Internal Page

**What goes wrong:** The service worker tries to call `chrome.tabs.setZoom(tabId, factor)` on a tab showing `chrome://`, `chrome-extension://`, `about:`, or a PDF viewer. Chrome throws: `"Cannot access contents of the page. Extension manifest must request permission to access the respective host."` or simply rejects the zoom call.

**Why it happens:** The active tab query returns any tab — including Chrome's own pages. `setZoom` is blocked on these pages.

**Consequences:** Uncaught error floods the service worker console. On some Chrome versions, this can crash the service worker.

**Prevention:**
- Before calling `setZoom`, check `tab.url`:
  ```javascript
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    return; // Skip zoom on internal pages
  }
  ```
- Wrap all `setZoom` calls in try-catch.

**Detection (warning signs):** Errors in background service worker console when switching to `chrome://newtab`, `chrome://settings`, etc.

**Confidence:** HIGH — chrome internal page restriction on host permissions is well-documented.

**Phase:** Zoom application phase.

---

### Pitfall 12: Distance Estimation from Bounding Box Area is Non-Linear

**What goes wrong:** You map bounding box area linearly to zoom level. At close range, small head movements cause large zoom changes (overly sensitive). At far range, large movements cause tiny changes (feels unresponsive). The relationship between bounding box pixel area and perceived distance is quadratic (area ∝ 1/distance²), not linear.

**Why it happens:** Simple linear mapping is intuitive to implement but physically wrong.

**Consequences:** Extension feels hypersensitive close-up and sluggish from a distance.

**Prevention:**
- Use square root of bounding box area (which is proportional to bounding box width/height = proportional to 1/distance) as the base signal.
- Or use bounding box width directly (face width in pixels scales linearly with 1/distance).
- Calibrate: define a "normal distance" baseline at startup (or via a calibration step) and compute zoom as a ratio relative to that baseline.

**Detection (warning signs):** Zoom feels too aggressive when leaning in and too slow when leaning back.

**Confidence:** MEDIUM — based on optics / perspective projection math. Exact perceptual tuning requires user testing.

**Phase:** Zoom mapping algorithm phase.

---

### Pitfall 13: WASM Backend for TensorFlow.js/MediaPipe May Not Load in Offscreen Document

**What goes wrong:** MediaPipe or TensorFlow.js WASM backend fails to initialize in the offscreen document with `Cross-Origin-Embedder-Policy` or `SharedArrayBuffer` errors. Some backends require `SharedArrayBuffer`, which requires specific HTTP headers Chrome does not serve to extension pages by default.

**Why it happens:** The WASM threading backend requires `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Extension offscreen documents do not have these headers.

**Consequences:** Model falls back to CPU JS backend (much slower) or fails entirely.

**Prevention:**
- Use the non-threaded WASM backend or the WebGL backend, which do not require `SharedArrayBuffer`.
- With MediaPipe Tasks API: the default configuration avoids threading and works in extension contexts.
- Test backend initialization explicitly and log which backend is active.
- If using TensorFlow.js: call `tf.setBackend('webgl')` explicitly; do not rely on auto-detection, which may fail.

**Detection (warning signs):**
- Console warning: `"SharedArrayBuffer is not available"` or `"Falling back to WASM single-threaded"`.
- Inference is unexpectedly slow (>100ms) suggesting CPU JS fallback.

**Confidence:** MEDIUM — known issue in extension contexts; specific MediaPipe Tasks API behavior in offscreen documents should be verified against current docs.

**Phase:** ML integration phase — must verify backend selection before committing to a model.

---

## Minor Pitfalls

---

### Pitfall 14: chrome.storage.sync Has Per-Item and Total Quota Limits

**What goes wrong:** The excluded sites list grows large (many domains added). `chrome.storage.sync` has a total quota of 100KB and a per-item limit of 8KB. Writing a large array of excluded domains as a single item hits the per-item limit.

**Prevention:** Store excluded domains as individual keys (`excluded_${domain}: true`) or chunk the array. Use `chrome.storage.local` for large datasets (5MB quota) if sync is not required.

**Confidence:** HIGH — quota values are documented in Chrome API docs.

**Phase:** Storage design, before implementing excluded sites list.

---

### Pitfall 15: popup.js Cannot Directly Control the Webcam or Access Offscreen Document

**What goes wrong:** Developer puts webcam start/stop logic in popup.js for simplicity. Popup closes when user clicks elsewhere. Webcam session ends. All state is lost.

**Prevention:** Popup is UI-only. It sends messages to background service worker. Service worker manages offscreen document lifecycle. Popup only reads state from `chrome.storage.session`.

**Confidence:** HIGH — popup page lifecycle is ephemeral (closes when unfocused); this is fundamental extension architecture.

**Phase:** Architecture design phase.

---

### Pitfall 16: requestAnimationFrame is Not Available in Offscreen Documents on Some Chrome Versions

**What goes wrong:** `requestAnimationFrame` throttling or unavailability in hidden/background offscreen documents. Browsers throttle RAF in invisible documents.

**Prevention:** Use `setInterval` for the detection loop instead of `requestAnimationFrame`. This is more predictable and not affected by visibility throttling.

**Confidence:** MEDIUM — RAF throttling in hidden documents is standard browser behavior but offscreen document specifics may vary.

**Phase:** Frame capture loop implementation.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Manifest permissions setup | Missing `"camera"` permission causes repeated per-session prompts | Add `"camera"` to manifest permissions upfront |
| Offscreen document creation | Duplicate creation error on service worker restart | Guard with `chrome.runtime.getContexts()` check |
| Webcam stream initialization | `getUserMedia` in service worker fails completely | All camera code must live in offscreen document |
| ML model selection | WASM threading backend fails in extension context | Test backend on offscreen page; use WebGL or single-thread WASM |
| ML model loading | 2–8s freeze on first enable | Bundle model locally, show loading state in popup |
| Frame inference loop | CPU pegged at 30fps | Throttle to 5–10fps with `setInterval(detect, 150)` |
| Distance → zoom mapping | Jitter from frame noise | EMA smoothing + dead zone + discrete zoom steps |
| Zoom application | Fails on chrome:// pages | URL guard before every `setZoom` call |
| Webcam cleanup | Webcam LED stays on after disable | Explicit `stream.getTracks().forEach(t => t.stop())` on STOP command |
| Service worker lifetime | Zoom relay breaks after 30s idle | Use long-lived `chrome.runtime.connect()` port |
| No-face handling | Zoom resets when user looks away briefly | Holdover timeout before acting on null detection |
| Excluded sites persistence | Large list hits sync storage limit | Use `storage.local` or per-key storage pattern |

---

## Sources

- Training knowledge of Chrome Extensions MV3 documentation (HIGH confidence for API constraints, service worker lifetime, tab permissions)
- Training knowledge of TensorFlow.js / MediaPipe in-browser ML patterns (MEDIUM confidence for WASM backend behavior in extension contexts — verify against current MediaPipe Tasks API docs)
- Training knowledge of WebRTC / getUserMedia API constraints in non-document contexts (HIGH confidence)
- Pitfalls 3, 13, 16 should be verified against current Chrome release notes before implementation

**Note:** No external sources were accessible during this research session (WebSearch, WebFetch, and Bash were unavailable). All findings are from training data. Critical claims are marked with confidence levels. Pitfalls 3 and 13 in particular should be validated against live Chrome documentation before the relevant implementation phases begin.
