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

  // Bind menu actions
  overlay.querySelectorAll('.host-menu-action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      hide();
      const action = btn.dataset.action;
      const roomCode = state.get('roomCode');

      if (action === 'new-game') {
        // The room activeGameId should also be cleared to ensure it goes back to a clean state.
        await fb.updateRoomMeta(roomCode, { status: 'lobby', activeGameId: null });
        router.navigate('game-select', { roomCode });
      } else if (action === 'lobby') {
        router.navigate('lobby', { roomCode });
      } else if (action === 'end-game') {
        await _endGameWithWinner(roomCode);
        router.navigate('lobby', { roomCode });
      } else if (action === 'home') {
        // Mid-game leave deserves a stronger warning since it strands other clients.
        const meta = state.get('roomMeta') || {};
        const midGame = meta.status === 'playing' && meta.activeGameId;
        const message = midGame
          ? "You're mid-game. Leaving means the game can't continue from this device. Proceed?"
          : 'Leave this room?';
        if (!window.confirm(message)) return;
        _leaveRoom(roomCode);
      }
    });
  });
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
  const isHost = state.isHost();
  const actionsEl = document.getElementById('top-bar-actions');
  if (!actionsEl) return;

  actionsEl.innerHTML = `
    <button id="btn-copy-link" aria-label="Copy join link" title="Copy join link"
      class="font-mono text-xs text-outline border border-outline px-2 py-1 hover:bg-surface-container-high transition-colors">
      ${roomCode}
    </button>
    <button id="btn-qr-share" aria-label="Show QR code" title="Share room QR" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1 ml-1" style="font-size:22px">qr_code_2</button>
    ${isHost
      ? `<button id="btn-host-menu-trigger" aria-label="Open host menu" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1 ml-1" style="font-size:22px">more_vert</button>`
      : ''
    }
  `;

  // Copy join link to clipboard
  const copyBtn = document.getElementById('btn-copy-link');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
      try {
        await navigator.clipboard.writeText(url);
        const orig = copyBtn.textContent.trim();
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = orig; }, 1500);
      } catch {
        toast.show('Could not copy link');
      }
    });
  }

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
    fb.setRoomStatus(roomCode, 'lobby');
    toast.show('Game ended');
    return;
  }

  const gameModule = getGame(game.type);
  const totals = game.totals || {};
  const playerIds = game.playerIds || [];
  const rounds = Object.keys(game.rounds || {}).length;

  // If no rounds played, just abandon
  if (rounds === 0 || !gameModule) {
    fb.setRoomStatus(roomCode, 'lobby');
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

  fb.setRoomStatus(roomCode, 'lobby');
}

function _winnerName(game, playerId) {
  return game.playerSnapshot?.[playerId]?.name || playerId;
}
