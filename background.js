// Background service worker: manages offscreen document lifecycle and camera state
// Uses chrome.runtime.getContexts (Chrome 116+) to check for existing offscreen documents

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

let offscreenPort = null;

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
