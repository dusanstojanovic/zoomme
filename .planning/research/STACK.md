# Technology Stack

**Project:** ZoomMe — webcam head-distance zoom control
**Researched:** 2026-02-15
**Note on sourcing:** WebSearch and WebFetch were unavailable during this research session. All findings are derived from training knowledge (cutoff January 2025) plus inspection of the existing codebase. Confidence levels reflect this. Verify versions before implementation.

---

## Recommended Stack

### Face Detection Library

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@mediapipe/tasks-vision` | 0.10.x | Face detection + landmark-based distance estimation | Google's official MediaPipe JS Tasks API — ships pre-quantized WASM + GPU delegate, runs at 30fps on mid-range laptops, single `npm`-free CDN/local bundle, designed for browser use without a build pipeline |

**Confidence: MEDIUM** — MediaPipe Tasks Vision 0.10.x is confirmed as of January 2025. The exact patch version may have changed; verify at https://www.npmjs.com/package/@mediapipe/tasks-vision before use.

**Why MediaPipe Tasks Vision over alternatives:**

| Library | Verdict | Reason |
|---------|---------|--------|
| `@mediapipe/tasks-vision` | **USE THIS** | Lightest inference path, GPU delegate auto-selected, single-file bundle loadable without npm, face landmark model is 3MB (short-range) vs competitors' 10-30MB |
| TensorFlow.js + `@tensorflow-models/face-landmarks-detection` | Avoid | Two separate libraries (~1MB TF core + model download), TFJS backend initialization adds 500ms+ cold start, overkill when MediaPipe Tasks is built on the same underlying runtime |
| `face-api.js` | Avoid | Unmaintained since 2021, built on TF.js 1.x, no WASM backend, CPU-only in practice, 6MB+ model weights |
| `@vladmandic/face-api` | Avoid for this use case | Active fork of face-api.js with WASM support, but still heavier than MediaPipe Tasks and less documented |
| `jeelizFaceFilter` | Avoid | Face orientation tracker only, no landmark-based distance estimation |
| OpenCV.js | Avoid | 7MB+ WASM, requires manual Haar cascade setup, far more complex than needed |
| Web AI API (built-in Chrome) | Not yet viable | Chrome's built-in face detection API (`FaceDetector`) only returns bounding boxes, not face landmarks, so interocular distance (needed for depth estimate) is unavailable. May have value in future Chrome versions. **Confidence: LOW** |

---

### Distance Estimation Approach

| Approach | Recommendation | Rationale |
|----------|---------------|-----------|
| Interocular distance from Face Landmarks | **USE THIS** | Face Mesh / BlazeFace Short-Range gives 468 landmarks; pixel distance between eye corners (landmarks 33 and 263) inversely correlates with head-to-camera distance without needing camera calibration. Simple formula: `estimatedDistance ∝ KNOWN_EYE_SPAN_MM / pixelEyeSpan * focalLength`. Works reliably 25–80cm. |
| Bounding box size | Fallback only | Works but is noisier — box grows/shrinks with head rotation, not just Z-distance |
| Depth estimation model | Overkill | Adds 10–50ms/frame latency and a large model |

**Confidence: MEDIUM** — Interocular distance technique is well-documented in MediaPipe community. Exact landmark indices (33 and 263 for outer eye corners) are stable in MediaPipe Face Mesh; verify against model card if using short-range vs. full-range model.

---

### How to Load the Model in a Chrome Extension (No Build Tools)

**Confidence: MEDIUM** — Based on MediaPipe Tasks API design and Chrome Extension CSP rules as of January 2025. Verify the WASM asset URL pattern against the actual npm package.

Chrome extensions with Manifest V3 cannot use remote code execution — `eval()`, dynamic `Function()`, or loading scripts from external CDNs in content scripts. The MediaPipe Tasks Vision library ships as an ES module + WASM bundle that CAN be loaded as a local file.

**Recommended loading strategy:**

1. Download `@mediapipe/tasks-vision` bundle files into an `lib/mediapipe/` directory inside the extension package.
2. The relevant files from the npm package are:
   - `vision_bundle.mjs` (or `vision_bundle.js`) — the ES module
   - `wasm/vision_wasm_internal.js` + `vision_wasm_internal.wasm` — WASM runtime
3. Load from a content script or offscreen document:
   ```js
   import { FaceLandmarker, FilesetResolver } from './lib/mediapipe/vision_bundle.mjs';

   const vision = await FilesetResolver.forVisionTasks(
     chrome.runtime.getURL('lib/mediapipe/wasm')
   );
   const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
     baseOptions: {
       modelAssetPath: chrome.runtime.getURL('lib/mediapipe/face_landmarker.task'),
       delegate: 'GPU',
     },
     runningMode: 'VIDEO',
     numFaces: 1,
   });
   ```
4. Reference all local file paths via `chrome.runtime.getURL()` — never use relative paths or hardcoded `https://` URLs for model assets.
5. Declare all lib files in `web_accessible_resources` in manifest.json.

