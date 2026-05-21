// ═══════════════════════════════════════════
// Winner Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import { getGame } from '../games/registry.js';
import { ACCENT_COLORS } from '../state.js';
import { show as toast } from '../components/toast.js';
import { escapeHTML } from '../utils.js';

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');

  bottomNav.hide();
  document.getElementById('top-bar').style.display = 'none';

  if (!roomCode) {
    router.navigate('home');
    return;
  }

  const game = state.currentGame();
  if (!game || !game.winner) {
    router.navigate('dashboard', { roomCode });
    return;
  }

  const gameModule = getGame(game.type);
  const snapshot = game.playerSnapshot || {};
  const totals = game.totals || {};
  const trackStats = state.get('roomMeta')?.trackStats || false;

  // Derive standings
  const standings = gameModule.deriveStandings(totals, game.playerIds);
  const winner = snapshot[game.winner] || {};
  const winnerTotal = totals[game.winner] || 0;
  const winnerColor = ACCENT_COLORS[winner.accentIndex || 0];

  container.innerHTML = `
    <div class="min-h-[100dvh] flex flex-col bg-primary text-on-primary">
      <!-- Hero -->
      <main class="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-8">
        <div class="text-center w-full max-w-sm mx-auto mb-12">
          <div class="flex items-center justify-center gap-2 mb-4">
            <span aria-hidden="true" class="material-symbols-outlined text-3xl" style="font-variation-settings: 'FILL' 1;">emoji_events</span>
            <span class="font-mono text-sm uppercase tracking-widest opacity-80">WINNER</span>
          </div>

          <h1 class="font-headline font-black text-[48px] uppercase tracking-tight leading-none mb-4 truncate">${escapeHTML(winner.name || 'UNKNOWN')}</h1>

          <div class="font-mono text-[72px] font-bold leading-none tracking-tighter">
            ${winnerTotal}
            <span class="text-2xl opacity-70 align-baseline">PTS</span>
          </div>
        </div>

        <!-- Standings -->
        <div class="w-full max-w-sm mx-auto space-y-3">
          ${standings.filter((s) => s.playerId !== game.winner).map((s) => {
            const p = snapshot[s.playerId] || {};
            return `
              <div class="flex justify-between items-center py-2 border-b border-white/20">
                <div class="flex items-center gap-3">
                  <span class="font-mono text-sm opacity-50 w-6 text-center">${s.rank}</span>
                  <span class="font-headline font-bold text-lg uppercase">${escapeHTML(p.name || s.playerId)}</span>
                </div>
                <span class="font-mono text-xl font-bold">${s.total}</span>
              </div>
            `;
          }).join('')}
        </div>
      </main>

      <!-- Actions (same buttons for host and spectators; taps are permission-gated) -->
      <footer class="p-6 space-y-3 shrink-0">
        <button id="btn-replay" class="w-full py-4 bg-surface-container-lowest text-primary font-headline font-extrabold uppercase tracking-widest text-base transition-colors hover:bg-surface-container-high">
          REPLAY ${gameModule.label.toUpperCase()}
        </button>
        <button id="btn-new-game" class="w-full py-4 border border-white/40 text-white font-headline font-extrabold uppercase tracking-widest text-base transition-colors hover:bg-white/10">
          CHOOSE NEW GAME
        </button>
        ${trackStats ? `
        <button id="btn-call-night" class="w-full py-4 border border-white/40 text-white font-headline font-extrabold uppercase tracking-widest text-base transition-colors hover:bg-white/10 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-lg" aria-hidden="true">bedtime</span>
          CALL IT A NIGHT
        </button>
        ` : ''}
      </footer>
    </div>
  `;

  const guardHost = (fn) => () => {
    if (!state.isHost()) {
      toast('Only the host can do that');
      return;
    }
    return fn();
  };

  container.querySelector('#btn-replay')?.addEventListener('click', guardHost(async () => {
    const players = state.activePlayers();
    const minPlayers = gameModule.minPlayers || 2;
    const maxPlayers = gameModule.maxPlayers || 20;
    if (players.length < minPlayers) {
      toast(`Need at least ${minPlayers} players to play ${gameModule.label}`);
      await fb.updateRoomMeta(roomCode, { status: 'lobby', activeGameId: null });
      router.navigate('lobby', { roomCode });
      return;
    }
    if (players.length > maxPlayers) {
      toast(`${gameModule.label} supports at most ${maxPlayers} players`);
      return;
    }
    const playerIds = players.map((p) => p.id);
    const snapshot = {};
    players.forEach((p) => {
      snapshot[p.id] = { name: p.name, accentIndex: p.accentIndex, seatOrder: p.seatOrder };
    });

    try {
      await fb.createGame(roomCode, game.type, game.config, playerIds, snapshot);
      router.navigate('dashboard', { roomCode });
    } catch (e) {
      console.error('Replay failed:', e);
    }
  }));

  container.querySelector('#btn-new-game')?.addEventListener('click', guardHost(async () => {
    await fb.updateRoomMeta(roomCode, { status: 'lobby', activeGameId: null });
    router.navigate(trackStats ? 'game-select' : 'lobby', { roomCode });
  }));

  container.querySelector('#btn-call-night')?.addEventListener('click', guardHost(async () => {
    await fb.endNight(roomCode);
  }));
}

export function unmount() {}
