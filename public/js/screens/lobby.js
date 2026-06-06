// ═══════════════════════════════════════════
// Lobby Screen — Player Roster Management
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import { accentColor } from '../state.js';
import { escapeHTML } from '../utils.js';

let _unsub = null;
// Tracks the host state last reflected in the top bar, so we only re-render the
// header actions (and its overflow trigger) when the viewer flips host ⇄ spectator.
let _lastTopBarHost = null;

export function mount(container, params = {}) {
  bottomNav.hide();

  const roomCode = params.roomCode || state.get('roomCode');
  if (!roomCode) {
    router.navigate('home');
    return;
  }

  state.set('roomCode', roomCode);

  // Show top bar. No back button here — leaving happens via the overflow menu's
  // "Exit Lobby"; the header carries copy-link + QR + overflow (host only).
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'LOBBY';
  document.getElementById('top-bar-back').classList.add('hidden');
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);
  _lastTopBarHost = state.isHost();

  container.innerHTML = `
    <div id="lobby-content" class="p-6 pb-8 flex flex-col">

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

      <!-- Players heading (everyone); shows "N PLAYERS" once there's at least one. -->
      <h2 id="players-heading" class="font-headline font-extrabold uppercase text-lg tracking-widest mt-4 mb-6">PLAYERS</h2>

      <!-- Player List: 2-column grid of player tiles -->
      <div id="player-list" class="grid grid-cols-2 gap-2"></div>

      <!-- Host-only: let spectators enter scores (host still confirms the round). -->
      <div id="spectator-scoring-section" class="mt-4 border border-outline bg-surface-container-lowest p-4" style="display:none">
        <div class="flex items-center justify-between gap-3">
          <label for="toggle-spectator-scoring" class="font-headline font-bold text-sm uppercase">Allow spectators to score</label>
          <button
            type="button"
            role="switch"
            id="toggle-spectator-scoring"
            aria-checked="false"
            class="w-12 h-7 border transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-surface-container-high border-outline"
          ><span class="toggle-thumb absolute top-0.5 left-0.5 w-6 h-6 transition-all bg-outline"></span></button>
        </div>
      </div>
    </div>

    <!-- Docked bottom actions — pinned above the bottom nav. The sections below
         are mutually exclusive; the whole bar is shown/hidden in _render based on
         whether any action applies, so it never renders empty. -->
    <div id="lobby-actions" class="docked-bar p-4 bg-surface-container-low flex flex-col gap-3" style="display:none">

      <!-- Start Game (host only) -->
      <div id="start-section" style="display:none">
        <p id="start-hint" class="font-body text-sm text-on-surface-variant text-center mb-2" style="display:none">Add at least 3 players to start a game.</p>
        <button id="btn-start-game" class="btn-primary flex items-center justify-center" disabled>
          Start a new game
        </button>
      </div>

      <!-- Finished game actions (host only, after a game ends). -->
      <div id="finished-game-section" class="flex flex-col gap-3" style="display:none"></div>

      <!-- Leave Lobby (once the night is locked — host + spectators). -->
      <div id="leave-lobby-section" style="display:none">
        <button id="btn-leave-lobby" class="btn-danger w-full flex items-center justify-center gap-2">
          <span aria-hidden="true" class="material-symbols-outlined text-lg">logout</span>
          LEAVE LOBBY
        </button>
      </div>

      <!-- Go to game (spectators only, once the host has started a game) — lets a
           spectator jump from the roster to the live board. -->
      <div id="spectator-game-section" style="display:none">
        <button id="btn-go-to-game" class="btn-primary w-full flex items-center justify-center gap-2">
          GO TO GAME
          <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>
        </button>
      </div>

      <!-- Become Host (visible to all when no host) -->
      <div id="become-host-section" style="display:none">
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

  // Go to game (spectators, once the host has started a game) — jumps to the board.
  container.querySelector('#btn-go-to-game')?.addEventListener('click', () => {
    router.navigate('dashboard', { roomCode });
  });

  container.querySelector('#btn-become-host')?.addEventListener('click', async () => {
    try {
      await fb.claimHost(roomCode);
    } catch (e) {
      toast.show('Failed to claim host');
    }
  });

  // Allow-spectators-to-score toggle (host only). Flip optimistically, persist to
  // the lobby; a later _render reconciles from the synced lobby flag.
  container.querySelector('#toggle-spectator-scoring')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const next = btn.getAttribute('aria-checked') !== 'true';
    _applySpectatorToggleVisuals(btn, next);
    try {
      await fb.updateRoomLobby(roomCode, { spectatorScoring: next });
    } catch (err) {
      _applySpectatorToggleVisuals(btn, !next);
      toast.show('Failed to update setting');
    }
  });
}

// Mirror the game-select switch styling for the spectator-scoring toggle.
function _applySpectatorToggleVisuals(btn, on) {
  btn.setAttribute('aria-checked', String(on));
  btn.classList.toggle('bg-primary', on);
  btn.classList.toggle('border-primary', on);
  btn.classList.toggle('bg-surface-container-high', !on);
  btn.classList.toggle('border-outline', !on);
  const thumb = btn.querySelector('.toggle-thumb');
  if (thumb) {
    thumb.classList.toggle('bg-on-primary', on);
    thumb.classList.toggle('translate-x-5', on);
    thumb.classList.toggle('bg-outline', !on);
  }
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

  // Assign the lowest unused accent colour, so colours don't collide after players
  // are removed and new ones added (a freed slot gets reused instead of duplicating
  // a colour still in play). seatOrder picks up after the current max for the same
  // reason. accentColor() handles indices beyond the palette.
  const playerArr = Object.values(players);
  const usedAccents = new Set(playerArr.map((p) => p.accentIndex));
  let accentIndex = 0;
  while (usedAccents.has(accentIndex)) accentIndex++;
  const seatOrder = playerArr.reduce((max, p) => Math.max(max, p.seatOrder ?? -1), -1) + 1;

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
      _showJuaPrizeSplitModal(container, roomCode, lobby.activeGameId, game.config, game.playerIds || [], nameUpper, seatOrder, accentIndex);
      return;
    }
  }

  try {
    const newPlayerId = await fb.addPlayer(roomCode, name, seatOrder, accentIndex);
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

    // The lobby is always a nav tab: it shows on its own when no game is active,
    // and alongside the game tab during a Flip 7 game. Only a non-Flip 7 game in
    // progress hides the nav (those games use their own tab set elsewhere).
    const activeGameForNav = state.currentGame();
    if (activeGameForNav && activeGameForNav.type !== 'flip7') {
      bottomNav.hide();
    } else {
      bottomNav.show('lobby');
    }

    // Show/hide host controls (add-player row + quick-add chips). Hidden once
    // the night has ended — no more players can be added.
    const canAdd = isHost && lobby.status !== 'night-ended';
    container.querySelector('#host-controls').style.display = canAdd ? 'block' : 'none';
    const viewerLabelEl = container.querySelector('#viewer-label');
    if (viewerLabelEl) {
      if (isHost) {
        viewerLabelEl.style.display = 'none';
      } else {
        viewerLabelEl.style.display = 'block';
        // Always show the Spectator Mode card; the sub-line reflects room state.
        const gameActive = lobby.status === 'playing' && state.currentGame()?.status === 'active';
        let spectatorSubLine, spectatorSubSize;
        if (gameActive) {
          spectatorSubLine = 'Host has started the game...';
          spectatorSubSize = 'text-base';
        } else if (lobby.status === 'night-ended') {
          spectatorSubLine = 'Host has ended the game night';
          spectatorSubSize = 'text-sm';
        } else {
          spectatorSubLine = 'Waiting for the host to start the game';
          spectatorSubSize = 'text-base';
        }
        viewerLabelEl.innerHTML = `
          <div class="bg-surface-container-high border border-outline p-4 text-center">
            <p class="font-headline font-bold text-lg uppercase tracking-widest text-outline">SPECTATOR MODE</p>
            <p class="font-body ${spectatorSubSize} text-on-surface-variant mt-1">${spectatorSubLine}</p>
          </div>
        `;
      }
    }
    container.querySelector('#start-section').style.display = isHost ? 'block' : 'none';

    // Host-only spectator-scoring toggle (persists across games in the night).
    const specSection = container.querySelector('#spectator-scoring-section');
    if (specSection) {
      specSection.style.display = isHost ? 'block' : 'none';
      const specToggle = specSection.querySelector('#toggle-spectator-scoring');
      if (specToggle) _applySpectatorToggleVisuals(specToggle, lobby.spectatorScoring === true);
    }

    // Render player list. Add is always allowed for the host. Remove is allowed
    // except while a game is actually in progress — once a game is finished or
    // abandoned (or the night has ended) the game's playerIds/snapshot are
    // frozen, so removing a player from the roster can't affect jua/standings.
    const isPlaying = lobby.status === 'playing';
    const gameInProgress = state.currentGame()?.status === 'active';
    const addRow = container.querySelector('#add-player-row');
    if (addRow) addRow.style.display = canAdd ? 'flex' : 'none';
    _renderPlayers(container, players, isHost, roomCode, gameInProgress);
    _showSuggestions(container, roomCode);

    // The overflow menu is host-only. If the viewer just became (or stopped being)
    // the host, re-render the header so the trigger appears/disappears.
    if (isHost !== _lastTopBarHost) {
      hostMenu.renderTopBarActions(roomCode);
      _lastTopBarHost = isHost;
    }

    const becomeHostSection = container.querySelector('#become-host-section');
    if (becomeHostSection) becomeHostSection.style.display = (!lobby.hostKey && !isHost) ? 'block' : 'none';

    // Spectators get a "Go to game" shortcut to the live board once the host has
    // a game in progress.
    const spectatorGameSection = container.querySelector('#spectator-game-section');
    if (spectatorGameSection) spectatorGameSection.style.display = (!isHost && isPlaying && gameInProgress) ? 'block' : 'none';

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
    // Keep the "add at least 3 players" hint visible until the threshold is met.
    // At 0 players the empty-state placeholder already shows it, so only fill the
    // gap for 1-2 players here.
    const startHint = container.querySelector('#start-hint');
    if (startHint) {
      const showHint = isHost && !isPlaying && !nightLocked && activeCount > 0 && activeCount < 3;
      startHint.style.display = showHint ? 'block' : 'none';
    }

    // Show the docked action bar only when one of its sections applies, so it
    // never renders as an empty strip. Mirror the per-section conditions above.
    const showStart = isHost && !isPlaying && !nightLocked;
    const showFinished = isHost && isGameFinished;
    const showGoToGame = !isHost && isPlaying && gameInProgress;
    const showBecomeHost = !lobby.hostKey && !isHost;
    const anyAction = showStart || showFinished || nightLocked || showGoToGame || showBecomeHost;
    const actionsBar = container.querySelector('#lobby-actions');
    if (actionsBar) actionsBar.style.display = anyAction ? 'flex' : 'none';
    // Reserve scroll space so the player grid clears the docked bar when shown.
    const lobbyContent = container.querySelector('#lobby-content');
    if (lobbyContent) {
      lobbyContent.classList.toggle('pb-32', anyAction);
      lobbyContent.classList.toggle('pb-8', !anyAction);
    }
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

  // Heading reflects the count: "PLAYERS" when empty, "N PLAYERS" otherwise.
  const heading = container.querySelector('#players-heading');
  if (heading) heading.textContent = sorted.length > 0 ? `${sorted.length} Players` : 'Players';
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
      const color = accentColor(p.accentIndex);
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
