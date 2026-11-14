let toastTimer = null;

/**
 * Displays a bottom toast message, optionally with an Undo action button.
 */
export function showToast(toastEl, msg, options = {}) {
  if (!toastEl) return;
  const { undoLabel = 'Undo', onUndo = null, durationMs = onUndo ? 6000 : 2400 } = options;

  clearTimeout(toastTimer);
  toastEl.innerHTML = '';

  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  toastEl.appendChild(textSpan);

  if (typeof onUndo === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo-btn';
    btn.textContent = undoLabel;
    btn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toastEl.classList.remove('show');
      onUndo();
    });
    toastEl.appendChild(btn);
  }

  toastEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, durationMs);
}
