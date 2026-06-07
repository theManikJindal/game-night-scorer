// ═══════════════════════════════════════════
// QR Code Modal Component
// ═══════════════════════════════════════════
// Call show(url, roomCode) to display a scannable QR code.
// Appended to document.body so screen re-renders don't destroy it.

let _el = null;

export function show(url, roomCode) {
  if (!_el) {
    _el = document.createElement('div');
    _el.id = 'qr-modal';
    _el.className = 'fixed inset-0 z-[300] flex items-center justify-center';
    _el.style.display = 'none';
    document.body.appendChild(_el);
  }

  _el.innerHTML = `
    <div id="qr-backdrop" class="absolute inset-0" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)"></div>
    <div class="relative bg-surface-container-low border border-outline flex flex-col items-center mx-4 w-full overflow-hidden" style="max-width:320px">
      <div class="w-full px-4 py-4 border-b border-outline-variant">
        <h2 class="font-headline font-extrabold text-xl uppercase">Scan to Join</h2>
      </div>
      <div class="py-6 flex flex-col items-center gap-3 w-full">
        <p class="font-mono text-base font-bold tracking-[0.3em]">${roomCode}</p>
        <div id="qr-canvas" class="p-3" style="background:#f4f4f2"></div>
      </div>
      <div class="w-full px-4 pb-4 flex gap-3 border-t border-outline-variant pt-4">
        <button id="qr-close" type="button" aria-label="Close" class="btn-secondary flex-none flex items-center justify-center self-stretch" style="padding:0;background:#f4f4f2">
          <span class="material-symbols-outlined" style="font-size:1.25rem">close</span>
        </button>
        <button id="qr-copy" type="button" class="btn-primary" style="flex:3">COPY LINK</button>
      </div>
    </div>
  `;

  _el.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Generate QR code into the container element
  new window.QRCode(document.getElementById('qr-canvas'), {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#f4f4f2',
    correctLevel: window.QRCode.CorrectLevel.M,
  });

  _el.querySelector('#qr-backdrop').addEventListener('click', hide);
  const closeBtn = _el.querySelector('#qr-close');
  closeBtn.addEventListener('click', hide);
  requestAnimationFrame(() => { closeBtn.style.width = closeBtn.offsetHeight + 'px'; });

  _el.querySelector('#qr-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      const btn = _el.querySelector('#qr-copy');
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY LINK'; }, 2000);
    }).catch(() => {});
  });
}

export function hide() {
  if (!_el) return;
  _el.style.display = 'none';
  _el.innerHTML = '';
  document.body.style.overflow = '';
}
