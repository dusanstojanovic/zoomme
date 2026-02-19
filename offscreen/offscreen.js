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

function log(msg) {
  console.log(msg);
  if (backgroundPort) backgroundPort.postMessage({ type: 'LOG', msg });
}

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
  log('ZoomMe: FaceLandmarker initialized');
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
  log('ZoomMe: detection loop started');
  detectionInterval = setInterval(() => {
    if (!faceLandmarker || video.readyState < 2) {
      log(`ZoomMe: skip — faceLandmarker=${!!faceLandmarker} readyState=${video.readyState}`);
      return;
    }
    const result = faceLandmarker.detectForVideo(video, performance.now());
    const spread = extractSpread(result);
    if (spread === null) {
      log('ZoomMe: no face detected');
      return;
    }

    if (baseline === null) {
      baselineSamples.push(spread);
      log(`ZoomMe: baseline sample ${baselineSamples.length}/5 spread=${spread.toFixed(4)}`);
      if (baselineSamples.length < 5) return;
      baseline = baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;
      log(`ZoomMe: baseline captured ${baseline.toFixed(4)}`);
    }
    const ratio = spread / baseline;
    backgroundPort.postMessage({ type: 'DISTANCE_READING', spread, baseline, ratio });
  }, 500);
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
  log('ZoomMe: baseline reset — will recapture from next 5 readings');
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
    log('ZoomMe: requesting camera...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480,
        frameRate: { ideal: 15, max: 30 }
      }
    });
    const track = stream.getVideoTracks()[0];
    log(`ZoomMe: camera acquired — ${JSON.stringify(track.getSettings())}`);
    activeStream = stream;
    video.srcObject = stream;
    await video.play();
    if (backgroundPort) {
      backgroundPort.postMessage({ type: 'CAMERA_READY' });
    }
    initFaceLandmarker().then(() => startDetectionLoop()).catch(err => log(`ZoomMe: FaceLandmarker init failed: ${err}`));
  } catch (err) {
    log(`ZoomMe offscreen: camera error ${err.name}: ${err.message}`);
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
