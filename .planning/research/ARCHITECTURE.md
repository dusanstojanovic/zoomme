# Architecture Patterns

**Domain:** Chrome Extension (MV3) — Webcam Face Detection Zoom Control
**Researched:** 2026-02-15
**Confidence:** HIGH (MV3 constraints are well-documented; ML pipeline patterns from established extensions)

---

## Core Constraint: Where Webcam Access Lives in MV3

This is the single most architecturally decisive fact for this project.

**Manifest V3 service workers cannot access `getUserMedia`.** Service workers have no
DOM, no `navigator.mediaDevices`, and no ability to render video frames. This rules out
doing camera capture in `background.js`.

**Content scripts CAN call `getUserMedia`**, but camera permission is granted to the
extension origin (`chrome-extension://...`), not the page origin. A content script
calling `getUserMedia` inherits the page origin, which means it will prompt on every
new site and may be blocked by site CSP. Rejected for this use case.

**The correct answer: Offscreen Document.** Chrome 116+ (stable since mid-2023) added
`chrome.offscreen.createDocument()`. An offscreen document is a hidden extension page
that runs on the extension origin, has full DOM access, can call `getUserMedia`, and
can load TensorFlow.js / MediaPipe. This is the canonical MV3 solution for webcam
capture.

**Confidence: HIGH** — Offscreen documents for `USER_MEDIA` purpose are explicitly
documented in Chrome's official extension API docs and in the MV3 migration guide.

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTENSION ORIGIN                          │
│                                                             │
│  ┌──────────────┐    messages     ┌─────────────────────┐  │
│  │  Background  │◄───────────────►│  Offscreen Document  │  │
│  │  Service     │                 │  (offscreen.html)    │  │
│  │  Worker      │                 │                      │  │
│  │              │  zoom commands  │  - getUserMedia()    │  │
│  │  - State     │                 │  - <video> element   │  │
│  │  - Tab zoom  │                 │  - <canvas> element  │  │
│  │  - Offscreen │                 │  - Face detection    │  │
│  │    lifecycle │                 │    model (WASM/SIMD) │  │
│  │  - Excluded  │                 │  - Distance calc     │  │
│  │    sites     │                 │  - Frame loop        │  │
│  └──────┬───────┘                 └─────────────────────┘  │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ chrome.tabs.setZoom()
          │ chrome.tabs.query()
          ▼
┌─────────────────┐    ┌─────────────────────────────────────┐
│   Active Tab    │    │           Popup                      │
│   (any website) │    │  (popup/popup.html)                  │
│                 │    │                                      │
│  No content     │    │  - Toggle enable/disable             │
│  script needed  │    │  - Exclude current site              │
│  for zoom —     │    │  - Show current zoom level           │
│  tabs.setZoom   │    │  - Show detection confidence         │
│  works from     │    │  - Communicates via                  │
│  background     │    │    chrome.runtime.sendMessage        │
└─────────────────┘    └─────────────────────────────────────┘
```

**Key insight:** No content script is needed for the zoom feature itself.
`chrome.tabs.setZoom(tabId, zoomFactor)` is a background API that works without
injecting anything into the page. This keeps the architecture clean.

---

## Component Boundaries

| Component | File | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| Background Service Worker | `background.js` | State management, offscreen lifecycle, zoom application, excluded-sites list, tab change listener | Offscreen (messages), Popup (messages), Chrome tabs API |
| Offscreen Document | `offscreen/offscreen.html` + `offscreen/offscreen.js` | Webcam capture, ML inference, distance estimation, throttled zoom calculation | Background (messages only) |
| Popup | `popup/popup.html` + `popup/popup.js` | User controls, status display | Background (messages only) |
| Face Detection Module | `offscreen/detector.js` (internal) | Wraps MediaPipe FaceMesh or TensorFlow.js BlazeFace; returns normalized bounding box | Offscreen JS (direct import) |
| Distance Estimator | `offscreen/distance.js` (internal) | Converts bounding-box face size to estimated cm distance using pinhole camera model | Offscreen JS (direct import) |
| Zoom Mapper | `offscreen/zoom-mapper.js` (internal) | Maps distance (cm) → zoom factor (0.25–5.0), applies smoothing/hysteresis | Offscreen JS (direct import) |

---

## Data Flow

```
Camera Hardware
      │
      ▼ MediaStream (30fps)
[<video> in Offscreen]
      │
      ▼ drawImage() every N ms (requestAnimationFrame or setInterval)
[<canvas> in Offscreen]
      │
      ▼ ImageData / ImageBitmap
[Face Detection Model]  ← MediaPipe FaceMesh WASM or TF.js BlazeFace
      │
      ▼ Bounding box: {x, y, width, height} normalized 0–1
[Distance Estimator]
      │  formula: estimated_distance = (REF_FACE_WIDTH_PX * FOCAL_LENGTH) / face_pixel_width
      ▼ distance_cm (float)
[Zoom Mapper]
      │  smooth: exponential moving average over last N frames
      │  hysteresis: only emit if delta > threshold
      ▼ zoom_factor (float, 0.25–5.0)
