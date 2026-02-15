# Project Research Summary

**Project:** ZoomMe — webcam head-distance zoom control (Chrome extension)
**Domain:** Chrome Extension (MV3) + in-browser ML face detection
**Researched:** 2026-02-15
**Confidence:** MEDIUM (no live web research tools; training data + codebase inspection)

## Executive Summary

ZoomMe is a Chrome extension that uses webcam-based face distance estimation to automatically adjust browser zoom — closer head = zoom out (more content), farther head = zoom in (larger text). The technically decisive constraint is Manifest V3: service workers have no DOM, so webcam access cannot live in `background.js`. The canonical solution is an **Offscreen Document** (`chrome.offscreen`, Chrome 116+) that runs the full camera-capture + ML inference pipeline, emitting distance readings to the background service worker which applies `chrome.tabs.setZoom()`. No content scripts are needed for the zoom itself; no build tools or npm are needed for the extension.

The recommended implementation uses `@mediapipe/tasks-vision` (0.10.x) bundled locally inside the extension package. It gives GPU-accelerated WASM inference, a 3MB short-range face landmark model, and interocular distance estimation via landmarks 33/263 — the most accurate lightweight approach. The face detection loop should run at 5-10fps via `setInterval` (not `requestAnimationFrame`), with an exponential moving average (alpha ≈ 0.1-0.2) and a ~5% dead zone applied before any `setZoom()` call. These are not optimizations to add later — shipping without them produces an unusable, jittery experience.

The critical risks are all architectural and must be resolved before writing feature code: the offscreen document must be guarded against duplicate creation on service worker restart; the service worker must stay alive via a long-lived `chrome.runtime.connect()` port (not one-shot `sendMessage`); and ML model files must be bundled locally (CDN URLs are blocked by Chrome Extension CSP). Get the camera-to-zoom pipeline working first, then add UI and persistence.

---

## Key Findings

### Recommended Stack

The extension needs no build tools and no framework. The full stack is: vanilla JS + MediaPipe Tasks Vision (local bundle) + Chrome Extension APIs. `@mediapipe/tasks-vision` is the clear winner over TensorFlow.js, face-api.js, and OpenCV.js — it has the smallest model (3MB short-range vs 10-30MB alternatives), built-in GPU delegate, and a single-file bundle loadable without npm.

**Core technologies:**
- `@mediapipe/tasks-vision` 0.10.x (local bundle): face landmark detection — lightest inference path, GPU delegate auto-selected, no CDN required
- `chrome.offscreen` (Chrome 116+): webcam capture context — only valid DOM context in MV3 that can call `getUserMedia` from the extension origin
- `chrome.tabs.setZoom()` + `"tabs"` permission: zoom application — native Chrome zoom, consistent with Ctrl+/-, no content script injection
- `chrome.storage.local`: state persistence — enabled state, excluded sites, calibrated baseline distance
- `chrome.runtime.connect()` ports: service worker keepalive — prevents 30s idle termination from breaking the zoom relay

**Do not use:** React/Vue/Svelte, Webpack/Vite, TensorFlow.js, face-api.js, CDN URLs for model or library assets, `unsafe-eval` in CSP, `FaceDetector` browser built-in (bounding boxes only, no landmark depth estimation).

See: `.planning/research/STACK.md`

### Expected Features

Features are straightforward and well-bounded by the project spec. The MVP is tightly defined with no ambiguity about scope.

**Must have (table stakes):**
- Enable/disable toggle with visual "camera active" indicator — webcam access without explicit opt-in destroys trust
- Zoom reset on disable — users must not feel trapped at a wrong zoom level
- Zoom deadband + EMA smoothing — without this the raw output is visually nauseating; this is not optional polish
- Settings persistence across sessions — `chrome.storage.local` from day one, not deferred
- Reasonable out-of-the-box defaults — no tweaking required for typical 50-80cm laptop distance

**Should have (differentiators):**
- Adjustable zoom range slider — high perceived value, low effort, first customization unlock
- Auto-calibration on first enable — moves from "works on my laptop" to "works for everyone"
- Per-site exclusion (one-click) — addresses fixed-layout sites that break with zoom
- Excluded sites management UI — without this, exclusions pile up invisibly

**Defer (v2+):**
- Everything in the anti-features list: camera preview in popup, per-site zoom memory, CSS zoom, multiple zoom profiles, keyboard shortcuts, onboarding wizard, mobile support

