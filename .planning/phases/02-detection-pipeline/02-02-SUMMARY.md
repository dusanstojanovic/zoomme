# Plan 02-02 Summary: Wire FaceLandmarker detection loop + distance readings

**Status:** Complete (awaiting human verification)
**Commit:** 9afbd9b
**Date:** 2026-02-17

## What was done
- Changed offscreen.html script tag to type="module"
- Rewrote offscreen.js as ES module with static import from vision_bundle.mjs
- Added initFaceLandmarker() — creates FaceLandmarker with local WASM + model
- Added extractSpread() — eye landmark spread (landmarks 33/263) as distance proxy
- Added startDetectionLoop() — setInterval at 1s, sends DISTANCE_READING via port
- Added stopDetectionLoop() — clears interval, resets baseline
- Detection starts after CAMERA_READY (parallel to camera start), stops before stream release
- Added DISTANCE_READING handler in background.js that logs spread/baseline/ratio

## Files modified
- `offscreen/offscreen.html` — script type="module"
- `offscreen/offscreen.js` — full rewrite as ES module with MediaPipe detection
- `background.js` — DISTANCE_READING handler added to port.onMessage

## Deviations
None.
