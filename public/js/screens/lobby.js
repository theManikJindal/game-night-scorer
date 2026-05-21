// ═══════════════════════════════════════════
// Lobby Screen — Player Roster Management
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';
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
  document.getElementById('top-bar-back').classList.remove('hidden');
  document.getElementById('top-bar-back').onclick = () => {
    fb.unwatchRoom();
    router.navigate('home', {}, 'back');
  };
  document.getElementById('top-bar-actions').innerHTML = '';

  container.innerHTML = `
    <div class="p-6 pb-32">
      <!-- Room Code -->
      <div class="bg-surface-container-lowest border border-outline p-6 mb-6">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-2">ROOM PIN</p>
        <div class="flex items-center justify-between">
          <span class="font-mono text-3xl font-bold tracking-[0.3em]">${roomCode}</span>
          <button id="btn-copy" class="font-mono text-[10px] uppercase tracking-widest border border-outline px-3 py-2 hover:bg-surface-container-high transition-colors">
            COPY LINK
          </button>
        </div>
      </div>

      <!-- Host-only: Add Player -->
      <div id="host-controls" style="display:none">
        <h2 class="font-headline font-extrabold uppercase text-sm tracking-widest mb-4">PLAYERS</h2>

        <!-- Always-visible inline add (hidden during playing — new players can't join mid-game) -->
        <div id="add-player-row" class="flex gap-2 mb-4">
          <label for="input-player-name" class="sr-only">Player name...</label>
          <input
            id="input-player-name"
            type="text"
            maxlength="12"
            placeholder="Player name..."
            autocomplete="off"
            autocorrect="off"
            autocapitalize="characters"
            class="flex-1 bg-surface-container-lowest border border-outline font-headline font-bold text-sm uppercase py-3 px-4 placeholder:text-outline placeholder:normal-case placeholder:font-normal focus:outline-none focus:border-primary transition-colors"
          >
          <button id="btn-confirm-add" aria-label="Add player" title="Add player" class="bg-primary text-on-primary px-4 font-headline font-bold text-sm uppercase tracking-widest flex items-center gap-1 hover:opacity-90 transition-opacity shrink-0">
            <span class="material-symbols-outlined text-lg" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      <!-- Viewer label -->
      <div id="viewer-label" class="mb-4" style="display:none">
        <div class="bg-surface-container-high border border-outline p-4 text-center">
          <p class="font-mono text-[10px] uppercase tracking-widest text-outline">SPECTATOR MODE</p>
          <p class="font-body text-sm text-on-surface-variant mt-1">Waiting for the host to start a game...</p>
        </div>
      </div>

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

      <!-- Night Recap (visible after at least 1 game, only if tracking) -->
      <div id="recap-section" class="mt-6" style="display:none">
        <button id="btn-recap" class="w-full bg-surface-container-lowest border border-outline py-3 font-headline font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
          <span aria-hidden="true" class="material-symbols-outlined text-sm">bar_chart</span>
          NIGHT RECAP
        </button>
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
  container.querySelector('#input-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _addPlayer(container, roomCode);
  });

  // Start game
  container.querySelector('#btn-start-game')?.addEventListener('click', () => {
    const meta = state.get('roomMeta');
    if (meta?.activeGameId && meta?.status === 'playing') {
      router.navigate('dashboard');
    } else {
      router.navigate('game-select', { roomCode });
    }
  });

  // Night recap
  container.querySelector('#btn-recap')?.addEventListener('click', () => {
    router.navigate('recap', { roomCode });
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
    input.value = '';
    input.focus();

    // If no host player set yet, prompt the host to identify themselves
    const meta = state.get('roomMeta') || {};
    if (!meta.hostPlayerId && newPlayerId) {
      _showHostPrompt(container, roomCode, newPlayerId, nameUpper);
    }
  } catch (e) {
    toast.show('Failed to add player');
  }
}

function _showHostPrompt(container, roomCode, playerId, playerName) {
  // Remove any existing prompt
  const existing = container.querySelector('#host-prompt');
  if (existing) existing.remove();

  const playerList = container.querySelector('#player-list');
  if (!playerList) return;

  const prompt = document.createElement('div');
  prompt.id = 'host-prompt';
  prompt.className = 'bg-primary text-on-primary border border-outline p-4 mb-2';
  prompt.innerHTML = `
    <p class="font-headline font-bold text-sm uppercase mb-3">Are you ${escapeHTML(playerName)}?</p>
    <div class="flex gap-2">
      <button id="host-prompt-yes" class="flex-1 py-2 bg-surface-container-lowest text-primary font-headline font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors">
        YES, THAT'S ME
      </button>
      <button id="host-prompt-no" class="flex-1 py-2 border border-white/40 text-white font-headline font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-colors">
        NO
      </button>
    </div>
  `;

  playerList.insertAdjacentElement('beforebegin', prompt);

  prompt.querySelector('#host-prompt-yes').addEventListener('click', async () => {
    await fb.updateRoomMeta(roomCode, { hostPlayerId: playerId });
    toast.show('You are set as the host player');
    prompt.remove();
  });

  prompt.querySelector('#host-prompt-no').addEventListener('click', () => {
    prompt.remove();
  });
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

    // Show/hide host controls
    container.querySelector('#host-controls').style.display = isHost ? 'block' : 'none';
    container.querySelector('#viewer-label').style.display = isHost ? 'none' : 'block';
    container.querySelector('#start-section').style.display = isHost ? 'block' : 'none';

    // If game is active and viewer just joined, go to dashboard
    if (!isHost && meta.status === 'playing' && meta.activeGameId) {
      router.navigate('dashboard', { roomCode });
      return;
    }

    // Render player list (mid-game: hide Add + Remove; Deactivate toggle still available)
    const isPlaying = meta.status === 'playing';
    const addRow = container.querySelector('#add-player-row');
    if (addRow) addRow.style.display = (isHost && !isPlaying) ? 'flex' : 'none';
    _renderPlayers(container, players, isHost, roomCode, isPlaying);

    // Remove host prompt if host player has been set
    if (meta.hostPlayerId) {
      const hostPrompt = container.querySelector('#host-prompt');
      if (hostPrompt) hostPrompt.remove();
    }

    // Stats tracking
    const trackStats = meta.trackStats || false;
    const games = data.games || {};
    const hasPlayedGames = Object.values(games).some((g) => g.rounds && Object.keys(g.rounds).length > 0);

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

    // Show recap only if tracking is on and games have been played
    const recapSection = container.querySelector('#recap-section');
    if (recapSection) recapSection.style.display = (trackStats && hasPlayedGames) ? 'block' : 'none';

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
    const btn = container.querySelector('#btn-start-game');
    const hint = container.querySelector('#start-hint');
    if (btn) {
      btn.disabled = activeCount < 2;
      if (meta.status === 'playing') {
        btn.textContent = 'RETURN TO GAME';
        btn.querySelector('.material-symbols-outlined')?.remove();
        btn.disabled = false;
        hint.textContent = '';
      } else if (meta.status === 'lobby') {
        btn.innerHTML = 'CHOOSE GAME <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>';
        btn.disabled = activeCount < 2;
        hint.textContent = activeCount < 2 ? 'ADD AT LEAST 2 PLAYERS' : `${activeCount} PLAYERS READY`;
      } else {
        hint.textContent = activeCount < 2 ? 'ADD AT LEAST 2 PLAYERS' : `${activeCount} PLAYERS READY`;
      }
    }
  });
}

function _renderPlayers(container, players, isHost, roomCode, isPlaying = false) {
  const list = container.querySelector('#player-list');
  const sorted = Object.values(players).sort((a, b) => a.seatOrder - b.seatOrder);
  const meta = state.get('roomMeta') || {};
  const hostPlayerId = meta.hostPlayerId || null;

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
      const isHostPlayer = hostPlayerId === p.id;
      return `
        <div class="bg-surface-container-lowest border border-outline ${inactive} flex items-center">
          <div class="w-1.5 self-stretch" style="background:${color}"></div>
          <div class="flex-1 p-4 flex items-center gap-3">
            <div class="w-10 h-10 border border-outline flex items-center justify-center font-mono font-bold text-sm" style="border-top: 3px solid ${color}">
              ${escapeHTML(p.name.substring(0, 2))}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-headline font-extrabold text-sm uppercase truncate">${escapeHTML(p.name)}</p>
                ${isHostPlayer ? '<span class="font-mono text-[8px] bg-primary text-on-primary px-1.5 py-0.5 uppercase tracking-widest shrink-0">HOST</span>' : ''}
              </div>
              <p class="font-mono text-[10px] text-outline uppercase">${p.isActive ? 'ACTIVE' : 'INACTIVE'}</p>
            </div>
            ${isHost ? `
              <div class="flex gap-1">
                <button class="player-set-host p-1.5 hover:bg-surface-container-high transition-colors ${isHostPlayer ? 'opacity-30' : ''}" data-id="${escapeHTML(p.id)}" title="Set as host player" aria-label="Set ${escapeHTML(p.name)} as host player">
                  <span aria-hidden="true" class="material-symbols-outlined text-sm">${isHostPlayer ? 'shield_person' : 'person'}</span>
                </button>
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

  // Show hint if no host player selected yet and there are players
  if (isHost && !hostPlayerId && sorted.length > 0) {
    list.insertAdjacentHTML('beforeend', `
      <p class="font-mono text-[10px] text-outline text-center mt-2 uppercase">
        <span aria-hidden="true" class="material-symbols-outlined text-[10px] align-middle">info</span>
        TAP THE PERSON ICON TO MARK HOST PLAYER
      </p>
    `);
  }

  // Bind player action buttons
  if (isHost) {
    list.querySelectorAll('.player-set-host').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        fb.updateRoomMeta(roomCode, { hostPlayerId: id });
        toast.show('Host player set');
      });
    });

    list.querySelectorAll('.player-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const meta = state.get('roomMeta') || {};
        if (id === meta.hostPlayerId) {
          toast.show('Cannot deactivate host player');
          return;
        }
        const isActive = btn.dataset.active === 'true';
        fb.updatePlayer(roomCode, id, { isActive: !isActive });
      });
    });

    list.querySelectorAll('.player-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const meta = state.get('roomMeta') || {};
        if (id === meta.hostPlayerId) {
          toast.show('Cannot remove host player');
          return;
        }
        fb.removePlayer(roomCode, id);
      });
    });
  }
}
