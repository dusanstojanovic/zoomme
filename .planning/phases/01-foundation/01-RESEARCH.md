# Phase 1: Foundation - Research

**Researched:** 2026-02-15
**Domain:** Chrome Extension MV3 — Offscreen Document + Webcam Lifecycle + Service Worker Keepalive
**Confidence:** HIGH

---

## Summary

Phase 1 establishes the webcam context in a Chrome offscreen document, wires it to the background service worker, and implements the enable/disable toggle with a camera-active indicator. This phase has zero ML, zero zoom logic, and zero persistence complexity — it is purely about getting the right Chrome APIs connected in the right places.

The architecturally decisive constraint was already resolved in prior research: `getUserMedia` cannot run in a MV3 service worker (no DOM). The offscreen document is the only valid camera context in MV3. The two most dangerous pitfalls in this phase are (1) failing to guard against duplicate offscreen document creation on service worker restart, and (2) the service worker terminating after ~30s idle, breaking the message relay. Both have canonical solutions: use `chrome.runtime.getContexts()` before every `createDocument()` call, and use `chrome.runtime.connect()` long-lived ports (with periodic messages) to keep the service worker alive while the webcam is running.

The session-only state requirement (CAM-02: always starts unchecked on browser restart) is best served by `chrome.storage.session` (Chrome 102+, 10MB quota), which persists across service worker restarts within a browser session but is cleared on browser close/restart. This is exactly the semantic needed.

**Primary recommendation:** Build offscreen document + port-based keepalive + storage.session state in one tight unit. Do not separate them.

---

## Standard Stack

### Core

| API / Module | Version | Purpose | Why Standard |
|---|---|---|---|
| `chrome.offscreen` | Chrome 109+ | Creates hidden extension page with DOM for `getUserMedia` | Only valid camera context in MV3; explicitly supported with `USER_MEDIA` reason |
| `chrome.runtime.connect()` | All MV3 | Long-lived port between offscreen doc and service worker | Periodic messages through the port reset the SW's 30s idle timer — canonical keepalive |
| `chrome.storage.session` | Chrome 102+ | Per-session `enabled` flag | Persists across SW restarts within a session; cleared on browser restart — exactly CAM-02 semantics |
| `MediaStream` / `getUserMedia` | Web standard | Acquire webcam stream | Must be called from the offscreen document context |

### No External Libraries Needed for Phase 1

Phase 1 requires no npm packages. It is pure Chrome Extension APIs + Web platform APIs.

**Installation:** None. All APIs are built-in.

---

## Architecture Patterns

### Recommended File Structure After Phase 1

```
zoomme/
├── manifest.json           # Add: offscreen, camera permissions
├── background.js           # Add: offscreen lifecycle, port management, storage.session state
├── offscreen/
│   ├── offscreen.html      # New: minimal HTML shell for offscreen doc
│   └── offscreen.js        # New: getUserMedia, stream lifecycle, port to background
└── popup/
    ├── popup.html          # Update: checkbox toggle + status indicator
    ├── popup.js            # Update: sends SET_ENABLED, reads state for indicator
    └── popup.css           # Update: style for indicator
```

### Pattern 1: Guard Against Duplicate Offscreen Document

**What:** Before every `createDocument()` call, check whether one already exists using `chrome.runtime.getContexts()`.
**When to use:** Always — service workers restart after ~30s idle; in-memory state is lost; this guard must run on every creation attempt.

```javascript
// background.js
// Source: https://developer.chrome.com/docs/extensions/reference/api/offscreen

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });
  if (contexts.length > 0) return; // already exists
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Webcam stream for face distance detection'
  });
}
```

Note: `chrome.runtime.getContexts` requires Chrome 116+. The offscreen API itself requires Chrome 109+. The getContexts guard is the documented canonical pattern as of Chrome 116+.

### Pattern 2: Long-Lived Port for Service Worker Keepalive

**What:** Offscreen document opens a named port to the background service worker. It sends a heartbeat message every 20 seconds. Each message resets the service worker's 30s idle timer.
**When to use:** Whenever the webcam is active. Without this, the service worker dies mid-session and zoom updates stop.

