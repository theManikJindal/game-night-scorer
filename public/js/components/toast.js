// ═══════════════════════════════════════════
// Toast Notifications
// ═══════════════════════════════════════════

export function show(message, duration = 1200) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  // role="status" makes the toast announced by screen readers as it's added
  // to the aria-live="polite" container in index.html.
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  let dismissed = false;
  let autoTimer = null;

  const finalize = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(autoTimer);
    toast.remove();
  };

  // Auto-dismiss: fade out (remove .show) then remove from the DOM.
  const fadeOut = () => {
    toast.classList.remove('show');
    setTimeout(finalize, 220);
  };
  const armAuto = (ms) => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(fadeOut, ms);
  };
  armAuto(duration);

  // Swipe-to-dismiss (touch or mouse): drag horizontally in either direction.
  _enableSwipe(toast, {
    onGrab: () => clearTimeout(autoTimer),
    onDismiss: finalize,
    onSnapBack: () => armAuto(800), // re-arm a short timer after a cancelled swipe
  });
}

// Wires pointer-based horizontal drag onto a toast. Past a threshold the toast
// flings off-screen and `onDismiss` fires; otherwise it snaps back and `onSnapBack`
// re-arms the auto-dismiss. Uses Pointer Events so touch and mouse share one path.
function _enableSwipe(toast, { onGrab, onDismiss, onSnapBack }) {
  let startX = 0;
  let dx = 0;
  let dragging = false;
  let pointerId = null;

  const down = (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    dx = 0;
    dragging = true;
    onGrab();
    toast.style.transition = 'none';
    try { toast.setPointerCapture(e.pointerId); } catch {}
  };

  const move = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    toast.style.transform = `translateX(${dx}px)`;
    toast.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 200));
  };

  const up = (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    const width = toast.offsetWidth || 200;
    const threshold = Math.min(120, width * 0.4);
    toast.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    if (Math.abs(dx) > threshold) {
      // Fling off-screen in the swipe direction, then remove.
      const dir = dx > 0 ? 1 : -1;
      toast.style.transform = `translateX(${dir * (width + 80)}px)`;
      toast.style.opacity = '0';
      setTimeout(onDismiss, 200);
    } else {
      // Not far enough — snap back to rest and let it auto-dismiss again.
      toast.style.transform = '';
      toast.style.opacity = '';
      onSnapBack();
    }
  };

  toast.addEventListener('pointerdown', down);
  toast.addEventListener('pointermove', move);
  toast.addEventListener('pointerup', up);
  toast.addEventListener('pointercancel', up);
}
