// ═══════════════════════════════════════════
// Game Night Scorer — App Entry
// ═══��═══════════════════════════════════════

import { initFirebase } from './firebase.js';
import * as router from './router.js';
import * as fb from './firebase.js';
import * as state from './state.js';
import * as cache from './cache.js';

// ── Firebase Config ──
// Replace with your Firebase project config
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB5p1wV0pcpUgAQH2Zz4pjXiCRoOQeKc5U",
  authDomain: "game-night-scorer.firebaseapp.com",
  databaseURL: "https://game-night-scorer-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "game-night-scorer",
  storageBucket: "game-night-scorer.firebasestorage.app",
  messagingSenderId: "410138952060",
  appId: "1:410138952060:web:1c537946e06b30b474a4f9",
  measurementId: "G-CE2HYH3XS9"
};

// ── Screen Imports ──
import * as homeScreen from './screens/home.js';
import * as lobbyScreen from './screens/lobby.js';
import * as gameSelectScreen from './screens/game-select.js';
import * as dashboardScreen from './screens/dashboard.js';
import * as rulesScreen from './screens/rules.js';
import * as scoringScreen from './screens/scoring.js';
import * as winnerScreen from './screens/winner.js';
import * as recapScreen from './screens/recap.js';
import * as hostMenu from './components/host-menu.js';

// ── Init ──
async function init() {
  // Init Firebase
  initFirebase(FIREBASE_CONFIG);

  // Register screens
  router.registerScreen('home', homeScreen);
  router.registerScreen('lobby', lobbyScreen);
  router.registerScreen('game-select', gameSelectScreen);
  router.registerScreen('dashboard', dashboardScreen);
  router.registerScreen('rules', rulesScreen);
  router.registerScreen('scoring', scoringScreen);
  router.registerScreen('winner', winnerScreen);
  router.registerScreen('recap', recapScreen);

  // Init shared host menu
  hostMenu.init();

  // Pre-hydrate state from URL + cache BEFORE router fires its initial _onHashChange.
  // Without this, screens that read state.get('roomCode') on a hash-based refresh
  // (e.g. refreshing while on #lobby or #dashboard) would find state empty and bail.
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  const cached = roomCode ? cache.readCache(roomCode) : null;
  if (roomCode) {
    state.set('roomCode', roomCode);
    if (cached) {
      state.set('roomMeta', cached.meta || {});
      state.set('players', cached.players || {});
      state.set('games', cached.games || {});
    }
  }

  // Start router — _onHashChange fires here with state already populated
  router.init('screen-container');

  // Auto-navigate on night-ended / night-resumed status changes
  state.on('roomMeta', (newMeta, prevMeta) => {
    if (!newMeta) return;
    const screen = router.currentScreen();
    const roomCode = newMeta.roomCode || state.get('roomCode');
    if (!roomCode) return;

    if (newMeta.status === 'night-ended' && screen !== 'recap') {
      router.navigate('recap', { roomCode });
    } else if (prevMeta?.status === 'night-ended' && newMeta.status === 'lobby') {
      if (screen === 'recap') router.navigate('lobby', { roomCode });
    }
  });

  if (roomCode && fb.isConfigured()) {
    // If cache was available but hash isn't already pointing at a game screen, navigate now.
    const gameScreens = ['lobby', 'dashboard', 'rules', 'scoring', 'winner', 'recap', 'game-select'];
    const currentHash = window.location.hash.replace('#', '');
    if (cached && !gameScreens.includes(currentHash)) {
      router.navigate('lobby', { roomCode });
    }

    try {
      const code = await fb.joinRoom(roomCode);
      if (code) {
        if (!cached) router.navigate('lobby', { roomCode: code });
      } else if (cached) {
        cache.clearCache(roomCode);
        router.navigate('home');
      }
    } catch (e) {
      console.warn('Room from URL not found');
    }
  }

}

// Add shake keyframe for input validation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
`;
document.head.appendChild(style);

init();
