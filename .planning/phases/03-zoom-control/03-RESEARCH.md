# Phase 3: Zoom Control - Research

**Researched:** 2026-02-17
**Domain:** Chrome Tabs Zoom API, signal smoothing, MV3 service worker
**Confidence:** HIGH

---

## Summary

Phase 3 wires the distance ratio signal from the offscreen document to `chrome.tabs.setZoom()` in the background service worker. The Chrome Tabs API provides a built-in zoom method that requires no additional manifest permissions beyond what already exists. The main engineering work is converting the ratio signal into a zoom level and making that zoom level stable enough to not flicker.

The key design insight: readings arrive at ~1s intervals, which is slow enough that EMA with alpha=0.3 provides strong smoothing without noticeable lag. A dead zone around ratio=1.0 (±0.15) prevents micro-jitter at resting distance from causing any zoom changes. Zoom must be applied with `scope: "per-tab"` so it does not bleed to other tabs of the same origin.

**Primary recommendation:** Apply EMA to the raw ratio, apply a dead zone, then map the smoothed ratio linearly to a zoom factor using `chrome.tabs.setZoom(tabId, zoomFactor)` on the active tab whenever the computed zoom level changes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chrome.tabs` | Built-in (Chrome 116+) | Set tab zoom level | Native Chrome API, no install |

### No External Libraries Needed

Everything required — EMA, dead zone, linear mapping — is trivial arithmetic. No npm packages needed in a no-build-system vanilla JS extension.

---

## Architecture Patterns

### Recommended Structure

Add zoom control logic directly inside `background.js`. No new files needed for this phase.

```
background.js
├── EMA state variable (emaRatio)
├── Active tab tracking (activeTabId)
├── applyZoom(ratio) — smoothing + dead zone + mapping + setZoom call
└── DISTANCE_READING message handler calls applyZoom()
```

### Pattern 1: Exponential Moving Average (EMA)

**What:** Single-state low-pass filter that weights recent readings more than old ones.

**Formula:** `ema = alpha * newValue + (1 - alpha) * previousEma`

**Alpha selection for 1s intervals:**
- alpha=0.5: settles in ~3 samples, more responsive, less smooth
- alpha=0.3: settles in ~5 samples, good balance for 1s intervals
- alpha=0.1: settles in ~15 samples, over-smoothed for 1s data

**Recommendation:** alpha=0.3. At 1s per sample this provides ~5s settling time — fast enough to respond to deliberate posture change, slow enough to absorb single-frame outliers.

```javascript
// Source: Standard signal processing formula
const EMA_ALPHA = 0.3;
let emaRatio = null; // null = not initialized yet

function updateEma(newRatio) {
  if (emaRatio === null) {
    emaRatio = newRatio; // seed with first reading
  } else {
    emaRatio = EMA_ALPHA * newRatio + (1 - EMA_ALPHA) * emaRatio;
  }
  return emaRatio;
}
```

### Pattern 2: Dead Zone

**What:** A symmetric range around ratio=1.0 that maps to exactly 100% zoom. Prevents any zoom change while the user is at rest.

**Recommended width:** ±0.15 (i.e., ratio 0.85–1.15 = 100% zoom). This covers normal head movement while seated.

```javascript
const DEAD_ZONE_LOW  = 0.85;  // below this = zoomed in
const DEAD_ZONE_HIGH = 1.15;  // above this = zoomed out

function ratioToZoom(smoothedRatio) {
  if (smoothedRatio >= DEAD_ZONE_LOW && smoothedRatio <= DEAD_ZONE_HIGH) {
    return 1.0; // dead zone: no change
  }
  // Map outside dead zone to zoom range
  // ...
}
```

### Pattern 3: Distance-to-Zoom Linear Mapping

**Coordinate system:**
- ratio > 1.0 = closer to screen = zoom OUT (less than 1.0)
- ratio < 1.0 = farther from screen = zoom IN (greater than 1.0, up to cap)

**Mapping strategy:** Linear interpolation from dead zone boundary to zoom limit.

```
ratio 1.15 → zoom 1.0  (dead zone edge, normal)
ratio 2.0  → zoom 0.5  (very close, zoomed out)
ratio 0.85 → zoom 1.0  (dead zone edge, normal)
ratio 0.5  → zoom 1.5  (far back, zoomed in)
```

```javascript
// Source: derived from chrome.tabs zoom range [0.3, 5.0] and UX requirements
const ZOOM_MIN = 0.5;   // maximum zoom-out when very close
const ZOOM_MAX = 1.5;   // maximum zoom-in when very far

