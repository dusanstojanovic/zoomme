# Requirements: ZoomMe

**Defined:** 2026-02-15
**Core Value:** Head distance reliably controls page zoom level with minimal latency and no manual intervention.

## v1 Requirements

### Webcam & Detection

- [ ] **CAM-01**: User can enable webcam tracking via "Use ZoomMe" checkbox in popup
- [ ] **CAM-02**: Enabled state is per-session only — always starts unchecked on browser restart
- [ ] **CAM-03**: Webcam fully stops (stream released) when checkbox is unchecked
- [ ] **CAM-04**: Visual indicator in popup shows when webcam is active
- [ ] **CAM-05**: Normal distance auto-calibrated when user first enables (capture baseline)

### Zoom Control

- [ ] **ZOOM-01**: Page zoom adjusts based on head distance — closer = zoom out, farther = return to 100%
- [ ] **ZOOM-02**: Zoom uses Chrome's tabs.setZoom() API (native browser zoom)
- [ ] **ZOOM-03**: Zoom resets to 100% when user disables tracking
- [ ] **ZOOM-04**: EMA smoothing + dead zone prevents jitter during normal use
- [ ] **ZOOM-05**: Slider in popup controls max zoom range
- [ ] **ZOOM-06**: Head distance measured at ~1 second intervals (not every frame)

### Site Exclusion

- [ ] **EXCL-01**: User can toggle exclude current site via extension icon/popup
- [ ] **EXCL-02**: Excluded sites list visible in popup with remove capability
- [ ] **EXCL-03**: Excluded sites persist across sessions via chrome.storage

### Settings

- [ ] **SET-01**: Slider position persists across popup close via chrome.storage
- [ ] **SET-02**: Excluded sites persist across sessions via chrome.storage

## v2 Requirements

### Calibration

- **CAL-01**: User can manually recalibrate normal distance
- **CAL-02**: Calibration instruction overlay on first enable

### Polish

- **POL-01**: Keyboard shortcut to toggle enable/disable
- **POL-02**: Onboarding tooltip on first install

## Out of Scope

| Feature | Reason |
|---------|--------|
| Camera preview / live video feed | Privacy concern, unnecessary complexity |
| Per-site zoom memory | Conflicts with adaptive nature — zoom is dynamic, not saved preference |
| CSS zoom / transform: scale() | Breaks layouts, inconsistent with native Ctrl+/- |
| Magnification mode (closer = zoom in) | Different product for different user (accessibility) |
| Cloud sync beyond chrome.storage.sync | No server, no accounts, no data leaving device |
| Hotkey for manual zoom control | Conflicts with hands-free value prop; Chrome has Ctrl+/- |
| Mobile / tablet support | Desktop Chrome only, laptop webcam assumed |
| Multiple zoom profiles | Disproportionate complexity for v1 |
| Persistent enable state | Per-session only by design — privacy-first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAM-01 | Phase 1 | Pending |
| CAM-02 | Phase 1 | Pending |
| CAM-03 | Phase 1 | Pending |
| CAM-04 | Phase 1 | Pending |
| CAM-05 | Phase 2 | Pending |
| ZOOM-01 | Phase 3 | Pending |
| ZOOM-02 | Phase 3 | Pending |
| ZOOM-03 | Phase 3 | Pending |
| ZOOM-04 | Phase 3 | Pending |
| ZOOM-05 | Phase 4 | Pending |
| ZOOM-06 | Phase 2 | Pending |
| EXCL-01 | Phase 4 | Pending |
| EXCL-02 | Phase 4 | Pending |
| EXCL-03 | Phase 4 | Pending |
| SET-01 | Phase 4 | Pending |
| SET-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-02-15*
*Last updated: 2026-02-15 after roadmap creation*
