# Feature Landscape

**Domain:** Webcam-controlled adaptive zoom — Chrome extension
**Researched:** 2026-02-15
**Confidence note:** WebSearch, WebFetch, and Context7 tools were unavailable during this research session. All findings are based on training data (knowledge cutoff January 2025), Chrome extension API documentation knowledge, and analysis of the existing project scaffold and PROJECT.md. Confidence levels reflect this limitation honestly.

---

## Table Stakes

Features users expect from any adaptive/automatic zoom extension. Missing any of these = users disable or uninstall immediately.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Enable/disable toggle (off by default) | Webcam access is alarming if silent. Users need explicit opt-in. Privacy norm in browser extensions. | Low | Already in requirements. Must be visible and obvious in popup. |
| Visual indicator when webcam is active | Users need to know when the camera is on. Leaving no signal = privacy distrust, bad reviews. | Low | Can be as simple as icon badge or popup status text. A camera-on indicator (e.g., "Active" label) is the minimum. |
| Zoom that works across normal browsing sites | The core promise. If zoom breaks on common sites (Gmail, GitHub, news sites), value is zero. | Medium | Chrome `tabs.setZoom()` works per-tab; need to re-apply on tab switch. |
| Zoom resets when disabled | If toggling off leaves the page zoomed in/out, users feel trapped. Must restore to 1.0 on disable. | Low | Single `tabs.setZoom(tabId, 1.0)` call on toggle-off. |
| Persistence across sessions | Enable/disable state and settings should survive browser restarts. | Low | `chrome.storage.sync` already planned. |
| Reasonable default behavior out of the box | First-run experience: user enables, gets useful behavior without tweaking sliders. | Medium | Requires sensible defaults: max zoom range ~1.5x, detection threshold calibrated for typical laptop distances (50–80 cm normal working distance). |
| Settings that survive popup close | Slider position and excluded sites must not reset every time popup closes. | Low | All settings write to `chrome.storage.sync` immediately on change. |

---

## Differentiators

Features that make this extension stand out. Not universally expected, but high perceived value for the target user.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Adjustable zoom range slider | Different users, different monitors, different use cases. A slider for max zoom (e.g., 100%–200%) lets users tune sensitivity without touching chrome://settings. | Low | HTML range input. Maps slider value to max zoom level. Store in chrome.storage.sync. |
| Per-site exclusion (one-click from icon) | Some sites break with zoom (fixed-width layouts, web apps with internal scrolling). One-click exclude from the toolbar icon is frictionless. | Medium | Requires reading current tab URL, storing hostname in excluded list, checking exclusion on every zoom update. |
| Excluded sites list with management UI | Users accumulate excluded sites. Need a way to review/remove them. Without this, exclusions pile up invisibly. | Medium | A scrollable list in popup showing excluded hostnames with remove buttons. |
| Smooth/damped zoom transitions | Raw distance-to-zoom mapping causes jitter. Smoothing (moving average or low-pass filter on distance values) makes the experience feel intentional rather than glitchy. | Medium | Purely algorithmic — exponential moving average on the distance signal. No extra APIs needed. |
| Zoom deadband at normal distance | A "neutral zone" around the calibrated normal distance where zoom stays at 100% prevents micro-jitter when the user is holding still. | Low | Threshold check before applying zoom change. E.g., ±5% distance change triggers no update. |
| Auto-calibration on first enable | Instead of hard-coding what "normal distance" is, capture it at enable time. Instruction: "Sit normally and click Enable." | Medium | One-time measurement at toggle-on. Store calibrated distance in chrome.storage.sync. Allow recalibration. |

---

## Anti-Features

