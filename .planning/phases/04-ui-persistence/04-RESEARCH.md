# Phase 4: UI + Persistence - Research

**Researched:** 2026-02-17
**Domain:** Chrome Extension MV3 — chrome.storage, popup↔background sync, site exclusion, HTML range input
**Confidence:** HIGH

---

## Summary

Phase 4 adds three features to the existing popup+background: a max-zoom slider, a per-site exclusion toggle, and persistence of both across browser restarts. All three are straightforward uses of `chrome.storage.sync` with no new permissions required — the manifest already declares `"storage"` and `"tabs"`.

The key architectural decision: **the popup writes directly to `chrome.storage.sync`** for settings (slider value, excluded sites list). The background reads from storage at service worker startup and listens for `chrome.storage.onChanged` to keep its in-memory cache fresh. This is the standard MV3 pattern: no message round-trip required for settings persistence, and the background always has correct values because `onChanged` fires cross-context whenever any extension page writes to storage.

For site exclusion, store hostnames (not full origins). This handles both `http://` and `https://` variants of the same site, covers subdomainless matching (e.g. `github.com` matches both `github.com/` and `github.com/settings`), and produces readable UI strings. The check in `applyZoom` is a single `Array.includes()` call.

**Primary recommendation:** Popup writes to `chrome.storage.sync` directly. Background caches settings in module-level variables, loads them on startup, and refreshes via `storage.onChanged`. All checks happen against the in-memory cache — no storage read per distance reading.

---

## Research Findings by Question

### Q1: chrome.storage.sync vs chrome.storage.local

**Decision: Use `chrome.storage.sync`.**

| Attribute | storage.sync | storage.local |
|-----------|-------------|---------------|
| Total quota | ~100 KB | 10 MB |
| Per-item limit | 8 KB | No limit |
| Write rate limit | 120/min, 1800/hr | None |
| Cross-device sync | Yes | No |
| Suitable for | User preferences, small settings | Large data, caches |

The ZoomMe settings are tiny: a single float (ZOOM_MAX, ~8 bytes) and a list of hostnames (each ~30 bytes, realistically ≤20 sites = ~600 bytes). Total payload is well under the 8 KB per-item limit and far under the 100 KB total quota. Write rate is never a concern — settings change only on explicit user action.

`storage.sync` is the correct choice: it preserves user preferences across Chrome profile sync (multiple devices), matches the stated requirement ("persist across sessions"), and is exactly what this storage area was designed for.

**Source:** [chrome.storage API - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) — HIGH confidence.

---

### Q2: Popup writing directly vs. messaging background

**Decision: Popup writes directly to `chrome.storage.sync`. Background reacts via `storage.onChanged`.**

In MV3, popup pages have full access to all Chrome extension APIs including `chrome.storage`. There is no architectural requirement to route storage writes through the background service worker. Messaging adds complexity and a round-trip with no benefit when the storage API is directly accessible.

The correct MV3 pattern:
1. Popup reads current settings from `storage.sync` on open to populate UI.
2. Popup writes to `storage.sync` on user change (slider input, exclude button).
3. Background registers `chrome.storage.onChanged` at global scope to react to changes.
4. Background also reads from `storage.sync` on startup to seed its in-memory cache (because it may have been terminated since the last write).

`storage.onChanged` fires in ALL extension contexts including the service worker, regardless of which context wrote the value. This is confirmed: "a popup page can immediately save settings to storage.sync, and the service worker can use storage.onChanged to apply the setting as soon as possible."

