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
  bottomNav.hide();
  const roomCode = params.roomCode || state.get('roomCode');

  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'SELECT GAME';
  document.getElementById('top-bar-back').classList.remove('hidden');
  document.getElementById('top-bar-back').onclick = () => router.navigate('lobby', { roomCode }, 'back');
  document.getElementById('top-bar-actions').innerHTML = '';

  _selectedGame = null;

  const players = state.activePlayers();
  const playerCount = players.length;
  const games = getAllGames();

  container.innerHTML = `
    <div class="p-6 pb-32">
      <div class="flex justify-between items-end mb-6">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-1">CHOOSE YOUR GAME</p>
          <h2 class="font-headline font-black text-2xl uppercase tracking-tight">What are we playing?</h2>
        </div>
        <span class="font-mono text-[10px] border border-outline px-2 py-1 uppercase">${playerCount} Players</span>
      </div>

      <!-- Game Cards -->
      <div class="flex flex-col gap-1 border-t border-l border-outline" id="game-cards">
        ${games.map((g) => {
          const compatible = playerCount >= g.minPlayers && playerCount <= g.maxPlayers;
          return `
            <button class="game-card w-full text-left bg-surface-container-lowest border border-outline p-6 transition-all ${compatible ? 'hover:bg-surface-container group' : 'opacity-40 cursor-not-allowed'}" data-id="${escapeHTML(g.id)}" ${!compatible ? 'disabled' : ''}>
              <div class="flex justify-between items-start mb-3">
                <span class="font-mono text-[10px] text-outline tracking-widest uppercase">${g.minPlayers}-${g.maxPlayers} PLAYERS / ${g.winMode === 'highest_total' ? 'HIGHEST WINS' : 'LOWEST WINS'}</span>
                <div class="game-check w-7 h-7 border-2 border-outline-variant flex items-center justify-center transition-all"></div>
              </div>
              <h3 class="font-headline font-black text-3xl uppercase tracking-tighter mb-2 group-hover:text-secondary transition-colors">${g.label}</h3>
              <p class="text-on-surface-variant text-sm leading-relaxed">${g.description}</p>
            </button>
          `;
        }).join('')}
      </div>

      <!-- Config Section (shown after selection) -->
      <div id="game-config" class="mt-6" style="display:none"></div>

      <!-- Start Button -->
      <div class="mt-8">
        <button id="btn-start" class="btn-primary flex items-center justify-center gap-2" disabled>
          SELECT A GAME
        </button>
      </div>
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

  // Update start button to show selected game name
  const startBtn = container.querySelector('#btn-start');
  if (_selectedGame) {
    const game = getGame(_selectedGame);
    startBtn.disabled = false;
    startBtn.innerHTML = `START ${game.label.toUpperCase()} <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_forward</span>`;
  } else {
    startBtn.disabled = true;
    startBtn.innerHTML = `SELECT A GAME`;
  }
}

function _renderConfig(container) {
  const configEl = container.querySelector('#game-config');
  if (!_selectedGame) {
    configEl.style.display = 'none';
    return;
  }

  const game = getGame(_selectedGame);
  if (!game || !game.configFields || game.configFields.length === 0) {
    configEl.style.display = 'none';
    return;
  }

  const playerCount = state.activePlayers().length;

  configEl.style.display = 'block';
  configEl.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline p-4">
      <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-4">GAME SETTINGS</p>
      ${game.configFields.map((f) => _renderConfigField(game, f, playerCount)).join('')}
    </div>
  `;
}

function _renderConfigField(game, f, playerCount) {
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
        <span id="config-desc-${f.key}" class="font-mono text-[9px] text-outline">MIN ${f.min || 1}</span>
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
  btn.innerHTML = '<div class="spinner mx-auto"></div>';

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
