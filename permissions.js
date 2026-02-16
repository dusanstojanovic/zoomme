const btn = document.getElementById('grant');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.textContent = 'Requesting camera...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    status.textContent = 'Permission granted! Starting camera...';
    // Tell background to retry enabling camera
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: true }, () => {
      setTimeout(() => window.close(), 500);
    });
  } catch (err) {
    status.textContent = 'Camera permission denied. Please allow access and try again.';
    status.classList.add('error');
    btn.disabled = false;
  }
});