[chrome.runtime.sendMessage] ──► Background Service Worker
      │
      ▼ chrome.tabs.setZoom(activeTabId, zoom_factor)
Browser renders page at new zoom
```

**Frame budget notes:**
- Face detection should run at 5–10 fps max (not 30fps) to avoid throttling the
  service worker message queue and to stay within CPU budget on laptops.
- Use `setInterval` with 100–200ms interval in offscreen, not `requestAnimationFrame`
  (rAF may be throttled in hidden documents).
- MediaPipe FaceMesh WASM runs entirely in the offscreen document — no network calls
  after initial load.

---

## Message Protocol

All communication is via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`.
No shared memory, no ports needed for MVP (ports only needed if message rate exceeds
~50/sec, which 5-10fps does not).

```
Offscreen → Background:
  { type: "ZOOM_UPDATE", zoomFactor: 1.4, distance: 52, confidence: 0.91 }
  { type: "NO_FACE_DETECTED" }
  { type: "CAMERA_ERROR", error: "NotAllowedError" }

Background → Offscreen:
  { type: "START_DETECTION" }
  { type: "STOP_DETECTION" }

Popup → Background:
  { type: "GET_STATE" }
  { type: "SET_ENABLED", enabled: true }
  { type: "EXCLUDE_SITE", hostname: "docs.google.com" }
  { type: "INCLUDE_SITE", hostname: "docs.google.com" }

Background → Popup (response):
  { enabled: true, currentZoom: 1.4, distance: 52, excludedSites: [...] }
```

---

## State Management

State lives entirely in the Background Service Worker. Offscreen is stateless between
detection cycles. Popup is read-only display.

```
BackgroundState = {
  enabled: boolean,              // persisted via chrome.storage.local
  excludedSites: string[],       // hostnames, persisted via chrome.storage.local
  currentZoom: number,           // ephemeral, set on each ZOOM_UPDATE
  offscreenActive: boolean,      // tracks if offscreen document exists
  activeTabId: number | null,    // updated via chrome.tabs.onActivated
}
```

**Service worker wake/sleep:** MV3 service workers terminate after ~30 seconds of
inactivity. The offscreen document will send ZOOM_UPDATE messages every 100–200ms
while active, which keeps the service worker alive. No alarm-based keepalive needed
while detection is running.

---

## Offscreen Document Lifecycle

```
User enables extension (popup)
        │
        ▼
Background: chrome.offscreen.createDocument({
  url: "offscreen/offscreen.html",
  reasons: ["USER_MEDIA"],
  justification: "Webcam access for face detection"
})
        │
        ▼
Offscreen initializes → getUserMedia() → loads ML model → starts frame loop
        │
        ▼ sends ZOOM_UPDATE messages continuously

User disables extension OR tab is excluded site
        │
        ▼
Background: chrome.offscreen.closeDocument()
           + chrome.tabs.setZoom(tabId, 0)  // 0 = reset to default
```

**Only one offscreen document can exist per extension at a time.** Background must
check `chrome.offscreen.hasDocument()` before creating. If service worker restarts,
it must check for orphaned offscreen documents on startup.

---

## Patterns to Follow

### Pattern 1: Offscreen-as-Sensor
Treat the offscreen document as a pure sensor: it emits measurements, makes no
decisions about whether to apply zoom (that logic belongs in background). This keeps
zoom policy (excluded sites, enabled state) in one place.

```javascript
// offscreen.js — only emit, never decide
chrome.runtime.sendMessage({ type: "ZOOM_UPDATE", zoomFactor: calculated });

// background.js — all policy decisions here
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ZOOM_UPDATE") {
    if (!state.enabled) return;
    if (state.excludedSites.includes(currentHostname)) return;
    chrome.tabs.setZoom(state.activeTabId, msg.zoomFactor);
  }
});
```

### Pattern 2: Exponential Moving Average for Zoom Smoothing
Raw distance estimates are noisy. Apply EMA before sending to background.

```javascript
const ALPHA = 0.2; // lower = smoother, higher = more responsive
let smoothedZoom = 1.0;

function updateZoom(rawZoom) {
  smoothedZoom = ALPHA * rawZoom + (1 - ALPHA) * smoothedZoom;
  return smoothedZoom;
}
```

### Pattern 3: Hysteresis Dead-Zone
Avoid constant micro-adjustments. Only apply zoom if delta exceeds threshold.

```javascript
const ZOOM_THRESHOLD = 0.05; // 5% change minimum
let lastAppliedZoom = 1.0;

function shouldApply(newZoom) {
  return Math.abs(newZoom - lastAppliedZoom) >= ZOOM_THRESHOLD;
}
```

### Pattern 4: Graceful Camera Permission Handling
Camera permission must be requested from an extension page context. The offscreen
document is that context. On `NotAllowedError`, send error to background which relays
to popup for user display. Do not retry automatically — wait for user action.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Content Script for Webcam
**What:** Injecting a content script into pages and calling `getUserMedia` there.
**Why bad:** Camera permission is granted to the page origin, not extension origin.
Creates a permission prompt on every new domain. Also triggers CSP issues on some sites
(GitHub, Google, etc. reject extension-injected scripts with strict CSP).
**Instead:** Use offscreen document exclusively for camera access.

