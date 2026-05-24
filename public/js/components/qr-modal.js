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
    <div id="qr-backdrop" class="absolute inset-0" style="background:rgba(0,0,0,0.6)"></div>
    <div class="relative bg-surface-container-lowest border border-outline p-6 flex flex-col items-center gap-4 mx-4 w-full" style="max-width:280px">
      <div class="flex items-center justify-between w-full">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline">SCAN TO JOIN</p>
        <button id="qr-close" aria-label="Close" class="material-symbols-outlined text-outline hover:text-on-surface transition-colors" style="font-size:20px">close</button>
      </div>
      <div id="qr-canvas" class="p-3" style="background:#fff"></div>
      <p class="font-mono text-2xl font-bold tracking-[0.3em]">${roomCode}</p>
      <button id="qr-copy" class="font-mono text-[10px] uppercase tracking-widest border border-outline px-4 py-2 w-full hover:bg-surface-container-high transition-colors">
        COPY LINK
      </button>
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
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.M,
  });

  _el.querySelector('#qr-backdrop').addEventListener('click', hide);
  _el.querySelector('#qr-close').addEventListener('click', hide);

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
