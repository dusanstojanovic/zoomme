# Codebase Concerns

**Analysis Date:** 2026-02-15

## Tech Debt

**Incomplete Extension Functionality:**
- Issue: Extension is a shell/stub with no actual zoom functionality implemented
- Files: `manifest.json`, `background.js`, `popup/popup.js`
- Impact: Extension does nothing useful yet - core feature absent
- Fix approach: Implement actual zoom level control via Chrome APIs (chrome.tabs.setZoom, chrome.tabs.getZoom)

**Hardcoded Button Behavior:**
- Issue: "Do something" button in popup sends generic message with no meaningful action
- Files: `popup/popup.js`, `background.js`
- Impact: User clicks button but nothing happens; confusing UX
- Fix approach: Implement actual zoom increment/decrement logic with zoom level tracking

**Missing Error Handling:**
- Issue: No error handling for Chrome API calls or failed message passing
- Files: `popup/popup.js` (line 3-4)
- Impact: Silent failures when chrome.runtime APIs fail; difficult to debug issues
- Fix approach: Add try-catch blocks, validate API responses, log meaningful errors

## Security Considerations

**Overly Permissive Message Handling:**
- Risk: Background service worker accepts any message type without validation
- Files: `background.js` (line 1-6)
- Current mitigation: Only one hardcoded message type, but validation is implicit
- Recommendations: Add explicit message type whitelist, validate message structure before processing

**Missing Host Permissions:**
- Risk: Extension has zero permissions - won't work on any website
- Files: `manifest.json` (line 18)
- Current mitigation: None - this is blocking functionality
- Recommendations: Add required permissions: "tabs", "scripting", "activeTab" for zoom control; consider adding "<all_urls>" or specific domain patterns

**No Content Security Policy:**
- Risk: Inline scripts in popup.html could be vulnerable to XSS if dynamic content added
- Files: `popup/popup.html`
- Current mitigation: Currently only static content
- Recommendations: Add CSP header in manifest.json; move popup.js to separate script file if not already (currently is separate - good)

## Performance Bottlenecks

**No Performance Optimization Needed (Currently):**
- The codebase is minimal and has no detectable performance issues
- If zoom functionality added, consider debouncing zoom changes to prevent rapid API calls

## Fragile Areas

**Popup-Background Communication:**
- Files: `popup/popup.js`, `background.js`
- Why fragile: Uses promise-based sendMessage without timeout; if service worker crashes, message fails silently
- Safe modification: Add timeout wrapper, retry logic, error callbacks
- Test coverage: No tests present

**Chrome API Compatibility:**
- Files: All `.js` files
- Why fragile: No version checking or feature detection; assumes Manifest V3 Chrome API stability
- Safe modification: Add feature detection before using chrome APIs
- Test coverage: No automated tests - manual Chrome testing only

**No State Persistence:**
- Files: `background.js`, `popup/popup.js`
- Why fragile: No use of chrome.storage API means zoom settings lost on browser restart
- Safe modification: Implement chrome.storage.sync to persist user preferences per domain
- Test coverage: None

## Missing Critical Features

**Core Zoom Feature:**
- Problem: Extension does nothing - no zoom control implemented
- Blocks: The entire purpose of the extension

**Zoom Persistence:**
- Problem: No way to remember user's zoom preference per website
- Blocks: Users must re-zoom on every visit

**User Feedback:**
- Problem: No visual indication that zoom was applied or current zoom level shown
- Blocks: Users can't tell if their zoom action worked

**Default Zoom Setting:**
- Problem: No way to set a default zoom level across all sites
- Blocks: Power users can't customize behavior

## Test Coverage Gaps

**No Testing Infrastructure:**
- What's not tested: All functionality is untested
- Files: `popup/popup.js`, `background.js`
- Risk: Any changes break silently; Chrome extension testing is manual only
- Priority: High - should add unit tests for message passing logic once implemented

**No Integration Testing:**
- What's not tested: End-to-end zoom workflow (popup click → zoom applied → persisted)
- Risk: Bugs in Chrome API integration discovered only during manual testing
- Priority: Medium - test against multiple Chrome versions

## Dependencies at Risk

**Chrome Version Compatibility:**
- Risk: Manifest V3 is relatively new; older Chrome versions won't load extension
- Impact: Limits user base to Chrome 88+
- Current approach: Using Manifest V3 (correct, but no v2 fallback)

**No Package Manager:**
- Risk: No npm/package.json means no automated dependency updates
- Impact: Any external libraries added manually (currently none)
- Current mitigation: Using only native Chrome APIs (good for zero dependencies)

---

*Concerns audit: 2026-02-15*