See: `.planning/research/FEATURES.md`

### Architecture Approach

The architecture has one dominant pattern: **Offscreen-as-Sensor**. The offscreen document is a pure measurement device — it captures frames, runs inference, computes distance, and emits `ZOOM_UPDATE` messages. All policy decisions (is the extension enabled? is this site excluded? which tab gets zoomed?) live exclusively in the background service worker. The popup is read-only display + command sender. No content scripts are needed.

**Major components:**
1. **Background Service Worker** (`background.js`) — state authority, offscreen lifecycle, tab zoom application, excluded-sites enforcement, active tab tracking
2. **Offscreen Document** (`offscreen/offscreen.html` + `offscreen.js`) — `getUserMedia`, video element, canvas, MediaPipe inference, EMA smoothing, distance-to-zoom mapping, message relay
3. **Detector Module** (`offscreen/detector.js`) — wraps MediaPipe FaceLandmarker; returns normalized landmarks
4. **Distance Estimator** (`offscreen/distance.js`) — interocular pixel distance → estimated cm using pinhole model
5. **Zoom Mapper** (`offscreen/zoom-mapper.js`) — distance → zoom factor with EMA, dead zone, hysteresis
6. **Popup** (`popup/popup.html` + `popup.js`) — toggle, exclude-site button, status display; all via `chrome.runtime.sendMessage`

Key protocol decision: use `chrome.runtime.connect()` (long-lived port) between offscreen and background, not one-shot `sendMessage`. This keeps the service worker alive and provides a reliable relay.

See: `.planning/research/ARCHITECTURE.md`

### Critical Pitfalls

1. **getUserMedia in service worker** — throws immediately; all camera code must live in the offscreen document. This forces the entire architecture; discover it late and you rewrite everything.

2. **Duplicate offscreen document on service worker restart** — service workers restart after ~30s idle; calling `createDocument()` again throws. Guard every creation with `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })`.

3. **Service worker termination kills zoom relay** — one-shot `sendMessage` breaks after 30s idle; use `chrome.runtime.connect()` long-lived port to keep the worker alive while detection is running.

4. **30fps inference pegs CPU** — mid-range laptops run inference at 30-80ms/frame; at 30fps this is 100% CPU. Throttle to 5-10fps (`setInterval(detect, 150)`) from the start, not as a later optimization.

5. **Zoom jitter without smoothing** — raw ML bounding boxes fluctuate ±5-15% frame-to-frame; direct mapping to zoom causes visible flickering. EMA (alpha ≈ 0.1) + 5% dead zone + debounced `setZoom()` are mandatory for usability.

6. **CDN model URLs blocked by CSP** — all MediaPipe assets (WASM, model file) must be bundled locally and referenced via `chrome.runtime.getURL()`. Never use `cdn.jsdelivr.net` or `storage.googleapis.com` URLs.

7. **`setZoom()` on chrome:// pages throws** — always check `tab.url` before calling; skip `chrome://`, `chrome-extension://`, `about:`, `file://`.

See: `.planning/research/PITFALLS.md`

---

## Implications for Roadmap

The architecture research defines a clear dependency chain: camera context before inference, inference before zoom, zoom before UI, UI before persistence polish. Skipping ahead causes rewrites. The phase structure below follows this chain directly.

### Phase 1: Foundation — Offscreen Document + Camera Access
**Rationale:** Architecturally decisive. All subsequent work depends on having a working camera context in an offscreen document. This is also where the two most critical pitfalls live (getUserMedia placement, duplicate document guard). Must be right before anything else is built.
**Delivers:** Offscreen document that opens the webcam, shows readiness in devtools console, and can be started/stopped by the background service worker. Service worker keepalive via long-lived port established here.
**Addresses features:** Enable/disable toggle (skeleton), visual active indicator (skeleton)
**Avoids:** Pitfall 1 (getUserMedia in service worker), Pitfall 2 (duplicate offscreen), Pitfall 8 (service worker termination), Pitfall 10 (webcam stays on after disable)
**Research flag:** Standard — MV3 offscreen patterns are well-documented. No additional research needed before this phase.

