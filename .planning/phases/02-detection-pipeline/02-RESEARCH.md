# Phase 2: Detection Pipeline - Research

**Researched:** 2026-02-16
**Domain:** MediaPipe Tasks Vision (WASM) in a Chrome MV3 offscreen document
**Confidence:** HIGH (spike verified, type definitions read, official docs checked)

---

## Summary

The detection pipeline requires wiring MediaPipe FaceLandmarker into the existing offscreen document. The spike (`npm pack @mediapipe/tasks-vision@0.10.32`) confirmed the exact bundle layout: two JS WASM loader files and two `.wasm` binaries (SIMD + noSIMD variants), plus `vision_bundle.mjs` (ES module) and `vision_bundle.cjs`. Total weight: ~21MB WASM files + 3.6MB model.

The critical constraint is that the project has **no build system** — all JS is loaded as plain browser scripts. The `vision_bundle.mjs` uses ES module `export {}` syntax and cannot be loaded as a classic `<script src>`. The offscreen document must use `<script type="module">` and offscreen.js must use `import` statements. This is a one-line HTML change and a module import addition — no bundler required.

MediaPipe's `FilesetResolver.forVisionTasks(basePath)` constructs paths as `${basePath}/vision_{wasm|wasm_nosimd}_internal.{js|wasm}` automatically based on SIMD detection. Passing `chrome.runtime.getURL('wasm')` as `basePath` routes to bundled files. The manifest needs `wasm-unsafe-eval` in CSP and `web_accessible_resources` covering the wasm/ and model/ directories. The offscreen document loads properly (has full DOM, has `window`), so `requestAnimationFrame` is available, but since we throttle to ~1 second intervals anyway, `setInterval` with `performance.now()` as the timestamp is simpler and more predictable.

**Primary recommendation:** Bundle WASM + model locally, load `vision_bundle.mjs` as ES module in offscreen.js, initialize `FaceLandmarker` once, run `detectForVideo(video, performance.now())` via `setInterval` at 1000ms, derive distance from left/right eye corner landmark spread (x-axis distance between landmarks 33 and 263, normalized), and report readings to background.js via the existing long-lived port.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mediapipe/tasks-vision` | 0.10.32 (latest) | FaceLandmarker WASM inference | Official Google library; single self-contained package with WASM |

### Supporting

| Asset | Size | Purpose | Note |
|-------|------|---------|------|
| `wasm/vision_wasm_internal.js` | 200KB | WASM loader (SIMD) | Bundled from npm package |
| `wasm/vision_wasm_internal.wasm` | 11MB | WASM binary (SIMD) | Bundled from npm package |
| `wasm/vision_wasm_nosimd_internal.js` | 200KB | WASM loader (noSIMD fallback) | Bundled from npm package |
| `wasm/vision_wasm_nosimd_internal.wasm` | 10MB | WASM binary (noSIMD) | Bundled from npm package |
| `model/face_landmarker.task` | 3.6MB | Face landmark model (float16) | Downloaded once from Google storage |

**Download URL for model:**
```
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FaceLandmarker (478 landmarks) | FaceDetector (bounding box only) | FaceDetector gives no z/depth info and no consistent landmark positions for distance ratio; FaceLandmarker is required |
| setInterval throttle | requestAnimationFrame + frame skip | rAF works in offscreen docs but is more complex; setInterval at 1000ms is simpler and sufficient for ~1s interval requirement |
| vision_bundle.mjs ES import | Bundler (webpack/vite/esbuild) | No bundler exists; ES module import works natively in Chrome extension pages with `type="module"` |

**Installation (spike only, not in extension):**
```bash
npm pack @mediapipe/tasks-vision
# Extract wasm/ directory from the .tgz into extension/wasm/
# Download face_landmarker.task into extension/model/
```

---

## Architecture Patterns

### Recommended Project Structure

```
zoomme/
├── offscreen/
│   ├── offscreen.html          # Add type="module" to script tag
│   └── offscreen.js            # Add import + MediaPipe detection loop
├── wasm/                       # Bundled from @mediapipe/tasks-vision
│   ├── vision_wasm_internal.js
│   ├── vision_wasm_internal.wasm
│   ├── vision_wasm_nosimd_internal.js
│   └── vision_wasm_nosimd_internal.wasm
├── model/
│   └── face_landmarker.task    # Downloaded model
├── background.js               # Receives DISTANCE_READING messages
└── manifest.json               # CSP + web_accessible_resources additions
```

### Pattern 1: Switching offscreen.js to ES Module

**What:** Change `<script src="offscreen.js">` to `<script type="module" src="offscreen.js">` so offscreen.js can use `import` from `vision_bundle.mjs`.

**When to use:** Required because `vision_bundle.mjs` uses ES module `export {}` syntax. Classic script loading will fail silently.

