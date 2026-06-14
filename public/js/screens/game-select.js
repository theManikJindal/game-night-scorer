// ═══════════════════════════════════════════
// Game Select Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';
import { escapeHTML } from "../utils.js";
import { getGame, getAllGames } from '../games/registry.js';

let _selectedGame = null;

export function mount(container, params = {}) {
  // Game select is a subscreen of the lobby — keep the bottom nav with Lobby active.
  bottomNav.show('lobby');
  const roomCode = params.roomCode || state.get('roomCode');

  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'SELECT GAME';
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.remove('hidden');
  backBtn.textContent = 'arrow_back';
  backBtn.setAttribute('aria-label', 'Go back');
  backBtn.onclick = () => router.navigate('lobby', { roomCode }, 'back');
  document.getElementById('top-bar-actions').innerHTML = '';
  document.getElementById('top-bar-role').innerHTML = '';
  // Game select is a focused subscreen — hide the header sound button here.
  document.getElementById('top-bar-sound').style.display = 'none';

  _selectedGame = null;

  const players = state.activePlayers();
  const playerCount = players.length;
  const games = getAllGames();

  container.innerHTML = `
    <div class="screen-body pb-32">
      <div class="flex justify-between items-end mb-6">
        <div>
          <p class="font-mono text-[0.625rem] uppercase tracking-widest text-outline mb-1">CHOOSE YOUR GAME</p>
          <h2 class="font-headline font-extrabold text-2xl uppercase tracking-tight">What are we playing?</h2>
        </div>
        <span class="font-mono text-[0.625rem] border border-outline px-2 py-1 uppercase">${playerCount} Players</span>
      </div>

      <!-- Game Cards -->
      <div class="flex flex-col gap-1 border-t border-l border-outline" id="game-cards">
        ${games.map((g) => {
          const compatible = playerCount >= g.minPlayers && playerCount <= g.maxPlayers;
          return `
            <div class="game-card-group" data-group-id="${escapeHTML(g.id)}">
              <button class="game-card w-full text-left bg-surface-container-lowest border border-outline p-6 transition-all ${compatible ? 'hover:bg-surface-container group' : 'opacity-40 cursor-not-allowed'}" data-id="${escapeHTML(g.id)}" ${!compatible ? 'disabled' : ''}>
                <div class="flex justify-between items-start mb-3">
                  <span class="font-mono text-[0.625rem] text-outline tracking-widest uppercase">${g.minPlayers}-${g.maxPlayers} PLAYERS / ${g.winMode === 'highest_total' ? 'HIGHEST WINS' : 'LOWEST WINS'}</span>
                  <div class="game-check w-7 h-7 border-2 border-outline-variant flex items-center justify-center transition-all"></div>
                </div>
                <h3 class="font-headline font-extrabold text-3xl uppercase tracking-tighter mb-2 group-hover:text-secondary transition-colors">${g.label}</h3>
                <p class="text-on-surface-variant text-sm leading-relaxed">${g.description}</p>
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Start Button (floats up from above the bottom nav on selection) -->
    <div id="btn-start-wrapper" class="docked-bar p-4 bg-surface-container-low translate-y-full transition-transform duration-300 ease-out">
      <button id="btn-start" class="btn-primary flex items-center justify-center gap-2 w-full">
        SELECT A GAME
      </button>
    </div>
  `;

  // Bind card clicks
  container.querySelectorAll('.game-card:not([disabled])').forEach((card) => {
    card.addEventListener('click', () => {
      _selectedGame = card.dataset.id;
      _renderSelection(container);
      _renderConfig(container);
    });
  });

  // Start game
  container.querySelector('#btn-start').addEventListener('click', () => _startGame(container, roomCode));
}

export function unmount() {
  _selectedGame = null;
}

function _renderSelection(container) {
  container.querySelectorAll('.game-card').forEach((card) => {
    const indicator = card.querySelector('.game-check');
    if (!indicator) return;
    const isSelected = card.dataset.id === _selectedGame;
    if (isSelected) {
      card.style.borderColor = '#000000';
      card.style.borderWidth = '2px';
      card.style.background = '#ffffff';
      card.style.borderLeft = '4px solid #000000';
      indicator.className = 'game-check w-7 h-7 bg-primary border-2 border-primary flex items-center justify-center transition-all';
      indicator.innerHTML = '<span aria-hidden="true" class="material-symbols-outlined text-white text-base">check</span>';
    } else {
      card.style.borderColor = '';
      card.style.borderWidth = '';
      card.style.background = '';
      card.style.borderLeft = '';
      indicator.className = 'game-check w-7 h-7 border-2 border-outline-variant flex items-center justify-center transition-all';
      indicator.innerHTML = '';
    }
  });

  const startWrapper = container.querySelector('#btn-start-wrapper');
  const startBtn = container.querySelector('#btn-start');
  if (_selectedGame) {
    const game = getGame(_selectedGame);
    startWrapper.classList.remove('translate-y-full');
    startWrapper.classList.add('translate-y-0');
    startBtn.disabled = false;
    startBtn.innerHTML = `START ${game.label.toUpperCase()} <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>`;
  } else {
    startWrapper.classList.remove('translate-y-0');
    startWrapper.classList.add('translate-y-full');
    startBtn.disabled = true;
    startBtn.innerHTML = `SELECT A GAME`;
  }
}

function _renderConfig(container) {
  // Remove any existing inline config panels
  container.querySelectorAll('.game-config-inline').forEach((el) => el.remove());

  if (!_selectedGame) return;

  const game = getGame(_selectedGame);
  if (!game || !game.configFields || game.configFields.length === 0) return;

  const playerCount = state.activePlayers().length;
  const group = container.querySelector(`.game-card-group[data-group-id="${_selectedGame}"]`);
  if (!group) return;

  const configDiv = document.createElement('div');
  configDiv.className = 'game-config-inline';
  configDiv.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline border-t-0 p-4">
      <p class="font-mono text-[0.625rem] uppercase tracking-widest text-outline mb-4">GAME SETTINGS</p>
      ${game.configFields.map((f) => _renderConfigField(game, f, playerCount)).join('')}
    </div>
  `;
  group.appendChild(configDiv);

  // Wire up toggle fields
  game.configFields.filter((f) => f.type === 'toggle').forEach((f) => {
    const btn = configDiv.querySelector(`#config-${f.key}`);
    const subfields = configDiv.querySelector(`#config-${f.key}-subfields`);
    if (!btn || !subfields) return;
    btn.addEventListener('click', () => {
      const isOn = btn.getAttribute('aria-checked') === 'true';
      const next = !isOn;
      btn.setAttribute('aria-checked', String(next));
      const thumb = btn.querySelector('.toggle-thumb');
      if (next) {
        btn.classList.remove('bg-surface-container-high', 'border-outline');
        btn.classList.add('bg-primary', 'border-primary');
        if (thumb) { thumb.classList.remove('bg-outline'); thumb.classList.add('bg-on-primary', 'translate-x-5'); }
        subfields.classList.remove('hidden');
      } else {
        btn.classList.remove('bg-primary', 'border-primary');
        btn.classList.add('bg-surface-container-high', 'border-outline');
        if (thumb) { thumb.classList.remove('bg-on-primary', 'translate-x-5'); thumb.classList.add('bg-outline'); }
        subfields.classList.add('hidden');
      }
    });
  });

  // Live-compute prize displays; buy-in changes also reset prize1/prize2 to their defaults
  const prize1El = configDiv.querySelector('#config-juaPrize1');
  const prize2El = configDiv.querySelector('#config-juaPrize2');
  const prize3El = configDiv.querySelector('#config-juaPrize3-display');
  const buyInEl = configDiv.querySelector('#config-juaBuyIn');

  const _updatePrize3 = () => {
    if (!prize3El) return;
    const buyIn = parseInt(buyInEl?.value) || 0;
    const prize1 = parseInt(prize1El?.value) || 0;
    const prize2 = parseInt(prize2El?.value) || 0;
    const prize3 = buyIn * playerCount - prize1 - prize2;
    prize3El.textContent = prize3;
    prize3El.style.color = prize3 < 0 ? '#dc2626' : '';
  };

  buyInEl?.addEventListener('input', () => {
    const buyIn = parseInt(buyInEl.value) || 0;
    const def = Math.ceil(buyIn * playerCount * 0.33);
    if (prize1El) prize1El.value = def;
    if (prize2El) prize2El.value = def;
    _updatePrize3();
  });

  [prize1El, prize2El].filter(Boolean).forEach((el) => el.addEventListener('input', _updatePrize3));
  _updatePrize3();
}

