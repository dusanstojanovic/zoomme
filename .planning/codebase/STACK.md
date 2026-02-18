# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- JavaScript (ES6+) - Extension scripts and UI logic

**Markup & Styling:**
- HTML5 - Popup UI
- CSS3 - Popup styling

## Runtime

**Environment:**
- Chrome Browser (Manifest V3)

**Platform:**
- macOS/Windows/Linux (any platform with Chrome)

## Frameworks

**Core:**
- Chrome Extensions API (Manifest V3) - Extension foundation and messaging

**UI:**
- Vanilla HTML/CSS/JavaScript - Popup interface

## Key Dependencies

**None.**

The project has zero npm dependencies. All code uses only native Chrome APIs and vanilla JavaScript.

## Configuration

**Extension Manifest:**
- File: `manifest.json`
- Version: 3 (latest Chrome extension standard)
- Current permissions: Empty (none requested)

**Environment:**
- No environment variables required
- No build process or compilation step needed
- Direct browser loading via `chrome://extensions` developer mode

## How to Run

**Development:**
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the `/Users/dusan/Desktop/zoomme` directory

**No installation steps required** — extension loads directly from source files.

## Platform Requirements

**Development:**
- Chrome browser (any recent version supporting Manifest V3)
- Text editor

**Production:**
- Chrome browser (supports Manifest V3)
- Optional: Chrome Web Store distribution

---

*Stack analysis: 2026-02-15*
