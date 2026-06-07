// ═══════════════════════════════════════════
// Winner Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import * as confetti from '../components/confetti.js';
import { getGame } from '../games/registry.js';
import { buildSingleGameTables, wireSingleGameTables, winnerNamesHTML } from './single-game-tables.js';

// Tracks which game's winner we've already auto-celebrated, so returning to the
// winner tab for the same game doesn't re-fire the confetti.
let _celebratedGameId = null;
let _unsubLobby = null;
let _unsubGames = null;

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');

  if (!roomCode) {
    bottomNav.hide();
    document.getElementById('top-bar').style.display = 'none';
    router.navigate('home');
    return;
  }

  const game = state.currentGame();
  if (!game || !game.winner) {
    router.navigate('dashboard', { roomCode });
    return;
  }

  // Winner is part of the Flip 7 tabbed flow: show the header + bottom nav so
  // it stays reachable (and navigable) after a game finishes.
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'Flip 7';
  // No back button — winner is a bottom-nav tab, navigable like the other tabs.
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.add('hidden');
  backBtn.onclick = null;
  hostMenu.renderTopBarActions(roomCode);
  bottomNav.show('winner');

  const snapshot = game.playerSnapshot || {};
  const juaOn = !!(game.config?.jua);

  // A Flip 7 game can finish tied at the top (checkEnd just records leaders[0]
  // as game.winner, leaving the result for this screen to surface). Show *all*
  // the rank-1 players — the same tied-winner layout the Recap hero uses.
  const standings = getGame(game.type).deriveStandings(game.totals || {}, game.playerIds || []);
  const winnerIds = standings.filter((s) => s.rank === 1).map((s) => s.playerId);
  // Fall back to the stored single winner if standings can't be derived.
  const ids = winnerIds.length ? winnerIds : (game.winner ? [game.winner] : []);
  const winnerNames = ids.map((id) => snapshot[id]?.name || 'UNKNOWN');
  const plural = winnerNames.length > 1;

  // Scores/Winnings tables for this game. The prior-winnings tiebreak excludes
  // the shown (active) game so a player's own current result never sorts itself.
  const activeId = state.get('roomLobby')?.activeGameId || null;
  const priorGames = Object.entries(state.get('games') || {})
    .filter(([id]) => id !== activeId)
    .map(([, g]) => g);
  const tables = buildSingleGameTables(game, priorGames);

  container.innerHTML = `
    <div class="h-full flex flex-col bg-background text-on-surface">
      <!-- Hero -->
      <main class="screen-body flex-1 flex flex-col items-center overflow-y-auto min-h-0 ${juaOn ? 'pb-28' : 'pb-8'}">
        <div id="hero-section" role="button" tabindex="0" aria-label="Celebrate again" title="Tap to celebrate again" class="text-center w-full max-w-sm mx-auto mb-12 cursor-pointer select-none">
          <div class="flex items-center justify-center gap-2 ${plural ? 'mb-8' : 'mb-4'}">
            <span aria-hidden="true" class="material-symbols-outlined text-[2.5rem]" style="font-variation-settings: 'FILL' 1;">emoji_events</span>
            <span class="font-headline text-xl uppercase tracking-widest opacity-80">${plural ? 'WINNERS' : 'WINNER'}</span>
          </div>

          ${winnerNamesHTML(winnerNames)}
        </div>

        <!-- Standings -->
        <div class="w-full max-w-sm mx-auto">
          ${tables.scoresTableHTML}${tables.winningsTableHTML}${tables.tieCardHTML}
        </div>

      </main>

      ${juaOn ? `
      <!-- Docked view switcher: Scores / Winnings (sits flush above the bottom nav) -->
      <div class="docked-bar p-4 bg-surface-container-low">
        <div role="tablist" aria-label="View" class="flex border border-outline">
          <button id="seg-scores" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Scores</button>
          <button id="seg-winnings" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Winnings</button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  const segScores = container.querySelector('#seg-scores');
  const segWinnings = container.querySelector('#seg-winnings');

  const _applyView = (showWinnings) => {
    if (segScores && segWinnings) {
      const active = 'bg-primary text-on-primary';
      segScores.className = `flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors ${showWinnings ? '' : active}`;
      segWinnings.className = `flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors ${showWinnings ? active : ''}`;
      segScores.setAttribute('aria-selected', String(!showWinnings));
      segWinnings.setAttribute('aria-selected', String(showWinnings));
    }
    // Hero (trophy + winner name) stays visible on both Scores and Winnings tabs.
    const scoresView = container.querySelector('#scores-view');
    if (scoresView) scoresView.style.display = showWinnings ? 'none' : '';
    const winningsView = container.querySelector('#winnings-view');
    if (winningsView) winningsView.style.display = showWinnings ? '' : 'none';
    const tieCard = container.querySelector('#tie-card');
    if (tieCard) tieCard.style.display = showWinnings ? 'block' : 'none';
  };

  const activeGameId = state.get('roomLobby')?.activeGameId || null;

  // Winnings breakdowns: each player's winnings cell can swap its amount for the
  // breakdown text. Tapping a cell toggles just that player, in place.
  wireSingleGameTables(container);

  // The Scores/Winnings choice is remembered per game, so it survives tab
  // navigation but resets to Scores once a new game ends (the activeGameId
  // changes). Older string-only values fail the parse and fall back to Scores.
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('gns_winner_view')); } catch { /* legacy/invalid */ }

  let showWinnings = juaOn && stored?.gameId === activeGameId && stored?.view === 'winnings';
  _applyView(showWinnings);

  const _setView = (next) => {
    showWinnings = next;
    localStorage.setItem('gns_winner_view', JSON.stringify({
      gameId: activeGameId,
      view: showWinnings ? 'winnings' : 'scores',
    }));
    _applyView(showWinnings);
  };
  segScores?.addEventListener('click', () => _setView(false));
  segWinnings?.addEventListener('click', () => _setView(true));

  // Tapping the hero (trophy, "WINNER" label, or winner name) retriggers the rain.
  const hero = container.querySelector('#hero-section');
  if (hero) {
    hero.addEventListener('click', () => confetti.startRain());
    hero.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confetti.startRain(); }
    });
  }

  // Auto-celebrate the first time a game's winner is revealed — but not when
  // simply returning to the winner tab for the same game. The rain isn't tied to
  // this screen: it keeps falling even if you navigate away mid-celebration.
  if (_celebratedGameId !== activeGameId) {
    _celebratedGameId = activeGameId;
    confetti.startRain();
  }

  // When the host starts a new game while this screen is open, navigate everyone
  // to the dashboard so they land on the live board automatically.
  const shownGameId = game.gameId;
  const _checkNewGame = () => {
    const lobby = state.get('roomLobby') || {};
    if (lobby.activeGameId && lobby.activeGameId !== shownGameId) {
      const newGame = state.currentGame();
      if (newGame?.status === 'active') {
        router.navigate('dashboard', { roomCode });
      }
    }
  };
  _unsubLobby = state.on('roomLobby', _checkNewGame);
  _unsubGames = state.on('games', _checkNewGame);
}

export function unmount() {
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_unsubGames) { _unsubGames(); _unsubGames = null; }
}