**Example:**
```html
<!-- offscreen/offscreen.html -->
<script type="module" src="offscreen.js"></script>
```

```javascript
// offscreen/offscreen.js - top of file
import { FilesetResolver, FaceLandmarker } from
  chrome.runtime.getURL('vendor/vision_bundle.mjs');
```

**Note on import path:** Extension pages can use dynamic `import()` with `chrome.runtime.getURL()` or static import with a relative path if vendor files are in the same directory. The cleanest approach for no-build: copy `vision_bundle.mjs` into the extension directory (e.g., `vendor/`) and use a relative import path.

### Pattern 2: FilesetResolver with Local WASM

**What:** `FilesetResolver.forVisionTasks(basePath)` auto-selects SIMD vs noSIMD and returns `WasmFileset`. Pass `chrome.runtime.getURL('wasm')` as the base path.

**Verified from bundle source (vision_bundle.mjs):**
```javascript
// Internal implementation in bundle (verified via spike):
// forVisionTasks(basePath) => ea("vision", basePath)
// ea(name, basePath) => {
//   wasmLoaderPath: `${basePath}/vision_wasm_[no]simd_internal.js`,
//   wasmBinaryPath: `${basePath}/vision_wasm_[no]simd_internal.wasm`
// }

const wasmBasePath = chrome.runtime.getURL('wasm');
const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
```

### Pattern 3: FaceLandmarker Initialization

**What:** Initialize once after camera starts, reuse across all detection calls.

```javascript
// Source: vision.d.ts + ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: chrome.runtime.getURL('model/face_landmarker.task'),
  },
  runningMode: 'VIDEO',   // required for detectForVideo
  numFaces: 1,            // only track one face
});
```

### Pattern 4: Throttled Detection Loop at ~1 Second

**What:** `setInterval` calls `detectForVideo(video, performance.now())`. Timestamp must be monotonically increasing; `performance.now()` satisfies this.

```javascript
// ~1-second detection interval (not every frame)
let detectionInterval = null;

function startDetectionLoop() {
  detectionInterval = setInterval(() => {
    if (video.readyState < 2) return; // video not ready
    const result = faceLandmarker.detectForVideo(video, performance.now());
    const reading = extractDistanceReading(result);
    if (reading !== null) {
      backgroundPort.postMessage({ type: 'DISTANCE_READING', ...reading });
    }
  }, 1000);
}

function stopDetectionLoop() {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }
}
```

### Pattern 5: Distance Proxy from Eye Landmark Spread

**What:** Use the normalized x-distance between left and right eye outer corners (landmarks 33 and 263) as the distance proxy. Larger spread = closer to camera; smaller spread = farther away. This is a ratio, not an absolute cm measurement — suitable for relative comparison against a captured baseline.

