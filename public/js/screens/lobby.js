// ═══════════════════════════════════════════
// Lobby Screen — Player Roster Management
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as qrModal from '../components/qr-modal.js';
import { ACCENT_COLORS } from '../state.js';
import { escapeHTML } from '../utils.js';

let _unsub = null;

export function mount(container, params = {}) {
  bottomNav.hide();

  const roomCode = params.roomCode || state.get('roomCode');
  if (!roomCode) {
    router.navigate('home');
    return;
  }

  state.set('roomCode', roomCode);

  // Show top bar
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'LOBBY';
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.remove('hidden');
  backBtn.textContent = 'logout';
  backBtn.setAttribute('aria-label', 'Leave room');
  backBtn.onclick = () => {
    fb.unwatchRoom();
    router.navigate('home', {}, 'back');
  };
  _renderTopBarActions(roomCode);

  container.innerHTML = `
    <div class="p-6 pb-32">

      <!-- Leave Lobby (top, once the night is locked — host + spectators) -->
      <div id="leave-lobby-section" class="mb-6" style="display:none">
        <button id="btn-leave-lobby" class="btn-primary w-full flex items-center justify-center gap-2">
          <span aria-hidden="true" class="material-symbols-outlined text-lg">logout</span>
          LEAVE LOBBY
        </button>
      </div>

      <!-- Finished game actions (host only, after a game ends) -->
      <div id="finished-game-section" class="mb-6 flex flex-col gap-3" style="display:none"></div>

      <!-- Viewer status panel (spectator only) -->
      <div id="viewer-label" class="mb-6" style="display:none"></div>

      <!-- Host-only: Add Player -->
      <div id="host-controls" style="display:none">
        <!-- Always-visible inline add. Mid-game adds are allowed; the new player joins the next game. -->
        <div id="add-player-row" class="flex gap-2 mb-2">
          <label for="input-player-name" class="sr-only">Add Player</label>
          <input
            id="input-player-name"
            type="text"
            maxlength="12"
            placeholder="Add Player"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="characters"
            class="flex-1 bg-surface-container-lowest border border-outline font-headline font-bold text-base uppercase py-3 px-4 placeholder:text-outline placeholder:normal-case placeholder:font-normal focus:outline-none focus:border-primary transition-colors"
          >
          <button id="btn-confirm-add" aria-label="Add Player" title="Add Player" class="bg-primary text-on-primary px-4 font-headline font-bold text-sm uppercase tracking-widest flex items-center gap-1 hover:opacity-90 transition-opacity shrink-0">
            <span class="material-symbols-outlined text-lg" aria-hidden="true">add</span>
          </button>
        </div>
        <div id="name-suggestions" class="mb-4 flex items-start gap-2"></div>
      </div>

      <!-- Players heading (everyone) -->
      <h2 class="font-headline font-extrabold uppercase text-lg tracking-widest mb-6">PLAYERS</h2>

      <!-- Player List: 2-column grid of player tiles -->
      <div id="player-list" class="grid grid-cols-2 gap-2"></div>

      <!-- Start Game (host only) -->
      <div id="start-section" class="mt-4" style="display:none">
        <button id="btn-start-game" class="btn-primary flex items-center justify-center" disabled>
          Start a new game
        </button>
      </div>

      <!-- Become Host (visible to all when no host) -->
      <div id="become-host-section" class="mt-4" style="display:none">
        <button id="btn-become-host" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
          BECOME HOST
        </button>
      </div>
    </div>
  `;

  _bindEvents(container, roomCode);
  _startWatching(roomCode, container);
}

export function unmount() {
  // Keep the room watcher alive — we still need it
}

