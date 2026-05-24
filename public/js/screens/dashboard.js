// ═══════════════════════════════════════════
// Dashboard Screen — Live Scoreboard
// ═══════════════════════════════════════════

import * as state from '../state.js';
import { ACCENT_COLORS } from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as toast from '../components/toast.js';
import * as hostMenu from '../components/host-menu.js';
import { renderRow } from '../components/player-row.js';
import { getGame } from '../games/registry.js';
import { escapeHTML } from '../utils.js';

// Bolt Optimization: Memoize O(R*P) round points calculation
// The dashboard re-renders frequently on Firebase state syncs.
// We cache the roundPoints calculation based on the game.rounds object reference
// and the specific player list to avoid redundant array allocations and lookups.
const _roundPointsCache = new WeakMap();

let _unsubGames = null;
let _unsubMeta = null;
let _unsubPlayers = null;

// ── Flip 7 inline scoring state ──
// Draft persists across Firebase re-renders until the round is confirmed or undone.
let _flip7Draft = {}; // { [playerId]: { numbers: Set<number>, actions: Set<number>, x2: bool, bust: bool } }
let _flip7RoundCount = -1; // Detects undo (round count decreases) to clear the draft
let _flip7DrawerEl = null; // Fixed overlay appended to body — survives _render() calls
let _flip7DrawerPlayerId = null; // Which player's drawer is currently open
let _flip7Grayscale = false; // false = colour (default); true = grayscale (toggle hidden for now)

// Grayscale spritesheet: converted once via canvas, reused across all drawer opens.
let _flip7SpriteSrc = '/images/flip7-cards.png';