function ratioToZoom(smoothedRatio) {
  if (smoothedRatio >= DEAD_ZONE_LOW && smoothedRatio <= DEAD_ZONE_HIGH) {
    return 1.0;
  }
  if (smoothedRatio > DEAD_ZONE_HIGH) {
    // Closer than normal: zoom out
    // Map [DEAD_ZONE_HIGH, 2.0] -> [1.0, ZOOM_MIN]
    const t = Math.min((smoothedRatio - DEAD_ZONE_HIGH) / (2.0 - DEAD_ZONE_HIGH), 1.0);
    return 1.0 - t * (1.0 - ZOOM_MIN);
  } else {
    // Farther than normal: zoom in
    // Map [DEAD_ZONE_LOW, 0.3] -> [1.0, ZOOM_MAX]
    const t = Math.min((DEAD_ZONE_LOW - smoothedRatio) / (DEAD_ZONE_LOW - 0.3), 1.0);
    return 1.0 + t * (ZOOM_MAX - 1.0);
  }
}
```

### Pattern 4: Active Tab Tracking

**What:** Keep a cached `activeTabId` that is updated whenever the user switches tabs.

**Why cache instead of querying each time:** `chrome.tabs.query()` is async. Caching avoids the latency and race conditions on every distance reading.

```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onActivated
let activeTabId = null;

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTabId = tabId;
});

// Seed on startup (service worker may wake after tab is already active)
async function seedActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) activeTabId = tab.id;
}
seedActiveTab();
```

### Pattern 5: Applying Zoom with Per-Tab Scope

**What:** Set zoom mode to `manual` + scope to `per-tab` on each new active tab so the zoom is isolated to that tab only and does not persist after navigation.

**Why manual mode:** In `automatic` mode Chrome handles zoom internally and defaults to `per-origin` scope, which bleeds to all same-origin tabs. `manual` mode forces `per-tab` scope.

**Why per-tab scope:** Per-origin zoom persists across navigation and affects sibling tabs. Per-tab zoom resets on navigation, which is the right behavior for a proximity-driven control.

```javascript
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoomSettings
async function ensurePerTabZoomMode(tabId) {
  try {
    await chrome.tabs.setZoomSettings(tabId, { mode: 'manual', scope: 'per-tab' });
  } catch (e) {
    // Silently ignore: chrome:// pages, NTP, and PDF viewer throw errors here
  }
}
```

### Pattern 6: Full applyZoom Function

```javascript
let lastZoomFactor = null;

async function applyZoom(rawRatio) {
  if (!activeTabId) return;

  const smoothed = updateEma(rawRatio);
  const zoom = ratioToZoom(smoothed);

  // Avoid redundant setZoom calls — only call if value changed meaningfully
  if (lastZoomFactor !== null && Math.abs(zoom - lastZoomFactor) < 0.01) return;

  try {
    await chrome.tabs.setZoom(activeTabId, zoom);
    lastZoomFactor = zoom;
  } catch (e) {
    // Silently ignore errors on restricted pages (chrome://, NTP, etc.)
  }
}

// Called in DISTANCE_READING message handler:
// applyZoom(msg.ratio);
```

### Pattern 7: Reset Zoom on Disable

```javascript
async function resetZoom() {
  if (activeTabId !== null) {
    try {
      await chrome.tabs.setZoom(activeTabId, 1.0);
    } catch (e) {
      // Ignore restricted pages
    }
  }
  emaRatio = null;
  lastZoomFactor = null;
}

// Call resetZoom() inside disableCamera() in background.js
```

### Anti-Patterns to Avoid

- **Calling setZoom on every DISTANCE_READING without checking for change:** Causes unnecessary API calls; if the computed zoom is the same as last time, skip the call.
- **Using per-origin scope:** Bleeds zoom to all same-origin tabs and persists across navigation.
- **Forgetting to seed EMA on first reading:** Without seeding, the first few readings produce incorrect smoothed values.
- **Not catching setZoom errors:** `chrome.tabs.setZoom` throws on chrome://, the NTP, and PDF viewer. Uncaught promise rejections will log errors and may terminate the service worker.
- **Querying active tab on every reading:** Async query adds latency; cache `activeTabId` via `onActivated` instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser zoom | Custom CSS inject | `chrome.tabs.setZoom()` | Native, works on all pages, no CSP issues |
| Zoom persistence | Manual storage tracking | `per-tab` scope auto-resets on navigation | Browser handles lifecycle |

---

## Common Pitfalls

### Pitfall 1: setZoom Throws on Restricted Pages

**What goes wrong:** `chrome.tabs.setZoom()` rejects with an error when called on `chrome://`, `chrome-extension://`, the New Tab Page, or PDF viewer tabs.

