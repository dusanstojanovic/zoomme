# ZoomMe

## What This Is

A Chrome extension (MV3) that automatically zooms web pages based on how close the user's head is to their webcam. Uses MediaPipe face detection running locally in WASM to estimate head distance and adjusts the browser zoom level accordingly — closer means zoom out (show more content), farther means return to normal. Built for laptop users who naturally lean in and out while browsing.

## Core Value

Head distance reliably controls page zoom level with minimal latency and no manual intervention.

## Requirements

### Validated

- ✓ Chrome Manifest V3 extension structure — v1.0
- ✓ Background service worker with port-based message passing — v1.0
- ✓ Webcam-based head distance detection via MediaPipe FaceLandmarker — v1.0
- ✓ Distance-to-zoom mapping using Chrome tabs.setZoom() API — v1.0
- ✓ Enable/disable toggle (webcam off by default, per-session only) — v1.0
- ✓ Auto-calibration of baseline distance on first enable — v1.0
- ✓ EMA smoothing + dead zone + snap-to-raw for jitter-free zoom — v1.0
- ✓ Slider to control max zoom range (persisted via chrome.storage.sync) — v1.0
- ✓ Per-site exclude toggle with excluded sites list (persisted) — v1.0

### Active

- [ ] Manual recalibrate button in popup *(CAL-01 — partially shipped as Recalibrate button post-v1.0)*
- [ ] Calibration instruction overlay on first enable *(CAL-02)*
- [ ] Keyboard shortcut to toggle enable/disable *(POL-01)*
- [ ] Onboarding tooltip on first install *(POL-02)*

### Out of Scope

- Camera preview in popup — privacy concern, unnecessary complexity
- Per-site zoom memory — conflicts with adaptive nature (zoom is dynamic, not a saved preference)
- CSS zoom / transform: scale() — breaks layouts, inconsistent with native Ctrl+/-
- Magnification mode (closer = zoom in) — different product for different user
- Cloud sync beyond chrome.storage.sync — no server, no accounts, no data leaving device
- Mobile/tablet support — desktop Chrome + laptop webcam only
- Multiple zoom profiles — disproportionate complexity

## Context

**Shipped v1.0** — 556 LOC vanilla JS, no build tools, no npm runtime dependencies.
Tech stack: Chrome Extension MV3, vanilla JS, MediaPipe Tasks Vision 0.10.32 (WASM, bundled locally).
Post-v1.0 tuning: scan interval raised to 1s, dead zone widened ±20%, snap-on-large-movement added, web_accessible_resources restricted to extension pages.

## Constraints

- **Tech stack**: Chrome Extension Manifest V3, vanilla JS (no frameworks)
- **Performance**: Detection at 1s intervals (not every frame); WASM inference is hardware-accelerated via xnnpack
- **Privacy**: No camera data leaves the device, no preview shown, webcam fully off when disabled
- **Permissions**: `tabs`, `storage`, `offscreen` — no host permissions, no broad access

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Offscreen document for getUserMedia | MV3 service workers cannot call getUserMedia | ✓ Works correctly |
| Long-lived port for offscreen channel | sendMessage cannot keep SW alive; port + heartbeat can | ✓ No premature termination |
| MediaPipe bundled locally | CDN URLs blocked by extension CSP | ✓ Works offline, no CSP violations |
| Inter-eye landmark spread as distance proxy | Simple, robust, no 3D reconstruction needed | ✓ Reliable distance signal |
| Browser zoom API over CSS zoom | Consistent with native Ctrl+/- behavior | ✓ Works across all sites |
| Closer = zoom out | User leaning in wants more content, not magnification | ✓ Intuitive |
| Webcam off by default (per-session) | Privacy-first | ✓ Users approve |
| EMA + dead zone + snap | Smoothing for drift, instant response for large moves | ✓ Stable and responsive |
| In-memory settings cache in background | Avoids async storage reads on every 1s DISTANCE_READING | ✓ No hot-path I/O |

---
*Last updated: 2026-02-18 after v1.0 milestone*