**Landmark indices (verified from FaceLandmarker 478-point mesh):**
- Landmark 33: right eye outer corner (right from viewer's perspective)
- Landmark 263: left eye outer corner (left from viewer's perspective)

```javascript
function extractDistanceReading(result) {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  const landmarks = result.faceLandmarks[0];
  const rightEye = landmarks[33];   // right eye outer corner
  const leftEye  = landmarks[263];  // left eye outer corner
  // Normalized x-coords: spread increases as face gets closer
  const spread = Math.abs(leftEye.x - rightEye.x);
  return { spread }; // dimensionless ratio 0.0-1.0
}
```

### Pattern 6: Auto-Baseline on First Reading

**What:** On the first successful detection after enabling, store the spread as the "normal distance" baseline. Subsequent readings report `ratio = currentSpread / baselineSpread`.

```javascript
let baseline = null;

function processReading(spread) {
  if (baseline === null) {
    baseline = spread;
    console.log('ZoomMe: baseline captured', baseline);
  }
  const ratio = spread / baseline; // >1.0 = closer, <1.0 = farther
  backgroundPort.postMessage({ type: 'DISTANCE_READING', spread, baseline, ratio });
}
```

### Anti-Patterns to Avoid

- **Using CDN URL in FilesetResolver:** CSP blocks external URLs in extension pages. Only `chrome.runtime.getURL()` paths work. Confirmed by prior decisions and official CSP docs.
- **Loading vision_bundle.mjs as a classic script:** It uses `export {}` which is invalid in non-module context. The browser will throw a syntax error.
- **Calling detectForVideo before camera stream is ready:** Check `video.readyState >= 2` (HAVE_CURRENT_DATA) before each call.
- **Reusing the same timestamp twice:** FaceLandmarker VIDEO mode requires monotonically increasing timestamps. `performance.now()` called fresh each interval satisfies this.
- **Initializing FaceLandmarker in the global scope before WASM loads:** It's async — must await inside an async function called after DOMContentLoaded or after camera starts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Face detection | Custom CV | FaceLandmarker | WASM inference, GPU accelerated, 478-point mesh |
| SIMD detection | Manual UA sniff | `FilesetResolver.isSimdSupported()` (called internally by `forVisionTasks`) | Already handled inside the bundle |
| Distance calculation | Focal-length trigonometry | Normalized landmark spread ratio | No camera calibration needed; relative comparison against baseline is sufficient for zoom control |

**Key insight:** The landmark spread ratio approach avoids needing focal length, sensor size, or any camera calibration. It works because we compare against a user-specific baseline captured at "normal distance" — the ratio is meaningful relative to that baseline even without absolute depth.

---

## Common Pitfalls

### Pitfall 1: WASM Files Must Be in `web_accessible_resources`

**What goes wrong:** WASM loader script (`vision_wasm_internal.js`) tries to `fetch()` the `.wasm` binary by constructing a URL from the loader's path. If the wasm files are not declared in `web_accessible_resources`, the fetch is blocked.

**Why it happens:** Chrome extension CSP + web_accessible_resources restrictions prevent extension files from being fetched unless declared. The WASM loader uses `locateFile` callback (verified in bundle: `locateFile: t => t.endsWith('.wasm') ? n.wasmBinaryPath.toString() : ...`) so it goes through the path we provide, but the fetch itself must be allowed.

**How to avoid:** Declare `wasm/*` and `model/*` in `web_accessible_resources` in manifest.json with `matches: ["<all_urls>"]` or restrict to extension pages only. Since these are only loaded from the offscreen document (an extension page), `matches: ["chrome-extension://<id>/*"]` is sufficient — but `<all_urls>` is simpler.

**Warning signs:** Console error `Failed to fetch` or `net::ERR_FILE_NOT_FOUND` when loading WASM.

### Pitfall 2: CSP Missing `wasm-unsafe-eval`

**What goes wrong:** WASM execution requires `wasm-unsafe-eval` in the manifest CSP for extension pages. Without it, WASM compilation fails.

**Why it happens:** MV3 default CSP does not include it. Chrome requires explicit opt-in.

**How to avoid:**
```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
}
```

**Verified:** The Chrome CSP docs confirm `wasm-unsafe-eval` is the supported directive and is included in the minimum allowed policy (i.e., you don't need to add it — it's already in the Chrome-enforced minimum). However, being explicit doesn't hurt and documents intent clearly.

**Update (HIGH confidence):** Chrome docs state the enforced minimum CSP is `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` — meaning `wasm-unsafe-eval` is already granted by default for extension pages. No manifest CSP entry may be needed. Verify during implementation.

### Pitfall 3: Model File Path as URL vs Relative Path

**What goes wrong:** `modelAssetPath` in FaceLandmarker options may need a full absolute URL, not a relative path, when running in an offscreen document. The offscreen document's base URL is `chrome-extension://<id>/offscreen/offscreen.html`, so a relative `../model/face_landmarker.task` would resolve correctly, but it's cleaner to use `chrome.runtime.getURL('model/face_landmarker.task')`.

**How to avoid:** Always use `chrome.runtime.getURL('model/face_landmarker.task')` for the model path.

### Pitfall 4: FaceLandmarker Init Blocking Camera Start

**What goes wrong:** WASM loading (~11MB binary) takes 1-3 seconds. If init is awaited synchronously before signaling `CAMERA_READY`, the user sees a delay.

**Why it happens:** FaceLandmarker initialization fetches and compiles WASM — it's slow on first load.

**How to avoid:** Start detection initialization in parallel or after `CAMERA_READY` is sent. Send `CAMERA_READY` as soon as `video.play()` resolves; initialize MediaPipe in the background and only start the detection interval once init completes.

### Pitfall 5: `requestAnimationFrame` Throttle Cap in Offscreen Documents

**What goes wrong:** rAF may be throttled or not fire reliably in hidden documents (offscreen documents cannot be focused, which affects visibility-based throttling). The December 2025 Medium article reports rAF calls can stall in chrome.offscreen contexts.

**How to avoid:** Use `setInterval(fn, 1000)` instead of `requestAnimationFrame`. The requirement is ~1 second intervals anyway, so `setInterval` is both correct and avoids the rAF visibility problem entirely.

---

## Code Examples

Verified patterns from official sources and spike:

### Full Offscreen Detection Flow

```javascript
// offscreen/offscreen.js
import { FilesetResolver, FaceLandmarker } from '../vendor/vision_bundle.mjs';

let faceLandmarker = null;
let baseline = null;
let detectionInterval = null;

async function initFaceLandmarker() {
  const wasmBasePath = chrome.runtime.getURL('wasm');
  const modelPath = chrome.runtime.getURL('model/face_landmarker.task');

  const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath },
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

function extractSpread(result) {
  if (!result.faceLandmarks?.length) return null;
  const lm = result.faceLandmarks[0];
  return Math.abs(lm[263].x - lm[33].x); // left eye outer - right eye outer
}

function startDetectionLoop() {
  detectionInterval = setInterval(() => {
    if (!faceLandmarker || video.readyState < 2) return;
    const result = faceLandmarker.detectForVideo(video, performance.now());
    const spread = extractSpread(result);
    if (spread === null) return;

    if (baseline === null) {
      baseline = spread;
    }
    const ratio = spread / baseline;
    backgroundPort.postMessage({ type: 'DISTANCE_READING', spread, baseline, ratio });
  }, 1000);
}
```

### manifest.json Changes

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [
    {
      "resources": ["wasm/*", "model/*", "vendor/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### offscreen.html Change

```html
<!-- Before: -->
<script src="offscreen.js"></script>

<!-- After: -->
<script type="module" src="offscreen.js"></script>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MediaPipe Legacy JS (face_mesh.js) | MediaPipe Tasks Vision 0.10.x (FaceLandmarker) | 2023 | New API is stable and recommended; legacy is deprecated |
| CDN-hosted WASM | Bundle WASM locally | Required for extension CSP | Local only; no remote fetches needed |
| 468 landmarks | 478 landmarks (with iris refinement) | 0.10.x | Extra 10 iris landmarks available but not needed for distance |

**Deprecated/outdated:**
- `@mediapipe/face_mesh` (legacy): deprecated, use `@mediapipe/tasks-vision` FaceLandmarker instead
- CDN-based WASM loading (`cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`): blocked by extension CSP

---

## Open Questions

1. **Does `wasm-unsafe-eval` need to be explicit in manifest.json?**
   - What we know: Chrome docs say the enforced minimum CSP for extension pages already includes `wasm-unsafe-eval`
   - What's unclear: Whether omitting it from manifest.json is safe or if some Chrome versions require it to be explicit
   - Recommendation: Include it explicitly in manifest.json to be safe; it cannot hurt and documents intent

2. **Static import vs dynamic `import()` for vision_bundle.mjs**
   - What we know: Chrome extension ES module scripts support both static `import` and dynamic `import()`
   - What's unclear: Static import requires the path to be a string literal known at parse time; `chrome.runtime.getURL()` can't be used in a static import. Dynamic `import(chrome.runtime.getURL('vendor/vision_bundle.mjs'))` works but requires async init.
   - Recommendation: Copy `vision_bundle.mjs` into the extension directory and use a relative static import: `import { FaceLandmarker, FilesetResolver } from '../vendor/vision_bundle.mjs'`

3. **WASM loading time on first init (~11MB binary)**
   - What we know: WASM compilation can take 1-3 seconds on typical hardware
   - What's unclear: Whether Chrome caches compiled WASM across extension reloads
   - Recommendation: Initialize MediaPipe after `CAMERA_READY`, not before. Keep camera start and model init parallel.

4. **Landmark 33/263 accuracy for distance proxy**
   - What we know: These are the outer eye corners in the 478-point mesh; x-distance in normalized coords gives a reliable spread ratio
   - What's unclear: Whether z-coordinate would give more accurate depth than x-spread in edge cases (extreme head angles)
   - Recommendation: Use x-spread for simplicity — it's more stable and the baseline-ratio approach tolerates small errors. EMA smoothing in Phase 3 handles noise.

---

## Sources

### Primary (HIGH confidence)
- `npm pack @mediapipe/tasks-vision@0.10.32` — bundle layout, file names, sizes, FilesetResolver implementation, WasmFileset construction logic (verified by reading `vision_bundle.mjs` and `vision.d.ts`)
- `https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy` — `wasm-unsafe-eval` CSP directive (verified)
- `https://developer.chrome.com/docs/extensions/reference/api/offscreen` — offscreen document API, limitations, DOM access confirmed

### Secondary (MEDIUM confidence)
- `https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js` — JavaScript initialization pattern, detectForVideo usage, timestamp requirements
- `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` — model file size verified via HTTP HEAD: 3,758,596 bytes (3.6MB)
- WebSearch: rAF in offscreen documents — multiple sources confirm rAF may not fire reliably; setInterval is the safe alternative

### Tertiary (LOW confidence)
- Medium article (Dec 2025) on rAF in offscreen documents — could not fetch, but search summary confirms rAF stalls in chrome.offscreen; setInterval recommended

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — spike verified bundle layout, file names, sizes
- Architecture: HIGH — ES module pattern, FilesetResolver path construction, landmark indices all verified from source
- Pitfalls: HIGH (CSP/web_accessible_resources), MEDIUM (rAF in offscreen), MEDIUM (init timing)

**Research date:** 2026-02-16
**Valid until:** 2026-06-01 (MediaPipe patch versions move fast; re-verify version before implementation)
