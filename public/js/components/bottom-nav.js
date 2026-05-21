// ═══════════════════════════════════════════
// Bottom Navigation Bar
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';

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

let _activeTab = 'dashboard';

export function show(activeTab = 'dashboard') {
  const nav = document.getElementById('bottom-nav');
  nav.style.display = 'flex';

  // Remove no-nav from current active screen
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen) activeScreen.classList.remove('no-nav');

  _activeTab = activeTab;
  render();
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

export function getActive() {
  return _activeTab;
}

function render() {
  const nav = document.getElementById('bottom-nav');
  const tabs = state.isHost() ? TABS.host : TABS.viewer;

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
}