function _initGrayscaleSprite() {
  if (_flip7SpriteSrc !== '/images/flip7-cards.png') return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, 0, 0);
    _flip7SpriteSrc = canvas.toDataURL('image/png');
  };
  img.src = '/images/flip7-cards.png';
}

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

  // Kick off grayscale spritesheet conversion as early as possible
  _initGrayscaleSprite();

  // Create the Flip 7 card drawer overlay (body-level so _render() can't overwrite it)
  _flip7DrawerEl = document.createElement('div');
  _flip7DrawerEl.id = 'flip7-card-drawer';
  _flip7DrawerEl.className = 'fixed inset-0 z-50 flex items-end';
  _flip7DrawerEl.style.display = 'none';
  document.body.appendChild(_flip7DrawerEl);

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

  // Remove the Flip 7 drawer from the DOM (restore scroll if it was open)
  if (_flip7DrawerEl) {
    _flip7DrawerEl.remove();
    _flip7DrawerEl = null;
    document.body.style.overflow = '';
  }
  _flip7Draft = {};
  _flip7RoundCount = -1;
  _flip7DrawerPlayerId = null;
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

  // Clear Flip 7 draft when the round count changes (undo or fresh mount after submit)
  if (game.type === 'flip7' && rounds.length !== _flip7RoundCount) {
    _flip7Draft = {};
    _flip7RoundCount = rounds.length;
  }

  let html = '';

  // Overtime banner
  if (game.status === 'overtime') {
    html += `<div class="overtime-banner mb-4">TIE-BREAKER / OVERTIME</div>`;
  }

  // Game info bar
  const isFlip7Host = game.type === 'flip7' && isHost
    && game.status !== 'finished' && game.status !== 'abandoned';

  html += `
    <div class="flex justify-between items-end mb-4">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline">ROUND</p>
        <p class="font-mono text-xl font-bold">${rounds.length}${game.type === 'papayoo' ? `/${game.config?.roundLimit || 5}` : ''}</p>
        ${isFlip7Host ? `<p class="font-mono text-[10px] text-outline mt-0.5">Tap a player to score</p>` : ''}
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
    if (isFlip7Host && !isInactive(s.playerId)) {
      // Tappable row for active players — host enters cards via drawer
      html += _renderFlip7HostRow(s, p, roundPoints[s.playerId] || []);
    } else {
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
    }
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

    if (isFlip7Host) {
      html += `
        <div class="flex gap-2 mt-6">
          <button id="btn-undo" title="${undoTitle}" aria-label="${undoTitle}"
            class="bg-surface-container-lowest border border-outline py-3 px-4 text-sm font-headline font-bold uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            ${undoDisabled ? 'disabled' : ''}>
            <span class="material-symbols-outlined text-sm" aria-hidden="true">undo</span>
            UNDO
          </button>
          <button id="btn-confirm-round"
            class="flex-1 btn-primary flex items-center justify-center gap-2">
            CONFIRM ROUND
            <span class="material-symbols-outlined text-lg" aria-hidden="true">check</span>
          </button>
        </div>
      `;
    } else {
      html += `
        <div class="flex gap-2 mt-6">
          <button id="btn-undo" title="${undoTitle}" aria-label="${undoTitle}"
            class="flex-1 bg-surface-container-lowest border border-outline py-3 text-sm font-headline font-bold uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            ${undoDisabled ? 'disabled' : ''}>
            <span class="material-symbols-outlined text-sm" aria-hidden="true">undo</span>
            UNDO
          </button>
        </div>
      `;
    }
  }

  content.innerHTML = html;

  // Bind host actions
  if (isHost) {
    content.querySelector('#btn-undo')?.addEventListener('click', () => _undoRound(roomCode, game, gameModule));

    if (isFlip7Host) {
      // Open drawer when a player row is tapped
      content.querySelectorAll('.flip7-player-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          _openFlip7Drawer(container, roomCode, btn.dataset.playerId, snapshot, game);
        });
      });

      content.querySelector('#btn-confirm-round')?.addEventListener('click', () => {
        _confirmFlip7Round(container, roomCode, game, gameModule);
      });
    }
  }
}

// ── Flip 7 tappable player row ──

function _renderFlip7HostRow(standing, playerData, roundHistory) {
  const { playerId: pid, total, rank } = standing;
  const color = ACCENT_COLORS[playerData.accentIndex || 0];
  const name = escapeHTML(playerData.name || pid);
  const rankLabel = rank <= 3 ? ['1ST', '2ND', '3RD'][rank - 1] : `${rank}TH`;
  const bgClass = rank % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-high/20';

  const draft = _flip7Draft[pid];
  const hasDraft = draft && (draft.numbers.size > 0 || draft.actions.size > 0 || draft.x2);

  const roundChips = roundHistory.map((pts) =>
    `<span class="inline-block font-mono text-[9px] bg-surface-container-low border border-outline-variant px-1 py-0.5 text-outline">${pts >= 0 ? '+' : ''}${pts}</span>`
  ).join('');

  let draftChip = '';
  if (hasDraft) {
    const { basePoints, flip7 } = _computeFlip7Score(draft);
    const roundPts = basePoints + (flip7 ? 15 : 0);
    const chipLabel = `+${roundPts}${flip7 ? ' F7' : ''}`;
    draftChip = `<span class="inline-block font-mono text-[9px] px-1 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${chipLabel}</span>`;
  }

  return `
    <button type="button"
      class="flip7-player-row w-full text-left ${bgClass} border border-outline hover:bg-surface-container-high transition-colors"
      data-player-id="${escapeHTML(pid)}"
      aria-label="Score ${name}">
      <div class="accent-bar" style="background:${color}"></div>
      <div class="p-4 flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2">
            <p class="font-headline font-extrabold text-base uppercase truncate">${name}</p>
            <span class="font-mono text-[10px] text-outline uppercase shrink-0">${rankLabel}</span>
          </div>
          <div class="flex gap-1 mt-1 flex-wrap items-center">
            ${roundChips}
            ${draftChip}
            ${!hasDraft ? `<span class="font-mono text-[9px] text-outline">TAP TO SCORE</span>` : ''}
          </div>
        </div>
        <div class="text-right shrink-0 flex items-center gap-2">
          <p class="font-mono text-2xl font-bold ${rank === 1 ? 'text-secondary' : ''}">${total}</p>
          <span class="material-symbols-outlined text-sm text-outline-variant" aria-hidden="true">edit</span>
        </div>
      </div>
    </button>
  `;
}

// ── Flip 7 score computation (mirrors gameModule.computeScoreFromCards) ──

function _computeFlip7Score(draft) {
  if (!draft) return { basePoints: 0, flip7: false };
  const numbers = [...draft.numbers];
  const actions = [...draft.actions];
  const numberSum = numbers.reduce((s, n) => s + n, 0);
  const actionSum = actions.reduce((s, n) => s + n, 0);
  const subtotal = (numberSum + actionSum) * (draft.x2 ? 2 : 1);
  return { basePoints: subtotal, flip7: numbers.length === 7 };
}

// ── Flip 7 card drawer ──

// Spritesheet: public/images/flip7-cards.png — 910×816px, 7 cols × 4 rows, each card 130×204px.
// bg-size: 700% auto makes one card fill the button width at any size (fully responsive).
// bg-position formula: x = col/6 * 100%, y = row/3 * 100%
//
// Grid order (display sequence, 4 cols × 5 rows):
//   0  1  2  3   ← row 0
//   4  5  6  7
//   8  9 10 11
//  12 +2 +4 +6
//  +8 +10 ×2 DONE
// Grid layout (5 cols × 4 rows):
// ---   0  +8  +10  ×2
// +6    1   2    3   4
// +4    5   6    7   8
// +2    9  10   11  12
const _F7_CARD_DATA = [
  { empty: true },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  0, col: 0, row: 0 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  8, col: 6, row: 0 },
  { cls: 'flip7-action-btn', attr: 'data-action', val: 10, col: 2, row: 2 },
  { id: 'flip7-x2-btn', col: 1, row: 3 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  6, col: 5, row: 2 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  1, col: 1, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  2, col: 5, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  3, col: 0, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  4, col: 1, row: 1 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  4, col: 4, row: 2 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  5, col: 2, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  6, col: 3, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  7, col: 4, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  8, col: 5, row: 1 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  2, col: 3, row: 2 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  9, col: 0, row: 2 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 10, col: 2, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 11, col: 3, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 12, col: 4, row: 0 },
];

