// ═══════════════════════════════════════════
// Dashboard Screen — Live Scoreboard
// ═══════════════════════════════════════════

import * as state from '../state.js';
import { accentColor } from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as toast from '../components/toast.js';
import * as hostMenu from '../components/host-menu.js';
import { renderRow } from '../components/player-row.js';
import { getGame } from '../games/registry.js';
import { cumulativeJuaNets, liveJuaNets } from '../stats.js';
import { escapeHTML, confirmRoundDialog, confirmSaveDialog } from '../utils.js';

// Bolt Optimization: Memoize O(R*P) round points calculation
// The dashboard re-renders frequently on Firebase state syncs.
// We cache the roundPoints calculation based on the game.rounds object reference
// and the specific player list to avoid redundant array allocations and lookups.
const _roundPointsCache = new WeakMap();

let _unsubGames = null;
let _unsubLobby = null;
let _unsubPlayers = null;

// ── Flip 7 inline scoring state ──
// The in-progress round's source of truth is the SYNCED liveRound/{pid} structure
// in Firebase (so spectators can score too). _flip7Draft is only a transient scratch
// buffer for the currently-open drawer; it is hydrated from liveRound on open.
let _flip7Draft = {}; // { [playerId]: { numbers: Set<number>, actions: Set<number>, x2: bool } }
let _flip7RoundCount = -1; // Detects undo/submit (round count changes) to clear scratch
let _flip7DrawerEl = null; // Fixed overlay appended to body — survives _render() calls
let _flip7DrawerPlayerId = null; // Which player's drawer is currently open
let _flip7DrawerBaseV = 0; // CAS baseline: liveRound/{pid}.v seen when the drawer opened
let _flip7Grayscale = false; // false = colour (default); true = grayscale (toggle hidden for now)
let _flip7DragMode = false; // Drag-to-rearrange mode for the card grid

// ── Scoreboard sort state ──
let _playerSortMode = 'score'; // 'score' | 'custom'
let _customPlayerOrder = null; // ordered array of active playerIds; null until first save
let _playerDragCleanup = null; // cleanup fn for any in-progress drag
let _roundsDisplayMode = 'last3'; // 'none' | 'last3' | 'all'

// Jua round tracking state (reset each round)
let _juaRoundData = { firstSavePid: null };
let _juaRoundTracked = -1;
let _juaModalEl = null; // Body-level modal — survives _render() calls

// Edit scores overlay (body-level, survives _render() calls)
let _editScoresEl = null;
let _editScoresMode = false; // When true, tapping a player row opens adjust drawer instead of card drawer
let _editAdjustments = {}; // { [pid]: newEntry } — buffered until SAVE is clicked
let _editLastRoundKey = null; // round key captured when edit mode is entered
let _editFirstSavePid = undefined; // undefined = untouched; null = cleared; pid = changed

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

  // Top bar — no back button; navigation is via the bottom nav and overflow menu.
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-back').classList.add('hidden');

  // Bottom nav
  bottomNav.show('dashboard');

  container.innerHTML = `<div id="dash-content" class="screen-body pb-8 flex flex-col min-h-full"></div>`;

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

  _juaModalEl = document.createElement('div');
  _juaModalEl.id = 'jua-modal';
  _juaModalEl.className = 'fixed inset-0 z-50 flex items-end';
  _juaModalEl.style.cssText = 'display:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
  document.body.appendChild(_juaModalEl);

  // Watch for state changes
  const renderHandler = () => {
    bottomNav.refresh(); // tab set depends on game type, which may load after mount
    _render(container, roomCode);
  };
  _unsubGames = state.on('games', renderHandler);
  _unsubLobby = state.on('roomLobby', renderHandler);
  _unsubPlayers = state.on('players', renderHandler);

  // Ensure room is being watched
  if (!state.get('roomCode')) {
    state.set('roomCode', roomCode);
  }
  // Guard on the actual watcher, not roomLobby — cache hydration sets roomLobby on
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
  if (_unsubLobby) _unsubLobby();
  _unsubLobby = null;
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
  _editFirstSavePid = undefined;
  _juaRoundData = { firstSavePid: null };
  _juaRoundTracked = -1;
  _playerSortMode = 'score';
  _customPlayerOrder = null;
  _roundsDisplayMode = 'last3';
  if (_playerDragCleanup) { _playerDragCleanup(); _playerDragCleanup = null; }
  if (_juaModalEl) {
    _juaModalEl.remove();
    _juaModalEl = null;
  }
}