Things to explicitly NOT build. Each is a trap that adds complexity with no proportionate user value — or actively violates the product's core constraints.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Camera preview / live video feed in popup | Privacy concern (project constraint). Increases popup complexity massively. Users don't need to see themselves. | Status text only: "Camera active" or "Camera off". |
| Per-site zoom memory (remembering zoom level per domain) | Conflicts with the adaptive nature — zoom is dynamic, not a saved preference. Adds state complexity. Already explicitly out of scope in PROJECT.md. | One global behavior. If site is excluded, zoom is untouched. |
| CSS zoom / transform: scale() | Breaks site layouts, causes scroll issues, fights with site CSS, not visible in Chrome's zoom indicator. Already out of scope. | `tabs.setZoom()` only — consistent with native Ctrl+/- behavior. |
| Zoom-in on close (magnification mode) | The project explicitly uses closer = zoom out (show more content). Reversing this for magnification is a different product for a different user (low vision accessibility). Don't try to serve both. | Keep the closer = zoom-out (more content) model. Document the design decision clearly. |
| Cloud sync of excluded sites to a server | No server, no account, no data leaving the device. `chrome.storage.sync` already syncs across Chrome-signed-in devices via Google's infrastructure with zero effort. | chrome.storage.sync handles cross-device sync automatically. |
| Hotkey/keyboard shortcut for zoom control | Zoom is automatic — a hotkey conflicts with the hands-free value prop. Also, Chrome already has Ctrl+/- for manual zoom. | Keep it automatic. If user wants manual, they use native Chrome shortcuts. |
| Mobile / tablet support | Manifest V3 Chrome extensions run on desktop Chrome only. Webcam-based detection assumes a front-facing laptop camera. | Clearly scope to desktop Chrome. The primary audience (laptop users) is already defined. |
| Onboarding wizard / multi-step setup flow | Over-engineering for a single-purpose extension. Adds friction to first use. | A single "Enable" toggle with a one-line description. Auto-calibrate silently on first enable. |
| Multiple zoom profiles | "Work profile" vs "reading profile" etc. adds state management complexity disproportionate to value. | One slider, one behavior. |

---

## Feature Dependencies

```
Enable/disable toggle
  └── Visual active indicator (depends on toggle state)
  └── Zoom-resets-on-disable (depends on toggle state)
  └── Auto-calibration on first enable (triggered by toggle-on)
      └── Normal distance baseline (output of calibration, input to zoom mapping)

Normal distance baseline
  └── Zoom deadband at normal distance (uses baseline value)
  └── Distance-to-zoom mapping (uses baseline as reference point)
      └── Smooth/damped zoom transitions (post-processing on mapping output)
      └── Per-site exclusion check (gate before applying zoom)

Per-site exclusion (one-click from icon)
  └── Excluded sites list with management UI (reads same exclusion store)

Adjustable zoom range slider
  └── Distance-to-zoom mapping (uses max zoom value from slider)

Persistence (chrome.storage.sync)
  └── All of the above (all settings read/write to storage)
```

---

## MVP Recommendation

Build in this order — each item is usable without the next, and each unlocks the next:

1. **Enable/disable toggle with visual indicator** — the on-ramp. Nothing else matters without this.
2. **Distance-to-zoom mapping** — the core value. Hard-coded normal distance initially.
3. **Zoom reset on disable** — prevents user feeling trapped; required for credibility.
4. **Zoom deadband + smoothing** — without this the raw experience is unusable (jitter). Do not ship without it.
5. **Adjustable zoom range slider** — first customization unlock; high perceived value, low effort.
6. **Auto-calibration on first enable** — moves from "works on my laptop" to "works for everyone."
7. **Per-site exclusion (one-click)** — addresses the inevitable broken-site complaints.
8. **Excluded sites list with management UI** — completes the exclusion flow.
9. **Persistence** — should be implemented from step 1 onward, not deferred.

Defer indefinitely: everything in Anti-Features above.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Table stakes (toggle, indicator, persistence) | HIGH | Universal Chrome extension UX norms — well-established, training data reliable |
| Zoom reset behavior | HIGH | Deterministic from `tabs.setZoom()` API contract — no ambiguity |
| Differentiators (smoothing, deadband, calibration) | MEDIUM | Based on signal-processing and UX reasoning; no direct competitor evidence verified live |
| Anti-features (CSS zoom, preview, per-site memory) | HIGH | Explicitly excluded in PROJECT.md + well-known Chrome extension constraints |
| Feature complexity estimates | MEDIUM | Based on Chrome API familiarity from training; complexity could shift if face detection library choice is constrained |
| MVP ordering | MEDIUM | Logical dependency ordering; could shift based on implementation findings |

---

## Sources

- Project context: `/Users/dusan/Desktop/zoomme/.planning/PROJECT.md` (HIGH — primary source of record)
- Chrome Extension architecture: `/Users/dusan/Desktop/zoomme/.planning/codebase/ARCHITECTURE.md`
- Chrome `tabs.setZoom()` API — training data knowledge (HIGH confidence for existence/behavior; version constraints may differ)
- `chrome.storage.sync` API — training data (HIGH confidence; well-established API)
- MediaPipe / TensorFlow.js face detection patterns — training data (MEDIUM confidence; library APIs change)
- General Chrome extension UX norms — training data synthesis (MEDIUM confidence; verified against real extension patterns in training corpus)

**Note:** Live web research was unavailable. Competitor analysis (existing zoom extensions on Chrome Web Store) was not possible in this session. The feature landscape is derived from first-principles analysis of the project context + Chrome extension domain knowledge. Recommend a follow-up pass comparing against 2–3 real extensions in the Chrome Web Store before finalizing phase requirements.