### Anti-Pattern 2: Running Face Detection in Background Service Worker
**What:** Importing TensorFlow.js or MediaPipe into `background.js`.
**Why bad:** Service workers have no DOM, no `OffscreenCanvas` that supports WASM
GPU backends, and limited CPU budget. WASM ML models require `WebAssembly` which is
technically available in service workers but without canvas/ImageBitmap pipeline it
is impractical. Will also cause service worker to time out or be killed.
**Instead:** All ML inference runs in the offscreen document.

### Anti-Pattern 3: 30fps Zoom Updates
**What:** Running face detection at full camera framerate and sending a message per frame.
**Why bad:** `chrome.tabs.setZoom()` is not designed for 30 calls/sec. It creates
visible jank, hammers the browser's zoom compositor, and saturates the extension message
bus. Also burns CPU/battery.
**Instead:** Throttle to 5–10fps for inference. Apply hysteresis to further reduce
actual `setZoom()` calls to ~1–3 per second under normal use.

### Anti-Pattern 4: Storing State in Offscreen Document
**What:** Keeping enabled/excluded-sites state in the offscreen document.
**Why bad:** Offscreen documents can be destroyed and recreated. State is lost on
recreation. Also creates split-brain when service worker restarts.
**Instead:** All persistent and ephemeral state in background service worker, backed
by `chrome.storage.local` for persistence across service worker restarts.

### Anti-Pattern 5: Applying Zoom on Every Tab
**What:** Using `chrome.tabs.onActivated` naively and applying zoom to every tab.
**Why bad:** Will zoom tabs the user never consciously enabled it for (e.g., new tabs,
extension pages, PDF viewer). chrome.tabs.setZoom on `chrome://` URLs throws errors.
**Instead:** Check `tab.url` before applying zoom. Skip `chrome://`, `chrome-extension://`,
`about:`, `file://` if not explicitly allowed.

---

## Scalability Considerations

| Concern | Current scope | If product grows |
|---------|--------------|-----------------|
| CPU usage | Single offscreen doc, throttled 5-10fps | Could add worker thread inside offscreen for ML inference (OffscreenCanvas + Worker) |
| Multiple monitors | `tabs.setZoom` per-tab is sufficient | No change needed |
| Multiple windows | `chrome.tabs.onActivated` fires for all windows | Already handled by tracking `activeTabId` |
| Per-tab zoom memory | Each tab has independent zoom state in Chrome | Use `chrome.tabs.getZoom` on activation to restore previous zoom |
| Model size | BlazeFace is ~400KB, FaceMesh is ~2MB | Bundle with extension, no CDN (avoids CSP and offline issues) |

---

## Build Order (Phase Dependencies)

```
Phase 1: Offscreen Document + Camera Access
  - Create offscreen.html / offscreen.js scaffold
  - Implement getUserMedia with correct permission
  - Implement offscreen lifecycle in background.js
  Deliverable: Camera stream visible in offscreen (verified via devtools)

Phase 2: Face Detection Pipeline
  Depends on: Phase 1 (needs camera stream)
  - Bundle MediaPipe FaceMesh or TF.js BlazeFace
  - Implement detector.js wrapper
  - Implement distance.js (pinhole model)
  - Test bounding box output in offscreen console
  Deliverable: Distance estimates logged to console at 5-10fps

Phase 3: Zoom Control
  Depends on: Phase 2 (needs distance estimates)
  - Implement zoom-mapper.js with EMA smoothing
  - Wire ZOOM_UPDATE messages to background.js
  - Implement chrome.tabs.setZoom() calls
  - Implement excluded-sites check
  Deliverable: Zoom responds to head movement on real tabs

Phase 4: Popup UI
  Depends on: Phase 3 (needs state to display)
  - Enable/disable toggle
  - Exclude current site button
  - Status display (distance, zoom, confidence)
  Deliverable: Full user-controllable extension

Phase 5: Persistence + Edge Cases
  Depends on: Phase 4
  - chrome.storage.local for enabled state and excluded sites
  - Service worker restart recovery
  - Handle chrome:// URL edge cases
  - Camera permission error UX
  Deliverable: Production-quality extension
```

---

## Sources

- Chrome Extension Manifest V3 migration guide — offscreen documents section (chrome.google.com/webstore/developer docs)
- `chrome.offscreen` API reference — reasons: USER_MEDIA, createDocument, hasDocument
- `chrome.tabs.setZoom()` API reference
- MediaPipe FaceMesh (JavaScript/WASM): mediapipe.dev/solutions/face_mesh
- TensorFlow.js BlazeFace model: tfhub.dev/tensorflow/tfjs-model/blazeface
- Pinhole camera model for face-distance estimation: standard computer vision formula

**Confidence note:** All MV3 architectural constraints (no getUserMedia in service
workers, offscreen document as the correct approach, single-document limit) are
HIGH confidence based on the Chrome extension documentation as of Chrome 116+ (2023).
The ML model selection (BlazeFace vs FaceMesh) is MEDIUM confidence — needs a
feasibility check on bundle size and inference latency on the target platform during
Phase 2 research.
