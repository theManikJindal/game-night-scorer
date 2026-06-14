// ═══════════════════════════════════════════
// Shared Host Menu Component
// ═══════════════════════════════════════════
// Lives in index.html as a fixed overlay.
// Screens call show/hide and bind actions.

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from './toast.js';
import * as cache from '../cache.js';
import * as qrModal from './qr-modal.js';
import * as hostTransfer from './host-transfer.js';
import { getGame } from '../games/registry.js';

let _bound = false;

export function init() {
  if (_bound) return;
  _bound = true;

  const overlay = document.getElementById('host-menu-overlay');
  const backdrop = document.getElementById('host-menu-backdrop');
  if (!overlay || !backdrop) return;

  // Close on backdrop click
  backdrop.addEventListener('click', hide);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'block') {
      hide();
    }
  });

  // Delegate menu actions — items are re-rendered on each open (see _renderMenuItems).
  const itemsEl = document.getElementById('host-menu-items');
  itemsEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.host-menu-action');
    if (!btn) return;
    hide();
    const action = btn.dataset.action;
    const roomCode = state.get('roomCode');

    if (action === 'end-game') {
      await _endGameWithWinner(roomCode);
      router.navigate('lobby', { roomCode });
    } else if (action === 'become-host') {
      hostTransfer.requestBecomeHost(roomCode);
    } else if (action === 'call-night') {
      await _callItANight(roomCode);
    } else if (action === 'one-more-game') {
      await _oneMoreGame(roomCode);
    } else if (action === 'exit-lobby') {
      // Mid-game leave deserves a stronger warning since it strands other clients.
      const lobby = state.get('roomLobby') || {};
      const midGame = lobby.status === 'playing' && lobby.activeGameId;
      const message = midGame
        ? "You're mid-game. Leaving means the game can't continue from this device. Proceed?"
        : 'Leave this room?';
      if (!window.confirm(message)) return;
      _leaveRoom(roomCode);
    }
  });
}

// Build the overflow menu items. Shared across the Lobby, Game, and Recap tabs so
// everyone sees the same menu everywhere. Destructive items use the negative (error)
// variant; positive ones (e.g. "One More Game") use the default variant.
// "End Game" only shows while a game is actually in progress; "Call it a Night" only
// once stats are tracked and a game has finished (and the night isn't already locked);
// "One More Game" replaces it once the night is locked.
function _renderMenuItems() {
  const itemsEl = document.getElementById('host-menu-items');
  if (!itemsEl) return;

  const items = [];
  if (state.isHost()) {
    const lobby = state.get('roomLobby') || {};
    const games = state.get('games') || {};
    const gameActive = lobby.status === 'playing' && state.currentGame()?.status === 'active';
    const trackStats = lobby.trackStats !== false;
    const hasFinishedGame = Object.values(games).some((g) => g.status === 'finished');
    // "Call it a Night" can't co-exist with "End Game" — finish the active game first.
    const canCallNight = trackStats && hasFinishedGame && lobby.status !== 'night-ended' && !gameActive;

    if (gameActive) items.push({ action: 'end-game', icon: 'stop_circle', label: 'End Game' });
    if (canCallNight) items.push({ action: 'call-night', icon: 'bedtime', label: 'Call it a Night' });
    // Once the night's been called, offer to resume it for another game. Unlike
    // the other (destructive) actions, this is a positive, non-error action.
    if (lobby.status === 'night-ended') {
      items.push({ action: 'one-more-game', icon: 'replay', label: 'One More Game', variant: 'default' });
    }
  } else {
    // Spectators can request to take over as host (via the request → approve flow).
    items.push({ action: 'become-host', icon: 'swap_horiz', label: 'Become Host' });
  }
  // Everyone gets "Leave Lobby".
  items.push({ action: 'exit-lobby', icon: 'logout', label: 'Leave Lobby' });

  const base = 'host-menu-action w-full text-left px-4 py-3 font-headline font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors flex items-center gap-3';
  itemsEl.innerHTML = items.map((it, i) => {
    // Most items are destructive (error variant); a few are positive (default).
    const color = it.variant === 'default' ? 'text-on-surface' : 'text-error';
    return `
    <button class="${base} ${color}${i < items.length - 1 ? ' border-b border-outline-variant' : ''}" data-action="${it.action}">
      <span aria-hidden="true" class="material-symbols-outlined text-sm">${it.icon}</span>
      ${it.label.toUpperCase()}
    </button>
  `;
  }).join('');
}

async function _callItANight(roomCode) {
  if (!state.isHost()) {
    toast.show('Only the host can do that');
    return;
  }
  const confirmed = window.confirm('Call it a night? This locks the room and shows the recap to everyone.');
  if (!confirmed) return;
  try {
    await fb.endNight(roomCode);
  } catch (e) {
    console.error('End night failed:', e);
    toast.show('Failed to end night');
  }
}

