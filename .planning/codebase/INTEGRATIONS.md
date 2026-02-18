# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**None Configured.**

The extension does not currently integrate with any external APIs or third-party services.

## Data Storage

**Databases:**
- Not used

**File Storage:**
- Local filesystem only (extension files)
- Available: Chrome Storage API (chrome.storage) - Not currently implemented

**Caching:**
- Not configured

## Authentication & Identity

**Auth Provider:**
- None

The extension requires no authentication. All functionality is local to the browser.

## Monitoring & Observability

**Error Tracking:**
- None

**Logs:**
- Browser console logging only (`console.log`, `console.warn`)
- Location: Browser DevTools > Extensions tab

## CI/CD & Deployment

**Hosting:**
- None currently configured

**Deployment Options:**
- Manual: Load unpacked via `chrome://extensions`
- Optional: Chrome Web Store (requires google-chrome-webstore account, not currently set up)

**CI Pipeline:**
- Not configured

## Environment Configuration

**Required env vars:**
- None

**Secrets location:**
- Not applicable

## Available Chrome APIs

**Currently Implemented:**
- `chrome.runtime.onMessage` - Receive messages from popup
- `chrome.runtime.sendMessage` - Send messages from popup to background
- `chrome.runtime.onInstalled` - Handle extension installation

**Available but Not Used:**
- `chrome.storage` - Local/sync storage
- `chrome.tabs` - Tab manipulation
- `chrome.activeTab` - Access active tab
- `chrome.permissions` - Dynamic permissions (requires permission request)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-02-15*
