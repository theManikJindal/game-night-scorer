// ═══════════════════════════════════════════
// Night Recap Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as toast from '../components/toast.js';
import { computeNightStats } from '../stats.js';
import { ACCENT_COLORS } from '../state.js';
import { escapeHTML } from '../utils.js';

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');
  const meta = state.get('roomMeta') || {};
  const locked = meta.status === 'night-ended';
  const isHost = state.isHost();

  bottomNav.hide();
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = locked ? 'NIGHT LOCKED' : 'NIGHT RECAP';

  const backBtn = document.getElementById('top-bar-back');
  if (locked) {
    backBtn.classList.add('hidden');
  } else {
    backBtn.classList.remove('hidden');
    backBtn.onclick = () => router.navigate('lobby', { roomCode }, 'back');
  }
  document.getElementById('top-bar-actions').innerHTML = locked
    ? `<span class="font-mono text-[10px] text-outline border border-outline px-2 py-1 flex items-center gap-1"><span aria-hidden="true" class="material-symbols-outlined text-[12px]">lock</span>LOCKED</span>`
    : '';

  if (!roomCode) {
    router.navigate('home');
    return;
  }
  const games = state.get('games') || {};
  const players = state.get('players') || {};
  const stats = computeNightStats(games, players);

  if (!stats) {
    const trackOn = !!meta.trackStats;
    container.innerHTML = `
      <div class="p-6 text-center py-20">
        <span class="material-symbols-outlined text-5xl text-outline mb-4" aria-hidden="true">bar_chart</span>
        <p class="font-headline font-bold text-lg uppercase mb-2">No Stats Yet</p>
        <p class="font-body text-sm text-on-surface-variant max-w-xs mx-auto">${
          trackOn
            ? 'Play at least one game and the MVP, per-game breakdowns, and player highlights will show up here.'
            : 'Turn on <span class="font-bold">Track Tonight\u2019s Stats</span> in the Lobby and play at least one game to see MVP, per-game breakdowns, and highlights here.'
        }</p>
      </div>
    `;
    if (locked && isHost) {
      _renderStartNewNightFooter(container, roomCode);
    }
    return;
  }

  let html = '<div class="p-6 pb-12">';

  // ── Night Overview Header ──
  html += `
    <section class="border-l-4 border-primary pl-6 mb-8">
      <h2 class="text-3xl font-headline font-black uppercase tracking-tight leading-[0.9] mb-2">NIGHT<br>RECAP</h2>
      <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-outline">${stats.totalGames} GAME${stats.totalGames > 1 ? 'S' : ''} / ${stats.totalRounds} ROUNDS</p>
    </section>
  `;

  // ── MVP Banner ──
  if (stats.mvpId) {
    const mvp = stats.overall.find((p) => p.playerId === stats.mvpId);
    if (mvp) {
      const color = ACCENT_COLORS[mvp.accentIndex % ACCENT_COLORS.length];
      html += `
        <div class="bg-primary text-on-primary p-6 mb-8">
          <div class="flex items-center gap-2 mb-2">
            <span aria-hidden="true" class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">emoji_events</span>
            <span class="font-mono text-[10px] uppercase tracking-widest opacity-80">MOST VALUABLE PLAYER</span>
          </div>
          <h3 class="font-headline font-black text-3xl uppercase tracking-tight">${escapeHTML(mvp.name)}</h3>
          <p class="font-mono text-sm opacity-80 mt-1">${mvp.gamesWon} WIN${mvp.gamesWon > 1 ? 'S' : ''} / ${mvp.gamesPlayed} GAME${mvp.gamesPlayed > 1 ? 'S' : ''}</p>
        </div>
      `;
    }
  }

  // ── Overall Player Stats ──
  html += `
    <section class="mb-10">
      <h3 class="font-headline font-extrabold uppercase text-sm tracking-widest mb-4 flex items-center gap-2">
        <span aria-hidden="true" class="material-symbols-outlined text-sm">leaderboard</span>
        OVERALL STANDINGS
      </h3>
      <div class="border border-outline overflow-hidden">
        <div class="grid grid-cols-12 bg-surface-container-high border-b border-outline px-4 py-2">
          <div class="col-span-5 font-mono text-[10px] uppercase tracking-widest text-outline">PLAYER</div>
          <div class="col-span-2 font-mono text-[10px] uppercase tracking-widest text-outline text-center">PLAYED</div>
          <div class="col-span-2 font-mono text-[10px] uppercase tracking-widest text-outline text-center">WON</div>
          <div class="col-span-3 font-mono text-[10px] uppercase tracking-widest text-outline text-right">BEST</div>
        </div>
        ${stats.overall.map((p, i) => {
          const color = ACCENT_COLORS[p.accentIndex % ACCENT_COLORS.length];
          const bgClass = i % 2 === 0 ? 'bg-surface-container-lowest' : '';
          return `
            <div class="grid grid-cols-12 items-center px-4 py-3 border-b border-outline-variant last:border-0 ${bgClass}">
              <div class="col-span-5 flex items-center gap-2">
                <div class="w-1 h-6" style="background:${color}"></div>
                <span class="font-headline font-bold text-xs uppercase truncate">${escapeHTML(p.name)}</span>
                ${stats.mvpId === p.playerId ? '<span class="font-mono text-[7px] bg-primary text-on-primary px-1 py-0.5 uppercase">MVP</span>' : ''}
              </div>
              <div class="col-span-2 font-mono text-sm text-center">${p.gamesPlayed}</div>
              <div class="col-span-2 font-mono text-sm text-center font-bold ${p.gamesWon > 0 ? 'text-secondary' : ''}">${p.gamesWon}</div>
              <div class="col-span-3 font-mono text-sm text-right">${p.bestFinish === Infinity ? '-' : _ordinal(p.bestFinish)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;

  // ── Per-Game Breakdowns ──
  stats.perGame.forEach((game, gi) => {
    html += `
      <section class="mb-10">
        <div class="flex items-start gap-3 mb-4">
          <span class="font-mono text-sm text-outline border border-outline px-2 py-1">${String(gi + 1).padStart(2, '0')}</span>
          <div>
            <h3 class="text-xl font-headline font-bold uppercase tracking-tight">${game.label}</h3>
            <p class="font-mono text-[10px] text-outline uppercase">${game.roundCount} ROUNDS</p>
          </div>
        </div>
    `;

    // Winner or abandoned callout
    if (game.winner && game.snapshot[game.winner]) {
      const w = game.snapshot[game.winner];
      html += `
        <div class="bg-surface-container-high border border-outline p-3 mb-3 flex items-center gap-3">
          <span aria-hidden="true" class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">emoji_events</span>
          <span class="font-headline font-bold text-sm uppercase">${escapeHTML(w.name)}</span>
          <span class="font-mono text-[10px] text-outline ml-auto">WINNER</span>
        </div>
      `;
    } else if (game.isAbandoned) {
      html += `
        <div class="bg-surface-container-high border border-outline-variant p-3 mb-3 flex items-center gap-3">
          <span aria-hidden="true" class="material-symbols-outlined text-sm text-outline">cancel</span>
          <span class="font-headline font-bold text-sm uppercase text-outline">INCONCLUSIVE</span>
          <span class="font-mono text-[10px] text-outline ml-auto">NO WINNER</span>
        </div>
      `;
    }

    // Player stats for this game
    const playerStatList = Object.values(game.playerStats || {}).sort((a, b) => a.finalRank - b.finalRank);

    playerStatList.forEach((ps) => {
      const color = ACCENT_COLORS[ps.accentIndex % ACCENT_COLORS.length];
      html += `
        <div class="bg-surface-container-lowest border border-outline mb-1">
          <div class="h-[2px]" style="background:${color}"></div>
          <div class="p-4">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="font-headline font-extrabold text-sm uppercase">${escapeHTML(ps.name)}</span>
                <span class="font-mono text-[10px] text-outline">${_ordinal(ps.finalRank)}</span>
              </div>
              <span class="font-mono text-lg font-bold ${ps.isWinner ? 'text-secondary' : ''}">${ps.totalScore}</span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1">
      `;

      // Game-specific stat pills
      if (game.type === 'flip7') {
        html += _statPill('BEST RD', '+' + ps.bestRound);
        html += _statPill('WORST RD', '+' + ps.worstRound);
        if (ps.f7Bonuses > 0) html += _statPill('F7 BONUS', 'x' + ps.f7Bonuses, true);
      } else if (game.type === 'papayoo') {
        html += _statPill('BEST RD', ps.bestRound);
        html += _statPill('WORST RD', ps.worstRound);
        if (ps.zeroRounds > 0) html += _statPill('CLEAN RDS', ps.zeroRounds, true);
        if (ps.heavy40Rounds > 0) html += _statPill('40+ RDS', ps.heavy40Rounds);
      } else if (game.type === 'cabo') {
        html += _statPill('BEST RD', ps.bestRound);
        html += _statPill('WORST RD', ps.worstRound);
        if (ps.caboCalls > 0) html += _statPill('CABO CALLS', ps.caboCalls);
        if (ps.successfulCabos > 0) html += _statPill('GOOD CABOS', ps.successfulCabos, true);
        if (ps.kamikazeAttempts > 0) html += _statPill('KAMIKAZE', ps.kamikazeAttempts, true);
        if (ps.exact100Resets > 0) html += _statPill('100 RESETS', ps.exact100Resets);
      }

      html += `
            </div>
          </div>
        </div>
      `;
    });

    html += `</section>`;
  });

  // ── Footer Button ──
  if (locked) {
    if (isHost) {
      html += `
        <div class="mt-8 space-y-3">
          <button id="btn-start-new-night" class="btn-primary w-full flex items-center justify-center gap-2">
            <span aria-hidden="true" class="material-symbols-outlined text-lg">restart_alt</span>
            START NEW NIGHT
          </button>
          <p class="font-mono text-[10px] text-outline text-center uppercase">KEEPS PLAYERS, CLEARS GAMES, UNLOCKS THE ROOM</p>
        </div>
      `;
    } else {
      html += `
        <div class="mt-8 text-center">
          <p class="font-mono text-[10px] text-outline uppercase">Night locked by host</p>
        </div>
      `;
    }
  } else {
    html += `
      <div class="mt-8">
        <button id="btn-back-lobby" class="btn-secondary w-full flex items-center justify-center gap-2">
          <span aria-hidden="true" class="material-symbols-outlined text-lg">arrow_back</span>
          BACK TO LOBBY
        </button>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;

  container.querySelector('#btn-back-lobby')?.addEventListener('click', () => {
    router.navigate('lobby', { roomCode }, 'back');
  });

  container.querySelector('#btn-start-new-night')?.addEventListener('click', async () => {
    if (!state.isHost()) {
      toast.show('Only the host can do that');
      return;
    }
    const confirmed = window.confirm('Start a new night? This archives tonight\u2019s games and clears the scoreboard. Players are kept.');
    if (!confirmed) return;
    try {
      await fb.startNewNight(roomCode);
    } catch (e) {
      console.error('Start new night failed:', e);
      toast.show('Failed to start new night');
    }
  });
}

function _renderStartNewNightFooter(container, roomCode) {
  const footer = document.createElement('div');
  footer.className = 'p-6 pb-12';
  footer.innerHTML = `
    <button id="btn-start-new-night" class="btn-primary w-full flex items-center justify-center gap-2">
      <span aria-hidden="true" class="material-symbols-outlined text-lg">restart_alt</span>
      START NEW NIGHT
    </button>
    <p class="font-mono text-[10px] text-outline text-center uppercase mt-2">UNLOCKS THE ROOM FOR A FRESH NIGHT</p>
  `;
  container.appendChild(footer);
  footer.querySelector('#btn-start-new-night')?.addEventListener('click', async () => {
    if (!state.isHost()) {
      toast.show('Only the host can do that');
      return;
    }
    try {
      await fb.startNewNight(roomCode);
    } catch (e) {
      console.error('Start new night failed:', e);
      toast.show('Failed to start new night');
    }
  });
}

export function unmount() {}

function _ordinal(n) {
  if (n === 1) return '1ST';
  if (n === 2) return '2ND';
  if (n === 3) return '3RD';
  return n + 'TH';
}

function _statPill(label, value, highlight = false) {
  const bg = highlight ? 'bg-primary text-on-primary' : 'bg-surface-container-high';
  return `<span class="font-mono text-[9px] ${bg} px-2 py-0.5 uppercase">${label}: ${value}</span>`;
}