function _renderConfigField(game, f, playerCount) {
  if (f.type === 'toggle') {
    const subFieldsHtml = (f.subFields || []).map((sf) => {
      if (sf.type === 'computed') {
        return `
          <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <label class="font-headline font-bold text-xs uppercase text-outline">${escapeHTML(sf.label)}</label>
            <div class="flex items-center gap-1">
              ${sf.unit ? `<span class="font-mono text-lg text-outline">${escapeHTML(sf.unit)}</span>` : ''}
              <span id="config-${sf.key}-display" class="font-mono text-lg w-20 text-right text-outline">—</span>
            </div>
          </div>
        `;
      }
      return `
        <div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
          <label for="config-${sf.key}" class="font-headline font-bold text-xs uppercase">${escapeHTML(sf.label)}</label>
          <div class="flex items-center gap-1">
            ${sf.unit ? `<span class="font-mono text-lg text-outline">${escapeHTML(sf.unit)}</span>` : ''}
            <input
              type="number"
              id="config-${sf.key}"
              value="${sf.computeDefault ? sf.computeDefault(game.defaultConfig, playerCount) : (game.defaultConfig[sf.key] !== undefined ? game.defaultConfig[sf.key] : (sf.default || 0))}"
              min="${sf.min !== undefined ? sf.min : 1}"
              class="w-20 bg-transparent border-0 border-b-2 border-primary font-mono text-lg text-right py-1 px-0 focus:outline-none focus:border-secondary"
            >
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="py-3 border-b border-outline-variant last:border-0">
        <div class="flex items-center justify-between">
          <label class="font-headline font-bold text-sm uppercase">${escapeHTML(f.label)}</label>
          <button
            type="button"
            role="switch"
            id="config-${f.key}"
            aria-checked="${String(!!game.defaultConfig[f.key])}"
            class="w-12 h-7 border transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${game.defaultConfig[f.key] ? 'bg-primary border-primary' : 'bg-surface-container-high border-outline'}"
          ><span class="toggle-thumb absolute top-0.5 left-0.5 w-6 h-6 transition-all ${game.defaultConfig[f.key] ? 'bg-on-primary translate-x-5' : 'bg-outline'}"></span></button>
        </div>
        <div id="config-${f.key}-subfields" class="${game.defaultConfig[f.key] ? '' : 'hidden'} mt-3 pl-3 border-l-2 border-outline-variant">
          ${subFieldsHtml}
        </div>
      </div>
    `;
  }
  if (f.type === 'select') {
    // Cabo: default to 2 decks once player count exceeds the single-deck cap
    // so the form starts in a valid state for larger rooms.
    let defaultValue = game.defaultConfig[f.key];
    if (game.id === 'cabo' && f.key === 'deckCount' && playerCount > 5) {
      defaultValue = 2;
    }
    const optionsHtml = f.options.map((opt) => `
      <option value="${escapeHTML(String(opt.value))}" ${opt.value === defaultValue ? 'selected' : ''}>${escapeHTML(opt.label)}</option>
    `).join('');
    return `
      <div class="flex items-center justify-between py-3 border-b border-outline-variant last:border-0 gap-3">
        <label for="config-${f.key}" class="font-headline font-bold text-sm uppercase block">${escapeHTML(f.label)}</label>
        <select
          id="config-${f.key}"
          class="bg-transparent border-0 border-b-2 border-primary font-mono text-sm py-1 px-0 focus:outline-none focus:border-secondary"
        >${optionsHtml}</select>
      </div>
    `;
  }
  return `
    <div class="flex items-center justify-between py-3 border-b border-outline-variant last:border-0">
      <div>
        <label for="config-${f.key}" class="font-headline font-bold text-sm uppercase block">${f.label}</label>
        <span id="config-desc-${f.key}" class="font-mono text-[0.5625rem] text-outline">MIN ${f.min || 1}</span>
      </div>
      <input
        type="number"
        id="config-${f.key}"
        aria-describedby="config-desc-${f.key}"
        value="${game.defaultConfig[f.key]}"
        min="${f.min || 1}"
        class="w-20 bg-transparent border-0 border-b-2 border-primary font-mono text-lg text-right py-1 px-0 focus:outline-none focus:border-secondary"
      >
    </div>
  `;
}

async function _startGame(container, roomCode) {
  if (!_selectedGame) return;

  const game = getGame(_selectedGame);
  const players = state.activePlayers();
  const playerIds = players.map((p) => p.id);

  // Build config from form with validation. Reject invalid input up front with
  // a toast instead of silently falling back to defaults — otherwise the host
  // thinks they changed something and a game starts with unexpected settings.
  const config = { ...game.defaultConfig };
  const CONFIG_MAX = 9999;
  if (game.configFields) {
    for (const f of game.configFields) {
      if (f.type === 'toggle') {
        const toggleBtn = container.querySelector(`#config-${f.key}`);
        if (!toggleBtn) continue;
        const isOn = toggleBtn.getAttribute('aria-checked') === 'true';
        config[f.key] = isOn;
        if (isOn && f.subFields) {
          for (const sf of f.subFields) {
            const subInput = container.querySelector(`#config-${sf.key}`);
            if (!subInput) continue;
            const raw = subInput.value.trim();
            if (raw === '') continue;
            const parsed = Number(raw);
            const min = sf.min || 1;
            if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
              toast.show(`${sf.label} must be a whole number`);
              subInput.focus();
              return;
            }
            if (parsed < min) {
              toast.show(`${sf.label} must be at least ${min}`);
              subInput.focus();
              return;
            }
            if (parsed > CONFIG_MAX) {
              toast.show(`${sf.label} can't exceed ${CONFIG_MAX}`);
              subInput.focus();
              return;
            }
            config[sf.key] = parsed;
          }
        }
        continue;
      }
      const input = container.querySelector(`#config-${f.key}`);
      if (!input) continue;
      if (f.type === 'select') {
        config[f.key] = Number(input.value);
        continue;
      }
      const raw = input.value.trim();
      if (raw === '') continue; // empty = accept default
      const parsed = Number(raw);
      const min = f.min || 1;
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        toast.show(`${f.label} must be a whole number`);
        input.focus();
        return;
      }
      if (parsed < min) {
        toast.show(`${f.label} must be at least ${min}`);
        input.focus();
        return;
      }
      if (parsed > CONFIG_MAX) {
        toast.show(`${f.label} can't exceed ${CONFIG_MAX}`);
        input.focus();
        return;
      }
      config[f.key] = parsed;
    }
  }

  if (config.jua) {
    const totalPot = config.juaBuyIn * playerIds.length;
    if (config.juaPrize1 + config.juaPrize2 > totalPot) {
      toast.show(`1st and 2nd place prizes exceed the total pot (₹${totalPot})`);
      container.querySelector('#config-juaPrize1')?.focus();
      return;
    }
  }

  if (game.id === 'cabo' && config.deckCount === 1 && playerIds.length > 5) {
    toast.show('1 deck supports up to 5 players. Choose 2 decks for 6+.');
    const sel = container.querySelector('#config-deckCount');
    if (sel) sel.focus();
    return;
  }

  // Build player snapshot
  const snapshot = {};
  players.forEach((p) => {
    snapshot[p.id] = { name: p.name, accentIndex: p.accentIndex, seatOrder: p.seatOrder };
  });

  const btn = container.querySelector('#btn-start');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner mx-auto"></div><span class="sr-only">Loading...</span>';

  try {
    await fb.createGame(roomCode, _selectedGame, config, playerIds, snapshot);
    router.navigate('dashboard', { roomCode });
  } catch (e) {
    console.error('Start game failed:', e);
    toast.show('Failed to start game');
    btn.disabled = false;
    btn.innerHTML = 'START GAME <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>';
  }
}