function _renderTopBarActions(roomCode) {
  const actionsEl = document.getElementById('top-bar-actions');
  if (!actionsEl) return;

  _closeLobbyMenu(); // clear any leftover overlay from a previous mount

  actionsEl.innerHTML = `
    <button id="btn-copy-link" aria-label="Copy join link" title="Copy join link"
      class="font-mono text-xs border border-outline px-2 py-1 hover:bg-surface-container-high transition-colors">
      ${roomCode}
    </button>
    <button id="btn-qr-share" aria-label="Show QR code" title="Share room QR" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1 ml-1" style="font-size:22px">qr_code_2</button>
    <button id="btn-lobby-menu-trigger" aria-label="Open menu" class="material-symbols-outlined hover:bg-surface-container-high transition-colors p-1 ml-1" style="font-size:22px;display:none">more_vert</button>
  `;

  const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

  const copyBtn = document.getElementById('btn-copy-link');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      const orig = copyBtn.textContent.trim();
      copyBtn.textContent = 'COPIED!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    } catch {
      toast.show('Could not copy link');
    }
  });

  document.getElementById('btn-qr-share')?.addEventListener('click', () => {
    qrModal.show(url, roomCode);
  });

  document.getElementById('btn-lobby-menu-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.getElementById('lobby-menu-overlay')) {
      _closeLobbyMenu();
    } else {
      _openLobbyMenu(roomCode);
    }
  });
}

// Host-only overflow menu for the lobby — mirrors the game screen's 3-dot menu.
function _openLobbyMenu(roomCode) {
  _closeLobbyMenu();

  // "Call it a Night" appears once stats are tracked and a game has finished.
  const lobby = state.get('roomLobby') || {};
  const games = state.get('games') || {};
  const trackStats = lobby.trackStats !== false;
  const hasFinishedGame = Object.values(games).some((g) => g.status === 'finished');
  const canCallNight = trackStats && hasFinishedGame && lobby.status !== 'night-ended';

  const itemClass = 'w-full text-left px-4 py-3 font-headline font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors flex items-center gap-3';

  const overlay = document.createElement('div');
  overlay.id = 'lobby-menu-overlay';
  overlay.className = 'fixed inset-0 z-[200]';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div id="lobby-menu-backdrop" class="absolute inset-0" style="background:rgba(0,0,0,0.15)"></div>
    <div class="absolute top-14 right-4 max-w-[250px] w-[220px] bg-surface-container-low border border-outline" style="max-width:min(250px, calc(100vw - 32px))">
      ${canCallNight ? `
      <button id="lobby-menu-call-night" class="${itemClass} border-b border-outline-variant">
        <span aria-hidden="true" class="material-symbols-outlined text-sm">bedtime</span>
        CALL IT A NIGHT
      </button>
      ` : ''}
      <button id="lobby-menu-change-host" class="${itemClass} text-red-600">
        <span aria-hidden="true" class="material-symbols-outlined text-sm">swap_horiz</span>
        CHANGE HOST
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#lobby-menu-backdrop').addEventListener('click', _closeLobbyMenu);

  overlay.querySelector('#lobby-menu-call-night')?.addEventListener('click', () => {
    _closeLobbyMenu();
    _callItANight(roomCode);
  });

  overlay.querySelector('#lobby-menu-change-host').addEventListener('click', async () => {
    _closeLobbyMenu();
    try {
      await fb.releaseHost(roomCode);
    } catch (e) {
      toast.show('Failed to release host');
    }
  });
}

function _closeLobbyMenu() {
  document.getElementById('lobby-menu-overlay')?.remove();
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

function _bindEvents(container, roomCode) {
  // Add player — inline always-visible
  container.querySelector('#btn-confirm-add')?.addEventListener('click', () => _addPlayer(container, roomCode));
  const nameInput = container.querySelector('#input-player-name');
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _addPlayer(container, roomCode);
  });
  _showSuggestions(container, roomCode);

  // Start game
  container.querySelector('#btn-start-game')?.addEventListener('click', () => {
    router.navigate('game-select', { roomCode });
  });

  // Leave Lobby (shown when the night is locked)
  container.querySelector('#btn-leave-lobby')?.addEventListener('click', () => {
    fb.unwatchRoom();
    router.navigate('home', {}, 'back');
  });

  container.querySelector('#btn-become-host')?.addEventListener('click', async () => {
    try {
      await fb.claimHost(roomCode);
    } catch (e) {
      toast.show('Failed to claim host');
    }
  });
}

