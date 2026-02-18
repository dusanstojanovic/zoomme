# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- Lowercase with optional hyphens
- Examples: `background.js`, `popup.js`, `popup.html`, `popup.css`
- No file extension prefixes (e.g., no `.controller.js`, `.service.js`)

**Functions:**
- camelCase
- Example: `addEventListener`, `sendMessage`

**Variables:**
- camelCase for local variables
- Examples: `message`, `sender`, `sendResponse`, `details`
- Prefixed with module context in some cases (e.g., `action-btn` for DOM IDs)

**Constants:**
- UPPERCASE_WITH_UNDERSCORES for message type constants
- Example: `'POPUP_ACTION'` (string literal, not a declared constant)

**DOM IDs and Classes:**
- kebab-case for DOM selectors
- Example: `action-btn`, `.popup` class

## Code Style

**Formatting:**
- No linter/formatter detected (no .eslintrc, .prettierrc files)
- Indentation: 2 spaces (observed in CSS and JavaScript)
- Max line length: Not enforced (observed up to ~80 characters)

**Spacing:**
- Single spaces around operators
- No trailing semicolons are consistently applied (some present, some missing)
- Consistent use of modern arrow functions

**Linting:**
- Not configured in codebase

## Import Organization

**Scripts:**
- Direct file references in HTML via `<script src="..."></script>`
- No module imports (standard ES modules not used)
- Example: `popup.html` directly imports `popup.js` and `popup.css`

**Path Style:**
- Relative paths from the containing directory
- Example: `popup/popup.js` loaded as `<script src="popup.js"></script>` from within `popup.html`

## Error Handling

**Chrome API Errors:**
- Check `chrome.runtime.lastError` after async operations
- Pattern from `popup/popup.js`:
  ```javascript
  chrome.runtime.sendMessage({ type: 'POPUP_ACTION' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(chrome.runtime.lastError.message);
      return;
    }
    console.log('Response:', response);
  });
  ```

**Message Passing:**
- Return `true` to keep async message channels open
- Example from `background.js`: `return true; // keep channel open for async sendResponse`

**Error Logging:**
- Use `console.warn()` for warnings
- Use `console.log()` for informational messages

## Logging

**Framework:** Native `console` object

**Patterns:**
- Prefix logs with extension name for clarity
- Example: `console.log('Zoomme: popup action received', sender);`
- Avoid logging in production-critical paths
- Log Chrome extension lifecycle events (installation, updates)
- Log message receipts for debugging inter-script communication

**When to Log:**
- Extension installation/lifecycle events
- Received messages from other scripts
- User actions (button clicks)
- Error conditions (via `console.warn`)

## Comments

**When to Comment:**
- Only when behavior is non-obvious
- Used sparingly in codebase
- Focus on "why" not "what"

**Patterns Observed:**
- Inline comments explain intent
- Example: `return true; // keep channel open for async sendResponse`
- HTML comments not used in template files

## Function Design

**Size:** Small, single-purpose functions (all functions in codebase are < 10 lines)

**Parameters:**
- Minimal parameters passed
- Destructure when possible from callback arguments
- Example: `(message, sender, sendResponse) => {...}`

**Return Values:**
- Return boolean `true` for message listeners that use async `sendResponse`
- Return `undefined` implicitly for event listeners
- Always return from error branches to prevent further execution

## Module Design

**Exports:**
- No module exports (not using ES modules)
- Each script is self-contained

**Organization:**
- `background.js`: Service worker (background script) - lifecycle and message handling
- `popup/popup.js`: Popup UI script - DOM interaction and message sending
- Scripts communicate via `chrome.runtime` APIs

**Barrel Files:**
- Not applicable (no module system)

---

*Convention analysis: 2026-02-15*
