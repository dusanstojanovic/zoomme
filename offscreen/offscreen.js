// Offscreen document: handles getUserMedia stream lifecycle
// Communicates with background.js via long-lived port named 'offscreen-keepalive'

let activeStream = null;
let backgroundPort = null;
let heartbeatInterval = null;
let isStreaming = false;

const video = document.getElementById('video');

function connectToBackground() {
  backgroundPort = chrome.runtime.connect({ name: 'offscreen-keepalive' });

  // Send heartbeat every 20s to keep service worker alive
  heartbeatInterval = setInterval(() => {
    if (backgroundPort) {
      backgroundPort.postMessage({ type: 'HEARTBEAT' });
    }
  }, 20000);

  backgroundPort.onDisconnect.addListener(() => {
    // Clear heartbeat on disconnect
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    backgroundPort = null;

    // Reconnect if we are still actively streaming
    if (isStreaming) {
      setTimeout(connectToBackground, 500);
    }
  });

  backgroundPort.onMessage.addListener((msg) => {
    if (msg.type === 'START_CAMERA') {
      isStreaming = true;
      startCamera();
    } else if (msg.type === 'STOP_CAMERA') {
      stopCamera();
    }
  });
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480,
        frameRate: { max: 30 }
      }
    });
    activeStream = stream;
    video.srcObject = stream;
    await video.play();
    if (backgroundPort) {
      backgroundPort.postMessage({ type: 'CAMERA_READY' });
    }
  } catch (err) {
    console.error('ZoomMe offscreen: camera error', err);
    if (backgroundPort) {
      backgroundPort.postMessage({ type: 'CAMERA_ERROR', error: err.name });
    }
    activeStream = null;
    isStreaming = false;
  }
}

function stopCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  video.srcObject = null;
  isStreaming = false;
}

// Connect immediately on script load
connectToBackground();
