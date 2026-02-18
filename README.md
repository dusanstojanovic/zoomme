# Zoomme

Chrome extension that automatically adjusts page zoom based on your distance from the webcam. Move closer → zoom out. Move back → zoom in.

## How it works

Uses MediaPipe FaceLandmarker (runs locally via WASM) to measure the inter-eye distance in each webcam frame. The ratio against a captured baseline drives the zoom level.

- Scans once per second
- Dead zone (±20%) ignores small head movements
- Large movements snap instantly; small drift is smoothed via EMA
- Excluded sites and max zoom configurable via popup

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `zoomme` folder

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Set zoom on the active tab |
| `storage` | Persist settings (max zoom, excluded sites) |
| `offscreen` | Run `getUserMedia` in an offscreen document (MV3 requirement) |
| Camera | Capture webcam frames for face detection |

## Recalibrate

If zoom feels off, click **Recalibrate** in the popup to reset the baseline distance.

## Battery & CPU

When enabled, the extension runs a continuous webcam stream (320×240 @ 5fps) and MediaPipe WASM face detection once per second — expect **15–25% extra CPU** with spikes during each detection cycle. When disabled, impact is near zero (service worker is dormant). Disable the extension or use site exclusions when unneeded.
