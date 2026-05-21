// ══════��════════════════════════════════════
// Home Screen — Create / Join Room
// ═══════════════════════════════════════════

import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';

export function mount(container) {
  // Hide nav on home
  bottomNav.hide();
  document.getElementById('top-bar').style.display = 'none';

  container.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-[100dvh] px-6">
      <!-- Logo -->
      <div class="text-center mb-16">
        <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-outline mb-3">System.Ref_01</p>
        <h1 class="font-headline font-black uppercase tracking-tighter text-4xl leading-none">GAME<br>NIGHT</h1>
        <p class="font-mono text-[10px] uppercase tracking-[0.15em] text-outline mt-3">SCORER</p>
      </div>

      <!-- Create -->
      <div class="w-full max-w-xs space-y-3 mb-12">
        <button id="btn-create" class="btn-primary flex items-center justify-center gap-2">
          CREATE SESSION
          <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>
        </button>
      </div>

      <!-- Divider -->
      <div class="flex items-center w-full max-w-xs mb-12">
        <div class="flex-1 border-t border-outline-variant"></div>
        <span class="px-4 font-mono text-[10px] uppercase tracking-widest text-outline">OR JOIN</span>
        <div class="flex-1 border-t border-outline-variant"></div>
      </div>

      <!-- Join -->
      <div class="w-full max-w-xs space-y-3">
        <label for="input-pin" class="sr-only">ROOM PIN</label>
        <input
          id="input-pin"
          aria-label="Room PIN"
          type="text"
          maxlength="6"
          placeholder="ROOM PIN"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="characters"
          spellcheck="false"
          class="w-full bg-transparent border border-primary text-center font-mono text-2xl font-bold tracking-[0.4em] py-4 px-4 placeholder:text-outline placeholder:tracking-normal placeholder:text-base placeholder:font-body focus:outline-none focus:border-secondary transition-colors uppercase"
        >
        <button id="btn-join" class="btn-secondary flex items-center justify-center gap-2">
          JOIN ROOM
        </button>
      </div>

      <!-- Firebase status -->
      <div id="fb-status" class="mt-12 font-mono text-[10px] text-outline uppercase tracking-widest"></div>
    </div>
  `;

  // Firebase status
  const statusEl = container.querySelector('#fb-status');
  if (!fb.isConfigured()) {
    statusEl.innerHTML = `<span class="text-error">FIREBASE NOT CONFIGURED</span>`;
  }

  // Create handler
  container.querySelector('#btn-create').addEventListener('click', async () => {
    if (!fb.isConfigured()) {
      toast.show('Firebase not configured');
      return;
    }

    const btn = container.querySelector('#btn-create');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner mx-auto"></div>';

    try {
      const roomCode = await fb.createRoom();
      // Update URL for sharing
      const url = new URL(window.location);
      url.searchParams.set('room', roomCode);
      window.history.replaceState({}, '', url);

      router.navigate('lobby', { roomCode, isNew: true });
    } catch (e) {
      console.error('Create room failed:', e);
      toast.show('Failed to create room');
      btn.disabled = false;
      btn.innerHTML = 'CREATE SESSION <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>';
    }
  });

  // Join handler
  const joinHandler = async () => {
    if (!fb.isConfigured()) {
      toast.show('Firebase not configured');
      return;
    }

    const pin = container.querySelector('#input-pin').value.trim().toUpperCase();
    if (pin.length < 4) {
      toast.show('Enter a valid room PIN');
      _shakeInput(container.querySelector('#input-pin'));
      return;
    }

    const btn = container.querySelector('#btn-join');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner mx-auto"></div>';

    try {
      const code = await fb.joinRoom(pin);
      if (!code) {
        toast.show('Room not found');
        _shakeInput(container.querySelector('#input-pin'));
        btn.disabled = false;
        btn.innerHTML = 'JOIN ROOM';
        return;
      }

      const url = new URL(window.location);
      url.searchParams.set('room', code);
      window.history.replaceState({}, '', url);

      router.navigate('lobby', { roomCode: code });
    } catch (e) {
      console.error('Join failed:', e);
      toast.show('Failed to join room');
      btn.disabled = false;
      btn.innerHTML = 'JOIN ROOM';
    }
  };

  container.querySelector('#btn-join').addEventListener('click', joinHandler);
  container.querySelector('#input-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinHandler();
  });
}

export function unmount() {}

function _shakeInput(el) {
  el.style.borderColor = '#ba1a1a';
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.3s ease-in-out';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.animation = '';
  }, 600);
}