**Do NOT** use the CDN loading pattern shown in MediaPipe docs (e.g. `https://cdn.jsdelivr.net/...`). Chrome extension CSP blocks external script sources in content scripts and the popup.

**Alternative: Offscreen Document (for service worker context)**

If detection runs in the background rather than a content script, use Chrome's Offscreen Documents API (`chrome.offscreen`), which provides a DOM context from the service worker. This requires the `offscreen` permission (Manifest V3, Chrome 109+). This is useful if you want the webcam capture loop to outlive popup close events.

**Confidence: MEDIUM** on offscreen approach — `chrome.offscreen` was introduced in Chrome 109 and is confirmed working as of January 2025.

---

### Chrome APIs Needed

| API | Permission in manifest.json | Purpose | Notes |
|-----|----------------------------|---------|-------|
| `chrome.tabs.setZoom(tabId, zoomFactor)` | `"tabs"` | Set zoom level on active tab | Zoom factor: 0.25–5.0; 1.0 = 100%. **Confidence: HIGH** |
| `chrome.tabs.getZoom(tabId)` | `"tabs"` | Read current zoom for delta calculations | Required to implement smooth incremental changes |
| `chrome.storage.sync` | `"storage"` | Persist: enabled state, zoom range slider value, excluded sites list | Syncs across Chrome profiles; 8KB per-item limit is more than enough |
| `chrome.storage.local` | `"storage"` | Optional: store larger data (excluded sites list if it grows) | 10MB limit, local only |
| `getUserMedia` (WebRTC) | No manifest permission needed for popup/content script context | Access webcam stream | Requires user gesture for first grant; browser handles permission prompt natively |
| `chrome.offscreen` (optional) | `"offscreen"` | Create offscreen document for WASM + webcam loop if needed outside popup | Chrome 109+, required only if detection lives in service worker context |
| `chrome.runtime.onMessage` / `sendMessage` | None (built-in) | IPC between popup, content script, background | Already wired in scaffold |

**Confidence: HIGH** on `tabs`, `storage`, `runtime` APIs — these are stable, long-standing Chrome Extension APIs.

---

### Model File

| Asset | Size | Source | Notes |
|-------|------|--------|-------|
| `face_landmarker.task` (short-range) | ~3MB | MediaPipe face landmarker model bundle | Short-range optimized for webcam at 0.5–2m. Full-range model is ~14MB — do not use |

Bundle this file into the extension package. It cannot be fetched at runtime (CSP + no network access guarantee).

**Confidence: MEDIUM** — Model size and name accurate as of January 2025; verify against https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task.

---

### Supporting Code Patterns