async function _addPlayer(container, roomCode) {
  const input = container.querySelector('#input-player-name');
  const name = input.value.trim();
  if (!name) {
    toast.show('Enter a name');
    return;
  }

  // Check for duplicate names
  const players = state.get('players') || {};
  const nameUpper = name.toUpperCase();
  const duplicate = Object.values(players).some((p) => p.name === nameUpper);
  if (duplicate) {
    toast.show('Name already exists');
    input.select();
    return;
  }

  const count = Object.keys(players).length;
  const accentIndex = count % ACCENT_COLORS.length;

  // Mid-game joins only apply while a game is actually in progress (status
  // 'active'). A finished/abandoned game is frozen — adding then just rosters
  // the player for the next game (no prize-split modal, no game mutation).
  // If a game is in progress but we can't read it yet, block rather than fall
  // through to fb.addPlayer without the jua modal.
  const lobby = state.get('roomLobby') || {};
  if (lobby.status === 'playing' && lobby.activeGameId) {
    const game = state.currentGame();
    if (!game) {
      toast.show('Game data not loaded yet, try again');
      return;
    }
    if (game.status === 'active' && game.type === 'flip7' && game.config?.jua) {
      input.value = '';
      _showSuggestions(container, roomCode);
      _showJuaPrizeSplitModal(container, roomCode, lobby.activeGameId, game.config, game.playerIds || [], nameUpper, count, accentIndex);
      return;
    }
  }

  try {
    const newPlayerId = await fb.addPlayer(roomCode, name, count, accentIndex);
    _savePlayerName(nameUpper);
    input.value = '';
    input.focus();
    _showSuggestions(container, roomCode);

    if (lobby.status === 'playing' && lobby.activeGameId && newPlayerId) {
      const game = state.currentGame();
      // Only fold the new player into the current game while it's in progress.
      if (game && game.status === 'active') {
        await fb.addPlayerToGame(roomCode, lobby.activeGameId, newPlayerId, nameUpper, accentIndex, game.playerIds || []);
      }
    }
  } catch (e) {
    toast.show('Failed to add player');
  }
}


function _startWatching(roomCode, container) {
  fb.watchRoom(roomCode, (data) => {
    if (!data) {
      toast.show('Room not found');
      router.navigate('home');
      return;
    }

    const isHost = state.isHost();
    const lobby = data.lobby || {};
    const players = data.players || {};
    const games = data.games || {};
    const trackStats = lobby.trackStats !== false;
    const hasPlayedGames = Object.values(games).some((g) => g.rounds && Object.keys(g.rounds).length > 0);

    // The lobby is always a nav tab: it shows on its own when no game is active,
    // and alongside the game tab during a Flip 7 game. Only a non-Flip 7 game in
    // progress hides the nav (those games use their own tab set elsewhere).
    const activeGameForNav = state.currentGame();
    if (activeGameForNav && activeGameForNav.type !== 'flip7') {
      bottomNav.hide();
    } else {
      bottomNav.show('lobby');
    }

    // Show/hide host controls
    container.querySelector('#host-controls').style.display = isHost ? 'block' : 'none';
    const viewerLabelEl = container.querySelector('#viewer-label');
    if (viewerLabelEl) {
      if (isHost) {
        viewerLabelEl.style.display = 'none';
      } else {
        viewerLabelEl.style.display = 'block';
        const isGameActive = lobby.status === 'playing' && lobby.activeGameId;
        const showRecap = trackStats && hasPlayedGames;
        const nightEnded = lobby.status === 'night-ended';
        const spectatorSubLine = nightEnded
          ? 'Host has ended the game night'
          : 'Waiting for the host to start the game';
        const spectatorSubSize = nightEnded ? 'text-sm' : 'text-base';
        viewerLabelEl.innerHTML = isGameActive
          ? `${showRecap ? `<button id="btn-spectator-recap" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
                 <span aria-hidden="true" class="material-symbols-outlined text-sm">bar_chart</span>
                 VIEW NIGHT RECAP
               </button>` : ''}`
          : `<div class="bg-surface-container-high border border-outline p-4 text-center">
               <p class="font-headline font-bold text-lg uppercase tracking-widest text-outline">SPECTATOR MODE</p>
               <p class="font-body ${spectatorSubSize} text-on-surface-variant mt-1">${spectatorSubLine}</p>
             </div>`;
        viewerLabelEl.querySelector('#btn-spectator-recap')?.addEventListener('click', () => {
          router.navigate('recap', { roomCode });
        });
      }
    }
    container.querySelector('#start-section').style.display = isHost ? 'block' : 'none';

    // Render player list. Add is always allowed for the host. Remove is allowed
    // except while a game is actually in progress — once a game is finished or
    // abandoned (or the night has ended) the game's playerIds/snapshot are
    // frozen, so removing a player from the roster can't affect jua/standings.
    const isPlaying = lobby.status === 'playing';
    const gameInProgress = state.currentGame()?.status === 'active';
    const addRow = container.querySelector('#add-player-row');
    if (addRow) addRow.style.display = isHost ? 'flex' : 'none';
    _renderPlayers(container, players, isHost, roomCode, gameInProgress);
    _showSuggestions(container, roomCode);

    // The 3-dot overflow menu (Change Host, Call it a Night) is host-only.
    const lobbyMenuTrigger = document.getElementById('btn-lobby-menu-trigger');
    if (lobbyMenuTrigger) lobbyMenuTrigger.style.display = isHost ? '' : 'none';

    const becomeHostSection = container.querySelector('#become-host-section');
    if (becomeHostSection) becomeHostSection.style.display = (!lobby.hostKey && !isHost) ? 'block' : 'none';

    // Enable/disable start
    const activeCount = Object.values(players).length;
    const activeGame = state.currentGame();
    const isGameFinished = isPlaying && activeGame?.status === 'finished';

    const finishedSection = container.querySelector('#finished-game-section');
    if (finishedSection) {
      if (isHost && isGameFinished) {
        finishedSection.style.display = 'flex';
        _renderFinishedGameActions(finishedSection, roomCode);
      } else {
        finishedSection.style.display = 'none';
      }
    }

    // Once the night is locked, no new games can be started or replayed here —
    // the host starts a fresh night from the landing screen. Everyone gets a
    // Leave Lobby button instead.
    const nightLocked = lobby.status === 'night-ended';
    const leaveLobbySection = container.querySelector('#leave-lobby-section');
    if (leaveLobbySection) leaveLobbySection.style.display = nightLocked ? 'block' : 'none';

    const startSection = container.querySelector('#start-section');
    const btn = container.querySelector('#btn-start-game');
    if (startSection) startSection.style.display = (isHost && !isPlaying && !nightLocked) ? 'block' : 'none';
    if (btn) btn.disabled = activeCount < 3;
  });
}

