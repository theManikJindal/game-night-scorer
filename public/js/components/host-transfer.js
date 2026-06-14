// ═══════════════════════════════════════════
// Host Transfer — request → approve handshake
// ═══════════════════════════════════════════
// A spectator requests host control; the current host gets a "Change host" dialog
// with a 10-second auto-accept countdown. Because there's no backend, the only
// client guaranteed online is the requestor: if the host never responds (app
// closed / offline / countdown elapsed), the requestor's own client completes the
// takeover after a slightly longer fallback. The DB rule (database.rules.json)
// only allows hostKey to be overwritten with the pending request's requestKey, so
// a takeover is always to a key the host had a chance to see and decline.
//
// Driven by the global roomLobby watcher (see app.js) so the host dialog and the
// requestor's resolution work on every screen, not just the lobby.

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as toast from './toast.js';

const HOST_COUNTDOWN_SECONDS = 20;
// Slightly longer than the host countdown so an online host's explicit choice
// wins first; the requestor only steps in when the host is truly absent.
const REQUESTOR_FALLBACK_MS = 22000;
// Ignore requests older than this when deciding whether to surface the host
// dialog — guards against a stale request left behind when everyone was offline.
const STALE_REQUEST_MS = 60000;

// ── Requestor-side state ──
let _myRequestKey = null;      // the key I'll adopt as host once granted
let _fallbackTimer = null;

// ── Host-side state ──
let _hostDialog = null;
let _hostCountdownTimer = null;
let _hostDialogRequestKey = null; // requestKey currently shown, to detect replacement

// ═══════════════════════════════════════════
// Spectator entry point
// ═══════════════════════════════════════════

export async function requestBecomeHost(roomCode) {
  const lobby = state.get('roomLobby') || {};

  // No host to approve — just claim it outright.
  if (!lobby.hostKey) {
    try {
      await fb.claimHost(roomCode);
      toast.show("You're the host now");
    } catch {
      toast.show('Failed to claim host');
    }
    return;
  }

  if (lobby.hostChangeBlockedUntil && lobby.hostChangeBlockedUntil > Date.now()) {
    toast.show("Host isn't accepting requests right now");
    return;
  }

  if (lobby.hostChangeRequest) {
    const req = lobby.hostChangeRequest;
    const isStale = typeof req.requestedAt === 'number' && Date.now() - req.requestedAt > 30000;
    if (!isStale) {
      toast.show('A host change is already in progress');
      return;
    }
  }

  if (_myRequestKey) return; // we already have a request in flight

  // No dialog — fire the request straight off and let it auto-resolve. The host
  // sees the "Change host" countdown; if they never respond, our fallback timer
  // completes the takeover.
  try {
    _myRequestKey = await fb.requestHostChange(roomCode, '');
  } catch {
    toast.show('Failed to send request');
    return;
  }
  toast.show('Requesting host control…');
  _fallbackTimer = setTimeout(() => _autoTakeover(roomCode), REQUESTOR_FALLBACK_MS);
}

// Fallback: host never responded → take over ourselves.
async function _autoTakeover(roomCode) {
  _fallbackTimer = null;
  const key = _myRequestKey;
  if (!key) return;
  try {
    await fb.grantHostChange(roomCode, key);
    fb.adoptHostKey(roomCode, key);
    _finishAsNewHost();
  } catch {
    // Rule rejected it — the host declined moments ago. Treat as a decline.
    _clearRequest();
    toast.show('Host declined your request');
  }
}

// Idempotent: the fallback write and the lobby watcher can both observe the grant
// (one during the other's await), so guard against a duplicate "you're the host" toast.
function _finishAsNewHost() {
  if (!_myRequestKey) return;
  _clearRequest();
  toast.show("You're the host now");
}

// Drop our pending request state (key + fallback timer). No UI to tear down —
// the requestor never opens a dialog.
function _clearRequest() {
  _myRequestKey = null;
  if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
}

// ═══════════════════════════════════════════
// Global watcher hook (called from app.js on every roomLobby update)
// ═══════════════════════════════════════════

export function handleLobbyUpdate(lobby, _prevLobby) {
  if (!lobby) {
    // Room gone — tear everything down.
    _clearRequest();
    _closeHostDialog();
    return;
  }
  const roomCode = lobby.roomCode || state.get('roomCode');
  if (!roomCode) return;

  _resolveRequestor(roomCode, lobby);
  _driveHostDialog(roomCode, lobby);
}

// Requestor side: react to the host's decision (or another request superseding ours).
function _resolveRequestor(roomCode, lobby) {
  if (!_myRequestKey) return;

  if (lobby.hostKey === _myRequestKey) {
    // Granted (by the host, or by our own fallback write).
    fb.adoptHostKey(roomCode, _myRequestKey);
    _finishAsNewHost();
    return;
  }

  const req = lobby.hostChangeRequest;
  if (!req) {
    // Request cleared without us getting the key → declined.
    _clearRequest();
    toast.show('Host declined your request');
  } else if (req.requestKey !== _myRequestKey) {
    // Someone else's request replaced ours.
    _clearRequest();
    toast.show('Another spectator requested host');
  }
  // else: still pending — keep waiting.
}

// Host side: surface / dismiss the "Change host" dialog.
function _driveHostDialog(roomCode, lobby) {
  if (!state.isHost()) {
    if (_hostDialog) _closeHostDialog();
    return;
  }

  const req = lobby.hostChangeRequest;
  if (!req || !req.requestKey) {
    if (_hostDialog) _closeHostDialog();
    return;
  }

  // Honour an active "decline for N minutes" block by silently clearing requests.
  if (lobby.hostChangeBlockedUntil && lobby.hostChangeBlockedUntil > Date.now()) {
    if (_hostDialog) _closeHostDialog();
    fb.declineHostChange(roomCode, {}).catch(() => {});
    return;
  }

  // Skip stale requests (requestedAt is a server timestamp number once written).
  if (typeof req.requestedAt === 'number' && Date.now() - req.requestedAt > STALE_REQUEST_MS) {
    return;
  }

  if (_hostDialog && _hostDialogRequestKey === req.requestKey) return; // already showing this one
  if (_hostDialog) _closeHostDialog(); // a newer request replaced the one on screen
  _showHostDialog(roomCode, req);
}