// Returns inline background CSS for a single card sprite cell (fully responsive).
function _cardSpriteBg(col, row) {
  const src = _flip7Grayscale ? _flip7SpriteSrc : '/images/flip7-cards.png';
  const x = col === 0 ? '0%' : `${+(col / 6 * 100).toFixed(4)}%`;
  const y = row === 0 ? '0%' : `${+(row / 3 * 100).toFixed(4)}%`;
  return `background-image:url('${src}');background-size:700% auto;background-repeat:no-repeat;background-position:${x} ${y}`;
}

function _openFlip7Drawer(container, roomCode, playerId, snapshot, game) {
  if (!_flip7DrawerEl) return;
  _flip7DrawerPlayerId = playerId;

  if (!_flip7Draft[playerId]) {
    _flip7Draft[playerId] = { numbers: new Set(), actions: new Set(), x2: false };
  }

  const p = snapshot[playerId] || {};
  const color = ACCENT_COLORS[p.accentIndex || 0];
  const name = escapeHTML(p.name || playerId);
  const total = (game.totals || {})[playerId] || 0;

  // Build all 20 grid cells using the spritesheet
  const cardBtns = _F7_CARD_DATA.map((c) => {
    if (c.empty) return `<div style="aspect-ratio:130/204"></div>`;
    const bg = _cardSpriteBg(c.col, c.row);
    const cardStyle = `aspect-ratio:130/204;border-radius:6px;box-shadow:0 3px 5px -1px rgba(0,0,0,0.18);${bg}`;
    if (c.id) {
      return `<button type="button" id="${c.id}" class="relative overflow-hidden transition-all" aria-pressed="false" data-col="${c.col}" data-row="${c.row}" style="${cardStyle}"></button>`;
    }
    return `<button type="button" class="${c.cls} relative overflow-hidden transition-all" ${c.attr}="${c.val}" aria-pressed="false" data-col="${c.col}" data-row="${c.row}" style="${cardStyle}"></button>`;
  }).join('');

  _flip7DrawerEl.innerHTML = `
    <div id="flip7-drawer-backdrop" class="absolute inset-0 bg-black/50"></div>
    <div id="flip7-drawer-sheet" class="relative w-full bg-surface-container-lowest border-t-2 border-outline" style="max-height:85vh;display:flex;flex-direction:column;">
      <!-- Sticky header -->
      <div class="shrink-0">
        <div class="accent-bar" style="background:${color}"></div>
        <div class="flex justify-center pt-3 pb-1">
          <div class="w-10 h-1 rounded-full bg-outline-variant"></div>
        </div>
        <div class="px-4 pb-3 flex items-center justify-between border-b border-outline-variant">
          <div>
            <p id="flip7-header-score" class="font-mono text-4xl font-bold leading-none">0</p>
            <p id="flip7-header-label" class="font-mono text-[9px] text-outline mt-0.5 uppercase tracking-widest">THIS ROUND</p>
          </div>
          <div class="text-right">
            <p class="font-headline font-bold text-sm uppercase truncate">${name}</p>
            <p class="font-mono text-[10px] text-outline">${total} PTS TOTAL</p>
          </div>
        </div>
      </div>
      <!-- Scrollable 4-col grid: 19 sprite cards + DONE in the 20th slot -->
      <div class="overflow-y-auto flex-1 p-4">
        <div class="grid grid-cols-5 gap-3">
          ${cardBtns}
        </div>
      </div>
    </div>
  `;

  _flip7DrawerEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  _refreshDrawerCardStates(playerId);
  _updateDrawerScore(playerId);
  _bindDrawerEvents(container, roomCode, playerId);
}

function _closeFlip7Drawer() {
  if (!_flip7DrawerEl) return;
  _flip7DrawerEl.style.display = 'none';
  _flip7DrawerEl.innerHTML = '';
  _flip7DrawerPlayerId = null;
  document.body.style.overflow = '';
}