| Pattern | Why |
|---------|-----|
| `requestAnimationFrame` loop in popup/offscreen document | Drives detection at display frame rate; browser throttles it automatically when tab hidden |
| Detach loop when extension is disabled | Stop `getUserMedia` stream tracks (`track.stop()`) immediately on disable to release camera indicator light |
| Throttle zoom writes | `tabs.setZoom()` behind a 200ms debounce/throttle — the API is fast but rapid calls on every frame create jank |
| Exponential moving average on distance | Smooth out frame-to-frame jitter: `smoothed = 0.8 * prev + 0.2 * current` |

---

## What NOT to Use

| Technology | Reason |
|------------|--------|
| React / Vue / Svelte | No build tools constraint; adds a compilation requirement for zero benefit |
| npm / bundler (Webpack, Vite, Rollup) | Explicitly out of scope per project constraints; manual file management required |
| TensorFlow.js | Heavier than MediaPipe Tasks, longer cold start, same underlying capability |
| face-api.js | Unmaintained, CPU-only, no WASM backend |
| External CDN for model or library | Blocked by Chrome Extension CSP; all assets must be bundled locally |
| Content Security Policy relaxation | Do not add `unsafe-eval` to CSP to make a library work — it is a security hole and Chrome Web Store rejects extensions with it |
| `FaceDetector` (built-in browser API) | Returns bounding boxes only, cannot compute eye-corner distance for depth estimation |

---

## Manifest Additions Required

```json
{
  "permissions": ["tabs", "storage"],
  "host_permissions": ["<all_urls>"],
  "web_accessible_resources": [
    {
      "resources": ["lib/mediapipe/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Note: `"host_permissions": ["<all_urls>"]` is needed for `tabs.setZoom()` to work on arbitrary sites. Without it, zoom only works on the extension's own pages. **Confidence: HIGH.**

Webcam (`getUserMedia`) does not require a manifest permission — it is granted via the browser's native camera permission prompt.

---

## Installation (No npm)

Since the project uses no build tools, acquiring MediaPipe requires manual download:

```bash
# One-time: download MediaPipe Tasks Vision bundle from npm registry WITHOUT npm
# Option A: use npm just for download, don't commit node_modules
npm pack @mediapipe/tasks-vision
tar -xf mediapipe-tasks-vision-*.tgz
cp package/wasm/ ./lib/mediapipe/wasm/ -r
cp package/vision_bundle.mjs ./lib/mediapipe/
# Download model separately:
curl -L "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task" \
  -o ./lib/mediapipe/face_landmarker.task
```

Alternative: Download directly from the npm registry tarball URL (no npm install needed), extract manually.

**Confidence: MEDIUM** — The npm pack approach is standard. Verify the exact wasm directory layout in the actual package version used.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Face detection | `@mediapipe/tasks-vision` | TensorFlow.js + face-landmarks-detection | Heavier, slower cold start, same capability |
| Face detection | `@mediapipe/tasks-vision` | face-api.js | Unmaintained since 2021 |
| Zoom API | `chrome.tabs.setZoom()` | CSS `zoom` property via content script | Chrome's built-in zoom is consistent with Ctrl+/-, CSS zoom doesn't affect layout in all cases |
| Model loading | Local bundle (`chrome.runtime.getURL`) | CDN URL | CSP blocks CDN; must bundle locally |
| Camera access | `getUserMedia` in popup/offscreen | Chrome capture API | `getUserMedia` is standard, works in all extension contexts with DOM |

---

## Sources

- Training knowledge (January 2025 cutoff) — MediaPipe Tasks Vision API, Chrome Extension MV3 CSP rules, Chrome Tabs API
- Codebase inspection: `/Users/dusan/Desktop/zoomme/manifest.json`, `background.js`, `popup/`
- Project spec: `/Users/dusan/Desktop/zoomme/.planning/PROJECT.md`
- **Verify current versions at:**
  - https://www.npmjs.com/package/@mediapipe/tasks-vision
  - https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom
  - https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
  - https://developer.chrome.com/docs/extensions/reference/api/offscreen
