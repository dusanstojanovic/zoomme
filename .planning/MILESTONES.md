# Milestones

## v1.0 MVP — shipped 2026-02-18

**Phases:** 1–4 | **Plans:** 5 | **Timeline:** 3 days (2026-02-15 → 2026-02-18)
**LOC:** ~556 JS | **Commits:** 17

### Delivered

Full working Chrome extension (MV3) that zooms web pages based on webcam-detected head distance — no manual intervention required.

### Key Accomplishments

1. Webcam lifecycle via offscreen document with port-based SW keepalive and camera permission helper tab
2. MediaPipe Tasks Vision 0.10.32 bundled locally (WASM + face model) with CSP configuration
3. FaceLandmarker detection at 1s intervals with automatic baseline calibration on first enable
4. Distance-to-zoom mapping: EMA smoothing + dead zone (±20%) + snap-on-large-movement for jitter-free behavior
5. Max-zoom slider and per-site exclusion with chrome.storage.sync persistence across restarts

### Archive

- [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) — full phase details and decisions
- [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) — all 16/16 v1 requirements delivered
