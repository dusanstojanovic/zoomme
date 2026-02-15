document.getElementById('action-btn').addEventListener('click', () => {
  // Example: send message to background script
  chrome.runtime.sendMessage({ type: 'POPUP_ACTION' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(chrome.runtime.lastError.message);
      return;
    }
    console.log('Response:', response);
  });
});
