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
let _flip7DragMode = false; // Drag-to-rearrange mode for the card grid

// Edit scores overlay (body-level, survives _render() calls)
let _editScoresEl = null;
let _editScoresMode = false; // When true, tapping a player row opens adjust drawer instead of card drawer
let _editAdjustments = {}; // { [pid]: newEntry } — buffered until SAVE is clicked
let _editLastRoundKey = null; // round key captured when edit mode is entered

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
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.remove('hidden');
  backBtn.textContent = 'arrow_back';
  backBtn.setAttribute('aria-label', 'Go back');
  backBtn.onclick = () => router.navigate('lobby', { roomCode });

  // Bottom nav
  bottomNav.show('dashboard');

  container.innerHTML = `<div id="dash-content" class="p-6 pb-8"></div>`;

  // Kick off grayscale spritesheet conversion as early as possible
  _initGrayscaleSprite();

  // Create body-level overlays so _render() can't overwrite them
  _flip7DrawerEl = document.createElement('div');
  _flip7DrawerEl.id = 'flip7-card-drawer';
  _flip7DrawerEl.className = 'fixed inset-0 z-50 flex items-end';
  _flip7DrawerEl.style.display = 'none';
  document.body.appendChild(_flip7DrawerEl);

  _editScoresEl = document.createElement('div');
  _editScoresEl.id = 'edit-scores-overlay';
  _editScoresEl.className = 'fixed inset-0 z-50 flex items-end';
  _editScoresEl.style.display = 'none';
  document.body.appendChild(_editScoresEl);

  // Watch for state changes
  const renderHandler = () => _render(container, roomCode);
  _unsubGames = state.on('games', renderHandler);
  _unsubMeta = state.on('roomMeta', renderHandler);
  _unsubPlayers = state.on('players', renderHandler);

  // Ensure room is being watched
  if (!state.get('roomCode')) {
    state.set('roomCode', roomCode);
  }
  // Guard on the actual watcher, not roomMeta — cache hydration sets roomMeta on
  // page load which would otherwise skip watchRoom entirely after a refresh.
  if (!fb.isWatchingRoom()) {
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

  // Remove body-level overlays and restore scroll
  if (_flip7DrawerEl) {
    _flip7DrawerEl.remove();
    _flip7DrawerEl = null;
  }
  if (_editScoresEl) {
    _editScoresEl.remove();
    _editScoresEl = null;
  }
  document.body.style.overflow = '';
  _flip7Draft = {};
  _flip7RoundCount = -1;
  _flip7DrawerPlayerId = null;
  _editScoresMode = false;
  _editAdjustments = {};
  _editLastRoundKey = null;
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
  const roundKeys = game.rounds ? Object.keys(game.rounds) : [];
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const playerIds = game.playerIds || [];

  // Index of the round currently selected for editing (-1 when not in edit mode)
  const editingRoundIndex = _editScoresMode ? roundKeys.indexOf(_editLastRoundKey) : -1;

  // For Flip 7, show live totals (committed + in-progress draft) if the host
  // has pushed any scores mid-round. Falls back to committed totals.
  let displayTotals = (game.type === 'flip7' && game.liveTotals) ? game.liveTotals : totals;

  // While in edit mode with buffered adjustments, show preview totals locally
  if (_editScoresMode && editingRoundIndex >= 0 && Object.keys(_editAdjustments).length > 0) {
    const patchedRounds = rounds.map((rnd, i) =>
      i === editingRoundIndex
        ? { ...rnd, entries: { ...(rnd.entries || {}), ..._editAdjustments } }
        : rnd
    );
    let preview = Object.fromEntries(playerIds.map((id) => [id, 0]));
    patchedRounds.forEach((rnd) => { preview = gameModule.applyRound(preview, rnd, game); });
    displayTotals = preview;
  }

  // Title
  document.getElementById('top-bar-title').textContent = gameModule.label.toUpperCase();

  // Top bar actions — shared host menu component
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);

  // Derive standings from live totals so the leaderboard reflects in-progress scores
  const standings = gameModule.deriveStandings(displayTotals, playerIds);

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
  let roundFlip7Meta = {};
  let cacheHit = false;

  if (game.rounds && typeof game.rounds === 'object') {
    const cached = _roundPointsCache.get(game.rounds);
    // Ensure player list hasn't changed (strict equality on array ref)
    if (cached && cached.playerIds === playerIds) {
      roundPoints = cached.result;
      roundFlip7Meta = cached.flip7Meta || {};
      cacheHit = true;
    }
  }

  if (!cacheHit) {
    playerIds.forEach((pid) => { roundPoints[pid] = []; roundFlip7Meta[pid] = []; });
    rounds.forEach((rnd) => {
      playerIds.forEach((pid) => {
        roundPoints[pid].push(gameModule.getRoundPoints(rnd, pid));
        roundFlip7Meta[pid].push(rnd.entries?.[pid]?.flip7 || false);
      });
    });

    if (game.rounds && typeof game.rounds === 'object') {
      _roundPointsCache.set(game.rounds, { result: roundPoints, flip7Meta: roundFlip7Meta, playerIds });
    }
  }

  // In edit mode, overlay buffered adjustments onto the display round points so
  // the chip for the edited round shows the pending value before SAVE is clicked.
  let displayRoundPoints = roundPoints;
  let displayRoundFlip7Meta = roundFlip7Meta;
  if (_editScoresMode && editingRoundIndex >= 0 && Object.keys(_editAdjustments).length > 0) {
    displayRoundPoints = {};
    displayRoundFlip7Meta = {};
    playerIds.forEach((pid) => {
      const chips = [...(roundPoints[pid] || [])];
      const metas = [...(roundFlip7Meta[pid] || [])];
      if (_editAdjustments[pid]) {
        const e = _editAdjustments[pid];
        chips[editingRoundIndex] = (e.basePoints || 0) + (e.flip7 ? 15 : 0);
        metas[editingRoundIndex] = e.flip7 || false;
      }
      displayRoundPoints[pid] = chips;
      displayRoundFlip7Meta[pid] = metas;
    });
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
    <div class="flex justify-between items-end mb-8">
      <div>
        <p class="font-mono text-xs uppercase tracking-widest text-outline">${_editScoresMode ? 'EDITING' : ''}</p>
        <p class="font-mono text-3xl font-bold">${_editScoresMode ? `ROUND ${editingRoundIndex + 1}` : `ROUND ${rounds.length + 1}${game.type === 'papayoo' ? `/${game.config?.roundLimit || 5}` : ''}`}</p>
        ${isFlip7Host ? `<p class="font-mono text-xs text-outline mt-0.5">${_editScoresMode ? 'Tap a player to edit' : 'Tap a player to add score'}</p>` : ''}
      </div>
      <div class="text-right">
        <p class="font-mono text-xs uppercase tracking-widest text-outline">${gameModule.winMode === 'highest_total' ? 'TARGET' : game.type === 'cabo' ? 'BUST AT' : 'ROUNDS'}</p>
        <p class="font-mono text-3xl font-bold">${gameModule.winMode === 'highest_total' ? game.config?.targetScore : game.type === 'cabo' ? '>100' : game.config?.roundLimit}</p>
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
      html += _renderFlip7HostRow(s, p, displayRoundPoints[s.playerId] || [], editingRoundIndex, displayRoundFlip7Meta[s.playerId] || []);
    } else {
      html += renderRow({
        name: p.name || s.playerId,
        total: s.total,
        accentIndex: p.accentIndex || 0,
        rank: s.rank,
        rounds: displayRoundPoints[s.playerId] || [],
        roundsMeta: game.type === 'flip7' ? (displayRoundFlip7Meta[s.playerId] || []) : [],
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
      const roundDropdownItems = roundKeys.map((key, i) => `
        <button type="button" data-round-key="${key}"
          style="display:block;width:100%;text-align:left;padding:10px 16px;font-family:monospace;font-size:20px;text-transform:uppercase;letter-spacing:0.05em;color:#000;background:${key === _editLastRoundKey ? '#f0f0f0' : '#fff'};border:none;cursor:pointer;white-space:nowrap"
          class="round-dropdown-item">
          Round ${i + 1}
        </button>
      `).join('');

      html += `
        <div class="flex gap-2 mt-6">
          ${_editScoresMode ? `
            <button id="btn-edit-cancel"
              class="flex-1 bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center transition-colors hover:bg-surface-container-high">
              CANCEL
            </button>
            <button id="btn-edit-save"
              class="flex-1 btn-primary flex items-center justify-center gap-2">
              SAVE
              <span class="material-symbols-outlined text-lg" aria-hidden="true">check</span>
            </button>
          ` : `
            <div class="relative shrink-0">
              <button id="btn-edit-scores" aria-label="Edit scores" title="Edit scores"
                class="border border-outline flex items-center justify-center transition-colors hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed"
                style="width:3.25rem;height:100%;" ${rounds.length === 0 ? 'disabled' : ''}>
                <span class="material-symbols-outlined text-lg" aria-hidden="true">edit</span>
              </button>
              <div id="round-dropdown" style="display:none;position:absolute;bottom:100%;left:0;margin-bottom:4px;background:#fff;border:1px solid #000;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
                ${roundDropdownItems}
              </div>
            </div>
            <button id="btn-confirm-round"
              class="flex-1 btn-primary flex items-center justify-center gap-2">
              CONFIRM ROUND
              <span class="material-symbols-outlined text-lg" aria-hidden="true">check</span>
            </button>
          `}
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
      // Pencil button opens round dropdown
      const dropdownEl = content.querySelector('#round-dropdown');
      const pencilBtn = content.querySelector('#btn-edit-scores');
      if (pencilBtn && dropdownEl) {
        const closeDropdown = () => {
          dropdownEl.style.display = 'none';
          document.removeEventListener('click', closeDropdown);
        };

        pencilBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = dropdownEl.style.display !== 'none';
          if (open) {
            closeDropdown();
          } else {
            dropdownEl.style.display = 'block';
            document.addEventListener('click', closeDropdown);
          }
        });

        dropdownEl.querySelectorAll('.round-dropdown-item').forEach((item) => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            closeDropdown();
            _editLastRoundKey = item.dataset.roundKey;
            _editAdjustments = {};
            _editScoresMode = true;
            _render(container, roomCode);
          });
        });
      }

      const exitEditMode = () => {
        _editAdjustments = {};
        _editScoresMode = false;
        _editLastRoundKey = null;
        _render(container, roomCode);
      };
      content.querySelector('#btn-edit-cancel')?.addEventListener('click', exitEditMode);

      content.querySelector('#btn-edit-save')?.addEventListener('click', async () => {
        if (Object.keys(_editAdjustments).length === 0) { exitEditMode(); return; }
        const patchedRounds = rounds.map((rnd, i) =>
          i === editingRoundIndex
            ? { ...rnd, entries: { ...(rnd.entries || {}), ..._editAdjustments } }
            : rnd
        );
        let newTotals = Object.fromEntries(playerIds.map((id) => [id, 0]));
        patchedRounds.forEach((rnd) => { newTotals = gameModule.applyRound(newTotals, rnd, game); });
        const saveBtn = content.querySelector('#btn-edit-save');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<div class="spinner mx-auto"></div>';
        const pendingAdjustments = { ..._editAdjustments };
        _editAdjustments = {};
        _editScoresMode = false;
        try {
          await fb.patchLastRoundMulti(roomCode, game.gameId, _editLastRoundKey, pendingAdjustments, newTotals);
          if (game.status === 'active' || game.status === 'overtime') {
            const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, rounds.length);
            if (endResult.ended && endResult.winner) {
              await fb.submitGameEnd(roomCode, game.gameId, endResult.winner);
              router.navigate('winner', { roomCode });
              return;
            } else if (endResult.ended && endResult.overtime) {
              toast.show('Tied! Overtime round needed');
            }
          }
        } catch (e) {
          console.error('Save failed:', e);
          toast.show('Save failed');
          _editAdjustments = pendingAdjustments;
          _editScoresMode = true;
          _render(container, roomCode);
        }
      });

      // Open card drawer or adjust drawer depending on mode
      content.querySelectorAll('.flip7-player-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (_editScoresMode) {
            _openAdjustDrawer(container, roomCode, game, btn.dataset.playerId, snapshot);
          } else {
            _openFlip7Drawer(container, roomCode, btn.dataset.playerId, snapshot, game);
          }
        });
      });

      content.querySelector('#btn-confirm-round')?.addEventListener('click', () => {
        _confirmFlip7Round(container, roomCode, game, gameModule);
      });
    }
  }
}

// ── Flip 7 tappable player row ──

function _renderFlip7HostRow(standing, playerData, roundHistory, editingRoundIndex = -1, roundFlip7 = []) {
  const { playerId: pid, total, rank } = standing;
  const color = ACCENT_COLORS[playerData.accentIndex || 0];
  const name = escapeHTML(playerData.name || pid);
  const rankLabel = rank <= 3 ? ['1ST', '2ND', '3RD'][rank - 1] : `${rank}TH`;
  const bgClass = 'bg-surface-container-lowest';

  const draft = _flip7Draft[pid];
  const hasDraft = draft && (draft.numbers.size > 0 || draft.actions.size > 0 || draft.x2);

  const roundChips = roundHistory.map((pts, i) => {
    const label = `${pts >= 0 ? '+' : ''}${pts}${roundFlip7[i] ? ' 🔥' : ''}`;
    if (_editScoresMode && i === editingRoundIndex && _editAdjustments[pid]) {
      return `<span class="inline-block font-mono text-sm px-1.5 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${label}</span>`;
    }
    return `<span class="inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface">${label}</span>`;
  }).join('');

  let draftChip = '';
  if (hasDraft) {
    const { basePoints, flip7 } = _computeFlip7Score(draft);
    const roundPts = basePoints + (flip7 ? 15 : 0);
    const chipLabel = `+${roundPts}${flip7 ? ' 🔥' : ''}`;
    draftChip = `<span class="inline-block font-mono text-sm px-1.5 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${chipLabel}</span>`;
  }

  return `
    <div class="flex flex-col border border-outline ${bgClass}">
      <div class="accent-bar" style="background:${color}"></div>
      <div class="flex items-stretch flex-1">
        <div class="flex items-center justify-center shrink-0 min-w-[2.5rem] border-r border-outline">
          <span class="font-mono text-2xl font-bold">${rank}</span>
        </div>
        <button type="button"
          class="flip7-player-row flex-1 text-left hover:bg-surface-container-high transition-colors"
          data-player-id="${escapeHTML(pid)}"
          aria-label="Score ${name}">
          <div class="p-4 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <p class="font-headline font-extrabold text-xl uppercase truncate">${name}</p>
              <div class="flex gap-1 mt-1 flex-wrap items-center">
                ${roundChips}
                ${draftChip}
              </div>
            </div>
            <div class="text-right shrink-0">
              <p class="font-mono text-2xl font-bold">${total}</p>
            </div>
          </div>
        </button>
      </div>
    </div>
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

// ── Flip 7 live totals ──

async function _pushLiveTotals(roomCode, game) {
  const playerIds = game.playerIds || [];
  const committedTotals = game.totals || {};
  const playersMap = state.get('players') || {};
  const liveTotals = {};
  playerIds.forEach((pid) => {
    const committed = committedTotals[pid] || 0;
    if (playersMap[pid]?.isActive === false) {
      liveTotals[pid] = committed;
    } else {
      const draft = _flip7Draft[pid];
      if (draft) {
        const { basePoints, flip7 } = _computeFlip7Score(draft);
        liveTotals[pid] = committed + basePoints + (flip7 ? 15 : 0);
      } else {
        liveTotals[pid] = committed;
      }
    }
  });
  await fb.updateLiveTotals(roomCode, game.gameId, liveTotals);
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
// +2  +4  +6  +8  +10
// ×2  12  11  10    9
//  8   7   6   5    4
//  3   2   1   0  ---
const _F7_CARD_DATA = [
  // Row 0: action cards
  { cls: 'flip7-action-btn', attr: 'data-action', val:  2, col: 3, row: 2 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  4, col: 4, row: 2 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  6, col: 5, row: 2 },
  { cls: 'flip7-action-btn', attr: 'data-action', val:  8, col: 6, row: 0 },
  { cls: 'flip7-action-btn', attr: 'data-action', val: 10, col: 2, row: 2 },
  // Row 1: x2 + high numbers
  { id: 'flip7-x2-btn', col: 1, row: 3 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 12, col: 4, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 11, col: 3, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val: 10, col: 2, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  9, col: 0, row: 2 },
  // Row 2: mid numbers
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  8, col: 5, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  7, col: 4, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  6, col: 3, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  5, col: 2, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  4, col: 1, row: 1 },
  // Row 3: low numbers + clear
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  3, col: 0, row: 1 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  2, col: 5, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  1, col: 1, row: 0 },
  { cls: 'flip7-num-btn',    attr: 'data-num',    val:  0, col: 0, row: 0 },
  { empty: true },
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
    if (c.empty) return `<div class="flex items-center justify-center" style="aspect-ratio:130/204"><button type="button" id="flip7-done-btn" aria-label="Done" class="flex items-center justify-center border-2 border-primary text-primary hover:bg-primary hover:text-on-primary transition-colors" style="width:75%;aspect-ratio:130/204;box-shadow:0 3px 5px -1px rgba(0,0,0,0.18)"><span aria-hidden="true" class="material-symbols-outlined" style="font-size:28px;font-variation-settings:'wght' 700">check</span></button></div>`;
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
        <div class="relative flex justify-center pt-3 pb-1">
          <div class="w-10 h-1 rounded-full bg-outline-variant"></div>
          <button id="flip7-arrange-toggle" type="button" aria-pressed="${_flip7DragMode}"
            class="absolute right-4 top-1.5 font-mono text-[9px] uppercase tracking-widest flex items-center gap-0.5 transition-colors ${_flip7DragMode ? 'text-on-surface' : 'text-outline hover:text-on-surface'}"
            style="display:none">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">drag_indicator</span>
            ${_flip7DragMode ? 'DONE' : 'ARRANGE'}
          </button>
        </div>
        <div class="px-4 pb-3 flex items-center justify-between border-b border-outline-variant">
          <div>
            <div class="flex items-center gap-2">
              <p id="flip7-header-score" class="font-mono text-4xl font-bold leading-none">0</p>
              <span id="flip7-header-emoji" class="text-4xl leading-none" style="display:none">🔥</span>
            </div>
            <p id="flip7-header-label" class="font-mono text-[9px] text-outline mt-0.5 uppercase tracking-widest">THIS ROUND</p>
          </div>
          <p class="font-headline font-bold text-4xl uppercase truncate">${name}</p>
        </div>
      </div>
      <!-- Scrollable 5-col card grid -->
      <div class="overflow-y-auto flex-1 p-4">
        <div id="flip7-card-grid" class="grid grid-cols-5 gap-3">
          ${cardBtns}
        </div>
      </div>
    </div>
  `;

  _flip7DrawerEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  _refreshDrawerCardStates(playerId);
  _updateDrawerScore(playerId);

  const draftSnapshot = {
    numbers: new Set(_flip7Draft[playerId].numbers),
    actions: new Set(_flip7Draft[playerId].actions),
    x2: _flip7Draft[playerId].x2,
  };
  _bindDrawerEvents(container, roomCode, playerId, draftSnapshot);
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
  const emojiEl = _flip7DrawerEl?.querySelector('#flip7-header-emoji');
  if (!scoreEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) { scoreEl.textContent = '0'; if (emojiEl) emojiEl.style.display = 'none'; return; }
  const { basePoints, flip7 } = _computeFlip7Score(draft);
  const roundPts = basePoints + (flip7 ? 15 : 0);
  scoreEl.textContent = roundPts;
  if (emojiEl) emojiEl.style.display = flip7 ? '' : 'none';
}

