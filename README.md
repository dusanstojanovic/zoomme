# Zoomme

Chrome extension (Manifest V3).

## Structure

```
zoomme/
├── manifest.json       # Extension manifest
├── background.js       # Service worker (background script)
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── icons/              # Add icon16.png, icon48.png, icon128.png
└── README.md
```

## Load in Chrome

1. Open **chrome://extensions**
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `zoomme` folder

## Icons (optional)

To use custom icons, add PNG files in `icons/` (icon16.png, icon48.png, icon128.png) and add this to `manifest.json`:

```json
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

Without icons, Chrome uses the default puzzle icon.

## Permissions

Add any needed APIs in `manifest.json` under `"permissions"` (e.g. `"storage"`, `"activeTab"`, `"tabs"`).
