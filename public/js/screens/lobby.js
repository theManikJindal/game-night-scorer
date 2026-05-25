// ═══════════════════════════════════════════
// Lobby Screen — Player Roster Management
// ═══════════════════════════════════════════

import * as state from '../state.js';
import { getGame } from '../games/registry.js';
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
  document.getElementById('top-bar-actions').innerHTML = '';

  container.innerHTML = `
    <div class="p-6 pb-32">
      <!-- Room Code -->
      <div class="bg-surface-container-lowest border border-outline p-6 mb-6">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-2">LOBBY PIN</p>
        <div class="flex items-center justify-between">
          <span class="font-mono text-3xl font-bold tracking-[0.3em]">${roomCode}</span>
          <div class="flex items-center gap-2">
            <button id="btn-qr" aria-label="Show QR code" title="Show QR code" class="font-mono text-[10px] uppercase tracking-widest border border-outline px-3 py-2 hover:bg-surface-container-high transition-colors flex items-center gap-1">
              <span class="material-symbols-outlined" style="font-size:14px">qr_code_2</span>
            </button>
            <button id="btn-copy" class="font-mono text-[10px] uppercase tracking-widest border border-outline px-3 py-2 hover:bg-surface-container-high transition-colors">
              COPY LINK
            </button>
          </div>
        </div>
      </div>

      <!-- Current game card (shown when a game is active) -->
      <div id="current-game-card" class="mb-6"></div>

      <!-- In-progress game actions (host only, while a game is running) -->
      <div id="return-game-section" class="mb-6 flex flex-col gap-3" style="display:none"></div>

      <!-- Finished game actions (host only, after a game ends) -->
      <div id="finished-game-section" class="mb-6 flex flex-col gap-3" style="display:none"></div>

      <!-- Host-only: Add Player -->
      <div id="host-controls" style="display:none">
        <h2 class="font-headline font-extrabold uppercase text-sm tracking-widest mb-4">PLAYERS</h2>

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
            class="flex-1 bg-surface-container-lowest border border-outline font-headline font-bold text-sm uppercase py-3 px-4 placeholder:text-outline placeholder:normal-case placeholder:font-normal focus:outline-none focus:border-primary transition-colors"
          >
          <button id="btn-confirm-add" aria-label="Add Player" title="Add Player" class="bg-primary text-on-primary px-4 font-headline font-bold text-sm uppercase tracking-widest flex items-center gap-1 hover:opacity-90 transition-opacity shrink-0">
            <span class="material-symbols-outlined text-lg" aria-hidden="true">add</span>
          </button>
        </div>
        <div id="name-suggestions" class="mb-4"></div>
      </div>

      <!-- Viewer label -->
      <div id="viewer-label" class="mb-4" style="display:none"></div>

      <!-- Player List -->
      <div id="player-list" class="flex flex-col gap-1"></div>

      <!-- Track Stats Toggle (host only, before first game) -->
      <div id="stats-toggle-section" class="mt-6" style="display:none">
        <div class="bg-surface-container-lowest border border-outline p-4 flex items-center justify-between">
          <div class="flex-1 mr-4">
            <p class="font-headline font-bold text-sm uppercase">Track Tonight's Stats</p>
            <p class="font-mono text-[10px] text-outline mt-0.5">See MVP, per-game breakdowns, and player highlights at the end of the night</p>
          </div>
          <button id="btn-stats-toggle" role="switch" aria-checked="false" aria-label="Track Tonight's Stats" class="w-12 h-7 border border-outline bg-surface-container-high transition-all relative shrink-0" data-on="false">
            <div class="absolute top-[2px] left-[2px] w-[22px] h-[22px] bg-outline transition-transform" aria-hidden="true"></div>
          </button>
        </div>
      </div>

      <!-- Start Game (host only) -->
      <div id="start-section" class="mt-4" style="display:none">
        <button id="btn-start-game" class="btn-primary flex items-center justify-center gap-2" disabled>
          CHOOSE GAME
          <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>
        </button>
        <p id="start-hint" class="font-mono text-[10px] text-outline text-center mt-2 uppercase">ADD AT LEAST 2 PLAYERS</p>
      </div>

      <!-- Call it a Night (host only, visible after at least 1 finished game, between games) -->
      <div id="call-night-section" class="mt-3" style="display:none">
        <button id="btn-call-night" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
          <span aria-hidden="true" class="material-symbols-outlined text-sm">bedtime</span>
          CALL IT A NIGHT
        </button>
        <p class="font-mono text-[10px] text-outline text-center mt-2 uppercase">LOCKS THE NIGHT AND SHOWS THE RECAP TO EVERYONE</p>
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
  // QR code
  container.querySelector('#btn-qr').addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    qrModal.show(url, roomCode);
  });

  // Copy link
  container.querySelector('#btn-copy').addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = container.querySelector('#btn-copy');
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY LINK'; }, 2000);
    }).catch(() => toast.show('Copy failed'));
  });

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

  // Call it a Night — host only, between games
  container.querySelector('#btn-call-night')?.addEventListener('click', async () => {
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
  });

  // Stats tracking toggle
  const statsToggle = container.querySelector('#btn-stats-toggle');
  if (statsToggle) {
    statsToggle.addEventListener('click', () => {
      const isOn = statsToggle.dataset.on === 'true';
      const newVal = !isOn;
      statsToggle.dataset.on = String(newVal);
      statsToggle.setAttribute('aria-checked', String(newVal));
      const dot = statsToggle.querySelector('div');
      if (newVal) {
        statsToggle.style.background = '#000';
        statsToggle.style.borderColor = '#000';
        dot.style.transform = 'translateX(20px)';
        dot.style.background = '#fff';
      } else {
        statsToggle.style.background = '';
        statsToggle.style.borderColor = '';
        dot.style.transform = 'translateX(0)';
        dot.style.background = '';
      }
      // Save to Firebase
      fb.updateRoomMeta(roomCode, { trackStats: newVal });
    });
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

  const count = Object.keys(players).length;
  const accentIndex = count % ACCENT_COLORS.length;

  try {
    const newPlayerId = await fb.addPlayer(roomCode, name, count, accentIndex);
    _savePlayerName(nameUpper);
    input.value = '';
    input.focus();
    _showSuggestions(container, roomCode);

    // If a game is in progress, add the player to that game too
    const meta = state.get('roomMeta') || {};
    if (meta.status === 'playing' && meta.activeGameId && newPlayerId) {
      const game = state.currentGame();
      if (game) {
        await fb.addPlayerToGame(roomCode, meta.activeGameId, newPlayerId, nameUpper, accentIndex, game.playerIds || []);
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
    const meta = data.meta || {};
    const players = data.players || {};
    const games = data.games || {};
    const trackStats = meta.trackStats !== false;
    const hasPlayedGames = Object.values(games).some((g) => g.rounds && Object.keys(g.rounds).length > 0);

    // Show/hide host controls
    container.querySelector('#host-controls').style.display = isHost ? 'block' : 'none';
    const viewerLabelEl = container.querySelector('#viewer-label');
    if (viewerLabelEl) {
      if (isHost) {
        viewerLabelEl.style.display = 'none';
      } else {
        viewerLabelEl.style.display = 'block';
        const isGameActive = meta.status === 'playing' && meta.activeGameId;
        const showRecap = trackStats && hasPlayedGames;
        viewerLabelEl.innerHTML = isGameActive
          ? `<div class="flex flex-col gap-3">
               <button id="btn-go-to-game" class="btn-primary w-full flex items-center justify-center gap-2">
                 GO TO GAME
                 <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>
               </button>
               ${showRecap ? `<button id="btn-spectator-recap" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
                 <span aria-hidden="true" class="material-symbols-outlined text-sm">bar_chart</span>
                 VIEW NIGHT RECAP
               </button>` : ''}
             </div>`
          : `<div class="bg-surface-container-high border border-outline p-4 text-center">
               <p class="font-mono text-[10px] uppercase tracking-widest text-outline">SPECTATOR MODE</p>
               <p class="font-body text-sm text-on-surface-variant mt-1">Waiting for the host to start a game...</p>
             </div>`;
        viewerLabelEl.querySelector('#btn-go-to-game')?.addEventListener('click', () => {
          router.navigate('dashboard', { roomCode });
        });
        viewerLabelEl.querySelector('#btn-spectator-recap')?.addEventListener('click', () => {
          router.navigate('recap', { roomCode });
        });
      }
    }
    container.querySelector('#start-section').style.display = isHost ? 'block' : 'none';

    // Current game card
    const gameCardEl = container.querySelector('#current-game-card');
    if (gameCardEl) {
      const activeGame = state.currentGame();
      const gameDef = activeGame ? getGame(activeGame.type) : null;
      if (gameDef && meta.status === 'playing') {
        gameCardEl.innerHTML = `
          <div class="bg-surface-container-lowest border border-outline p-6">
            <span class="font-mono text-[10px] text-outline tracking-widest uppercase block mb-3">${gameDef.minPlayers}–${gameDef.maxPlayers} PLAYERS / ${gameDef.winMode === 'highest_total' ? 'HIGHEST WINS' : 'LOWEST WINS'}</span>
            <h3 class="font-headline font-black text-3xl uppercase tracking-tighter mb-2">${escapeHTML(gameDef.label)}</h3>
            <p class="text-on-surface-variant text-sm leading-relaxed">${escapeHTML(gameDef.description)}</p>
          </div>
        `;
      } else {
        gameCardEl.innerHTML = '';
      }
    }

    // Render player list. Mid-game: Add is allowed (new player joins the
    // next game — the active game's playerIds/snapshot are frozen), but
    // Remove is still hidden per-row to protect active participants.
    const isPlaying = meta.status === 'playing';
    const addRow = container.querySelector('#add-player-row');
    if (addRow) addRow.style.display = isHost ? 'flex' : 'none';
    _renderPlayers(container, players, isHost, roomCode, isPlaying);
    _showSuggestions(container, roomCode);

    // Show stats toggle only for host, before first game
    const statsToggleSection = container.querySelector('#stats-toggle-section');
    if (statsToggleSection) {
      statsToggleSection.style.display = (isHost && !hasPlayedGames) ? 'block' : 'none';
      // Sync toggle state from Firebase
      const toggleBtn = container.querySelector('#btn-stats-toggle');
      if (toggleBtn && toggleBtn.dataset.on !== String(trackStats)) {
        toggleBtn.dataset.on = String(trackStats);
        toggleBtn.setAttribute('aria-checked', String(trackStats));
        const dot = toggleBtn.querySelector('div');
        if (trackStats) {
          toggleBtn.style.background = '#000';
          toggleBtn.style.borderColor = '#000';
          dot.style.transform = 'translateX(20px)';
          dot.style.background = '#fff';
        } else {
          toggleBtn.style.background = '';
          toggleBtn.style.borderColor = '';
          dot.style.transform = 'translateX(0)';
          dot.style.background = '';
        }
      }
    }

    // Show "Call it a Night" to host only, once at least one game has finished, while in lobby.
    // Gated on trackStats — without tracking there's no "night" to end.
    const callNightSection = container.querySelector('#call-night-section');
    if (callNightSection) {
      const hasFinishedGame = Object.values(games).some((g) => g.status === 'finished');
      const show = isHost && trackStats && hasFinishedGame && meta.status === 'lobby';
      callNightSection.style.display = show ? 'block' : 'none';
    }

    // Enable/disable start
    const activeCount = Object.values(players).filter((p) => p.isActive).length;
    const activeGame = state.currentGame();
    const isGameFinished = isPlaying && activeGame?.status === 'finished';

    const returnSection = container.querySelector('#return-game-section');
    if (returnSection) {
      if (isHost && isPlaying && !isGameFinished) {
        returnSection.style.display = 'flex';
        returnSection.innerHTML = `
          <button id="btn-return-game" class="btn-primary w-full flex items-center justify-center gap-2">
            GO TO GAME
            <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>
          </button>
          ${(trackStats && hasPlayedGames) ? `
          <button id="btn-host-playing-recap" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
            <span aria-hidden="true" class="material-symbols-outlined text-sm">bar_chart</span>
            VIEW NIGHT RECAP
          </button>` : ''}
        `;
        returnSection.querySelector('#btn-return-game')?.addEventListener('click', () => {
          router.navigate('dashboard');
        });
        returnSection.querySelector('#btn-host-playing-recap')?.addEventListener('click', () => {
          router.navigate('recap', { roomCode });
        });
      } else {
        returnSection.style.display = 'none';
      }
    }

    const finishedSection = container.querySelector('#finished-game-section');
    if (finishedSection) {
      if (isHost && isGameFinished) {
        finishedSection.style.display = 'flex';
        _renderFinishedGameActions(finishedSection, roomCode, activeGame, trackStats);
      } else {
        finishedSection.style.display = 'none';
      }
    }

    const startSection = container.querySelector('#start-section');
    const btn = container.querySelector('#btn-start-game');
    const hint = container.querySelector('#start-hint');
    if (startSection) startSection.style.display = (isHost && !isPlaying) ? 'block' : 'none';
    if (btn) {
      btn.disabled = activeCount < 2;
      hint.textContent = activeCount < 2 ? 'ADD AT LEAST 2 PLAYERS' : `${activeCount} PLAYERS READY`;
    }
  });
}

function _renderFinishedGameActions(el, roomCode, game, trackStats) {
  const gameModule = getGame(game.type);
  const secondaryBtn = 'w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors';

  el.innerHTML = `
    <button id="btn-replay" class="btn-primary w-full flex items-center justify-center gap-2">
      <span aria-hidden="true" class="material-symbols-outlined text-lg">loop</span>
      REPLAY ${escapeHTML(gameModule.label.toUpperCase())}
    </button>
    <button id="btn-start-new-game" class="${secondaryBtn}">
      <span aria-hidden="true" class="material-symbols-outlined text-sm">add</span>
      START NEW GAME
    </button>
    <button id="btn-back-to-game" class="${secondaryBtn}">
      <span aria-hidden="true" class="material-symbols-outlined text-sm">emoji_events</span>
      GO BACK TO GAME
    </button>
    ${trackStats ? `
    <button id="btn-view-recap" class="${secondaryBtn}">
      <span aria-hidden="true" class="material-symbols-outlined text-sm">bar_chart</span>
      VIEW NIGHT RECAP
    </button>
    <button id="btn-call-night-finished" class="${secondaryBtn}">
      <span aria-hidden="true" class="material-symbols-outlined text-sm">bedtime</span>
      CALL IT A NIGHT
    </button>
    ` : ''}
  `;

  el.querySelector('#btn-back-to-game')?.addEventListener('click', () => {
    router.navigate('winner', { roomCode });
  });

  el.querySelector('#btn-replay')?.addEventListener('click', async () => {
    const players = state.activePlayers();
    const playerIds = players.map((p) => p.id);
    const snapshot = {};
    players.forEach((p) => {
      snapshot[p.id] = { name: p.name, accentIndex: p.accentIndex, seatOrder: p.seatOrder };
    });
    try {
      await fb.createGame(roomCode, game.type, game.config, playerIds, snapshot);
      router.navigate('dashboard', { roomCode });
    } catch (e) {
      toast.show('Failed to start replay');
    }
  });

  el.querySelector('#btn-start-new-game')?.addEventListener('click', async () => {
    await fb.updateRoomMeta(roomCode, { status: 'lobby', activeGameId: null });
    router.navigate('game-select', { roomCode });
  });

  el.querySelector('#btn-view-recap')?.addEventListener('click', () => {
    router.navigate('recap', { roomCode });
  });

  el.querySelector('#btn-call-night-finished')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Call it a night? This locks the room and shows the recap to everyone.');
    if (!confirmed) return;
    try {
      await fb.endNight(roomCode);
    } catch (e) {
      toast.show('Failed to end night');
    }
  });
}

function _renderPlayers(container, players, isHost, roomCode, isPlaying = false) {
  const list = container.querySelector('#player-list');
  const sorted = Object.values(players).sort((a, b) => a.seatOrder - b.seatOrder);
  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="text-center py-12">
        <span aria-hidden="true" class="material-symbols-outlined text-4xl text-outline mb-2">group_add</span>
        <p class="font-body text-sm text-on-surface-variant">${isHost ? 'Add at least 2 players to start a game.<br>Names show up here in the order you add them.' : 'Waiting for the host to add players\u2026'}</p>
      </div>
    `;
    return;
  }

  list.innerHTML = sorted
    .map((p) => {
      const color = ACCENT_COLORS[p.accentIndex % ACCENT_COLORS.length];
      const inactive = !p.isActive ? 'opacity-40' : '';
      return `
        <div class="bg-surface-container-lowest border border-outline ${inactive} flex items-center">
          <div class="w-1.5 self-stretch" style="background:${color}"></div>
          <div class="flex-1 p-4 flex items-center gap-3">
            <div class="w-10 h-10 border border-outline flex items-center justify-center font-mono font-bold text-sm" style="border-top: 3px solid ${color}">
              ${escapeHTML(p.name.substring(0, 2))}
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-headline font-extrabold text-sm uppercase truncate">${escapeHTML(p.name)}</p>
              <p class="font-mono text-[10px] text-outline uppercase">${p.isActive ? 'ACTIVE' : 'INACTIVE'}</p>
            </div>
            ${isHost ? `
              <div class="flex gap-1">
                <button class="player-toggle p-1.5 hover:bg-surface-container-high transition-colors" data-id="${escapeHTML(p.id)}" data-active="${p.isActive}" title="${p.isActive ? 'Deactivate' : 'Activate'}" aria-label="${p.isActive ? 'Deactivate' : 'Activate'} ${escapeHTML(p.name)}">
                  <span aria-hidden="true" class="material-symbols-outlined text-sm">${p.isActive ? 'person_off' : 'person_add'}</span>
                </button>
                ${isPlaying ? '' : `
                <button class="player-remove p-1.5 hover:bg-surface-container-high transition-colors" data-id="${escapeHTML(p.id)}" title="Remove" aria-label="Remove ${escapeHTML(p.name)}">
                  <span aria-hidden="true" class="material-symbols-outlined text-sm text-error">close</span>
                </button>
                `}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  // Bind player action buttons
  if (isHost) {
    list.querySelectorAll('.player-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const isActive = btn.dataset.active === 'true';
        fb.updatePlayer(roomCode, id, { isActive: !isActive });
      });
    });

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

function _showSuggestions(container, roomCode) {
  const input = container.querySelector('#input-player-name');
  const suggestionsEl = container.querySelector('#name-suggestions');
  if (!input || !suggestionsEl) return;

  const existing = new Set(Object.values(state.get('players') || {}).map((p) => p.name));
  const matches = _getKnownNames().filter((n) => !existing.has(n)).slice(0, 4);

  if (matches.length === 0) {
    suggestionsEl.innerHTML = '';
    return;
  }

  suggestionsEl.innerHTML = `
    <span class="font-mono text-[10px] uppercase tracking-widest text-outline self-center mr-1">Quick add:</span>
    ${matches.map((n) => `
      <button class="suggestion-chip font-mono text-[10px] uppercase tracking-widest border border-outline px-2 py-1 hover:bg-surface-container-high transition-colors">
        ${escapeHTML(n)}
      </button>
    `).join('')}
  `;

  suggestionsEl.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      _addPlayer(container, roomCode);
    });
  });
}
