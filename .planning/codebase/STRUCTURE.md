# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
zoomme/
├── manifest.json           # Extension manifest (Manifest V3)
├── background.js           # Service worker / background script
├── popup/                  # Popup UI module
│   ├── popup.html         # Popup markup
│   ├── popup.js           # Popup event handlers and logic
│   └── popup.css          # Popup styles
├── icons/                 # Extension icons directory
│   ├── icon16.png         # 16x16 icon
│   ├── icon48.png         # 48x48 icon
│   └── icon128.png        # 128x128 icon
└── README.md              # Documentation
```

## Directory Purposes

**Project Root:**
- Purpose: Extension configuration and background logic entry point
- Contains: Manifest file, service worker, documentation
- Key files: `manifest.json`, `background.js`

**popup/:**
- Purpose: Self-contained popup UI module
- Contains: HTML markup, CSS styles, JavaScript logic
- Key files: `popup.html`, `popup.css`, `popup.js`

**icons/:**
- Purpose: Extension branding assets
- Contains: PNG icon files in three sizes
- Key files: `icon16.png`, `icon48.png`, `icon128.png`

## Key File Locations

**Entry Points:**
- `manifest.json`: Extension configuration and manifest version
- `background.js`: Service worker entry point (runs in background)
- `popup/popup.html`: Popup UI entry point (rendered when icon clicked)

**Configuration:**
- `/Users/dusan/Desktop/zoomme/manifest.json`: Declares extension metadata, icons, background script, popup, permissions

**Core Logic:**
- `/Users/dusan/Desktop/zoomme/background.js`: Message routing, lifecycle management
- `/Users/dusan/Desktop/zoomme/popup/popup.js`: User interaction handlers, message sending

**Styling:**
- `/Users/dusan/Desktop/zoomme/popup/popup.css`: Popup UI styling (320px width, flexbox layout)

## Naming Conventions

**Files:**
- `popup.*`: All popup-related files grouped with prefix
- PascalCase not used (JavaScript/HTML conventions)
- Descriptive names: `popup.html`, `background.js`, `manifest.json`

**Directories:**
- Lowercase: `popup/`, `icons/`
- Semantic naming: Name describes content type
- No nested subdirectories (flat structure for small extension)

## Where to Add New Code

**New Feature (User-facing):**
- Primary code: Add to `/Users/dusan/Desktop/zoomme/popup/popup.js`
- Styles: Add to `/Users/dusan/Desktop/zoomme/popup/popup.css`
- Markup: Modify `/Users/dusan/Desktop/zoomme/popup/popup.html`

**New Background Task:**
- Implementation: Add listener to `/Users/dusan/Desktop/zoomme/background.js`
- Message protocol: Define in both `background.js` and `popup/popup.js`

**New Permissions:**
- Update: `/Users/dusan/Desktop/zoomme/manifest.json` `"permissions"` array

**Utility Functions:**
- Shared helpers: For now, add inline in relevant file
- Future refactor: Consider extracting to `utils.js` once logic grows

## Special Directories

**icons/:**
- Purpose: Stores extension icon assets referenced in manifest
- Generated: No (user-provided assets)
- Committed: Yes (PNG files committed to repo)

**.planning/:**
- Purpose: Architecture and planning documentation
- Generated: Yes (created by analysis tools)
- Committed: Yes (planning documents tracked)

---

*Structure analysis: 2026-02-15*