**Why it happens:** Chrome restricts extension interaction with system pages.

**How to avoid:** Wrap every `setZoom` and `setZoomSettings` call in `try/catch`. Log and ignore the error; do not let it propagate.

**Warning signs:** "Cannot access contents of url chrome://" or similar errors in service worker console.

### Pitfall 2: EMA Not Seeded Causes Initial Jitter

**What goes wrong:** If `emaRatio` starts at 0 instead of the first reading, the first computed zoom value will be wildly incorrect.

**Why it happens:** `0 * alpha + 0 * (1-alpha) = 0`, which maps to maximum zoom-in.

**How to avoid:** Initialize `emaRatio = null`. On first reading, set `emaRatio = rawRatio` directly (no blending).

### Pitfall 3: Per-Origin Zoom Bleeds to Other Tabs

**What goes wrong:** User opens two tabs at `https://example.com`. Extension zooms one tab. The other tab also zooms because `per-origin` is the default in `automatic` mode.

**Why it happens:** Default zoom scope is `per-origin` when mode is `automatic`.

**How to avoid:** Call `setZoomSettings(tabId, { mode: 'manual', scope: 'per-tab' })` before or alongside each `setZoom` call.

### Pitfall 4: Service Worker Wakes Without Active Tab Context

**What goes wrong:** Service worker restarts (after idle timeout) and `activeTabId` is null. First distance reading does nothing.

**Why it happens:** MV3 service workers are ephemeral; in-memory state is lost when they sleep.

**How to avoid:** Call `chrome.tabs.query({ active: true, lastFocusedWindow: true })` at service worker startup to seed `activeTabId`. Also re-seed inside the `DISTANCE_READING` handler as a fallback if `activeTabId` is null.

### Pitfall 5: Zoom Changes on Every Reading Without Minimum Change Threshold

**What goes wrong:** Even after EMA smoothing, floating-point math produces slightly different values on every call, causing `setZoom` to fire every second even when the user is perfectly still.

**Why it happens:** EMA output changes by tiny amounts indefinitely.

**How to avoid:** Only call `setZoom` when the new zoom value differs from the last applied zoom by more than a threshold (0.01 = 1% zoom change is imperceptible).

---

## Code Examples

### Minimal Full Integration in background.js

```javascript
// Source: derived from chrome.tabs API docs and standard signal processing

// --- Zoom control state ---
const EMA_ALPHA      = 0.3;
const DEAD_ZONE_LOW  = 0.85;
const DEAD_ZONE_HIGH = 1.15;
const ZOOM_MIN       = 0.5;
const ZOOM_MAX       = 1.5;
const ZOOM_DELTA_MIN = 0.01; // don't setZoom if change < 1%

let emaRatio      = null;
let lastZoom      = null;
let activeTabId   = null;

// Seed active tab on startup
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) activeTabId = tab.id;
})();

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTabId = tabId;
  // Reset EMA when user switches tabs so the new tab isn't surprised
  emaRatio = null;
  lastZoom = null;
});

function updateEma(raw) {
  if (emaRatio === null) { emaRatio = raw; return emaRatio; }
  emaRatio = EMA_ALPHA * raw + (1 - EMA_ALPHA) * emaRatio;
  return emaRatio;
}

function ratioToZoom(r) {
  if (r >= DEAD_ZONE_LOW && r <= DEAD_ZONE_HIGH) return 1.0;
  if (r > DEAD_ZONE_HIGH) {
    const t = Math.min((r - DEAD_ZONE_HIGH) / (2.0 - DEAD_ZONE_HIGH), 1.0);
    return 1.0 - t * (1.0 - ZOOM_MIN);
  }
  const t = Math.min((DEAD_ZONE_LOW - r) / (DEAD_ZONE_LOW - 0.3), 1.0);
  return 1.0 + t * (ZOOM_MAX - 1.0);
}

async function applyZoom(rawRatio) {
  // Fallback: re-seed active tab if lost (service worker restart)
  if (activeTabId === null) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;
    activeTabId = tab.id;
  }

  const zoom = ratioToZoom(updateEma(rawRatio));
  if (lastZoom !== null && Math.abs(zoom - lastZoom) < ZOOM_DELTA_MIN) return;

  try {
    await chrome.tabs.setZoomSettings(activeTabId, { mode: 'manual', scope: 'per-tab' });
    await chrome.tabs.setZoom(activeTabId, zoom);
    lastZoom = zoom;
  } catch (e) {
    // Restricted page (chrome://, NTP, PDF); skip silently
  }
}

async function resetZoom() {
  if (activeTabId !== null) {
    try {
      await chrome.tabs.setZoom(activeTabId, 1.0);
    } catch (e) { /* restricted page */ }
  }
  emaRatio = null;
  lastZoom = null;
}

// In the port.onMessage listener, add:
// } else if (msg.type === 'DISTANCE_READING') {
//   applyZoom(msg.ratio);
// }

// In disableCamera(), add:
// await resetZoom();
```