### Phase 2: Face Detection Pipeline
**Rationale:** Needs Phase 1's camera stream. This phase validates that MediaPipe loads correctly in the offscreen document context (WASM backend, no SharedArrayBuffer requirement, no CSP violation) before the zoom mapping layer is built on top of it.
**Delivers:** Distance estimates logged to console at 5-10fps. Inference confirmed within CPU budget on target hardware.
**Uses:** `@mediapipe/tasks-vision` locally bundled; interocular distance formula (landmarks 33/263); `setInterval(detect, 150)` loop
**Implements:** `detector.js`, `distance.js`
**Avoids:** Pitfall 4 (model loading blocks first frame — show loading state), Pitfall 5 (30fps CPU peg), Pitfall 13 (WASM backend failure in extension context)
**Research flag:** Needs verification — WASM backend behavior in offscreen documents and exact MediaPipe Tasks Vision bundle layout should be verified against current docs during this phase. Run a feasibility spike before committing to the full pipeline.

### Phase 3: Zoom Control + Smoothing
**Rationale:** Needs Phase 2's distance estimates. This phase produces the first end-to-end working feature. Smoothing and dead zone are implemented here, not deferred — they are required for the feature to be usable, not polish.
**Delivers:** Page zoom responds to head movement on real tabs. Zoom is stable when user holds still. Zoom resets on disable.
**Implements:** `zoom-mapper.js` (EMA, dead zone, hysteresis), `chrome.tabs.setZoom()` calls in background, tab URL guard, no-face holdover timeout
**Addresses features:** Core zoom behavior, zoom reset on disable, zoom deadband + smoothing
**Avoids:** Pitfall 6 (zoom jitter), Pitfall 7 (setZoom tab ID), Pitfall 9 (zoom resets on no detection), Pitfall 11 (chrome:// page crash), Pitfall 12 (non-linear bounding box mapping)
**Research flag:** Standard — zoom mapping math and Chrome tabs API are well-understood. No additional research needed.

### Phase 4: Popup UI + User Controls
**Rationale:** Needs Phase 3's working zoom to display meaningful state. Popup is UI-only — no business logic. Straightforward to build once the pipeline is proven.
**Delivers:** Full user-controllable extension: enable/disable toggle, active indicator, zoom range slider, per-site exclusion button, status display (distance, zoom level).
**Addresses features:** Enable/disable toggle (complete), visual indicator, adjustable zoom range slider, per-site exclusion (one-click)
**Avoids:** Pitfall 15 (webcam logic in popup)
**Research flag:** Standard — popup architecture is well-documented Chrome extension pattern. No additional research needed.

### Phase 5: Calibration + Persistence + Edge Cases
**Rationale:** Final hardening phase. Auto-calibration requires a working toggle (Phase 4). Persistence and edge case handling complete the production-quality extension.
**Delivers:** Auto-calibration on first enable; all settings persist across browser restarts; excluded sites management UI; service worker restart recovery; camera permission error UX; `chrome.storage` quota-safe excluded sites storage.
**Addresses features:** Auto-calibration, excluded sites management UI, persistence
**Avoids:** Pitfall 3 (camera permission re-prompts — add `"camera"` to manifest before this phase), Pitfall 14 (storage quota), Pitfall 8 (service worker restart recovery complete)
**Research flag:** Standard for persistence; camera permission manifest behavior (Pitfall 3) should be tested on current Chrome before implementation.

### Phase Ordering Rationale

- Phase 1 before everything: MV3 architecture constraint — camera context is a prerequisite for inference which is a prerequisite for zoom.
- Phase 2 feasibility spike: MediaPipe WASM in extension offscreen documents has known friction points (WASM threading, CSP, bundle layout). Validate early before building the mapping layer on top of unvalidated ML.
- Smoothing in Phase 3 not Phase 5: jitter makes the feature objectively unusable in testing. Deferring it means every test session during Phases 3-4 produces bad signal about whether the feature works.
- UI in Phase 4 not Phase 1: popup UI depends on state to display; building it before state exists produces throwaway code.

### Research Flags

**Needs deeper research during planning:**
- **Phase 2 (Face Detection Pipeline):** Verify MediaPipe Tasks Vision 0.10.x bundle layout (exact WASM filenames, directory structure) and offscreen document compatibility (WASM backend selection, no-SharedArrayBuffer path). Run a spike before planning the full pipeline. Also verify `face_landmarker.task` short-range model size and landmark indices 33/263 against current model card.

**Standard patterns (skip additional research):**
- **Phase 1:** Chrome offscreen document creation pattern is canonical and well-documented.
- **Phase 3:** `chrome.tabs.setZoom()` API and EMA smoothing math are stable.
- **Phase 4:** Popup message passing is standard Chrome extension pattern.
- **Phase 5:** `chrome.storage.local` API is stable; camera manifest permission behavior should be smoke-tested but doesn't need research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | MediaPipe Tasks Vision is correct choice; exact bundle layout and 0.10.x patch version need live verification. Chrome tabs/storage/offscreen APIs are HIGH confidence. |
| Features | MEDIUM | First-principles analysis without live competitor research. Table stakes and anti-features are HIGH; differentiator priority ordering is MEDIUM. |
| Architecture | HIGH | MV3 constraints (no getUserMedia in service worker, offscreen document as solution, single-document limit, service worker 30s termination) are definitively documented. |
| Pitfalls | HIGH | Critical pitfalls (1, 2, 5, 6, 7, 8, 10, 11) are HIGH confidence. Pitfalls 3 and 13 (camera permission re-prompts, WASM backend in offscreen) are MEDIUM — need live testing. |

**Overall confidence:** MEDIUM-HIGH. Architecture is solid. Stack choice is well-reasoned. Feature scope is tightly defined by the project spec. Main gaps are around MediaPipe's exact behavior in extension offscreen documents (testable in Phase 2 spike) and camera permission re-prompt behavior (testable in Phase 5).

### Gaps to Address

- **MediaPipe WASM bundle layout:** The exact filenames (`vision_bundle.mjs` vs `vision_bundle.js`, WASM directory structure) and whether the non-threaded backend works in offscreen documents without SharedArrayBuffer should be verified by inspecting the actual npm package before Phase 2 begins. Manual download (`npm pack @mediapipe/tasks-vision`) and inspection resolves this immediately.

- **Camera manifest permission behavior (Pitfall 3):** Whether adding `"camera"` to manifest permissions reliably prevents re-prompts on offscreen document recreation is MEDIUM confidence. Test early in Phase 1 or Phase 5 by explicitly closing and recreating the offscreen document.

- **Competitor analysis gap:** No live Chrome Web Store research was possible. The feature landscape is derived from first-principles. Before finalizing the Phase 4 scope, a quick review of 2-3 existing zoom extensions (Zoom for Google Chrome, Zoom Page WE) would validate the exclusion list and slider UX assumptions.

- **Interocular landmark indices:** Landmarks 33 and 263 for outer eye corners are reported as stable in MediaPipe Face Mesh; verify against the short-range `face_landmarker.task` model card before implementation.

---

## Sources

### Primary (HIGH confidence)
- Chrome Extensions MV3 documentation — offscreen documents, service worker lifetime, `chrome.offscreen`, `chrome.tabs.setZoom()`, `chrome.storage` APIs
- `/Users/dusan/Desktop/zoomme/.planning/PROJECT.md` — project spec, out-of-scope decisions, constraints
- `/Users/dusan/Desktop/zoomme/manifest.json`, `background.js`, `popup/` — existing codebase scaffold
- `/Users/dusan/Desktop/zoomme/.planning/research/ARCHITECTURE.md` — full architecture analysis
- `/Users/dusan/Desktop/zoomme/.planning/research/PITFALLS.md` — full pitfall analysis

### Secondary (MEDIUM confidence)
- `/Users/dusan/Desktop/zoomme/.planning/research/STACK.md` — technology selection rationale (MEDIUM: versions need live verification)
- `/Users/dusan/Desktop/zoomme/.planning/research/FEATURES.md` — feature landscape (MEDIUM: no live competitor data)
- MediaPipe Tasks Vision JS API — training data knowledge (cutoff January 2025)
- Pinhole camera model for face-distance estimation — standard computer vision

### Tertiary (LOW confidence — verify before use)
- MediaPipe `face_landmarker.task` exact landmark indices (33, 263) — needs model card verification
- Camera permission manifest behavior on offscreen document recreation — needs live Chrome testing
- WASM threading/SharedArrayBuffer behavior in extension offscreen documents — needs live testing

**Verify current package versions at:**
- https://www.npmjs.com/package/@mediapipe/tasks-vision
- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- https://developer.chrome.com/docs/extensions/reference/api/offscreen

---
*Research completed: 2026-02-15*
*Ready for roadmap: yes*
