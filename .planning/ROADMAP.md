# Roadmap: ZoomMe

## Overview

Four phases following the architecture dependency chain: establish the camera context in an offscreen document, add face detection inference, wire up zoom control with smoothing, then complete the popup UI and persistence. Each phase builds directly on the previous; skipping ahead causes rewrites.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Offscreen document + webcam lifecycle wired to background service worker
- [ ] **Phase 2: Detection Pipeline** - MediaPipe face landmark inference running at 5-10fps in offscreen context
- [ ] **Phase 3: Zoom Control** - Distance-to-zoom mapping with EMA smoothing applied to real tabs
- [ ] **Phase 4: UI + Persistence** - Complete popup controls, site exclusion, and settings storage

## Phase Details

### Phase 1: Foundation
**Goal**: The extension can open and close the webcam on demand without crashing the service worker
**Depends on**: Nothing (first phase)
**Requirements**: CAM-01, CAM-02, CAM-03, CAM-04
**Success Criteria** (what must be TRUE):
  1. User can check "Use ZoomMe" in popup and the webcam LED turns on
  2. User can uncheck the toggle and the webcam LED turns off (stream fully released)
  3. Opening a new browser window and returning does not re-enable the webcam (session-only state)
  4. A "camera active" visual indicator in popup reflects the current webcam state accurately
**Plans:** 1 plan
Plans:
- [ ] 01-01-PLAN.md — Webcam lifecycle: offscreen document, SW keepalive, popup toggle + indicator

### Phase 2: Detection Pipeline
**Goal**: The offscreen document detects face distance and reports readings to the background service worker
**Depends on**: Phase 1
**Requirements**: CAM-05, ZOOM-06
**Success Criteria** (what must be TRUE):
  1. Distance readings appear in the console at approximately 1-second intervals when webcam is active
  2. On first enable, a baseline "normal distance" is auto-captured within the first reading
  3. CPU usage during active detection stays within acceptable range on a typical laptop (inference throttled, not every frame)
**Plans**: TBD

### Phase 3: Zoom Control
**Goal**: Page zoom on real browser tabs responds to head distance with stable, jitter-free behavior
**Depends on**: Phase 2
**Requirements**: ZOOM-01, ZOOM-02, ZOOM-03, ZOOM-04
**Success Criteria** (what must be TRUE):
  1. Moving closer to the screen causes the active tab to zoom out (more content visible)
  2. Moving back to normal distance returns the tab to 100% zoom
  3. Holding still at any distance produces stable zoom with no visible flickering
  4. Disabling the toggle immediately resets the active tab to 100% zoom
**Plans**: TBD

### Phase 4: UI + Persistence
**Goal**: Users can configure zoom range and exclude sites, with all settings surviving browser restarts
**Depends on**: Phase 3
**Requirements**: ZOOM-05, EXCL-01, EXCL-02, EXCL-03, SET-01, SET-02
**Success Criteria** (what must be TRUE):
  1. User can drag a slider to set max zoom range and the zoom behavior changes immediately
  2. User can click one button in the popup to exclude the current site from zoom control
  3. Excluded sites list is visible in popup and individual sites can be removed
  4. Slider position and excluded sites list survive closing and reopening the browser
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/1 | Planning complete | - |
| 2. Detection Pipeline | 0/TBD | Not started | - |
| 3. Zoom Control | 0/TBD | Not started | - |
| 4. UI + Persistence | 0/TBD | Not started | - |
