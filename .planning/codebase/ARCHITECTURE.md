# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Chrome Extension Message-Passing Architecture (Manifest V3)

**Key Characteristics:**
- Event-driven background service worker
- Popup UI for user interaction
- Message-based communication between popup and background contexts
- Modular separation of UI and background logic

## Layers

**Background Service Worker (Service Layer):**
- Purpose: Handles extension-level events and manages background tasks
- Location: `/Users/dusan/Desktop/zoomme/background.js`
- Contains: Event listeners, message routing, lifecycle management
- Depends on: Chrome Runtime API
- Used by: Popup UI via message passing

**Popup UI (Presentation Layer):**
- Purpose: Provides user interface for extension interaction
- Location: `/Users/dusan/Desktop/zoomme/popup/`
- Contains: HTML markup, styling, user event handling
- Depends on: Chrome Runtime API for messaging
- Used by: End user through Chrome extension icon

**Assets (Static Resources):**
- Purpose: Extension branding and configuration
- Location: `/Users/dusan/Desktop/zoomme/icons/`, `/Users/dusan/Desktop/zoomme/manifest.json`
- Contains: Icon files (16x16, 48x48, 128x128), extension manifest
- Depends on: None
- Used by: Chrome browser for extension display

## Data Flow

**User Action → Message Passing → Background Response:**

1. User clicks button in popup UI (`/Users/dusan/Desktop/zoomme/popup/popup.html`)
2. Click event handler in `popup.js` triggers `chrome.runtime.sendMessage()`
3. Message with type `'POPUP_ACTION'` sent to background context
4. Background service worker receives message via `chrome.runtime.onMessage` listener in `background.js`
5. Handler processes message and sends response back via `sendResponse()`
6. Popup receives response and handles result (logging or error handling)

**State Management:**
- No persistent state managed currently
- All communication is request-response based
- Messages are transient; no storage layer implemented

## Key Abstractions

**Message Protocol:**
- Purpose: Define contract between popup and background contexts
- Examples: `{ type: 'POPUP_ACTION' }` in `popup.js` and `background.js`
- Pattern: Type-based routing with handler functions

**Extension Lifecycle:**
- Purpose: React to extension installation and updates
- Examples: `chrome.runtime.onInstalled` listener in `background.js`
- Pattern: Event listener with details object inspection

## Entry Points

**Extension Installation:**
- Location: `chrome.runtime.onInstalled` listener in `/Users/dusan/Desktop/zoomme/background.js`
- Triggers: When extension is first installed or updated
- Responsibilities: Log installation details, initialize extension state

**Popup Display:**
- Location: `/Users/dusan/Desktop/zoomme/popup/popup.html` (via manifest.json action)
- Triggers: When user clicks extension icon in Chrome toolbar
- Responsibilities: Render UI, attach event listeners

**User Interaction:**
- Location: `#action-btn` click handler in `/Users/dusan/Desktop/zoomme/popup/popup.js`
- Triggers: When user clicks "Do something" button
- Responsibilities: Send message to background, handle response

## Error Handling

**Strategy:** Console logging with runtime error checks

**Patterns:**
- Runtime error detection via `chrome.runtime.lastError` in `popup.js`
- Warning log output when message send fails
- Console logging for debug information in both contexts

## Cross-Cutting Concerns

**Logging:** Console-based logging in both background and popup contexts

**Validation:** Type-based message validation (`message.type === 'POPUP_ACTION'`)

**Authentication:** Not implemented (no permissions required in manifest)

---

*Architecture analysis: 2026-02-15*
