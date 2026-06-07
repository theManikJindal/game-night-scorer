// ═══════════════════════════════════════════
// Bottom Navigation Bar
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import { getGame } from '../games/registry.js';

const LOBBY_TAB = { id: 'lobby', icon: 'group', label: 'LOBBY' };

const TABS = {
  host: [
    { id: 'dashboard', icon: 'dashboard', label: 'DASHBOARD' },
    { id: 'rules', icon: 'menu_book', label: 'RULES' },
    { id: 'scoring', icon: 'calculate', label: 'SCORING' },
  ],
  viewer: [
    { id: 'dashboard', icon: 'dashboard', label: 'DASHBOARD' },
    { id: 'rules', icon: 'menu_book', label: 'RULES' },
  ],
};

// Flip 7 uses inline scoring and has no rules tab. The tab set is:
//   Lobby · <game> (while a game is in progress) · Recap (once stats exist).
function flip7Tabs(game) {
  const lobby = state.get('roomLobby') || {};
  const games = state.get('games') || {};
  const trackStats = lobby.trackStats !== false;
  const hasPlayedGames = Object.values(games).some((g) => g.rounds && Object.keys(g.rounds).length > 0);

  const tabs = [LOBBY_TAB];

  // The game tab is always labeled with the game's name (e.g. "FLIP 7"). While
  // in progress it opens the board; otherwise it opens the results (winner) so
  // a finished game stays reachable. Gate "in progress" on lobby.status, since
  // ending flips it back to 'waiting'. Once the night is called the game tab
  // drops entirely — only Lobby and Recap remain.
  if (game && lobby.status !== 'night-ended') {
    const gameLabel = (getGame(game.type)?.label || 'Game').toUpperCase();
    const inProgress = lobby.status === 'playing' && game.status === 'active';
    if (inProgress) {
      tabs.push({ id: 'dashboard', icon: 'dashboard', label: gameLabel });
    } else if (game.status === 'finished' && game.winner) {
      tabs.push({ id: 'winner', icon: 'dashboard', label: gameLabel });
    }
  }

  // Night recap appears once there's something to show (stats tracking on and
  // at least one game played).
  if (trackStats && hasPlayedGames) {
    tabs.push({ id: 'recap', icon: 'bar_chart', label: 'RECAP' });
  }

  return tabs;
}

let _activeTab = 'dashboard';

export function show(activeTab = 'dashboard') {
  const nav = document.getElementById('bottom-nav');
  nav.style.display = 'flex';

  // Remove no-nav from current active screen
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen) activeScreen.classList.remove('no-nav');

  _activeTab = activeTab;
  render();

  // Fonts can finish loading after the first render and grow the nav; remeasure
  // once they're ready so docked bars stay flush against the tabs.
  if (document.fonts?.ready) document.fonts.ready.then(_syncNavHeight);
}

// Publish the nav's real pixel height as --nav-height so the screen's bottom
// padding and any .docked-bar sit flush on top of the tabs (the old hardcoded
// 80px left a small gap, since the rendered nav is a few px shorter).
function _syncNavHeight() {
  const nav = document.getElementById('bottom-nav');
  if (!nav || nav.style.display === 'none') return;
  const h = nav.offsetHeight;
  if (h) document.documentElement.style.setProperty('--nav-height', `${h}px`);
}

export function hide() {
  const nav = document.getElementById('bottom-nav');
  nav.style.display = 'none';

  // Add no-nav to current active screen
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen) activeScreen.classList.add('no-nav');
}

export function setActive(tabId) {
  _activeTab = tabId;
  render();
}

/**
 * Re-render the nav (e.g. after game data loads so the tab set reflects the
 * current game type). No-op when the nav is hidden.
 */
export function refresh() {
  const nav = document.getElementById('bottom-nav');
  if (!nav || nav.style.display === 'none') return;
  render();
}

export function getActive() {
  return _activeTab;
}

function render() {
  const nav = document.getElementById('bottom-nav');
  const game = state.currentGame();
  const games = state.get('games') || {};

  // We're in the Flip 7 nav experience if a Flip 7 game is active OR one has
  // been played this night (so the Lobby/Recap tabs persist between games).
  const isFlip7Context = game?.type === 'flip7'
    || Object.values(games).some((g) => g.type === 'flip7');

  let tabs;
  if (isFlip7Context) {
    tabs = flip7Tabs(game);
  } else if (_activeTab === 'lobby') {
    tabs = [LOBBY_TAB];
  } else {
    tabs = state.isHost() ? TABS.host : TABS.viewer;
  }

  // Add ARIA attributes to indicate it is a tablist
  nav.setAttribute('role', 'tablist');

  nav.innerHTML = tabs
    .map(
      (tab) => `
    <button type="button" role="tab" aria-selected="${tab.id === _activeTab}" aria-controls="screen-container" id="tab-${tab.id}" class="nav-item ${tab.id === _activeTab ? 'active' : ''}" data-tab="${tab.id}">
      <span class="material-symbols-outlined" aria-hidden="true" ${tab.id === _activeTab ? 'style="font-variation-settings: \'FILL\' 1;"' : ''}>${tab.icon}</span>
      <span>${tab.label}</span>
    </button>
  `
    )
    .join('');

  // Direct routing on click — no state indirection
  nav.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = el.dataset.tab;
      if (tabId === _activeTab) return;
      _activeTab = tabId;
      render();
      const roomCode = state.get('roomCode');
      router.navigate(tabId, { roomCode });
    });
  });

  _syncNavHeight();
}