**Source:** [chrome.storage API docs](https://developer.chrome.com/docs/extensions/reference/api/storage), [MDN storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged) — HIGH confidence.

---

### Q3: Site exclusion — hostname vs origin

**Decision: Store hostnames. Check by hostname.**

| Approach | Example stored | Covers http:// AND https:// | Readable in UI |
|----------|---------------|----------------------------|----------------|
| Hostname | `github.com` | Yes | Yes |
| Full origin | `https://github.com` | No (must add both) | Acceptable |

Hostname matching is strictly simpler and more user-friendly. When a user visits `https://github.com/settings` and clicks "Exclude this site", they expect `github.com` to be excluded regardless of scheme. Storing full origins would require doubling entries to cover http and https.

**Extraction in popup:**
```javascript
// Source: standard URL Web API, no library needed
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const hostname = new URL(tab.url).hostname; // e.g. "github.com"
```

**Check in background applyZoom:**
```javascript
// In-memory cache, populated on startup and updated via onChanged
let excludedSites = []; // array of hostnames

async function applyZoom(rawRatio) {
  if (activeTabId === null) return;

  // Get URL of active tab to check exclusion
  const tab = await chrome.tabs.get(activeTabId);
  if (!tab.url) return;
  const hostname = new URL(tab.url).hostname;
  if (excludedSites.includes(hostname)) return; // skip excluded sites

  // ... rest of zoom logic
}
```

**Edge cases handled by hostname approach:**
- `github.com` and `www.github.com` are treated as different hostnames — this is correct behavior (user can exclude each explicitly).
- Non-http tabs (`chrome://`, `file://`) will throw on `new URL(tab.url).hostname` but those tabs already skip zoom (the existing code checks `tab.url?.startsWith('http')`).

**Source:** URL Web API (standard), prior code in background.js — HIGH confidence.

---

### Q4: Background settings — cache in memory vs read per reading

**Decision: Cache in module-level variables. Read from storage at startup. Refresh via `storage.onChanged`.**

`chrome.storage` reads are async. Awaiting a storage read on every `DISTANCE_READING` message (arriving at ~1Hz) adds latency to every zoom update and creates unnecessary I/O. The better approach is:

1. **On service worker startup**: read settings once into module-level variables.
2. **On `storage.onChanged`**: update module-level variables immediately.
3. **In `applyZoom`**: read directly from module-level variables — no async I/O.

The concern about service worker termination is handled by step 1: the service worker is guaranteed to run its top-level script before handling any event, so the startup read always runs before the first `DISTANCE_READING` is processed.

```javascript
// Module-level cache — populated on startup, kept fresh by onChanged
let settings = {
  zoomMax: 2.5,          // default
  excludedSites: []      // default
};

// Load on startup (runs before any events are dispatched)
chrome.storage.sync.get(
  { zoomMax: 2.5, excludedSites: [] },
  (stored) => { settings = stored; }
);

// Keep cache fresh when popup writes to storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.zoomMax)      settings.zoomMax      = changes.zoomMax.newValue;
  if (changes.excludedSites) settings.excludedSites = changes.excludedSites.newValue;
});
```

**Important:** `storage.onChanged` must be registered at the global scope (not inside an async function) so Chrome can restore it after service worker restart. This is already consistent with the existing pattern in background.js where all `chrome.*` listeners are at the top level.

**Source:** [Service worker lifecycle - Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [chrome.storage API docs](https://developer.chrome.com/docs/extensions/reference/api/storage) — HIGH confidence.

---

### Q5: Popup getting active tab URL

**Decision: Use `chrome.tabs.query({ active: true, currentWindow: true })`.**

The manifest already has `"tabs"` permission (confirmed in manifest.json line 19). With `"tabs"` permission, `tab.url` is populated in query results without needing `"activeTab"`.

```javascript
// Source: chrome.tabs API docs — HIGH confidence
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (!tab || !tab.url?.startsWith('http')) {
  // Cannot exclude chrome:// pages or blank tabs — hide/disable the exclude button
  return;
}
const hostname = new URL(tab.url).hostname;
```

Note: `currentWindow: true` is correct for popups. `lastFocusedWindow: true` is more appropriate for background scripts (which have no window context). Popup always opens in the context of the current window.

**Permission situation:** No new permissions needed. `"tabs"` already declared, `"storage"` already declared.

**Source:** [chrome.tabs API - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/tabs) — HIGH confidence.

---

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `chrome.storage.sync` | Built-in (Chrome 116+) | Persist slider + excluded sites | Native, cross-device sync, right quota tier |
| `chrome.tabs.query` | Built-in (Chrome 116+) | Get active tab hostname in popup | Already permitted, async/await compatible |
| `<input type="range">` | HTML standard | Slider for ZOOM_MAX | Native, no library needed, works in extension popup |
| `chrome.storage.onChanged` | Built-in (Chrome 116+) | Background reacts to settings changes | Cross-context, fires in service worker |

### No External Libraries Needed

This is a vanilla JS MV3 extension with no build system. All required functionality is available natively.

---

## Architecture Patterns

### Recommended File Changes

```
background.js
├── Add: settings cache object (zoomMax, excludedSites)
├── Add: storage.sync read on startup to populate cache
├── Add: chrome.storage.onChanged listener to refresh cache
└── Modify: applyZoom() to check excludedSites and use settings.zoomMax

popup/popup.html
├── Add: <input type="range"> for ZOOM_MAX slider
├── Add: "Exclude this site" button
└── Add: excluded sites list container

popup/popup.js
├── Add: load settings from storage.sync on popup open
├── Add: write zoomMax to storage.sync on slider change
├── Add: exclude button handler (read tab URL, update excludedSites list in storage)
└── Add: render + remove buttons for excluded sites list
```

### Pattern 1: Settings Storage Schema

```javascript
// Source: chrome.storage.sync API
// Key: 'zoomMax' — float, default 2.5
// Key: 'excludedSites' — Array<string> (hostnames), default []

// Write (from popup)
await chrome.storage.sync.set({ zoomMax: 2.0 });
await chrome.storage.sync.set({ excludedSites: ['github.com', 'notion.so'] });

// Read with defaults (from popup on open, and from background on startup)
chrome.storage.sync.get(
  { zoomMax: 2.5, excludedSites: [] },
  (result) => {
    // result.zoomMax guaranteed to be 2.5 if not previously set
    // result.excludedSites guaranteed to be [] if not previously set
  }
);
```

### Pattern 2: Popup Initializes from Storage

```javascript
// popup.js — on DOMContentLoaded
async function initSettings() {
  const { zoomMax, excludedSites } = await chrome.storage.sync.get({
    zoomMax: 2.5,
    excludedSites: []
  });

  slider.value = zoomMax;
  sliderLabel.textContent = `Max zoom: ${zoomMax.toFixed(1)}x`;
  renderExcludedList(excludedSites);
}
```

### Pattern 3: Slider Writes to Storage

```javascript
// popup.js — on slider 'input' event (fires during drag, not just on release)
slider.addEventListener('input', async () => {
  const zoomMax = parseFloat(slider.value);
  sliderLabel.textContent = `Max zoom: ${zoomMax.toFixed(1)}x`;
  await chrome.storage.sync.set({ zoomMax });
  // background.onChanged fires automatically — no message needed
});
```

### Pattern 4: Exclude Button Handler

```javascript
// popup.js
async function excludeCurrentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('http')) return;

  const hostname = new URL(tab.url).hostname;
  const { excludedSites } = await chrome.storage.sync.get({ excludedSites: [] });

  if (!excludedSites.includes(hostname)) {
    const updated = [...excludedSites, hostname];
    await chrome.storage.sync.set({ excludedSites: updated });
    renderExcludedList(updated);
  }
}
```

### Pattern 5: Remove Site Handler

```javascript
// popup.js
async function removeSite(hostname) {
  const { excludedSites } = await chrome.storage.sync.get({ excludedSites: [] });
  const updated = excludedSites.filter(h => h !== hostname);
  await chrome.storage.sync.set({ excludedSites: updated });
  renderExcludedList(updated);
}
```

### Pattern 6: Background Cache + onChanged

```javascript
// background.js — add at top level (global scope)
let settings = { zoomMax: 2.5, excludedSites: [] };

// Load on startup (synchronous kick-off; runs before first event)
chrome.storage.sync.get({ zoomMax: 2.5, excludedSites: [] }, (stored) => {
  settings = stored;
});

// Keep fresh when popup writes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.zoomMax)       settings.zoomMax       = changes.zoomMax.newValue;
  if (changes.excludedSites) settings.excludedSites = changes.excludedSites.newValue;
});
```

### Pattern 7: Modified applyZoom with Exclusion Check

```javascript
// background.js — modified applyZoom
async function applyZoom(rawRatio) {
  if (activeTabId === null) {
    const tab = await queryActiveTab();
    if (!tab) return;
    activeTabId = tab.id;
  }

  // Check exclusion using in-memory cache (no storage I/O)
  try {
    const tab = await chrome.tabs.get(activeTabId);
    if (tab.url) {
      const hostname = new URL(tab.url).hostname;
      if (settings.excludedSites.includes(hostname)) return;
    }
  } catch (e) {
    return; // tab closed or restricted
  }

  // Use settings.zoomMax from cache instead of hardcoded constant
  const zoom = ratioToZoom(updateEma(rawRatio), settings.zoomMax);
  // ... rest unchanged
}
```

### Anti-Patterns to Avoid

- **Reading from storage.sync inside applyZoom:** Adds async latency to every distance reading; use in-memory cache instead.
- **Messaging background to write settings:** Adds unnecessary round-trip; popup can write directly.
- **Storing full origins (e.g. `https://github.com`):** Double-stores http/https variants; hostname is sufficient.
- **Registering `storage.onChanged` inside an async function:** Must be at global scope or Chrome may not restore it after service worker restart.
- **Using `lastFocusedWindow: true` in popup query:** Use `currentWindow: true` in popup context; `lastFocusedWindow` is for background scripts with no window context.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-session persistence | localStorage, cookies, IndexedDB | `chrome.storage.sync` | Survives browser restart, syncs across devices, already permitted |
| Cross-context notification of setting changes | Custom messaging bus | `chrome.storage.onChanged` | Built-in, fires in all extension contexts including service worker |
| URL parsing | String splitting, regex | `new URL(tab.url).hostname` | Handles edge cases (port numbers, IPv6, trailing slashes), built-in |

---

## Common Pitfalls

### Pitfall 1: storage.sync quota exceeded silently

**What goes wrong:** Writes to `storage.sync` fail silently when quota is exceeded. For ZoomMe this is not a realistic risk (tiny data), but the pattern matters.

**How to avoid:** Check `chrome.runtime.lastError` after writes. For an excluded sites list, adding a UI cap of e.g. 100 sites is more than sufficient and keeps well under quota.

### Pitfall 2: Popup opens before background has loaded settings

**What goes wrong:** Popup reads from storage directly so it always has correct values regardless of background state. However, if background starts from cold and a distance reading arrives before the startup `storage.sync.get` callback fires, `settings` will have defaults.

**Why it's acceptable:** The startup `storage.sync.get` callback fires in the same microtask queue tick as the service worker start. Distance readings come from the offscreen document which can only send them after the port connects (after `waitForPort`). The port connection requires the offscreen document to load and connect, which takes >100ms. The storage read will complete long before the first `DISTANCE_READING` arrives.

### Pitfall 3: Slider fires rapid writes during drag

**What goes wrong:** `input` event fires many times per second during slider drag, causing rapid `storage.sync.set` calls which could hit the 120 writes/min rate limit.

**Why it probably doesn't matter in practice:** A typical drag lasts <3 seconds and fires ≤60 events, well under the 120/min limit. However, the safe pattern is to use `input` for visual update and `change` (fires once on release) for storage write. Given ZoomMe's settings panel is small, using `change` is the safest approach.

**How to avoid:**
```javascript
// Visual update on every drag position
slider.addEventListener('input', () => {
  sliderLabel.textContent = `Max zoom: ${parseFloat(slider.value).toFixed(1)}x`;
});
// Storage write only on release
slider.addEventListener('change', async () => {
  await chrome.storage.sync.set({ zoomMax: parseFloat(slider.value) });
});
```

### Pitfall 4: Exclude button shows on non-http tabs

**What goes wrong:** User opens popup while on `chrome://extensions`. `tab.url` starts with `chrome://`, so `new URL(tab.url).hostname` returns `extensions` and you'd exclude a meaningless "hostname".

**How to avoid:** Check `tab.url?.startsWith('http')` before showing/enabling the exclude button. Hide or gray it out on non-http tabs.

### Pitfall 5: storage.onChanged not registered at global scope

**What goes wrong:** If `chrome.storage.onChanged.addListener(...)` is inside an async IIFE or async function, Chrome may not restore it when the service worker restarts from idle.

**How to avoid:** Register `storage.onChanged` at the top level of background.js, the same way `chrome.runtime.onMessage` and `chrome.runtime.onConnect` are already registered.

---

## Code Examples

### HTML Slider Element
```html
<!-- popup/popup.html — add inside .popup div -->
<div class="slider-row">
  <span>Max zoom</span>
  <input id="zoom-slider" type="range" min="1.2" max="4.0" step="0.1" value="2.5">
  <span id="zoom-label">2.5x</span>
</div>
<button id="exclude-btn">Exclude this site</button>
<div id="excluded-list"></div>
```

### Render Excluded Sites List
```javascript
// popup.js
function renderExcludedList(sites) {
  const list = document.getElementById('excluded-list');
  list.innerHTML = '';
  if (sites.length === 0) {
    list.textContent = 'No excluded sites.';
    return;
  }
  sites.forEach(hostname => {
    const row = document.createElement('div');
    row.className = 'excluded-row';
    const label = document.createElement('span');
    label.textContent = hostname;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeSite(hostname));
    row.appendChild(label);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}
```

### Full Startup Sequence in popup.js
```javascript
// popup.js — DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load existing state from background (camera status)
  refreshState();

  // 2. Load settings from storage
  const { zoomMax, excludedSites } = await chrome.storage.sync.get({
    zoomMax: 2.5,
    excludedSites: []
  });
  document.getElementById('zoom-slider').value = zoomMax;
  document.getElementById('zoom-label').textContent = `${zoomMax.toFixed(1)}x`;
  renderExcludedList(excludedSites);

  // 3. Get active tab for exclude button label
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const excludeBtn = document.getElementById('exclude-btn');
  if (tab?.url?.startsWith('http')) {
    const hostname = new URL(tab.url).hostname;
    excludeBtn.textContent = `Exclude ${hostname}`;
    excludeBtn.disabled = false;
  } else {
    excludeBtn.textContent = 'Exclude this site';
    excludeBtn.disabled = true;
  }
});
```

---

## Manifest Changes Required

**None.** The manifest already declares:
- `"storage"` — required for `chrome.storage.sync`
- `"tabs"` — required for `chrome.tabs.query` with URL access

No new permissions are needed for Phase 4.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `localStorage` in popup | `chrome.storage.sync` | localStorage doesn't persist across browser restarts in extension contexts reliably; storage.sync is the standard |
| Message background to write settings | Popup writes directly to storage | Simpler in MV3; no round-trip needed |
| Per-origin exclusion | Per-hostname exclusion | Hostname covers http+https; origin requires two entries per site |

---

## Open Questions

1. **`ratioToZoom` needs to accept dynamic `zoomMax`**
   - What we know: Current `ratioToZoom` uses module-level `ZOOM_MAX` constant
   - What's unclear: Whether to pass `zoomMax` as parameter or read from `settings.zoomMax` directly inside the function
   - Recommendation: Pass as parameter — `ratioToZoom(r, zoomMax)` — makes the function pure and testable

2. **Slider range and step values**
   - What we know: Current hardcoded `ZOOM_MAX = 2.5`, `ZOOM_MIN = 0.3`. Chrome allows zoom 0.3–5.0.
   - What's unclear: What range is actually useful (very high zoom at very far distance is disorienting)
   - Recommendation: Slider range 1.2–3.0, step 0.1, default 2.5. This stays well within practical use.

3. **Whether to show "already excluded" state on the button**
   - What we know: User might re-open popup on an already-excluded site
   - Recommendation: Check if hostname is already in `excludedSites`; if so, show "Remove exclusion" instead of "Exclude this site"

---

## Sources

### Primary (HIGH confidence)
- [chrome.storage API - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) — storage.sync vs local quotas, onChanged API, get with defaults
- [chrome.tabs API - Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/tabs) — tabs.query, URL access with "tabs" permission, currentWindow vs lastFocusedWindow
- [MDN storage.onChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged) — fires in service workers, all contexts receive the event
- [Service worker lifecycle - Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — 30s idle timeout, global scope listener registration requirement

### Secondary (MEDIUM confidence)
- WebSearch: Multiple sources confirm popup can write directly to chrome.storage without routing through background; confirmed against official docs above
- WebSearch: "popup page can immediately save settings to storage.sync, and the service worker can use storage.onChanged to apply the setting as soon as possible" — consistent with official API docs

---

## Metadata

**Confidence breakdown:**
- chrome.storage.sync quota limits and API: HIGH — verified against official Chrome docs
- Popup direct write pattern: HIGH — confirmed by official docs and multiple sources
- storage.onChanged in service worker: HIGH — confirmed by MDN and official Chrome docs
- Hostname vs origin for exclusion: HIGH — URL Web API is standard, logic is sound
- Slider `change` vs `input` for storage writes: MEDIUM — rate limit math is correct but rate limit behavior in Chrome is verified as "120 writes/min" from official docs

**Research date:** 2026-02-17
**Valid until:** 2026-08-17 (Chrome storage APIs are stable)
