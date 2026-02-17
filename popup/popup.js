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

// --- Settings (zoom slider + site exclusion) ---

function renderExcludedList(sites) {
  const list = document.getElementById('excluded-list');
  list.innerHTML = '';
  if (sites.length === 0) {
    list.textContent = 'No excluded sites.';
    return;
  }
  sites.forEach(hostname => {
    const row = document.createElement('div');
    row.className = 'excluded-row';
    const label = document.createElement('span');
    label.textContent = hostname;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeSite(hostname));
    row.appendChild(label);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

async function removeSite(hostname) {
  const { excludedSites } = await chrome.storage.sync.get({ excludedSites: [] });
  const updated = excludedSites.filter(h => h !== hostname);
  await chrome.storage.sync.set({ excludedSites: updated });
  renderExcludedList(updated);
}

async function initSettings() {
  const slider = document.getElementById('zoom-slider');
  const label  = document.getElementById('zoom-label');
  const excludeBtn = document.getElementById('exclude-btn');

  // Load persisted settings
  const { zoomMax, excludedSites } = await chrome.storage.sync.get({
    zoomMax: 2.5,
    excludedSites: []
  });
  slider.value = zoomMax;
  label.textContent = `${parseFloat(zoomMax).toFixed(1)}x`;
  renderExcludedList(excludedSites);

  // Slider: update label live, write to storage on release
  slider.addEventListener('input', () => {
    label.textContent = `${parseFloat(slider.value).toFixed(1)}x`;
  });
  slider.addEventListener('change', async () => {
    await chrome.storage.sync.set({ zoomMax: parseFloat(slider.value) });
  });

  // Exclude button: get active tab hostname, toggle inclusion in excludedSites
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('http')) {
    const hostname = new URL(tab.url).hostname;
    const isExcluded = excludedSites.includes(hostname);
    excludeBtn.textContent = isExcluded ? `Remove exclusion for ${hostname}` : `Exclude ${hostname}`;
    excludeBtn.disabled = false;

    excludeBtn.addEventListener('click', async () => {
      const { excludedSites: current } = await chrome.storage.sync.get({ excludedSites: [] });
      let updated;
      if (current.includes(hostname)) {
        updated = current.filter(h => h !== hostname);
        excludeBtn.textContent = `Exclude ${hostname}`;
      } else {
        updated = [...current, hostname];
        excludeBtn.textContent = `Remove exclusion for ${hostname}`;
      }
      await chrome.storage.sync.set({ excludedSites: updated });
      renderExcludedList(updated);
    });
  }
  // else: excludeBtn remains disabled (non-http tab, already set in HTML)
}

// Replace the single-line DOMContentLoaded listener above with a combined one
document.addEventListener('DOMContentLoaded', () => {
  refreshState();
  initSettings();
});