function _bindDrawerEvents(container, roomCode, playerId, draftSnapshot) {
  if (!_flip7DrawerEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) return;

  _flip7DrawerEl.querySelector('#flip7-drawer-backdrop')?.addEventListener('click', () => {
    _flip7Draft[playerId].numbers = new Set(draftSnapshot.numbers);
    _flip7Draft[playerId].actions = new Set(draftSnapshot.actions);
    _flip7Draft[playerId].x2 = draftSnapshot.x2;
    _closeFlip7Drawer();
    _render(container, roomCode);
  });

  _flip7DrawerEl.querySelector('#flip7-done-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.style.background = '#000';
    btn.style.color = '#fff';
    setTimeout(() => {
      const game = state.currentGame();
      if (game) _pushLiveTotals(roomCode, game).catch(() => {});
      _closeFlip7Drawer();
      _render(container, roomCode);
    }, 150);
  });

  // ── Card selection (blocked in drag mode) ──

  _flip7DrawerEl.querySelectorAll('.flip7-num-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (_flip7DragMode) return;
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
      if (_flip7DragMode) return;
      const n = parseInt(btn.dataset.action);
      const sel = !draft.actions.has(n);
      sel ? draft.actions.add(n) : draft.actions.delete(n);
      _applyCardStyle(btn, sel);
      _updateDrawerScore(playerId);
    });
  });

  _flip7DrawerEl.querySelector('#flip7-x2-btn')?.addEventListener('click', (e) => {
    if (_flip7DragMode) return;
    draft.x2 = !draft.x2;
    _applyCardStyle(e.currentTarget, draft.x2);
    _updateDrawerScore(playerId);
  });

  // ── Arrange toggle ──

  const arrangeBtn = _flip7DrawerEl.querySelector('#flip7-arrange-toggle');
  const gridEl = _flip7DrawerEl.querySelector('#flip7-card-grid');
  let _arrangeSelected = null;

  function _applyArrangeModeVisuals() {
    if (!arrangeBtn) return;
    arrangeBtn.setAttribute('aria-pressed', String(_flip7DragMode));
    arrangeBtn.innerHTML = `<span class="material-symbols-outlined text-sm" aria-hidden="true">drag_indicator</span>${_flip7DragMode ? 'DONE' : 'ARRANGE'}`;
    arrangeBtn.className = `absolute right-4 top-1.5 font-mono text-[9px] uppercase tracking-widest flex items-center gap-0.5 transition-colors ${_flip7DragMode ? 'text-on-surface' : 'text-outline hover:text-on-surface'}`;
  }

  arrangeBtn?.addEventListener('click', () => {
    _flip7DragMode = !_flip7DragMode;
    if (!_flip7DragMode && _arrangeSelected) {
      _arrangeSelected.style.outline = '';
      _arrangeSelected = null;
    }
    _applyArrangeModeVisuals();
  });

  // ── Tap-to-swap in arrange mode ──
  // First tap selects a cell (outlined). Second tap on a different cell swaps
  // them. Tapping the same cell again deselects it. The empty slot is valid.

  gridEl.addEventListener('click', (e) => {
    if (!_flip7DragMode) return;
    let node = e.target;
    while (node && node.parentNode !== gridEl) node = node.parentNode;
    if (!node || node.parentNode !== gridEl) return;

    if (!_arrangeSelected) {
      _arrangeSelected = node;
      node.style.outline = '2px solid #000';
    } else if (_arrangeSelected === node) {
      _arrangeSelected.style.outline = '';
      _arrangeSelected = null;
    } else {
      _arrangeSelected.style.outline = '';
      _swapGridCells(_arrangeSelected, node);
      _arrangeSelected = null;
    }
  });
}