```javascript
// offscreen.js — port side
let backgroundPort = null;
let heartbeatInterval = null;

function connectToBackground() {
  backgroundPort = chrome.runtime.connect({ name: 'offscreen-keepalive' });
  backgroundPort.onDisconnect.addListener(() => {
    // Service worker restarted — reconnect
    backgroundPort = null;
    clearInterval(heartbeatInterval);
    if (isStreaming) connectToBackground();
  });
  // Send heartbeat every 20s to keep SW alive (SW terminates after 30s idle)
  heartbeatInterval = setInterval(() => {
    backgroundPort?.postMessage({ type: 'HEARTBEAT' });
  }, 20000);
}

// background.js — port side
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'HEARTBEAT') {
        // Message receipt resets the 30s idle timer — no action needed
      }
      if (msg.type === 'CAMERA_READY') {
        // Offscreen is live — update state
        chrome.storage.session.set({ cameraActive: true });
      }
      if (msg.type === 'CAMERA_ERROR') {
        chrome.storage.session.set({ cameraActive: false });
      }
    });
    port.onDisconnect.addListener(() => {
      chrome.storage.session.set({ cameraActive: false });
    });
  }
});
```

**Confirmed behavior (MEDIUM confidence):** Messages sent through a connected port reset the service worker's idle timer. Opening a port alone (without messages) does NOT reset the timer in current Chrome versions.

### Pattern 3: Session-Only State with chrome.storage.session

**What:** `enabled` and `cameraActive` flags stored in `chrome.storage.session` — cleared on browser restart, persists across service worker restarts within a session.
**When to use:** Any state that must satisfy CAM-02 (session-only, always starts unchecked after browser restart) but must survive the service worker's 30s idle termination.

```javascript
// background.js — reading state on SW restart
chrome.runtime.onStartup.addListener(async () => {
  // Browser just started — session storage is already cleared automatically
  // Ensure clean state
  await chrome.storage.session.set({ enabled: false, cameraActive: false });
});

// On any SW wake, check session state to reconcile
async function getEnabledState() {
  const { enabled } = await chrome.storage.session.get({ enabled: false });
  return enabled;
}
```

`chrome.storage.session` characteristics (HIGH confidence — verified against official docs):
- Cleared on browser close/restart (satisfies CAM-02)
- Persists when service worker is terminated and restarts within a session
- 10MB quota (Chrome 112+; 1MB before that)
- No cross-device sync

### Pattern 4: Stream Cleanup on Stop

**What:** When STOP command is received (or port disconnects), explicitly stop all tracks on the MediaStream.
**When to use:** Every disable path — this is what turns off the webcam LED.

```javascript
// offscreen.js
let activeStream = null;

async function startCamera() {
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { max: 30 } }
    });
    const video = document.getElementById('video');
    video.srcObject = activeStream;
    await video.play();
    backgroundPort?.postMessage({ type: 'CAMERA_READY' });
  } catch (err) {
    backgroundPort?.postMessage({ type: 'CAMERA_ERROR', error: err.name });
    activeStream = null;
  }
}

function stopCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
    activeStream = null;
  }
  const video = document.getElementById('video');
  if (video) video.srcObject = null;
}
```

### Manifest Changes Required for Phase 1

```json
{
  "permissions": ["offscreen", "storage"],
  "host_permissions": [],
  "web_accessible_resources": []
}
```

Note: `"camera"` is NOT added to manifest permissions in Phase 1. Camera access is granted via browser's native `getUserMedia` prompt triggered from the offscreen document. The `"camera"` manifest permission (for pre-granting) is addressed in a later phase (per-session prompt behavior is acceptable for Phase 1 — see Open Questions).

### Anti-Patterns to Avoid

- **getUserMedia in background.js:** Throws immediately — service workers have no `navigator.mediaDevices`. All camera code lives in offscreen.js.
- **sendMessage for ZOOM_UPDATE relay:** Use the long-lived port. One-shot `sendMessage` from offscreen to background works, but if the SW is terminated between messages, the offscreen will not automatically restart it — the port onDisconnect handler provides recovery.
- **Storing enabled state in a global variable in background.js:** Lost on SW termination. Use `chrome.storage.session`.
- **Calling `chrome.offscreen.hasDocument()`:** This method was removed from the official API. Use `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` instead.
- **Not handling port disconnect in offscreen.js:** If the SW restarts, the port disconnects. offscreen.js must reconnect to re-establish the heartbeat channel.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Keepalive mechanism | Custom alarms/polling | `chrome.runtime.connect()` port + heartbeat messages | Canonical pattern; alarms have minimum 1-minute interval in MV3 (insufficient for 30s timeout) |
| Offscreen existence check | In-memory boolean flag | `chrome.runtime.getContexts()` | In-memory flag lost on SW restart — exact scenario being guarded against |
| Session-only enabled state | `chrome.storage.local` + manual clear on startup | `chrome.storage.session` | Session semantics built-in; no clear-on-startup logic needed |