function _render(container, roomCode) {
  const content = container.querySelector('#dash-content');
  if (!content) return;

  if (_playerDragCleanup) { _playerDragCleanup(); _playerDragCleanup = null; }

  const game = state.currentGame();
  const lobby = state.get('roomLobby') || {};
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

  // For Flip 7, the live total is DERIVED on read from the committed total plus
  // the in-progress round points held in liveRound/{pid}. liveRound is the single
  // source of truth for the in-progress round, so there is no separate cached map
  // that can drift out of sync with totals.
  let displayTotals = totals;
  if (game.type === 'flip7' && game.liveRound) {
    displayTotals = {};
    playerIds.forEach((pid) => {
      displayTotals[pid] = (totals[pid] || 0) + (game.liveRound[pid]?.pts || 0);
    });
  }

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

  // Per-player jua first-save metadata (one boolean per committed round)
  const roundJuaMeta = {};
  if (game.config?.jua) {
    playerIds.forEach((pid) => {
      roundJuaMeta[pid] = rounds.map((rnd) => rnd.jua?.firstSavePid === pid);
    });
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

  // Track the current round. The in-progress selection lives in synced liveRound,
  // so there is no local draft to restore; we only drop the transient scratch when
  // a round is committed or undone.
  if (game.type === 'flip7' && rounds.length !== _flip7RoundCount) {
    if (_flip7RoundCount === -1) {
      _restoreSortState(roomCode, game.gameId);
    } else {
      _flip7Draft = {};
    }
    _flip7RoundCount = rounds.length;
  }

  // Sync Jua round data with the current round
  if (game.type === 'flip7' && game.config?.jua && rounds.length !== _juaRoundTracked) {
    if (_juaRoundTracked !== -1) {
      _juaRoundData = { firstSavePid: null };
    }
    _juaRoundTracked = rounds.length;
  }

  let html = '';

  // Game info bar
  const isFlip7Host = game.type === 'flip7' && isHost
    && game.status !== 'finished' && game.status !== 'abandoned';

  // Spectators may tap a row to score when the host has enabled it on an active
  // Flip 7 game. The host still confirms the round.
  const spectatorCanScore = game.type === 'flip7' && !isHost
    && lobby.spectatorScoring !== false
    && game.status !== 'finished' && game.status !== 'abandoned';

  // Check winner redirect
  if (game.status === 'finished' && game.winner) {
    router.navigate('winner', { roomCode });
    return;
  }

  // Compute Jua prize data once — used in header and player rows
  let juaPrizeData = null;
  if (game.config?.jua && !_editScoresMode) {
    const numPlayers = playerIds.length;
    const buyIn = game.config.juaBuyIn || 30;
    const totalPot = buyIn * numPlayers;
    const prize1 = game.config.juaPrize1 || 0;
    const prize2 = game.config.juaPrize2 || 0;
    const prize3 = totalPot - prize1 - prize2;
    const juaPool = _computeJuaPool(game);
    juaPrizeData = {
      positions: [1, 2, 3].map((rank) => {
        const s = standings.find((x) => x.rank === rank);
        const pName = s ? (snapshot[s.playerId]?.name || s.playerId) : '—';
        const amount = rank === 1 ? prize1 + juaPool : rank === 2 ? prize2 : prize3;
        return { rank, name: pName, amount };
      }),
    };
  }

  html += `
    <div class="flex justify-between items-end mb-8">
      <div>
        <p class="font-mono text-xs uppercase tracking-widest text-outline">${_editScoresMode ? 'EDITING' : ''}</p>
        <p class="font-mono text-3xl font-bold">${_editScoresMode ? `ROUND ${editingRoundIndex + 1}` : `ROUND ${rounds.length + 1}${game.type === 'papayoo' ? `/${game.config?.roundLimit || 5}` : ''}`}</p>
        ${juaPrizeData ? `<p class="font-mono text-sm text-outline mt-0.5">Prizes: ${juaPrizeData.positions.map(p => `₹${p.amount}`).join(' / ')}</p>` : ''}
      </div>
      <div class="text-right">
        <p class="font-mono text-xs uppercase tracking-widest text-outline">${gameModule.winMode === 'highest_total' ? 'TARGET' : game.type === 'cabo' ? 'BUST AT' : 'ROUNDS'}</p>
        <p class="font-mono text-3xl font-bold">${gameModule.winMode === 'highest_total' ? game.config?.targetScore : game.type === 'cabo' ? '>100' : game.config?.roundLimit}</p>
      </div>
    </div>
  `;

  let orderedStandings;
  if (_playerSortMode === 'custom' && _customPlayerOrder) {
    const orderMap = new Map(_customPlayerOrder.map((id, i) => [id, i]));
    orderedStandings = [...standings].sort(
      (a, b) => (orderMap.get(a.playerId) ?? Infinity) - (orderMap.get(b.playerId) ?? Infinity)
    );
  } else {
    // Leader (score) mode: rank ascending, then night winnings descending within
    // a tied rank. Winnings = cumulative net from completed games PLUS this game's
    // running net (so same-score players are separated by their current saves/fines).
    const allGames = state.get('games') || {};
    const priorGames = Object.entries(allGames)
      .filter(([id]) => id !== game.gameId)
      .map(([, g]) => g);
    const priorWinnings = cumulativeJuaNets(priorGames);
    const liveWinnings = liveJuaNets(game);
    const winningsOf = (pid) => (priorWinnings.get(pid) || 0) + (liveWinnings.get(pid) || 0);
    orderedStandings = [...standings].sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return winningsOf(b.playerId) - winningsOf(a.playerId);
    });
  }

  // Scoreboard controls bar (rounds toggle for all Flip7; sort toggle host-only)
  if (game.type === 'flip7') {
    html += `
      <div class="flex items-center justify-end gap-4 mb-1">
        ${rounds.length > 0 ? `
        <button id="btn-rounds-toggle" type="button"
          class="font-mono text-xs uppercase tracking-widest flex items-center gap-0.5 transition-colors text-on-surface">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">history</span>
          ${_roundsDisplayMode === 'none' ? 'NO ROUNDS' : _roundsDisplayMode === 'all' ? 'ALL ROUNDS' : 'LAST 3 ROUNDS'}
        </button>
        ` : ''}
        ${isFlip7Host ? `
          <button id="btn-sort-toggle" type="button"
            class="font-mono text-xs uppercase tracking-widest flex items-center gap-0.5 transition-colors text-on-surface">
            <span class="material-symbols-outlined text-sm" aria-hidden="true">swap_vert</span>
            ${_playerSortMode === 'score' ? 'LEADER' : 'FIXED'}
          </button>
        ` : ''}
      </div>
    `;
  }

  // Scoreboard
  html += `<div class="flex flex-col gap-1">`;
  orderedStandings.forEach((s) => {
    const p = snapshot[s.playerId] || {};
    if (isFlip7Host) {
      // Tappable row — host enters cards via drawer
      const liveFirstSave = !!game.config?.jua && !!game.liveRound?.[s.playerId]?.firstSave;
      html += _renderFlip7HostRow(
        s, p,
        _editScoresMode ? (displayRoundPoints[s.playerId] || []) : _applyRoundsDisplayLimit(displayRoundPoints[s.playerId] || []),
        editingRoundIndex,
        _editScoresMode ? (displayRoundFlip7Meta[s.playerId] || []) : _applyRoundsDisplayLimit(displayRoundFlip7Meta[s.playerId] || []),
        _editScoresMode ? (roundJuaMeta[s.playerId] || []) : _applyRoundsDisplayLimit(roundJuaMeta[s.playerId] || []),
        liveFirstSave,
        _editScoresMode ? 0 : (game.juaFines?.[s.playerId] || 0),
        game.liveRound?.[s.playerId] || null
      );
    } else {
      const liveEntry = game.liveRound?.[s.playerId];
      const liveFirstSave = !!game.config?.jua && !!liveEntry?.firstSave;
      // The display limit applies only to committed rounds; the live chip is the
      // current round and always shows (matches host behaviour, incl. 'none' mode).
      const committedPts = _applyRoundsDisplayLimit(displayRoundPoints[s.playerId] || []);
      const committedMeta = _applyRoundsDisplayLimit(displayRoundFlip7Meta[s.playerId] || []);
      const committedJua = _applyRoundsDisplayLimit(roundJuaMeta[s.playerId] || []);
      const spectatorRounds = liveEntry != null ? [...committedPts, liveEntry.pts] : committedPts;
      const spectatorMeta = liveEntry != null ? [...committedMeta, liveEntry.flip7 || false] : committedMeta;
      const spectatorJuaMeta = liveEntry != null ? [...committedJua, liveFirstSave] : committedJua;
      const rowHtml = renderRow({
        name: p.name || s.playerId,
        total: s.total,
        accentIndex: p.accentIndex || 0,
        rank: s.rank,
        rounds: spectatorRounds,
        roundsMeta: game.type === 'flip7' ? spectatorMeta : [],
        roundsJuaMeta: spectatorJuaMeta,

        hasLiveChip: liveEntry != null,
        progressPct: getProgress(s.total),
        isLeader: s.rank === 1,
        winMode: gameModule.winMode,
        fineCount: game.juaFines?.[s.playerId] || 0,
      });
      if (spectatorCanScore) {
        html += `<div class="flip7-spectator-row cursor-pointer" role="button" tabindex="0" data-player-id="${escapeHTML(s.playerId)}" aria-label="Score ${escapeHTML(p.name || s.playerId)}">${rowHtml}</div>`;
      } else {
        html += rowHtml;
      }
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
          style="display:block;width:100%;text-align:left;padding:10px 16px;font-family:monospace;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;color:#000;background:${key === _editLastRoundKey ? '#e8e8e6' : '#f4f4f2'};border:none;${i < roundKeys.length - 1 ? 'border-bottom:1px solid #c6c6c6;' : ''}cursor:pointer;white-space:nowrap"
          class="round-dropdown-item">
          Round ${i + 1}
        </button>
      `).join('');

      html += `
        <!-- Reserve scroll space so the last scoreboard row clears the docked bar. -->
        <div aria-hidden="true" class="h-20"></div>
        <!-- Docked confirm/edit (or save/cancel) row, pinned above the bottom nav. -->
        <div class="docked-bar p-4 bg-surface-container-low">
          <div class="flex gap-2">
          ${_editScoresMode ? `
            <button id="btn-edit-cancel" aria-label="Cancel" title="Cancel"
              class="shrink-0 self-stretch bg-surface-container-low border border-outline flex items-center justify-center transition-colors hover:bg-surface-container-high">
              <span class="material-symbols-outlined" style="font-size:24px" aria-hidden="true">delete</span>
            </button>
            <button id="btn-edit-save"
              class="flex-1 btn-primary flex items-center justify-center">
              SAVE
            </button>
          ` : `
            <div class="relative shrink-0">
              <button id="btn-edit-scores" aria-label="Edit scores" title="Edit scores"
                class="border border-outline flex items-center justify-center transition-colors hover:bg-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed"
                style="width:3.25rem;height:100%;" ${rounds.length === 0 ? 'disabled' : ''}>
                <span class="material-symbols-outlined text-lg" aria-hidden="true">edit</span>
              </button>
              <div id="round-dropdown" style="display:none;position:absolute;bottom:100%;left:0;margin-bottom:4px;background:#f4f4f2;border:1px solid #000;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
                ${roundDropdownItems}
              </div>
            </div>
            <button id="btn-confirm-round"
              class="flex-1 btn-primary flex items-center justify-center">
              CONFIRM ROUND
            </button>
          `}
          </div>
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
        let backdropEl = null;

        const closeDropdown = () => {
          if (backdropEl) { backdropEl.remove(); backdropEl = null; }
          dropdownEl.style.display = 'none';
        };

        pencilBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (backdropEl) { closeDropdown(); return; }

          // Darkening backdrop (matches the header overflow menu); the dropdown is
          // reparented onto it and positioned against the pencil button.
          backdropEl = document.createElement('div');
          backdropEl.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.15)';
          backdropEl.addEventListener('click', closeDropdown);
          document.body.appendChild(backdropEl);

          const rect = pencilBtn.getBoundingClientRect();
          dropdownEl.style.position = 'fixed';
          dropdownEl.style.zIndex = '9999';
          dropdownEl.style.left = `${rect.left}px`;
          dropdownEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
          dropdownEl.style.margin = '0';
          dropdownEl.style.display = 'block';
          backdropEl.appendChild(dropdownEl);
        });

        dropdownEl.querySelectorAll('.round-dropdown-item').forEach((item) => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            closeDropdown();
            _editLastRoundKey = item.dataset.roundKey;
            _editAdjustments = {};
            _editFirstSavePid = undefined;
            _editScoresMode = true;
            _render(container, roomCode);
            // Surface the now-active edit mode by scrolling the board to the top.
            container.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });
      }

      const exitEditMode = () => {
        _editAdjustments = {};
        _editFirstSavePid = undefined;
        _editScoresMode = false;
        _editLastRoundKey = null;
        _render(container, roomCode);
      };
      const editCancelBtn = content.querySelector('#btn-edit-cancel');
      if (editCancelBtn) {
        editCancelBtn.addEventListener('click', exitEditMode);
        // Square it: width follows the rendered height (set by the SAVE button).
        requestAnimationFrame(() => { editCancelBtn.style.width = editCancelBtn.offsetHeight + 'px'; });
      }

      content.querySelector('#btn-edit-save')?.addEventListener('click', async () => {
        const hasScoreAdjustments = Object.keys(_editAdjustments).length > 0;
        const hasFirstSaveChange = game.config?.jua && _editFirstSavePid !== undefined;
        if (!hasScoreAdjustments && !hasFirstSaveChange) { exitEditMode(); return; }

        const selectedRound = rounds[editingRoundIndex] || {};
        const originalEntries = selectedRound.entries || {};
        const originalFirstSavePid = selectedRound.jua?.firstSavePid || null;
        const newFirstSavePid = hasFirstSaveChange ? (_editFirstSavePid ?? null) : originalFirstSavePid;

        const changedPids = new Set([
          ...Object.keys(_editAdjustments),
          ...(hasFirstSaveChange && originalFirstSavePid ? [originalFirstSavePid] : []),
          ...(hasFirstSaveChange && newFirstSavePid ? [newFirstSavePid] : []),
        ]);
        const changes = [...changedPids].map((pid) => {
          const p = snapshot[pid] || {};
          const origEntry = originalEntries[pid] || {};
          const newEntry = _editAdjustments[pid] || origEntry;
          return {
            name: p.name || pid,
            beforeScore: (origEntry.basePoints || 0) + (origEntry.flip7 ? 15 : 0),
            beforeFirstSave: originalFirstSavePid === pid,
            afterScore: (newEntry.basePoints || 0) + (newEntry.flip7 ? 15 : 0),
            afterFirstSave: newFirstSavePid === pid,
            flip7: origEntry.flip7 || false,
          };
        });
        const confirmed = await confirmSaveDialog(changes);
        if (!confirmed) return;
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
        const pendingFirstSavePid = _editFirstSavePid;
        _editAdjustments = {};
        _editFirstSavePid = undefined;
        _editScoresMode = false;
        const juaData = hasFirstSaveChange ? { firstSavePid: pendingFirstSavePid || null } : undefined;
        try {
          await fb.patchLastRoundMulti(roomCode, game.gameId, _editLastRoundKey, pendingAdjustments, newTotals, juaData);
          if (game.status === 'active') {
            const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, rounds.length);
            if (endResult.ended) {
              await fb.submitGameEnd(roomCode, game.gameId, endResult.winner);
              router.navigate('winner', { roomCode });
              return;
            }
          }
        } catch (e) {
          console.error('Save failed:', e);
          toast.show('Save failed');
          _editAdjustments = pendingAdjustments;
          _editFirstSavePid = pendingFirstSavePid;
          _editScoresMode = true;
          _render(container, roomCode);
        }
      });

      content.querySelectorAll('.flip7-player-row').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (_editScoresMode) {
            _openAdjustDrawer(container, roomCode, game, btn.dataset.playerId, snapshot);
          } else {
            _openFlip7Drawer(container, roomCode, btn.dataset.playerId, snapshot, game);
          }
        });
      });

      // Drag-to-reorder on sort handles (custom sort mode only)
      content.querySelectorAll('.flip7-sort-handle').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
          _startPlayerDrag(e, handle, content, roomCode, game.gameId);
        });
      });

      content.querySelector('#btn-sort-toggle')?.addEventListener('click', () => {
        _playerSortMode = _playerSortMode === 'score' ? 'custom' : 'score';
        if (_playerSortMode === 'custom' && !_customPlayerOrder) {
          _customPlayerOrder = [...playerIds];
        }
        _saveSortState(roomCode, game.gameId);
        _render(container, roomCode);
      });

      content.querySelector('#btn-confirm-round')?.addEventListener('click', () => {
        _confirmFlip7Round(container, roomCode, game, gameModule);
      });
    }
  }

  content.querySelector('#btn-rounds-toggle')?.addEventListener('click', () => {
    if (_roundsDisplayMode === 'last3') _roundsDisplayMode = 'none';
    else if (_roundsDisplayMode === 'none') _roundsDisplayMode = 'all';
    else _roundsDisplayMode = 'last3';
    _saveSortState(roomCode, game.gameId);
    _render(container, roomCode);
  });

  // Spectator scoring: tapping a row opens the same card drawer (host confirms).
  content.querySelectorAll('.flip7-spectator-row').forEach((row) => {
    row.addEventListener('click', () => {
      _openFlip7Drawer(container, roomCode, row.dataset.playerId, snapshot, game);
    });
  });

}