### Manifest Change Required

```json
// No new permissions needed. setZoom works without "tabs" permission.
// The existing background.js already uses chrome.tabs.create (line 98),
// which also works without "tabs" permission.
// Source: https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions
```

---

## Chrome Tabs API: Zoom Facts

| Fact | Value | Source |
|------|-------|--------|
| setZoom requires "tabs" permission | No | Chrome docs |
| Valid zoom range | 0.3 – 5.0 | MDN tabs.setZoom |
| zoomFactor = 0 | Resets to browser default | Chrome docs |
| Default zoom scope | per-origin (in automatic mode) | Chrome docs |
| setZoom on chrome:// pages | Throws error | Community reports |
| setZoom requires host permissions | No | Chrome docs |
| per-tab zoom resets on navigation | Yes (Chrome) | MDN ZoomSettingsScope |

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Injecting CSS transform:scale() via content script | `chrome.tabs.setZoom()` | Native API handles all rendering, no content script needed |
| Storing zoom per-origin | per-tab scope | Avoids cross-tab bleed |

---

## Open Questions

1. **Dead zone width calibration**
   - What we know: ±0.15 ratio is a reasonable starting guess
   - What's unclear: The actual spread variation from normal head movement at a desk — this is dataset-dependent
   - Recommendation: Use ±0.15 as default, make it a named constant so it can be tuned in Phase 4

2. **EMA reset on tab switch**
   - What we know: Resetting emaRatio to null on tab switch is safest (prevents zoom "jumps" to wrong level)
   - What's unclear: Whether users will find the ~5s re-convergence period annoying
   - Recommendation: Reset on tab switch for now; revisit in Phase 4

3. **setZoomSettings call cost**
   - What we know: setZoomSettings must be called to set per-tab/manual scope; unclear if it needs to be called every reading or just once per tab
   - What's unclear: Whether the zoom settings persist until navigation or must be re-applied
   - Recommendation: Call setZoomSettings once per tab (track which tabs have been configured), fallback to calling it every time if that proves unreliable

---

## Sources

### Primary (HIGH confidence)
- [chrome.tabs API - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/tabs) — setZoom signature, permissions, zoom modes, onActivated
- [tabs.setZoom() - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/setZoom) — zoom factor range 0.3–5.0, parameter types
- [tabs.ZoomSettingsScope - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/ZoomSettingsScope) — per-tab vs per-origin behavior, Chrome navigation reset behavior

### Secondary (MEDIUM confidence)
- [EMA Mathematical Reference](https://tttapa.github.io/Pages/Mathematics/Systems-and-Control-Theory/Digital-filters/Exponential%20Moving%20Average/Exponential-Moving-Average.html) — formula, step response, settlement behavior
- [Chrome Extensions Permissions Discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/nvci7owIesA) — confirmed setZoom does not require "tabs" permission

### Tertiary (LOW confidence)
- WebSearch community reports — setZoom fails on chrome:// and NTP (consistent across sources but not in official docs)

---

## Metadata

**Confidence breakdown:**
- Chrome tabs zoom API (setZoom, range, permissions): HIGH — verified against official Chrome docs and MDN
- EMA formula and alpha selection: HIGH — standard signal processing, verified against math reference
- Dead zone width (±0.15): MEDIUM — reasonable engineering estimate, not empirically validated for this sensor
- setZoom on restricted pages throws: MEDIUM — consistent community reports, not in official docs
- Per-tab scope resets on navigation: HIGH — documented in MDN ZoomSettingsScope

**Research date:** 2026-02-17
**Valid until:** 2026-08-17 (Chrome APIs are stable; EMA math is timeless)