// Reverse "Call it a Night": unlock the room back to the 'waiting' state. We
// also clear activeGameId — the night's last game is over, so we don't want its
// tab restored; the host lands on the Lobby with a fresh "Start Game" button.
// (app.js navigates only the host to the lobby; spectators stay on the recap
// until a new game actually starts.)
async function _oneMoreGame(roomCode) {
  if (!state.isHost()) {
    toast.show('Only the host can do that');
    return;
  }
  try {
    await fb.updateRoomLobby(roomCode, { status: 'waiting', activeGameId: null });
  } catch (e) {
    console.error('Resume night failed:', e);
    toast.show('Failed to start another game');
  }
}

export function toggle() {
  const overlay = document.getElementById('host-menu-overlay');
  if (!overlay) return;
  if (overlay.style.display === 'none') {
    show();
  } else {
    hide();
  }
}

export function show() {
  init();
  const overlay = document.getElementById('host-menu-overlay');
  if (overlay) {
    _renderMenuItems();
    overlay.style.display = 'block';

    // Manage focus: focus first interactive element
    requestAnimationFrame(() => {
      const firstAction = overlay.querySelector('.host-menu-action');
      if (firstAction) firstAction.focus();
    });
  }
}

export function hide() {
  const overlay = document.getElementById('host-menu-overlay');
  if (overlay) {
    overlay.style.display = 'none';

    // Manage focus: return to trigger element
    const trigger = document.getElementById('btn-host-menu-trigger');
    if (trigger) trigger.focus();
  }
}

/**
 * Render the appropriate top-bar actions for an active game screen.
 * Call this from dashboard/scoring/rules mount.
 * Shows: room code + (host: 3-dot menu | viewer: exit button)
 */
export function renderTopBarActions(roomCode) {
  // Everyone gets the overflow menu now: the host has game/night controls, and
  // spectators have "Become Host" + "Exit Lobby".
  const showMenu = true;
  const actionsEl = document.getElementById('top-bar-actions');
  if (!actionsEl) return;

  // Role chip: tells the user whether they're driving the game (host) or watching
  // (spectator). The host variant is filled to stand out; spectator is outlined.
  const isHost = state.isHost();
  const roleChip = `<span class="font-mono text-[0.625rem] uppercase tracking-widest px-2 py-0.5 border mr-1 ${isHost ? 'bg-primary text-on-primary border-primary' : 'border-outline text-outline'}">${isHost ? 'HOST' : 'SPECTATOR'}</span>`;

  actionsEl.innerHTML = `
    ${roleChip}
    <button id="btn-qr-share" aria-label="Show QR code" title="Share room QR" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1" style="font-size:1.375rem">qr_code_2</button>
    ${showMenu
      ? `<button id="btn-host-menu-trigger" aria-label="Open menu" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1 ml-1" style="font-size:1.375rem">more_vert</button>`
      : ''
    }
  `;

  // Bind QR share button (visible to both host and viewer)
  const qrBtn = document.getElementById('btn-qr-share');
  if (qrBtn) {
    qrBtn.addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
      qrModal.show(url, roomCode);
    });
  }

  // Bind trigger
  const menuTrigger = document.getElementById('btn-host-menu-trigger');
  if (menuTrigger) {
    menuTrigger.addEventListener('click', toggle);
  }

}

function _leaveRoom(roomCode) {
  fb.unwatchRoom();
  if (roomCode) cache.clearCache(roomCode);
  router.navigate('home', {}, 'back');
}

async function _endGameWithWinner(roomCode) {
  const game = state.currentGame();
  if (!game) {
    fb.setRoomStatus(roomCode, 'waiting');
    toast.show('Game ended');
    return;
  }

  const gameModule = getGame(game.type);
  const totals = game.totals || {};
  const playerIds = game.playerIds || [];
  const rounds = Object.keys(game.rounds || {}).length;

  // No rounds played (or unknown game) — mark the game itself abandoned so it
  // doesn't linger as 'active' under activeGameId, then return the room to waiting.
  if (rounds === 0 || !gameModule) {
    await fb.submitGameAbandon(roomCode, game.gameId);
    fb.setRoomStatus(roomCode, 'waiting');
    toast.show('Game ended');
    return;
  }

  // Compute standings to find if there's a clear leader
  const standings = gameModule.deriveStandings(totals, playerIds);
  const rank1Players = standings.filter((s) => s.rank === 1);

  if (rank1Players.length === 1) {
    // Clear leader — set them as winner, mark game finished
    await fb.submitGameEnd(roomCode, game.gameId, rank1Players[0].playerId);
    toast.show(`Game ended — ${_winnerName(game, rank1Players[0].playerId)} wins`);
  } else {
    // Tied or inconclusive — mark as abandoned
    await fb.submitGameAbandon(roomCode, game.gameId);
    toast.show('Game ended (no clear winner)');
  }

  fb.setRoomStatus(roomCode, 'waiting');
}

function _winnerName(game, playerId) {
  return game.playerSnapshot?.[playerId]?.name || playerId;
}
