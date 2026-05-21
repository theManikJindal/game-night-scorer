// ═══════════════════════════════════════════
// Dashboard Screen — Live Scoreboard
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as toast from '../components/toast.js';
import * as hostMenu from '../components/host-menu.js';
import { renderRow } from '../components/player-row.js';
import { getGame } from '../games/registry.js';

// Bolt Optimization: Memoize O(R*P) round points calculation
// The dashboard re-renders frequently on Firebase state syncs.
// We cache the roundPoints calculation based on the game.rounds object reference
// and the specific player list to avoid redundant array allocations and lookups.
const _roundPointsCache = new WeakMap();

let _unsubGames = null;
let _unsubMeta = null;
let _unsubPlayers = null;

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');

  if (!roomCode) {
    router.navigate('home');
    return;
  }

  // Top bar
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-back').classList.remove('hidden');
  document.getElementById('top-bar-back').onclick = () => router.navigate('lobby', { roomCode });

  // Bottom nav
  bottomNav.show('dashboard');

  container.innerHTML = `<div id="dash-content" class="p-6 pb-8"></div>`;

  // Watch for state changes
  const renderHandler = () => _render(container, roomCode);
  _unsubGames = state.on('games', renderHandler);
  _unsubMeta = state.on('roomMeta', renderHandler);
  _unsubPlayers = state.on('players', renderHandler);

  // Ensure room is being watched
  if (!state.get('roomCode')) {
    state.set('roomCode', roomCode);
  }
  if (!state.get('roomMeta')) {
    fb.watchRoom(roomCode, () => {});
  }

  // Initial render
  _render(container, roomCode);
}

export function unmount() {
  if (_unsubGames) _unsubGames();
  _unsubGames = null;
  if (_unsubMeta) _unsubMeta();
  _unsubMeta = null;
  if (_unsubPlayers) _unsubPlayers();
  _unsubPlayers = null;
}

