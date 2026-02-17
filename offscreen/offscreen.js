// Offscreen document: handles getUserMedia stream lifecycle + MediaPipe face detection
// Communicates with background.js via long-lived port named 'offscreen-keepalive'

import { FilesetResolver, FaceLandmarker } from '../vendor/vision_bundle.mjs';

let activeStream = null;
let backgroundPort = null;
let heartbeatInterval = null;
let isStreaming = false;

let faceLandmarker = null;
let baseline = null;
let baselineSamples = [];
let detectionInterval = null;

const video = document.getElementById('video');

// --- MediaPipe detection ---

async function initFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'));
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL('model/face_landmarker.task'),
    },
    runningMode: 'VIDEO',
    numFaces: 1,
  });
  console.log('ZoomMe: FaceLandmarker initialized');
}

function extractSpread(result) {
  if (!result.faceLandmarks?.length) return null;
  const lm = result.faceLandmarks[0];
  const dx = lm[263].x - lm[33].x;
  const dy = lm[263].y - lm[33].y;
  const dz = (lm[263].z || 0) - (lm[33].z || 0);
  return Math.hypot(dx, dy, dz);
}

function startDetectionLoop() {
  detectionInterval = setInterval(() => {
    if (!faceLandmarker || video.readyState < 2) return;
    const result = faceLandmarker.detectForVideo(video, performance.now());
    const spread = extractSpread(result);
    if (spread === null) return;

    if (baseline === null) {
      baselineSamples.push(spread);
      if (baselineSamples.length < 5) return; // wait for 5 samples
      baseline = baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;
      console.log('ZoomMe: baseline captured', baseline);
    }
    const ratio = spread / baseline;
    backgroundPort.postMessage({ type: 'DISTANCE_READING', spread, baseline, ratio });
  }, 200);
}

function stopDetectionLoop() {
  clearInterval(detectionInterval);
  detectionInterval = null;
  baseline = null;
  baselineSamples = [];
}

function resetBaseline() {
  baseline = null;
  baselineSamples = [];
  console.log('ZoomMe: baseline reset — will recapture from next 5 readings');
}

// --- Camera lifecycle ---

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
    } else if (msg.type === 'RESET_BASELINE') {
      resetBaseline();
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
    initFaceLandmarker().then(() => startDetectionLoop());
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
  stopDetectionLoop();
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  video.srcObject = null;
  isStreaming = false;
}

// Connect immediately on script load
connectToBackground();
