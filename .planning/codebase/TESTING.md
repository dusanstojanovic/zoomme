# Testing Patterns

**Analysis Date:** 2026-02-15

## Test Framework

**Status:** Not detected

**No testing infrastructure found:**
- No `jest.config.js`, `vitest.config.js`, or test runner configuration
- No test files (*.test.js, *.spec.js) in codebase
- No testing libraries installed
- No test commands in project configuration

**Recommendation:** Add testing framework when needed (Jest or Vitest recommended for Chrome extension testing)

## Test File Organization

**Current State:**
- No test files present
- Codebase is small (2 main scripts: `background.js` and `popup/popup.js`)

**Recommended Location (if tests are added):**
- Co-located: `background.test.js` alongside `background.js`
- Co-located: `popup/popup.test.js` alongside `popup/popup.js`
- Or: `__tests__/` directory at root with mirrored structure

**Recommended Naming:**
- `[filename].test.js` for unit tests
- `[filename].spec.js` for integration/behavioral tests

## Test Structure

**No Current Tests**

**Recommended Pattern (for future implementation):**
```javascript
// Example structure for popup.js tests
describe('Popup Script', () => {
  beforeEach(() => {
    // Setup DOM and mocks
    document.body.innerHTML = '<button id="action-btn">Do something</button>';
  });

  afterEach(() => {
    // Cleanup
    document.body.innerHTML = '';
  });

  describe('Button Click Handler', () => {
    it('should send message to background script', () => {
      // Test implementation
    });

    it('should handle chrome.runtime.lastError', () => {
      // Test implementation
    });
  });
});
```

## Mocking

**No Mocking Framework Found**

**Recommended Approach for Chrome Extension Testing:**
- Mock `chrome` API: Use libraries like `sinon` or `jest-mock-extended`
- Mock DOM: Use `jsdom` or `happy-dom`
- Suppress `console` output during tests

**Pattern Example (if tests are added):**
```javascript
// Mock chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      callback({ success: true });
    }),
    onMessage: {
      addListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    },
    lastError: null
  }
};
```

**What to Mock:**
- `chrome.runtime.*` API calls
- DOM elements and methods
- `console` methods (when verifying logging)

**What NOT to Mock:**
- Extension lifecycle logic itself
- Message structure/contract
- Event listener registration (test that it happens)

## Fixtures and Factories

**Not Applicable**

**Future Recommendation:**
- Create `__tests__/fixtures/messages.js` for test data
- Example:
  ```javascript
  export const MESSAGES = {
    POPUP_ACTION: { type: 'POPUP_ACTION' },
    RESPONSE: { ok: true }
  };
  ```

## Coverage

**Requirements:** Not enforced

**Recommendation:**
- For a small extension like this, aim for >80% coverage
- Critical paths: message passing and DOM interaction

**View Coverage (if tests are added):**
```bash
npm test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual functions (popup button handler, message listener)
- Approach: Test each script's exported or testable functionality in isolation
- Current candidates: Event listener callbacks, message handling logic

**Integration Tests:**
- Scope: Communication between background script and popup script
- Approach: Test `chrome.runtime.sendMessage` flow end-to-end
- Current: Not applicable without test runner setup

**E2E Tests:**
- Framework: Not used
- Could use `puppeteer` with Chrome extension loading, but not necessary for this small codebase

## Common Patterns

**Async Testing (if added):**
```javascript
// For chrome.runtime.sendMessage callbacks
it('should receive response from background', async () => {
  const promise = new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'POPUP_ACTION' }, resolve);
  });

  const response = await promise;
  expect(response.ok).toBe(true);
});
```

**Error Testing:**
```javascript
// Testing error handling path
it('should handle chrome.runtime.lastError', () => {
  chrome.runtime.lastError = { message: 'Connection lost' };

  // Trigger message send
  document.getElementById('action-btn').click();

  // Verify error was logged
  expect(console.warn).toHaveBeenCalledWith('Connection lost');

  chrome.runtime.lastError = null; // cleanup
});
```

**DOM Testing:**
```javascript
// Test DOM interaction
it('should attach click listener to action button', () => {
  document.body.innerHTML = '<button id="action-btn">Test</button>';

  // Load script (happens automatically in real test setup)
  const button = document.getElementById('action-btn');
  expect(button).toBeTruthy();

  // Simulate click
  button.click();

  // Verify chrome.runtime.sendMessage was called
  expect(chrome.runtime.sendMessage).toHaveBeenCalled();
});
```

---

*Testing analysis: 2026-02-15*