function _render(container, roomCode) {
  const content = container.querySelector('#dash-content');
  if (!content) return;

  const game = state.currentGame();
  const meta = state.get('roomMeta') || {};
  const isHost = state.isHost();

  if (!game) {
    document.getElementById('top-bar-title').textContent = 'GAME NIGHT';
    content.innerHTML = `
      <div class="text-center py-20">
        <span aria-hidden="true" class="material-symbols-outlined text-5xl text-outline mb-4">casino</span>
        <p class="font-headline font-bold text-lg uppercase mb-2">No Active Game</p>
        <p class="font-body text-sm text-on-surface-variant">
          ${isHost ? 'Go back to the lobby to start a game.' : 'Waiting for the host to start a game...'}
        </p>
      </div>
    `;
    return;
  }

  const gameModule = getGame(game.type);
  if (!gameModule) return;

  const snapshot = game.playerSnapshot || {};
  const totals = game.totals || {};
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const playerIds = game.playerIds || [];

  // Title
  document.getElementById('top-bar-title').textContent = gameModule.label.toUpperCase();

  // Top bar actions — shared host menu component
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);

  // Derive standings
  const standings = gameModule.deriveStandings(totals, playerIds);

  // Progress calculation
  let getProgress;
  if (gameModule.winMode === 'highest_total') {
    const target = game.config?.targetScore || 200;
    getProgress = (total) => Math.min(100, Math.round((total / target) * 100));
  } else if (game.type === 'papayoo') {
    const roundLimit = game.config?.roundLimit || 5;
    getProgress = () => Math.min(100, Math.round((rounds.length / roundLimit) * 100));
  } else {
    const threshold = game.config?.lossThreshold || 100;
    getProgress = (total) => Math.min(100, Math.round((total / threshold) * 100));
  }

  // Round points per player — use game module's getRoundPoints for accuracy
  let roundPoints = {};
  let cacheHit = false;

  if (game.rounds && typeof game.rounds === 'object') {
    const cached = _roundPointsCache.get(game.rounds);
    // Ensure player list hasn't changed (strict equality on array ref)
    if (cached && cached.playerIds === playerIds) {
      roundPoints = cached.result;
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    playerIds.forEach((pid) => { roundPoints[pid] = []; });
    rounds.forEach((rnd) => {
      playerIds.forEach((pid) => {
        roundPoints[pid].push(gameModule.getRoundPoints(rnd, pid));
      });
    });

    if (game.rounds && typeof game.rounds === 'object') {
      _roundPointsCache.set(game.rounds, { result: roundPoints, playerIds });
    }
  }


  let html = '';

  // Overtime banner
  if (game.status === 'overtime') {
    html += `<div class="overtime-banner mb-4">TIE-BREAKER / OVERTIME</div>`;
  }

  // Game info bar
  html += `
    <div class="flex justify-between items-end mb-4">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline">ROUND</p>
        <p class="font-mono text-xl font-bold">${rounds.length}${game.type === 'papayoo' ? `/${game.config?.roundLimit || 5}` : ''}</p>
      </div>
      <div class="text-right">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline">${gameModule.winMode === 'highest_total' ? 'TARGET' : game.type === 'cabo' ? 'BUST AT' : 'ROUNDS'}</p>
        <p class="font-mono text-xl font-bold">${gameModule.winMode === 'highest_total' ? game.config?.targetScore : game.type === 'cabo' ? '>100' : game.config?.roundLimit}</p>
      </div>
    </div>
  `;

  // Check winner redirect
  if (game.status === 'finished' && game.winner) {
    router.navigate('winner', { roomCode });
    return;
  }

  // Sort: inactive players drop to the bottom regardless of score,
  // so active rankings stay visually clear.
  const playersMap = state.get('players') || {};
  const isInactive = (pid) => playersMap[pid]?.isActive === false;
  const orderedStandings = [
    ...standings.filter((s) => !isInactive(s.playerId)),
    ...standings.filter((s) => isInactive(s.playerId)),
  ];

  // Scoreboard
  html += `<div class="flex flex-col gap-1">`;
  orderedStandings.forEach((s) => {
    const p = snapshot[s.playerId] || {};
    html += renderRow({
      name: p.name || s.playerId,
      total: s.total,
      accentIndex: p.accentIndex || 0,
      rank: s.rank,
      rounds: roundPoints[s.playerId] || [],
      progressPct: getProgress(s.total),
      isLeader: s.rank === 1,
      winMode: gameModule.winMode,
      isInactive: isInactive(s.playerId),
    });
  });
  html += `</div>`;

  // Host actions
  if (isHost) {
    let undoReason = '';
    if (rounds.length === 0) undoReason = 'No rounds to undo';
    else if (game.status === 'finished') undoReason = 'Game is finished';
    else if (game.status === 'abandoned') undoReason = 'Game was abandoned';
    const undoDisabled = undoReason !== '';
    const undoTitle = undoDisabled ? undoReason : 'Undo last round';
    html += `
      <div class="flex gap-2 mt-6">
        <button id="btn-undo" title="${undoTitle}" aria-label="${undoTitle}" class="flex-1 bg-surface-container-lowest border border-outline py-3 text-sm font-headline font-bold uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed" ${undoDisabled ? 'disabled' : ''}>
          <span class="material-symbols-outlined text-sm" aria-hidden="true">undo</span>
          UNDO
        </button>
      </div>
    `;
  }

  content.innerHTML = html;

  // Bind host actions
  if (isHost) {
    content.querySelector('#btn-undo')?.addEventListener('click', () => _undoRound(roomCode, game, gameModule));
  }
}

async function _undoRound(roomCode, game, gameModule) {
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  if (rounds.length === 0) return;
  if (game.status === 'finished' || game.status === 'abandoned') {
    return;
  }

  // Recalculate totals without last round
  const playerIds = game.playerIds;
  const allRoundsExceptLast = rounds.slice(0, -1);
  let newTotals = Object.fromEntries(playerIds.map((id) => [id, 0]));

  allRoundsExceptLast.forEach((rnd) => {
    newTotals = gameModule.applyRound(newTotals, rnd, game);
  });

  // Re-evaluate end condition to determine correct status/overtime
  const newRoundCount = allRoundsExceptLast.length;
  const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, newRoundCount);
  let prevStatus = 'active';
  let overtime = false;
  if (endResult.ended && !endResult.winner) {
    prevStatus = 'overtime';
    overtime = true;
  }

  try {
    await fb.undoLastRound(roomCode, game.gameId, newTotals, prevStatus, overtime);
    toast.show('Round undone');
  } catch (e) {
    toast.show('Undo failed');
  }
}
