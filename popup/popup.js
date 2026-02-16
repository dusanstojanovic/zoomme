const toggle = document.getElementById('toggle');
const indicator = document.getElementById('indicator');

function applyState(state) {
  toggle.checked = !!state.enabled;

  if (state.lastError === 'NotAllowedError') {
    indicator.textContent = 'Camera permission denied';
    indicator.classList.remove('active');
  } else if (state.cameraActive) {
    indicator.textContent = 'Camera active';
    indicator.classList.add('active');
  } else {
    indicator.textContent = 'Camera off';
    indicator.classList.remove('active');
  }
}

function refreshState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('ZoomMe popup: GET_STATE error', chrome.runtime.lastError.message);
      return;
    }
    applyState(response);
  });
}

toggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: toggle.checked }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('ZoomMe popup: SET_ENABLED error', chrome.runtime.lastError.message);
      return;
    }
    // Allow camera startup time before refreshing
    setTimeout(refreshState, 500);
  });
});

// Update indicator in real-time while popup is open
chrome.storage.session.onChanged.addListener(() => {
  refreshState();
});

document.addEventListener('DOMContentLoaded', refreshState);
