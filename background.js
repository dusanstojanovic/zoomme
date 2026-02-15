chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POPUP_ACTION') {
    console.log('Zoomme: popup action received', sender);
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async sendResponse
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Zoomme installed:', details.reason);
});