// ── Flip 7 tappable player row ──

function _renderFlip7HostRow(standing, playerData, roundHistory, editingRoundIndex = -1, roundFlip7 = [], roundJuaSave = [], isLiveFirstSave = false, fineCount = 0, liveEntry = null) {
  const { playerId: pid, total, rank } = standing;
  const color = accentColor(playerData.accentIndex);
  const name = escapeHTML(playerData.name || pid);
  const rankLabel = rank <= 3 ? ['1ST', '2ND', '3RD'][rank - 1] : `${rank}TH`;
  const bgClass = 'bg-surface-container-lowest';

  // The in-progress selection is synced (liveRound), so the live chip is derived
  // from it — not from the transient local scratch buffer.
  const hasDraft = liveEntry != null;

  const chipList = roundHistory
    .map((pts, i) => {
      const isEditingRound = _editScoresMode && i === editingRoundIndex;
      if (_editScoresMode && !isEditingRound) return null;
      const showHeart = (isEditingRound && _editFirstSavePid !== undefined)
        ? _editFirstSavePid === pid
        : roundJuaSave[i];
      const label = `${pts}${roundFlip7[i] ? ' 🔥' : ''}${showHeart ? ' ❤️' : ''}`;
      const firstSaveChanged = _editFirstSavePid !== undefined && (_editFirstSavePid === pid) !== Boolean(roundJuaSave[i]);
      if (isEditingRound && (_editAdjustments[pid] || firstSaveChanged)) {
        return `<span class="inline-block font-mono text-sm px-1.5 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${label}</span>`;
      }
      return `<span class="inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface">${label}</span>`;
    })
    .filter(Boolean);

  let draftChip = '';
  if (!_editScoresMode && hasDraft) {
    const roundPts = liveEntry.pts || 0;
    const chipLabel = `${roundPts}${liveEntry.flip7 ? ' 🔥' : ''}${isLiveFirstSave ? ' ❤️' : ''}`;
    draftChip = `<span class="inline-block font-mono text-sm px-1.5 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${chipLabel}</span>`;
  } else if (!_editScoresMode && isLiveFirstSave) {
    draftChip = `<span class="inline-block font-mono text-sm px-1.5 py-0.5 border border-outline-variant">0 ❤️</span>`;
  }

  return `
    <div class="flex flex-col border border-outline ${bgClass}" data-row-player-id="${escapeHTML(pid)}">
      <div class="accent-bar" style="background:${color}"></div>
      <div class="flex items-stretch flex-1">
        ${_playerSortMode === 'custom'
          ? `<button type="button" class="flip7-sort-handle flex items-center justify-center shrink-0 min-w-[2.5rem] border-r border-outline cursor-grab active:cursor-grabbing"
              style="touch-action:none"
              data-player-id="${escapeHTML(pid)}" aria-label="Drag to reorder ${name}">
              <span class="material-symbols-outlined text-outline select-none" aria-hidden="true">drag_indicator</span>
            </button>`
          : `<div class="flex items-center justify-center shrink-0 min-w-[2.5rem] border-r border-outline">
              <span class="font-mono text-2xl font-bold">${rank}</span>
            </div>`
        }
        <button type="button"
          class="flip7-player-row flex-1 text-left hover:bg-surface-container-high transition-colors"
          data-player-id="${escapeHTML(pid)}"
          aria-label="Score ${name}">
          <div class="p-4 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <p class="font-headline font-extrabold text-xl uppercase truncate">${name}</p>
              ${(() => {
                const scoreChips = [...chipList, ...(draftChip ? [draftChip] : [])];
                if (fineCount === 0 && scoreChips.length === 0) return '';
                const fineChip = fineCount > 0
                  ? `<span class="inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface">👎 ${fineCount}</span>`
                  : '';
                let rows = '';
                for (let i = 0; i < scoreChips.length; i += 5) {
                  const prefix = i === 0 ? fineChip : '';
                  rows += `<div class="flex gap-1">${prefix}${scoreChips.slice(i, i + 5).join('')}</div>`;
                }
                if (fineChip && scoreChips.length === 0) {
                  rows = `<div class="flex gap-1">${fineChip}</div>`;
                }
                return `<div class="flex flex-col gap-1 mt-2">${rows}</div>`;
              })()}
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

// ── Jua pool helper ──

function _computeJuaPool(game) {
  const config = game.config || {};
  const firstSaveAmt = config.juaFirstSave || 5;
  const influenceFine = config.juaInfluenceFine || 10;
  let pool = 0;
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  rounds.forEach((rnd) => { if (rnd.jua?.firstSavePid) pool += firstSaveAmt; });
  const totalFines = Object.values(game.juaFines || {}).reduce((s, n) => s + n, 0);
  pool += totalFines * influenceFine;
  return pool;
}

// ── Flip 7 score computation (mirrors gameModule.computeScoreFromCards) ──

function _computeFlip7Score(draft) {
  if (!draft) return { basePoints: 0, flip7: false };
  const numbers = [...draft.numbers];
  const actions = [...draft.actions];
  const numberSum = numbers.reduce((s, n) => s + n, 0);
  const actionSum = actions.reduce((s, n) => s + n, 0);
  const subtotal = numberSum * (draft.x2 ? 2 : 1) + actionSum;
  return { basePoints: subtotal, flip7: numbers.length === 7 };
}

// ── Synced live round → drawer scratch ──

// Convert a synced liveRound/{pid} entry into the in-memory drawer shape. Tolerant
// of legacy entries (older in-flight rounds stored only { pts, flip7 }) and missing
// fields so an in-progress game from before this change never crashes the drawer.
function _liveRoundToDraft(entry) {
  return {
    numbers: new Set(Array.isArray(entry?.numbers) ? entry.numbers : []),
    actions: new Set(Array.isArray(entry?.actions) ? entry.actions : []),
    x2: !!entry?.x2,
  };
}

// ── Rounds display limit ──

function _applyRoundsDisplayLimit(arr) {
  if (_roundsDisplayMode === 'none') return [];
  if (_roundsDisplayMode === 'last3') return arr.length > 3 ? arr.slice(-3) : arr;
  return arr;
}

// ── Scoreboard sort persistence ──

function _sortKey(roomCode, gameId) {
  return `gns_sort_${roomCode}_${gameId}`;
}

function _saveSortState(roomCode, gameId) {
  try {
    localStorage.setItem(_sortKey(roomCode, gameId), JSON.stringify({ mode: _playerSortMode, order: _customPlayerOrder, roundsDisplay: _roundsDisplayMode }));
  } catch {}
}

function _restoreSortState(roomCode, gameId) {
  // Reset to defaults first: sort state is module-level and per-game, so without
  // this a game with no saved state would inherit the previous game's mode/order.
  _playerSortMode = 'score';
  _customPlayerOrder = null;
  _roundsDisplayMode = 'last3';
  try {
    const raw = localStorage.getItem(_sortKey(roomCode, gameId));
    if (!raw) return;
    const { mode, order, roundsDisplay } = JSON.parse(raw);
    _playerSortMode = mode || 'score';
    _customPlayerOrder = order || null;
    _roundsDisplayMode = roundsDisplay || 'last3';
  } catch {}
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

  // Hydrate the scratch buffer from the SYNCED selection and capture the CAS
  // baseline so a concurrent save by another device is detected on DONE.
  const liveEntry = game.liveRound?.[playerId];
  _flip7Draft[playerId] = _liveRoundToDraft(liveEntry);
  _flip7DrawerBaseV = liveEntry?.v || 0;
  // Reflect the synced first-save marker (now stored per-entry in liveRound).
  if (game.config?.jua) {
    const lr = game.liveRound || {};
    _juaRoundData.firstSavePid = Object.keys(lr).find((id) => lr[id]?.firstSave) || null;
  }

  const isHost = state.isHost();
  const p = snapshot[playerId] || {};
  const color = accentColor(p.accentIndex);
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
        <div class="px-4 pb-3 flex items-center gap-3 border-b border-outline-variant">
          <p class="font-headline font-bold text-4xl uppercase truncate min-w-0 flex-1 shrink">${name}</p>
          <div class="shrink-0 text-right">
            <div class="flex items-center gap-2 justify-end">
              <p id="flip7-header-score" class="font-mono text-4xl font-bold leading-none">0</p>
              <span id="flip7-header-emoji" class="text-4xl leading-none" style="display:none">🔥</span>
            </div>
            <p id="flip7-header-label" class="font-mono text-[9px] text-outline mt-0.5 uppercase tracking-widest">THIS ROUND</p>
          </div>
        </div>
        ${game.config?.jua ? `
        <div class="px-4 pt-2 pb-0 flex justify-center gap-3">
          <button id="flip7-first-save-btn" type="button"
            class="font-mono text-xs uppercase tracking-widest px-4 py-2 border transition-colors whitespace-nowrap ${_juaRoundData.firstSavePid === playerId ? 'bg-primary text-on-primary border-primary' : 'border-outline hover:border-primary'}">
            FIRST SAVE ❤️
          </button>
          ${isHost ? `
          <button id="flip7-fine-btn" type="button"
            class="font-mono text-xs uppercase tracking-widest px-4 py-2 border border-outline hover:border-primary transition-colors whitespace-nowrap">
            EDIT FINES 👎
          </button>
          ` : ''}
        </div>
        ` : ''}
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
    firstSavePid: _juaRoundData.firstSavePid,
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

// ── DEBUG: pause before a CAS write ──
// Blocks the save until the floating RESUME button is clicked, so two devices can
// be driven to the same point and resumed in a chosen order to stage races.
// DISABLED by default (no button, no wait). Set `window.__GNS_DEBUG_CAS_PAUSE = true`
// in the console to re-enable. Remove this block (and its call site) before shipping.
function _debugPauseBeforeCAS(label) {
  if (!(typeof window !== 'undefined' && window.__GNS_DEBUG_CAS_PAUSE === true)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);';
    el.innerHTML = `
      <div style="font-family:monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#fff;background:#000;padding:6px 10px;border:1px solid #fff;">PAUSED BEFORE CAS</div>
      <button type="button" id="gns-debug-resume" style="font-family:monospace;font-weight:700;font-size:18px;letter-spacing:0.08em;text-transform:uppercase;color:#000;background:#fff;border:2px solid #000;padding:18px 28px;cursor:pointer;box-shadow:0 6px 0 rgba(0,0,0,0.4);">▶ RESUME CAS</button>
      <div style="font-family:monospace;font-size:12px;color:#fff;background:rgba(0,0,0,0.6);padding:6px 10px;max-width:80vw;text-align:center;">${escapeHTML(String(label || ''))}</div>
    `;
    el.querySelector('#gns-debug-resume').addEventListener('click', () => {
      el.remove();
      resolve();
    });
    document.body.appendChild(el);
  });
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
  const firstSaveBtn = _flip7DrawerEl?.querySelector('#flip7-first-save-btn');
  if (!scoreEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) { scoreEl.textContent = '0'; if (emojiEl) emojiEl.style.display = 'none'; return; }
  const { basePoints, flip7 } = _computeFlip7Score(draft);
  const roundPts = basePoints + (flip7 ? 15 : 0);
  scoreEl.textContent = roundPts;
  if (emojiEl) emojiEl.style.display = flip7 ? '' : 'none';
  if (firstSaveBtn) {
    if (flip7) {
      if (_juaRoundData.firstSavePid === playerId) _juaRoundData.firstSavePid = null;
      firstSaveBtn.disabled = true;
      firstSaveBtn.classList.remove('bg-primary', 'text-on-primary', 'border-primary', 'border-outline', 'hover:border-primary');
      firstSaveBtn.classList.add('opacity-30', 'border-outline', 'cursor-not-allowed');
    } else {
      firstSaveBtn.disabled = false;
      firstSaveBtn.classList.remove('opacity-30', 'cursor-not-allowed');
      if (_juaRoundData.firstSavePid === playerId) {
        firstSaveBtn.classList.remove('border-outline', 'hover:border-primary');
        firstSaveBtn.classList.add('bg-primary', 'text-on-primary', 'border-primary');
      } else {
        firstSaveBtn.classList.remove('bg-primary', 'text-on-primary', 'border-primary');
        firstSaveBtn.classList.add('border-outline', 'hover:border-primary');
      }
    }
  }
}

function _bindDrawerEvents(container, roomCode, playerId, draftSnapshot) {
  if (!_flip7DrawerEl) return;
  const draft = _flip7Draft[playerId];
  if (!draft) return;

  _flip7DrawerEl.querySelector('#flip7-drawer-backdrop')?.addEventListener('click', () => {
    // Nothing syncs until DONE — discard the local scratch + first-save edit.
    _flip7Draft[playerId].numbers = new Set(draftSnapshot.numbers);
    _flip7Draft[playerId].actions = new Set(draftSnapshot.actions);
    _flip7Draft[playerId].x2 = draftSnapshot.x2;
    _juaRoundData.firstSavePid = draftSnapshot.firstSavePid;
    _closeFlip7Drawer();
    _render(container, roomCode);
  });

  _flip7DrawerEl.querySelector('#flip7-done-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.style.background = '#000';
    btn.style.color = '#fff';
    btn.disabled = true;

    const game = state.currentGame();
    if (!game) { _closeFlip7Drawer(); _render(container, roomCode); return; }

    // A spectator may only save while the host has scoring enabled (it may have
    // been turned off while this drawer was open).
    const isHost = state.isHost();
    if (!isHost && (state.get('roomLobby') || {}).spectatorScoring === false) {
      toast.show('Spectator scoring is off');
      _closeFlip7Drawer();
      _render(container, roomCode);
      return;
    }

    const { basePoints, flip7 } = _computeFlip7Score(draft);
    const pts = basePoints + (flip7 ? 15 : 0);
    const newEntry = {
      numbers: [...draft.numbers],
      actions: [...draft.actions],
      x2: draft.x2,
      pts,
      flip7,
      by: isHost ? 'host' : 'spectator',
      // first-save lives on the entry now; a Flip 7 can't also be a first save.
      firstSave: !!game.config?.jua && !flip7 && _juaRoundData.firstSavePid === playerId,
    };

    // DEBUG: pause here so concurrent CAS attempts can be staged by hand.
    await _debugPauseBeforeCAS(`${game.playerSnapshot?.[playerId]?.name || playerId} · ${pts} pts · base v${_flip7DrawerBaseV}`);

    let res;
    try {
      res = await fb.saveLiveRoundCAS(roomCode, game.gameId, playerId, _flip7DrawerBaseV, newEntry);
    } catch (err) {
      res = { ok: false };
    }

    if (!res.ok) {
      // Another device changed this player's entry since we opened the drawer
      // (a card edit, or a first-save move that cleared/bumped this player).
      toast.show('Another user edited the score');
      _closeFlip7Drawer();
      _render(container, roomCode);
      return;
    }

    _closeFlip7Drawer();
    _render(container, roomCode);
  });

  // Jua first-save toggle inside the scoring drawer
  _flip7DrawerEl.querySelector('#flip7-first-save-btn')?.addEventListener('click', (e) => {
    const isMarked = _juaRoundData.firstSavePid === playerId;
    _juaRoundData.firstSavePid = isMarked ? null : playerId;
    const btn = e.currentTarget;
    if (_juaRoundData.firstSavePid === playerId) {
      btn.classList.remove('border-outline', 'hover:border-primary');
      btn.classList.add('bg-primary', 'text-on-primary', 'border-primary');
    } else {
      btn.classList.remove('bg-primary', 'text-on-primary', 'border-primary');
      btn.classList.add('border-outline', 'hover:border-primary');
    }
    // Local only — committed via the DONE transaction so backdrop-cancel reverts it.
  });

  _flip7DrawerEl.querySelector('#flip7-fine-btn')?.addEventListener('click', () => {
    _closeFlip7Drawer();
    const game = state.currentGame();
    if (game) _openJuaFineCounter(playerId, game, roomCode);
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

function _swapPlayerRows(a, b) {
  const parent = a.parentNode;
  const ph = document.createComment('swap');
  parent.insertBefore(ph, a);
  parent.insertBefore(a, b);
  parent.insertBefore(b, ph);
  ph.remove();
}

// ── Scoreboard drag-to-reorder ──

function _startPlayerDrag(e, handle, content, roomCode, gameId) {
  e.preventDefault();

  const pid = handle.dataset.playerId;
  const rowEl = content.querySelector(`[data-row-player-id="${pid}"]`);
  if (!rowEl) return;

  const rowRect = rowEl.getBoundingClientRect();
  const offsetY = e.clientY - rowRect.top;

  // Ghost follows the pointer
  const ghost = rowEl.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rowRect.left}px`,
    top: `${rowRect.top}px`,
    width: `${rowRect.width}px`,
    opacity: '0.85',
    pointerEvents: 'none',
    zIndex: '9999',
    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
    transition: 'none',
  });
  document.body.appendChild(ghost);

  // Dim the source row in place
  rowEl.style.opacity = '0.25';

  const onMove = (ev) => {
    ghost.style.top = `${ev.clientY - offsetY}px`;

    const rows = [...content.querySelectorAll('[data-row-player-id]')];
    const myIdx = rows.indexOf(rowEl);
    const ghostMidY = ev.clientY - offsetY + rowRect.height / 2;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === rowEl) continue;
      const r = rows[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (i < myIdx && ghostMidY < mid) {
        rows[i].before(rowEl);
        break;
      } else if (i > myIdx && ghostMidY > mid) {
        rows[i].after(rowEl);
        break;
      }
    }
  };

  const onEnd = () => {
    ghost.remove();
    rowEl.style.opacity = '';
    _customPlayerOrder = [...content.querySelectorAll('[data-row-player-id]')].map((el) => el.dataset.rowPlayerId);
    _saveSortState(roomCode, gameId);
    _playerDragCleanup = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
  };

  _playerDragCleanup = () => {
    ghost.remove();
    rowEl.style.opacity = '';
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
}