**Key insight:** The Chrome extension APIs provide exactly the right tools for each problem. Custom solutions add code that must handle the same edge cases the built-in APIs already handle.

---

## Common Pitfalls

### Pitfall 1: Duplicate Offscreen Document on Service Worker Restart

**What goes wrong:** `chrome.offscreen.createDocument()` is called without checking if one exists. After ~30s idle the SW terminates; on next event it restarts and tries to create the document again. Chrome throws: "Only a single offscreen document may be created."

**Why it happens:** In-memory tracking of "did I create the document?" is lost on SW termination.

**How to avoid:** Always call `ensureOffscreenDocument()` (see Pattern 1 above) before any interaction with the offscreen document. Never assume the document doesn't exist.

**Warning signs:** Extension works on first use, fails after ~30 seconds of browser idle. Error in SW console: "Only a single offscreen document may be created."

### Pitfall 2: Service Worker Termination Kills Message Relay

**What goes wrong:** SW terminates after 30s idle. Subsequent messages from the offscreen document are dropped (no receiver). Webcam LED stays on but nothing relays to the popup.

**Why it happens:** One-shot `sendMessage` from offscreen to SW has no recovery path when SW is dead.

**How to avoid:** Use the long-lived port (Pattern 2). offscreen.js listens for `port.onDisconnect` and reconnects when the SW restarts and a new connection is established.

**Warning signs:** Webcam LED is on, popup shows "Camera off" after ~30 seconds of no popup interaction. SW shows "stopped" in chrome://extensions.

### Pitfall 3: Webcam LED Stays On After Disable

**What goes wrong:** The MediaStream is abandoned (not stopped) when the user unchecks the toggle. The webcam LED stays on permanently.

**Why it happens:** Closing or discarding the video element does not stop the underlying hardware stream. Tracks must be explicitly stopped.

**How to avoid:** In offscreen.js stopCamera(), always call `stream.getTracks().forEach(t => t.stop())` before nulling the reference. Verify LED turns off in manual testing.

**Warning signs:** After unchecking toggle, the webcam LED remains on. `activeStream.getTracks()` shows tracks still in `live` readyState.

### Pitfall 4: Popup Reads Stale State on Open

**What goes wrong:** Popup opens and shows "Camera off" even though the webcam is active, because it reads from a global variable that was reset when SW restarted.

**Why it happens:** Popup.js queries background for state; background reads from a global variable that doesn't survive SW restarts.

**How to avoid:** Background always reads `cameraActive` from `chrome.storage.session`, not from a global variable. Session storage survives SW restarts within a browser session.

**Warning signs:** Popup indicator is wrong after browser has been idle for 30+ seconds.

### Pitfall 5: `chrome.offscreen.hasDocument()` Does Not Exist

**What goes wrong:** Code calls `chrome.offscreen.hasDocument()` to check existence — this method does not exist in the current API.

**How to avoid:** Use `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` (Chrome 116+). This is the documented canonical check.

**Warning signs:** `TypeError: chrome.offscreen.hasDocument is not a function` in SW console.

---

## Code Examples

### Minimal Offscreen HTML Shell

```html
<!-- offscreen/offscreen.html -->
<!-- Source: https://developer.chrome.com/docs/extensions/reference/api/offscreen -->
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
  <!-- Video element required for getUserMedia stream; hidden — no UI shown -->
  <video id="video" autoplay playsinline muted style="display:none"></video>
  <script src="offscreen.js"></script>
</body>
</html>
```

### Background: Full Enable/Disable Handler

```javascript
// background.js
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');
let offscreenPort = null;

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Webcam stream for face distance detection'
  });
}

async function enableCamera() {
  await ensureOffscreenDocument();
  // Port is established by offscreen.js on load — send start command
  offscreenPort?.postMessage({ type: 'START_CAMERA' });
  await chrome.storage.session.set({ enabled: true });
}

async function disableCamera() {
  offscreenPort?.postMessage({ type: 'STOP_CAMERA' });
  await chrome.storage.session.set({ enabled: false, cameraActive: false });
  // Close the offscreen document to fully release the webcam context
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length > 0) await chrome.offscreen.closeDocument();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-keepalive') {
    offscreenPort = port;
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'CAMERA_READY') {
        await chrome.storage.session.set({ cameraActive: true });
      } else if (msg.type === 'CAMERA_ERROR') {
        await chrome.storage.session.set({ cameraActive: false, lastError: msg.error });
      } else if (msg.type === 'HEARTBEAT') {
        // Resets SW idle timer — no action needed
      }
    });
    port.onDisconnect.addListener(async () => {
      offscreenPort = null;
      await chrome.storage.session.set({ cameraActive: false });
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    chrome.storage.session.get({ enabled: false, cameraActive: false, lastError: null })
      .then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'SET_ENABLED') {
    (msg.enabled ? enableCamera() : disableCamera()).then(() => sendResponse({ ok: true }));
    return true;
  }
});
```