function _refreshDrawerCardStates(playerId) {
  if (!_flip7DrawerEl) return;
  const draft = _flip7Draft[playerId] || { numbers: new Set(), actions: new Set(), x2: false };

  _flip7DrawerEl.querySelectorAll('.flip7-num-btn').forEach((btn) => {
    _applyCardStyle(btn, draft.numbers.has(parseInt(btn.dataset.num)));
  });
  _flip7DrawerEl.querySelectorAll('.flip7-action-btn').forEach((btn) => {
    _applyCardStyle(btn, draft.actions.has(parseInt(btn.dataset.action)));
  });
  const x2Btn = _flip7DrawerEl.querySelector('#flip7-x2-btn');
  if (x2Btn) _applyCardStyle(x2Btn, draft.x2);
}

function _applyCardStyle(btn, selected) {
  btn.setAttribute('aria-pressed', String(selected));
  let overlay = btn.querySelector('.card-sel-overlay');
  if (selected && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'card-sel-overlay absolute inset-0 flex items-center justify-center pointer-events-none';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.innerHTML = '<span class="material-symbols-outlined text-white" style="font-size:2rem;font-variation-settings:\'FILL\' 1">check_circle</span>';
    btn.appendChild(overlay);
  } else if (!selected && overlay) {
    overlay.remove();
  }
}

function _updateDrawerScore(playerId) {
  const scoreEl = _flip7DrawerEl?.querySelector('#flip7-header-score');
  const labelEl = _flip7DrawerEl?.querySelector('#flip7-header-label');
  if (!scoreEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) { scoreEl.textContent = '0'; return; }
  const { basePoints, flip7 } = _computeFlip7Score(draft);
  const roundPts = basePoints + (flip7 ? 15 : 0);
  scoreEl.textContent = roundPts;
  if (labelEl) labelEl.textContent = flip7 ? 'THIS ROUND · FLIP 7!' : 'THIS ROUND';
}

function _bindDrawerEvents(container, roomCode, playerId) {
  if (!_flip7DrawerEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) return;

  _flip7DrawerEl.querySelector('#flip7-drawer-backdrop')?.addEventListener('click', () => {
    _closeFlip7Drawer();
    _render(container, roomCode);
  });

  _flip7DrawerEl.querySelectorAll('.flip7-num-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.num);
      if (!draft.numbers.has(n) && draft.numbers.size >= 7) return;
      const sel = !draft.numbers.has(n);
      sel ? draft.numbers.add(n) : draft.numbers.delete(n);
      _applyCardStyle(btn, sel);
      _updateDrawerScore(playerId);
    });
  });

  _flip7DrawerEl.querySelectorAll('.flip7-action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.action);
      const sel = !draft.actions.has(n);
      sel ? draft.actions.add(n) : draft.actions.delete(n);
      _applyCardStyle(btn, sel);
      _updateDrawerScore(playerId);
    });
  });

  _flip7DrawerEl.querySelector('#flip7-x2-btn')?.addEventListener('click', (e) => {
    draft.x2 = !draft.x2;
    _applyCardStyle(e.currentTarget, draft.x2);
    _updateDrawerScore(playerId);
  });


}

// ── Confirm Flip 7 Round ──

async function _confirmFlip7Round(container, roomCode, initialGame, gameModule) {
  const game = state.currentGame() || initialGame;
  const playerIds = game.playerIds || [];
  const totals = game.totals || {};
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const playersMap = state.get('players') || {};

  // Build draft entries from the local Flip 7 card selections
  const entries = {};
  playerIds.forEach((pid) => {
    if (playersMap[pid]?.isActive === false) return;
    const draftEntry = _flip7Draft[pid] || { numbers: new Set(), actions: new Set(), x2: false };
    const { basePoints, flip7 } = _computeFlip7Score(draftEntry);
    entries[pid] = {
      basePoints,
      flip7,
      cards: {
        numbers: [...draftEntry.numbers],
        actions: [...draftEntry.actions],
        x2: draftEntry.x2,
      },
    };
  });

  const draft = { entries };

  const validation = gameModule.validateRound(draft, game);
  if (!validation.valid) {
    toast.show(validation.error || 'Invalid round data');
    return;
  }

  const newTotals = gameModule.applyRound({ ...totals }, draft, game);
  const newRoundCount = rounds.length + 1;
  const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, newRoundCount);

  const btn = container.querySelector('#btn-confirm-round');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner mx-auto"></div>'; }

  try {
    await fb.submitRound(roomCode, game.gameId, draft, newTotals, endResult.ended ? endResult : null);

    if (endResult.ended && endResult.winner) {
      router.navigate('winner', { roomCode });
    } else if (endResult.ended && endResult.overtime) {
      toast.show('Tied! Overtime round needed');
      router.navigate('dashboard', { roomCode });
    } else {
      toast.show(`Round ${newRoundCount} submitted`);
      router.navigate('dashboard', { roomCode });
    }
  } catch (e) {
    console.error('Submit round failed:', e);
    toast.show('Submit failed');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'CONFIRM ROUND <span aria-hidden="true" class="material-symbols-outlined text-lg">check</span>';
    }
  }
}

// ── Undo last round ──

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