// ── Confirm Flip 7 Round ──

async function _confirmFlip7Round(container, roomCode, initialGame, gameModule) {
  const game = state.currentGame() || initialGame;
  const playerIds = game.playerIds || [];
  const totals = game.totals || {};
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const playersMap = state.get('players') || {};

  // Build the round entries from the SYNCED in-progress selections (liveRound),
  // which may include scores entered by spectators. Track which players were last
  // saved by a spectator so the confirm dialog can highlight them.
  const liveRound = game.liveRound || {};
  const spectatorPids = new Set();
  // Version vector captured as we read the live selections — used after the
  // confirm dialog to detect a spectator edit that landed while the host decided.
  const baseVersions = {};
  const entries = {};
  playerIds.forEach((pid) => {
    const live = liveRound[pid];
    baseVersions[pid] = live?.v || 0;
    const draftEntry = _liveRoundToDraft(live);
    const { basePoints, flip7 } = _computeFlip7Score(draftEntry);
    if (live?.by === 'spectator') spectatorPids.add(pid);
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

  // First save is part of the synced liveRound entries (a spectator may have set it).
  const firstSavePid = game.config?.jua
    ? (Object.keys(liveRound).find((id) => liveRound[id]?.firstSave) || null)
    : null;
  if (game.config?.jua) {
    draft.jua = { firstSavePid };
  }

  const validation = gameModule.validateRound(draft, game);
  if (!validation.valid) {
    toast.show(validation.error || 'Invalid round data');
    return;
  }

  const newTotals = gameModule.applyRound({ ...totals }, draft, game);
  const newRoundCount = rounds.length + 1;
  const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, newRoundCount);

  const activePlayerIds = playerIds;
  const playerScores = activePlayerIds.map((pid) => ({
    name: playersMap[pid]?.name || pid,
    score: (newTotals[pid] || 0) - (totals[pid] || 0),
    flip7: entries[pid]?.flip7 || false,
    firstSave: (game.config?.jua && firstSavePid === pid) || false,
    spectator: spectatorPids.has(pid),
  }));
  const confirmed = await confirmRoundDialog(playerScores, {
    requireNoSaveAck: !!game.config?.jua && !firstSavePid,
  });
  if (!confirmed) return;

  // A spectator may have saved a score while the host was in the dialog. The host
  // is the only committer, so a client-side version compare against the freshest
  // liveRound is enough (no need to CAS the commit itself). If anything changed,
  // re-open the dialog so the host only ever commits what they actually approved.
  const freshLive = (state.currentGame() || game).liveRound || {};
  const changed = playerIds.some((pid) => (freshLive[pid]?.v || 0) !== baseVersions[pid]);
  if (changed) {
    toast.show('Scores changed — review again');
    _confirmFlip7Round(container, roomCode, game, gameModule);
    return;
  }

  const btn = container.querySelector('#btn-confirm-round');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner mx-auto"></div>'; }

  try {
    await fb.submitRound(roomCode, game.gameId, rounds.length, draft, newTotals, endResult.ended ? endResult : null);

    _juaRoundData = { firstSavePid: null };
    _juaRoundTracked = rounds.length + 1;
    _flip7Draft = {};
    // submitRound nulls the whole liveRound node, clearing live first-save too.

    if (endResult.ended) {
      router.navigate('winner', { roomCode });
    } else {
      toast.show(`Round ${newRoundCount} submitted`);
      router.navigate('dashboard', { roomCode });
    }
  } catch (e) {
    console.error('Submit round failed:', e);
    toast.show('Submit failed');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'CONFIRM ROUND';
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
  const color = accentColor(p.accentIndex);
  const name = escapeHTML(p.name || pid);

  // For first save display: use pending change if set, otherwise read from round data
  const effectiveFirstSavePid = _editFirstSavePid !== undefined ? _editFirstSavePid : (selectedRound.jua?.firstSavePid || null);
  const isFirstSave = effectiveFirstSavePid === pid;

  _editScoresEl.innerHTML = `
    <div id="adjust-backdrop" class="absolute inset-0 bg-black/50"></div>
    <div class="relative w-full bg-surface-container-lowest border-t-2 border-outline">
      <div class="h-[6px]" style="background:${color}"></div>
      <div class="flex justify-center pt-3 pb-1">
        <div class="w-10 h-1 rounded-full bg-outline-variant"></div>
      </div>
      <div class="px-4 pb-3 border-b border-outline-variant">
        <p class="font-headline font-extrabold text-xl uppercase truncate">${name}</p>
      </div>
      ${game.config?.jua ? `
      <div class="px-4 pt-2 pb-0 flex justify-center">
        <button id="adj-first-save-btn" type="button"
          class="font-mono text-xs uppercase tracking-widest px-4 py-2 border transition-colors whitespace-nowrap ${isFirstSave ? 'bg-primary text-on-primary border-primary' : 'border-outline hover:border-primary'}">
          FIRST SAVE ❤️
        </button>
      </div>
      ` : ''}
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

  _editScoresEl.querySelector('#adj-first-save-btn')?.addEventListener('click', (e) => {
    const current = _editFirstSavePid !== undefined ? _editFirstSavePid : (selectedRound.jua?.firstSavePid || null);
    _editFirstSavePid = current === pid ? null : pid;
    const btn = e.currentTarget;
    if (_editFirstSavePid === pid) {
      btn.classList.remove('border-outline', 'hover:border-primary');
      btn.classList.add('bg-primary', 'text-on-primary', 'border-primary');
    } else {
      btn.classList.remove('bg-primary', 'text-on-primary', 'border-primary');
      btn.classList.add('border-outline', 'hover:border-primary');
    }
    _render(container, roomCode);
  });

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

// ── Jua Modal ──

function _openJuaFineCounter(pid, game, roomCode) {
  if (!_juaModalEl) return;
  const snapshot = game.playerSnapshot || {};
  const name = escapeHTML(snapshot[pid]?.name || pid);
  const fineRate = game.config?.juaInfluenceFine || 10;
  let fineCount = (game.juaFines || {})[pid] || 0;

  const _totalRupees = () => fineCount * fineRate;

  _juaModalEl.innerHTML = `
    <div id="jua-modal-backdrop" class="absolute inset-0 bg-black/50"></div>
    <div class="relative w-full bg-surface-container-lowest border-t-2 border-outline">
      <div class="flex justify-center pt-3 pb-1"><div class="w-10 h-1 rounded-full bg-outline-variant"></div></div>
      <div class="px-4 pb-3 border-b border-outline-variant">
        <p class="font-mono text-[9px] uppercase tracking-widest text-outline mb-1">RECORD FINES</p>
        <div class="flex items-center justify-between gap-3">
          <p class="font-headline font-extrabold text-xl uppercase truncate">${name}</p>
          <p id="jua-fine-rupees" class="font-mono text-2xl font-bold shrink-0">₹${_totalRupees()}</p>
        </div>
      </div>
      <div class="p-6 flex items-center justify-center gap-8 pb-4">
        <button id="jua-fine-sub" type="button"
          class="w-16 h-16 border-2 border-outline font-mono text-3xl flex items-center justify-center hover:bg-surface-container-high transition-colors disabled:opacity-30"
          ${fineCount === 0 ? 'disabled' : ''}>−</button>
        <span id="jua-fine-count" class="font-mono text-6xl font-bold w-16 text-center">${fineCount}</span>
        <button id="jua-fine-add" type="button"
          class="w-16 h-16 border-2 border-outline font-mono text-3xl flex items-center justify-center hover:bg-surface-container-high transition-colors">+</button>
      </div>
      <div class="px-4 pb-8">
        <button id="jua-fine-done" type="button" class="w-full btn-primary">DONE</button>
      </div>
    </div>
  `;

  _juaModalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const countEl = _juaModalEl.querySelector('#jua-fine-count');
  const rupeesEl = _juaModalEl.querySelector('#jua-fine-rupees');
  const subBtn = _juaModalEl.querySelector('#jua-fine-sub');

  const _refresh = () => {
    countEl.textContent = fineCount;
    rupeesEl.textContent = `₹${_totalRupees()}`;
    subBtn.disabled = fineCount === 0;
    fb.updateJuaFines(roomCode, game.gameId, { ...(game.juaFines || {}), [pid]: fineCount }).catch(() => {});
  };

  _juaModalEl.querySelector('#jua-fine-add').addEventListener('click', () => { fineCount++; _refresh(); });
  subBtn.addEventListener('click', () => { if (fineCount > 0) { fineCount--; _refresh(); } });

  _juaModalEl.querySelector('#jua-modal-backdrop').addEventListener('click', _closeJuaModal);
  _juaModalEl.querySelector('#jua-fine-done').addEventListener('click', _closeJuaModal);
}

function _closeJuaModal() {
  if (!_juaModalEl) return;
  _juaModalEl.style.display = 'none';
  _juaModalEl.innerHTML = '';
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

  try {
    await fb.undoLastRound(roomCode, game.gameId, newTotals, 'active');
    toast.show('Round undone');
  } catch (e) {
    toast.show('Undo failed');
  }
}