### Popup: Toggle + Indicator

```javascript
// popup.js
const toggle = document.getElementById('toggle');
const indicator = document.getElementById('indicator');

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  toggle.checked = response.enabled;
  indicator.textContent = response.cameraActive ? 'Camera active' : 'Camera off';
  indicator.className = response.cameraActive ? 'indicator active' : 'indicator';
  if (response.lastError === 'NotAllowedError') {
    indicator.textContent = 'Camera permission denied';
  }
}

toggle.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: toggle.checked });
  // Poll briefly for state update (camera takes ~200ms to start)
  setTimeout(refreshState, 300);
});

document.addEventListener('DOMContentLoaded', refreshState);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `chrome.offscreen.hasDocument()` | `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` | Chrome 116 | hasDocument never existed in stable API; getContexts is the canonical check |
| Background page (persistent) | Service worker (ephemeral, ~30s timeout) | MV3 (Chrome 88+) | Requires keepalive strategy; state must be in storage not globals |
| Opening a port resets SW timer | Only messages reset SW timer | Chrome 114 | Port + heartbeat messages required; port alone insufficient |
| `chrome.storage.local` for session state | `chrome.storage.session` for session state | Chrome 102 | Proper semantics: auto-cleared on browser restart, 10MB quota |

---

## Open Questions

1. **Camera manifest permission (Pitfall 3 from prior research)**
   - What we know: Adding `"camera"` to manifest permissions grants camera access at extension install via Chrome Web Store, preventing per-session prompts.
   - What's unclear: Whether `getUserMedia` re-prompts on offscreen document recreation when camera permission was granted via the native browser dialog (not manifest). MEDIUM confidence this is acceptable for Phase 1.
   - Recommendation: Do NOT add `"camera"` to manifest in Phase 1 (unnecessary for MVP testing). Test the re-prompt behavior manually by disabling and re-enabling the extension. If re-prompts occur, add `"camera"` to manifest in a follow-up.

2. **chrome.runtime.getContexts minimum Chrome version**
   - What we know: Requires Chrome 116+. `chrome.offscreen` itself requires Chrome 109+.
   - What's unclear: Whether we should support Chrome 109-115. If so, the older guard pattern using `clients.matchAll()` in the service worker context is needed.
   - Recommendation: Target Chrome 116+ for Phase 1 (released August 2023, broadly deployed). Document minimum version in manifest.json `minimum_chrome_version`.

3. **Port reconnect timing**
   - What we know: When SW restarts, the offscreen port disconnects. The offscreen's onDisconnect fires. The offscreen must then reconnect.
   - What's unclear: The timing of SW restart vs. reconnect. Is there a race where the offscreen reconnects before the SW is ready to accept connections?
   - Recommendation: In `onDisconnect`, use a short timeout (500ms) before reconnecting to allow SW to fully initialize.

---

## Sources

### Primary (HIGH confidence)
- https://developer.chrome.com/docs/extensions/reference/api/offscreen — `createDocument`, `closeDocument`, reasons list, `USER_MEDIA`, Chrome 109+ requirement
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle — SW termination at 30s idle, keepalive via messages, storage.session for cross-restart state
- https://developer.chrome.com/docs/extensions/reference/api/storage — `storage.session` characteristics: in-memory, cleared on browser restart, 10MB quota (Chrome 112+)

### Secondary (MEDIUM confidence)
- WebSearch: chrome extension MV3 service worker keepalive 2025 — confirmed port messages (not port open) reset SW idle timer; behavior changed in Chrome 114
- WebSearch: chrome.storage.session persist service worker restart — confirmed it persists across SW restarts within a session (cleared only on browser close)
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging — port-based messaging mechanics, onDisconnect behavior

### Tertiary (LOW confidence — verify before use)
- Camera manifest permission behavior on offscreen document recreation (Pitfall 3 from PITFALLS.md) — needs live Chrome testing; not addressed in Phase 1
- Port reconnect race condition timing (Open Question 3) — empirical behavior, needs testing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Chrome APIs are stable, documented, version-verified
- Architecture: HIGH — offscreen document pattern is canonical MV3; no alternatives exist
- Pitfalls: HIGH — pitfalls 1-4 are directly documented; pitfall 5 verified by checking API reference

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable Chrome APIs; 30-day validity)