function _showHostDialog(roomCode, req) {
  _hostDialogRequestKey = req.requestKey;
  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-50 flex items-center justify-center px-6';
  el.style.cssText = 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/50"></div>
    <div class="relative w-full max-w-sm bg-surface-container-low border-2 border-outline">
      <div class="px-5 pt-5 pb-3 border-b border-outline-variant">
        <p class="font-headline font-extrabold text-xl uppercase">Change Host</p>
      </div>
      <div class="px-5 pt-4 pb-2">
        <p class="font-body font-bold text-base text-on-surface">Another player wants to be the host.</p>
      </div>
      <label id="ht-block-row" class="flex items-center gap-3 px-5 pt-4 pb-1 cursor-pointer select-none">
        <input id="ht-block" type="checkbox" class="peer sr-only">
        <span aria-hidden="true" class="shrink-0 w-5 h-5 border border-primary bg-surface-container-lowest peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary flex items-center justify-center">
          <span class="material-symbols-outlined" style="font-size:16px;color:#fff;font-variation-settings:'wght' 700">check</span>
        </span>
        <span class="font-headline font-bold text-sm">Decline all requests for 5 minutes</span>
      </label>
      <div class="px-5 pt-3 pb-5 flex gap-2">
        <button id="ht-decline" type="button" aria-label="Decline" class="btn-secondary flex-none flex items-center justify-center self-stretch" style="padding:0;background:#f4f4f2">
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
        <button id="ht-accept" type="button" class="btn-primary" style="flex:3">Auto-accept (${HOST_COUNTDOWN_SECONDS})</button>
      </div>
      <p id="ht-countdown" class="text-sm font-body px-5 pb-5 text-center text-error" hidden>Auto-accept in ${HOST_COUNTDOWN_SECONDS} seconds.</p>
    </div>
  `;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  _hostDialog = el;

  const acceptBtn = el.querySelector('#ht-accept');
  const declineBtn = el.querySelector('#ht-decline');
  const blockCheckbox = el.querySelector('#ht-block');
  const countdownEl = el.querySelector('#ht-countdown');

  const accept = async () => {
    _closeHostDialog();
    try {
      await fb.grantHostChange(roomCode, req.requestKey);
    } catch {
      toast.show('Failed to change host');
    }
  };

  const decline = async () => {
    const blockMinutes = blockCheckbox.checked ? 5 : 0;
    _closeHostDialog();
    try {
      await fb.declineHostChange(roomCode, { blockMinutes });
    } catch {
      toast.show('Failed to decline');
    }
  };

  let acceptClickHandler = accept;
  acceptBtn.addEventListener('click', () => acceptClickHandler());
  declineBtn.addEventListener('click', decline);

  let remaining = HOST_COUNTDOWN_SECONDS;
  let blockedMode = false;

  const setAcceptLabel = () => {
    acceptBtn.innerHTML = `Auto-accept (<span style="display:inline-block">${remaining}</span>)`;
  };

  const setCountdownText = () => {
    countdownEl.innerHTML = `Auto-accept in <span style="display:inline-block">${remaining}</span> seconds.`;
  };

  const animateNum = (el) => {
    const span = el.querySelector('span');
    if (span) span.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-out' });
  };

  const startCountdown = () => {
    if (_hostCountdownTimer) { clearInterval(_hostCountdownTimer); _hostCountdownTimer = null; }
    remaining = HOST_COUNTDOWN_SECONDS;
    blockedMode = false;
    countdownEl.hidden = true;
    setAcceptLabel();
    _hostCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (blockedMode) { countdownEl.textContent = 'Accepting…'; } else { acceptBtn.textContent = 'Accepting…'; }
        accept();
        return;
      }
      if (blockedMode) {
        setCountdownText();
        animateNum(countdownEl);
      } else {
        setAcceptLabel();
        animateNum(acceptBtn);
      }
    }, 1000);
  };

  // Checking "decline all requests" switches the live countdown from the button
  // to the red line below; unchecking switches it back. The interval keeps running.
  const btnRow = acceptBtn.parentElement;

  blockCheckbox.addEventListener('change', () => {
    if (blockCheckbox.checked) {
      blockedMode = true;
      setCountdownText();
      countdownEl.hidden = false;
      btnRow.style.paddingBottom = '0.5rem';
      declineBtn.style.display = 'none';
      acceptBtn.style.flex = '1 1 100%';
      acceptBtn.textContent = 'Decline';
      acceptClickHandler = decline;
    } else {
      blockedMode = false;
      countdownEl.hidden = true;
      btnRow.style.paddingBottom = '';
      declineBtn.style.display = '';
      acceptBtn.style.flex = '3';
      setAcceptLabel();
      acceptClickHandler = accept;
    }
  });

  startCountdown();

  requestAnimationFrame(() => { declineBtn.style.width = declineBtn.offsetHeight + 'px'; });
}

function _closeHostDialog() {
  if (_hostCountdownTimer) { clearInterval(_hostCountdownTimer); _hostCountdownTimer = null; }
  _hostDialogRequestKey = null;
  if (_hostDialog) {
    _hostDialog.remove();
    _hostDialog = null;
    document.body.style.overflow = '';
  }
}