function _swapGridCells(a, b) {
  const parent = a.parentNode;
  const ph = document.createComment('swap');
  parent.insertBefore(ph, a);
  parent.insertBefore(a, b);
  parent.insertBefore(b, ph);
  ph.remove();
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
    await fb.submitRound(roomCode, game.gameId, rounds.length, draft, newTotals, endResult.ended ? endResult : null);

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

// ── Single-player score adjust drawer ──

function _openAdjustDrawer(container, roomCode, game, pid, snapshot) {
  if (!_editScoresEl) return;

  const roundKeys = game.rounds ? Object.keys(game.rounds) : [];
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const selectedRoundIndex = roundKeys.indexOf(_editLastRoundKey);
  const selectedRound = rounds[selectedRoundIndex];
  if (!selectedRound) {
    toast.show('Round not found');
    return;
  }

  const originalEntry = selectedRound.entries?.[pid] || { basePoints: 0, flip7: false };
  const currentEntry = _editAdjustments[pid] || originalEntry;

  // Compute the delta from original so re-opening shows what was last entered
  const delta = (currentEntry.basePoints || 0) - (originalEntry.basePoints || 0);
  const initialIsAdd = delta >= 0;
  const initialAmount = Math.abs(delta);

  const p = snapshot[pid] || {};
  const color = ACCENT_COLORS[p.accentIndex || 0];
  const name = escapeHTML(p.name || pid);

  _editScoresEl.innerHTML = `
    <div id="adjust-backdrop" class="absolute inset-0 bg-black/50"></div>
    <div class="relative w-full bg-surface-container-lowest border-t-2 border-outline">
      <div class="h-[6px]" style="background:${color}"></div>
      <div class="flex justify-center pt-3 pb-1">
        <div class="w-10 h-1 rounded-full bg-outline-variant"></div>
      </div>
      <div class="px-4 pb-3 border-b border-outline-variant">
        <p class="font-headline font-bold text-4xl uppercase truncate">${name}</p>
      </div>
      <div class="px-4 py-4 flex items-center gap-2 pb-8">
        <div class="flex font-mono text-xs uppercase shrink-0">
          <button type="button" id="adj-add-btn"
            class="px-4 py-3 border border-outline transition-colors">+ADD</button>
          <button type="button" id="adj-sub-btn"
            class="px-4 py-3 border border-outline border-l-0 transition-colors">−SUB</button>
        </div>
        <input type="number" id="adj-amount-input" inputmode="numeric"
          class="score-input flex-1" placeholder="0" min="0"
          value="${initialAmount || ''}">
        <button id="adj-apply-btn" class="btn-primary shrink-0 flex items-center justify-center" style="width:48px;height:48px;padding:0">
          <span aria-hidden="true" class="material-symbols-outlined" style="font-size:20px;font-variation-settings:'FILL' 1">check</span>
        </button>
      </div>
    </div>
  `;

  _editScoresEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  setTimeout(() => _editScoresEl.querySelector('#adj-amount-input')?.focus(), 50);

  let isAdd = initialIsAdd;
  const addBtn = _editScoresEl.querySelector('#adj-add-btn');
  const subBtn = _editScoresEl.querySelector('#adj-sub-btn');

  const setOp = (add) => {
    isAdd = add;
    addBtn.style.background = add ? '#000' : '';
    addBtn.style.color = add ? '#fff' : '';
    addBtn.style.borderColor = add ? '#000' : '';
    subBtn.style.background = add ? '' : '#000';
    subBtn.style.color = add ? '' : '#fff';
    subBtn.style.borderColor = add ? '' : '#000';
  };

  // Apply initial state
  setOp(initialIsAdd);

  addBtn.addEventListener('click', () => setOp(true));
  subBtn.addEventListener('click', () => setOp(false));

  _editScoresEl.querySelector('#adjust-backdrop')?.addEventListener('click', _closeAdjustDrawer);

  _editScoresEl.querySelector('#adj-apply-btn')?.addEventListener('click', () => {
    const amount = parseInt(_editScoresEl.querySelector('#adj-amount-input')?.value) || 0;
    if (amount === 0) { _closeAdjustDrawer(); return; }

    // Apply relative to original so re-edits replace rather than stack
    const newBasePoints = Math.max(0, (originalEntry.basePoints || 0) + (isAdd ? amount : -amount));
    _editAdjustments[pid] = { ...currentEntry, basePoints: newBasePoints };
    _closeAdjustDrawer();
    _render(container, roomCode);
  });
}

function _closeAdjustDrawer() {
  if (!_editScoresEl) return;
  _editScoresEl.style.display = 'none';
  _editScoresEl.innerHTML = '';
  document.body.style.overflow = '';
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