function _renderFinishedGameActions(el, roomCode) {
  // The winner, recap, and "call it a night" actions live in the bottom nav and
  // overflow menu — the finished-game section just offers Start New Game.
  el.innerHTML = `
    <button id="btn-start-new-game" class="btn-primary w-full flex items-center justify-center gap-2">
      <span aria-hidden="true" class="material-symbols-outlined text-lg">add</span>
      START NEW GAME
    </button>
  `;

  el.querySelector('#btn-start-new-game')?.addEventListener('click', () => {
    // Don't clear the current game yet — keep it referenced (so the Flip 7 /
    // Winner tab stays available) until a new game is actually created.
    // createGame overwrites activeGameId/status when the host picks a game.
    router.navigate('game-select', { roomCode });
  });
}

function _renderPlayers(container, players, isHost, roomCode, gameInProgress = false) {
  const list = container.querySelector('#player-list');
  const sorted = Object.values(players).sort((a, b) => a.seatOrder - b.seatOrder);
  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="col-span-2 text-center py-12">
        <span aria-hidden="true" class="material-symbols-outlined text-4xl text-outline mb-2">group_add</span>
        <p class="font-body text-base text-on-surface-variant">${isHost ? 'Add at least 3 players to start a game.' : 'Waiting for the host to add players\u2026'}</p>
      </div>
    `;
    return;
  }

  const canRemove = isHost && !gameInProgress;
  list.innerHTML = sorted
    .map((p) => {
      const color = ACCENT_COLORS[p.accentIndex % ACCENT_COLORS.length];
      return `
        <div class="relative bg-surface-container-lowest border border-outline">
          <div class="h-1.5 w-full" style="background:${color}"></div>
          <div class="p-4 ${canRemove ? 'pr-9' : ''}">
            <p class="font-headline font-extrabold text-xl uppercase truncate">${escapeHTML(p.name)}</p>
          </div>
          ${canRemove ? `
            <button class="player-remove absolute top-2.5 right-1.5 p-1 hover:bg-surface-container-high transition-colors" data-id="${escapeHTML(p.id)}" title="Remove" aria-label="Remove ${escapeHTML(p.name)}">
              <span aria-hidden="true" class="material-symbols-outlined text-[20px] text-error">close</span>
            </button>
          ` : ''}
        </div>
      `;
    })
    .join('');

  // Bind player action buttons
  if (isHost) {
    list.querySelectorAll('.player-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        fb.removePlayer(roomCode, id);
      });
    });
  }
}

// ── Player name memory ──

const _NAMES_KEY = 'gns_player_names';

function _getKnownNames() {
  try { return JSON.parse(localStorage.getItem(_NAMES_KEY) || '[]'); } catch { return []; }
}

function _savePlayerName(name) {
  const names = _getKnownNames().filter((n) => n !== name);
  names.unshift(name);
  localStorage.setItem(_NAMES_KEY, JSON.stringify(names.slice(0, 30)));
}

function _removePlayerName(name) {
  localStorage.setItem(_NAMES_KEY, JSON.stringify(_getKnownNames().filter((n) => n !== name)));
}

function _showSuggestions(container, roomCode) {
  const input = container.querySelector('#input-player-name');
  const suggestionsEl = container.querySelector('#name-suggestions');
  if (!input || !suggestionsEl) return;

  const existing = new Set(Object.values(state.get('players') || {}).map((p) => p.name));
  // Render a generous pool of candidates, then trim to whatever fits in 2 rows.
  const matches = _getKnownNames().filter((n) => !existing.has(n)).slice(0, 30);

  if (matches.length === 0) {
    suggestionsEl.innerHTML = '';
    return;
  }

  suggestionsEl.innerHTML = `
    <span class="font-label text-xs uppercase tracking-widest shrink-0 py-1">Quick add:</span>
    <div id="name-suggestions-chips" class="flex flex-wrap gap-2 min-w-0">
      ${matches.map((n) => `
        <button class="suggestion-chip font-label text-xs uppercase tracking-widest border border-outline pl-2 pr-1 py-1 hover:bg-surface-container-high transition-colors inline-flex items-center gap-1.5" data-name="${escapeHTML(n)}">
          ${escapeHTML(n)}
          <span class="remove-chip text-outline hover:text-on-surface leading-none" aria-label="Remove ${escapeHTML(n)}">&#x2715;</span>
        </button>
      `).join('')}
    </div>
  `;

  suggestionsEl.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.remove-chip')) return;
      input.value = chip.dataset.name;
      _addPlayer(container, roomCode);
    });
    chip.querySelector('.remove-chip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _removePlayerName(chip.dataset.name);
      _showSuggestions(container, roomCode);
    });
  });

  // Keep only the chips that fit within two rows of the chips column.
  requestAnimationFrame(() => {
    const chipsEl = suggestionsEl.querySelector('#name-suggestions-chips');
    if (!chipsEl) return;
    const chips = Array.from(chipsEl.children);
    if (chips.length === 0) return;
    const firstTop = chips[0].offsetTop;
    let secondTop = null;
    for (const c of chips) {
      if (c.offsetTop > firstTop) { secondTop = c.offsetTop; break; }
    }
    const maxTop = secondTop !== null ? secondTop : firstTop;
    chips.forEach((c) => {
      if (c.offsetTop > maxTop) c.remove();
    });
  });
}

function _showJuaPrizeSplitModal(container, roomCode, gameId, config, prevPlayerIds, playerName, seatOrder, accentIndex) {
  const newPlayerCount = prevPlayerIds.length + 1;
  const buyIn = config.juaBuyIn || 30;
  const totalPot = buyIn * newPlayerCount;

  const baseShare = buyIn === 30
    ? Math.round(newPlayerCount * buyIn / 3)
    : Math.ceil(newPlayerCount * buyIn / 3);
  let prize1 = buyIn === 30 ? baseShare + 20 : baseShare;
  let prize2 = baseShare;

  const _computePrize3 = () => totalPot - prize1 - prize2;

  const modalEl = document.createElement('div');
  modalEl.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';

  const prize3Init = _computePrize3();
  modalEl.innerHTML = `
    <div class="w-full max-w-sm bg-surface-container-low border border-outline shadow-lg">

      <div class="px-5 pt-5 pb-4 border-b border-outline-variant">
        <h2 class="font-headline font-extrabold text-xl uppercase">Add ${escapeHTML(playerName)}</h2>
      </div>

      <div class="px-5 py-3">
        <div class="flex items-center justify-between py-2">
          <label class="font-headline font-bold text-base uppercase">Adjust prize money</label>
        </div>
        <div class="mt-2 pl-3 border-l-2 border-outline-variant">
          <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <label class="font-headline font-bold text-base uppercase">Total Pot Size</label>
            <div class="flex items-center gap-1">
              <span class="font-mono text-base text-outline">₹</span>
              <span class="font-mono text-base w-20 text-right text-outline">${totalPot}</span>
            </div>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <label for="prize-split-1" class="font-headline font-bold text-base uppercase">1st Place</label>
            <div class="flex items-center gap-1">
              <span class="font-mono text-base text-outline">₹</span>
              <input type="number" id="prize-split-1" value="${prize1}" min="0"
                class="w-20 bg-transparent border-0 border-b-2 border-primary font-mono text-base text-right py-1 px-0 focus:outline-none focus:border-secondary">
            </div>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <label for="prize-split-2" class="font-headline font-bold text-base uppercase">2nd Place</label>
            <div class="flex items-center gap-1">
              <span class="font-mono text-base text-outline">₹</span>
              <input type="number" id="prize-split-2" value="${prize2}" min="0"
                class="w-20 bg-transparent border-0 border-b-2 border-primary font-mono text-base text-right py-1 px-0 focus:outline-none focus:border-secondary">
            </div>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <label class="font-headline font-bold text-base uppercase">3rd Place</label>
            <div class="flex items-center gap-1">
              <span class="font-mono text-base text-outline">₹</span>
              <span id="prize-split-3" class="font-mono text-base w-20 text-right ${prize3Init < 0 ? 'text-red-600' : 'text-outline'}">${prize3Init}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="px-5 pb-5 flex gap-3 border-t border-outline-variant pt-4">
        <button id="prize-split-cancel" type="button" aria-label="Cancel" class="btn-secondary flex-none flex items-center justify-center self-stretch" style="padding:0;background:#f4f4f2">
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
        <button id="prize-split-confirm" type="button" class="btn-primary" style="flex:3">ADD PLAYER</button>
      </div>

    </div>
  `;

  document.body.appendChild(modalEl);
  document.body.style.overflow = 'hidden';

  const cancelBtn = modalEl.querySelector('#prize-split-cancel');
  requestAnimationFrame(() => { cancelBtn.style.width = cancelBtn.offsetHeight + 'px'; });

  const p1El = modalEl.querySelector('#prize-split-1');
  const p2El = modalEl.querySelector('#prize-split-2');
  const p3El = modalEl.querySelector('#prize-split-3');

  const _updatePrize3 = () => {
    prize1 = parseInt(p1El.value) || 0;
    prize2 = parseInt(p2El.value) || 0;
    const prize3 = _computePrize3();
    p3El.textContent = prize3;
    p3El.classList.toggle('text-red-600', prize3 < 0);
    p3El.classList.toggle('text-outline', prize3 >= 0);
  };

  p1El.addEventListener('input', _updatePrize3);
  p2El.addEventListener('input', _updatePrize3);

  const _close = () => { modalEl.remove(); document.body.style.overflow = ''; };

  modalEl.querySelector('#prize-split-cancel').addEventListener('click', () => {
    _close();
    container.querySelector('#input-player-name')?.focus();
  });

  modalEl.querySelector('#prize-split-confirm').addEventListener('click', async () => {
    if (_computePrize3() < 0) {
      toast.show('Prize splits exceed total pot');
      return;
    }
    const confirmBtn = modalEl.querySelector('#prize-split-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'ADDING…';
    try {
      const newPlayerId = await fb.addPlayer(roomCode, playerName, seatOrder, accentIndex);
      _savePlayerName(playerName);
      await fb.addPlayerToGame(roomCode, gameId, newPlayerId, playerName, accentIndex, prevPlayerIds);
      await fb.updateGameConfig(roomCode, gameId, { juaPrize1: prize1, juaPrize2: prize2 });
      _close();
    } catch (e) {
      toast.show('Failed to add player');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'ADD PLAYER';
    }
  });
}
