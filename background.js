// Background service worker: manages offscreen document lifecycle and camera state
// Uses chrome.runtime.getContexts (Chrome 116+) to check for existing offscreen documents

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

let offscreenPort = null;

// --- Zoom control ---

const EMA_ALPHA = 0.4;
const DEAD_ZONE_LOW = 0.95;
const DEAD_ZONE_HIGH = 1.05;
const ZOOM_MIN = 0.3; // not user-configurable

let settings = { zoomMax: 2.5, excludedSites: [] };

chrome.storage.sync.get({ zoomMax: 2.5, excludedSites: [] }, (stored) => {
  settings = stored;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.zoomMax)        settings.zoomMax        = changes.zoomMax.newValue;
  if (changes.excludedSites)  settings.excludedSites  = changes.excludedSites.newValue;
});

const ZOOM_DELTA_MIN = 0.01;

let emaRatio = null;
let lastZoom = null;
let activeTabId = null;

// Seed active tab on startup (only zoomable tabs)
async function queryActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find(t => t.url?.startsWith('http'));
  return tab || null;
}
(async () => {
  const tab = await queryActiveTab();
  if (tab) activeTabId = tab.id;
})();

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith('http')) {
    activeTabId = tabId;
    emaRatio = null;
    lastZoom = null;
  }
});

function updateEma(raw) {
  if (emaRatio === null) { emaRatio = raw; return emaRatio; }
  emaRatio = EMA_ALPHA * raw + (1 - EMA_ALPHA) * emaRatio;
  return emaRatio;
}

function ratioToZoom(r, zoomMax) {
  if (r >= DEAD_ZONE_LOW && r <= DEAD_ZONE_HIGH) return 1.0;
  if (r > DEAD_ZONE_HIGH) {
    const t = Math.min((r - DEAD_ZONE_HIGH) / (2.0 - DEAD_ZONE_HIGH), 1.0);
    return 1.0 - t * (1.0 - ZOOM_MIN);
  }
  const t = Math.min((DEAD_ZONE_LOW - r) / (DEAD_ZONE_LOW - 0.3), 1.0);
  return 1.0 + t * (zoomMax - 1.0);
}

async function applyZoom(rawRatio) {
  if (activeTabId === null) {
    const tab = await queryActiveTab();
    if (!tab) return;
    activeTabId = tab.id;
  }

  try {
    const tab = await chrome.tabs.get(activeTabId);
    if (tab.url) {
      const hostname = new URL(tab.url).hostname;
      if (settings.excludedSites.includes(hostname)) return;
    }
  } catch (e) {
    return; // tab closed or restricted
  }

  const zoom = ratioToZoom(updateEma(rawRatio), settings.zoomMax);
  if (lastZoom !== null && Math.abs(zoom - lastZoom) < ZOOM_DELTA_MIN) return;

  try {
    await chrome.tabs.setZoom(activeTabId, zoom);
    lastZoom = zoom;
  } catch (e) {
    console.error('ZoomMe: setZoom failed', e.message);
  }
}

async function resetZoom() {
  if (activeTabId !== null) {
    try {
      await chrome.tabs.setZoom(activeTabId, 0);
    } catch (e) { /* restricted page */ }
  }
  emaRatio = null;
  lastZoom = null;
}

// --- Offscreen document lifecycle ---

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });

  if (contexts.length > 0) {
    return; // Already exists
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Required to capture webcam stream via getUserMedia in MV3 extension'
  });
}

// Wait for offscreen port to connect (up to 2s, polling every 100ms)
function waitForPort(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (offscreenPort) {
      resolve();
      return;
    }
    const interval = setInterval(() => {
      if (offscreenPort) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(interval);
      if (offscreenPort) {
        resolve();
      } else {
        reject(new Error('Offscreen port did not connect within timeout'));
      }
    }, timeoutMs);
  });
}

async function enableCamera() {
  await ensureOffscreenDocument();
  try {
    await waitForPort(2000);
    offscreenPort.postMessage({ type: 'START_CAMERA' });
  } catch (err) {
    console.error('ZoomMe: offscreen port not ready', err);
    await chrome.storage.session.set({ enabled: false, cameraActive: false, lastError: 'PortTimeout' });
    return;
  }
  await chrome.storage.session.set({ enabled: true });
}

async function disableCamera() {
  if (offscreenPort) {
    offscreenPort.postMessage({ type: 'STOP_CAMERA' });
  }
  await resetZoom();
  await chrome.storage.session.set({ enabled: false, cameraActive: false });

  // Close offscreen document if it still exists
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [OFFSCREEN_URL]
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    console.warn('ZoomMe: error closing offscreen document', err);
  }
}

// --- Port connection from offscreen document ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'offscreen-keepalive') return;

  offscreenPort = port;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'CAMERA_READY') {
      chrome.storage.session.set({ cameraActive: true });
    } else if (msg.type === 'CAMERA_ERROR') {
      chrome.storage.session.set({ cameraActive: false, lastError: msg.error });
      // Offscreen docs can't show permission prompts — open a helper tab
      if (msg.error === 'NotAllowedError') {
        chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });
      }
    } else if (msg.type === 'DISTANCE_READING') {
      applyZoom(msg.ratio);
    } else if (msg.type === 'HEARTBEAT') {
      // No-op: receiving this message resets the service worker idle timer
    }
  });

  port.onDisconnect.addListener(() => {
    offscreenPort = null;
    chrome.storage.session.set({ cameraActive: false });
  });
});

// --- Message handler for popup ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    chrome.storage.session.get(
      { enabled: false, cameraActive: false, lastError: null },
      (state) => sendResponse(state)
    );
    return true; // async
  }

  if (msg.type === 'SET_ENABLED') {
    (msg.enabled ? enableCamera() : disableCamera()).then(() => {
      sendResponse({ ok: true });
    });
    return true; // async
  }
});

// --- Clean state on browser startup ---

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.set({ enabled: false, cameraActive: false });
});
