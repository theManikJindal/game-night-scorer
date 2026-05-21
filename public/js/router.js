// ═══════════════════════════════════════════
// Hash-based SPA Router
// ═══════════════════════════════════════════

const _screens = new Map();
let _currentId = null;
let _container = null;
let _direction = 'forward';
const _history = [];
let _lastRenderTime = 0;


export function registerScreen(id, { mount, unmount }) {
  _screens.set(id, { mount, unmount });
}

export function init(containerId) {
  _container = document.getElementById(containerId);
  window.addEventListener('hashchange', _onHashChange);
  _onHashChange();
}

export function navigate(screenId, params = {}, direction = 'forward') {
  _direction = direction;
  if (direction === 'forward' && _currentId) {
    _history.push(_currentId);
  }
  const hash = `#${screenId}`;
  if (window.location.hash === hash) {
    _renderScreen(screenId, params);
  } else {
    window._routeParams = params;
    window.location.hash = hash;
  }
}

export function back() {
  const prev = _history.pop();
  if (prev) {
    navigate(prev, {}, 'back');
  }
}

export function currentScreen() {
  return _currentId;
}

function _onHashChange() {
  const hash = window.location.hash.replace('#', '') || 'home';
  const params = window._routeParams || {};
  window._routeParams = null;
  _renderScreen(hash, params);
}

function _renderScreen(screenId, params = {}) {
  const screen = _screens.get(screenId);
  if (!screen) {
    console.warn(`Screen "${screenId}" not registered`);
    return;
  }

  // Debounce: skip if same screen rendered within 100ms (hashchange race)
  const now = Date.now();
  if (screenId === _currentId && now - _lastRenderTime < 100) return;
  _lastRenderTime = now;

  // Unmount current screen
  if (_currentId) {
    const currentScreen = _screens.get(_currentId);
    if (currentScreen && currentScreen.unmount) {
      currentScreen.unmount();
    }
  }

  // AGGRESSIVELY remove ALL existing screens from container
  // This prevents stacking from rapid navigation or Firebase re-renders
  const oldScreens = _container.querySelectorAll('.screen');
  oldScreens.forEach((el) => el.remove());

  // Mount new screen
  const el = document.createElement('div');
  el.className = 'screen active';

  // If bottom nav is hidden, ensure this screen doesn't have nav padding
  const nav = document.getElementById('bottom-nav');
  if (nav && nav.style.display === 'none') {
    el.classList.add('no-nav');
  }

  el.id = `screen-${screenId}`;
  _container.appendChild(el);

  _currentId = screenId;

  try {
    screen.mount(el, params);
  } catch (e) {
    console.error(`Screen "${screenId}" mount error:`, e);
  }

}
