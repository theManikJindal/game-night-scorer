// ═══════════════════════════════════════════
// Scoring Screen — Host Score Entry
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as fb from '../firebase.js';
import * as router from '../router.js';
import * as toast from '../components/toast.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import { getGame } from '../games/registry.js';
import { ACCENT_COLORS } from '../state.js';
import { escapeHTML } from '../utils.js';

export function mount(container, params = {}) {
  const roomCode = params.roomCode || state.get('roomCode');

  const meta = state.get('roomMeta');
  if (!meta || !state.isHost()) {
    router.navigate('dashboard', { roomCode });
    return;
  }

  if (!roomCode) {
    router.navigate('home');
    return;
  }
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = 'SCORING';
  document.getElementById('top-bar-back').classList.remove('hidden');
  document.getElementById('top-bar-back').onclick = () => router.navigate('lobby', { roomCode });
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);

  bottomNav.show('scoring');

  _render(container, roomCode);
}

export function unmount() {}

function _render(container, roomCode) {
  const game = state.currentGame();
  if (!game) {
    container.innerHTML = `<div class="p-6 text-center"><p class="text-on-surface-variant">No active game</p></div>`;
    return;
  }

  // Guard: don't allow scoring on a finished game
  if (game.status === 'finished') {
    router.navigate(game.winner ? 'winner' : 'dashboard', { roomCode });
    return;
  }

  const gameModule = getGame(game.type);
  if (!gameModule) return;

  const snapshot = game.playerSnapshot || {};
  const totals = game.totals || {};
  const rounds = game.rounds ? Object.values(game.rounds) : [];
  const roundNum = rounds.length + 1;
  const playerIds = game.playerIds || [];

  // Only render scoring rows for players currently active.
  // Inactive players keep their past totals and remain eligible for winner (checkEnd uses full playerIds).
  const playersMap = state.get('players') || {};
  const activePlayerIds = playerIds.filter((id) => playersMap[id]?.isActive !== false);

  // Blocker: if no one is active, submission is impossible
  if (activePlayerIds.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center py-20">
        <span aria-hidden="true" class="material-symbols-outlined text-5xl text-outline mb-4">person_off</span>
        <p class="font-headline font-bold text-lg uppercase mb-2">No Active Players</p>
        <p class="font-body text-sm text-on-surface-variant">Reactivate at least one player from Manage Players to continue.</p>
      </div>
    `;
    return;
  }

  // Safety: for round-limited games, block scoring if at the limit (unless overtime)
  if (game.type === 'papayoo') {
    const limit = parseInt(game.config?.roundLimit) || 5;
    if (rounds.length >= limit && game.status === 'active') {
      container.innerHTML = `
        <div class="p-6 text-center py-20">
          <span aria-hidden="true" class="material-symbols-outlined text-5xl text-outline mb-4">check_circle</span>
          <p class="font-headline font-bold text-lg uppercase mb-2">All Rounds Complete</p>
          <p class="font-body text-sm text-on-surface-variant">Determining winner...</p>
        </div>
      `;
      return;
    }
  }

  // Derive standings for mini scoreboard
  const standings = gameModule.deriveStandings(totals, playerIds);

  container.innerHTML = `
    <div class="p-6 pb-32">
      <!-- Round Header -->
      <div class="flex justify-between items-end mb-4">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-widest text-outline">ENTER SCORES</p>
          <h2 class="font-headline font-black text-2xl uppercase tracking-tight">Round ${roundNum}</h2>
        </div>
        <div class="flex items-center gap-3">
          <button id="btn-reset-form" type="button" class="font-mono text-[10px] uppercase tracking-widest text-outline hover:text-on-surface underline-offset-2 hover:underline transition-colors">RESET FORM</button>
          <span class="font-mono text-[10px] border border-outline px-2 py-1 uppercase">${gameModule.label}</span>
        </div>
      </div>

      ${gameModule.scoringHint ? `
      <details class="mb-4 border border-outline-variant bg-surface-container-lowest">
        <summary class="cursor-pointer select-none px-4 py-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline hover:bg-surface-container-high transition-colors list-none">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">info</span>
          HOW SCORING WORKS
        </summary>
        <p class="px-4 pb-3 pt-1 font-body text-xs leading-relaxed text-on-surface-variant">${escapeHTML(gameModule.scoringHint)}</p>
      </details>
      ` : ''}

      <!-- Mini Standings -->
      <div class="bg-surface-container-lowest border border-outline mb-6 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-2 bg-surface-container-high border-b border-outline">
          <span class="font-mono text-[10px] uppercase tracking-widest text-outline">STANDINGS</span>
          <span class="font-mono text-[10px] text-outline">RD ${rounds.length}${game.type === 'papayoo' ? '/' + (game.config?.roundLimit || 5) : ''}</span>
        </div>
        <div class="divide-y divide-outline-variant">
          ${standings.map((s) => {
            const p = snapshot[s.playerId] || {};
            const color = ACCENT_COLORS[p.accentIndex || 0];
            const rankLabel = s.rank <= 3 ? ['1ST', '2ND', '3RD'][s.rank - 1] : s.rank + 'TH';
            return `
              <div class="flex items-center px-4 py-2 gap-3">
                <div class="w-1 self-stretch shrink-0" style="background:${color}"></div>
                <span class="font-mono text-[10px] text-outline w-6">${rankLabel}</span>
                <span class="font-headline font-bold text-xs uppercase flex-1 truncate">${escapeHTML(p.name || s.playerId)}</span>
                <span class="font-mono text-sm font-bold ${s.rank === 1 ? 'text-secondary' : ''}">${s.total}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Game-specific scorer -->
      <div id="scorer-form"></div>

      <!-- Submit -->
      <div class="mt-6 space-y-3">
        <button id="btn-submit-round" class="btn-primary flex items-center justify-center gap-2">
          CONFIRM ROUND
          <span aria-hidden="true" class="material-symbols-outlined text-lg">check</span>
        </button>
        <div id="validation-error" class="font-mono text-[10px] text-error text-center uppercase" style="display:none"></div>
      </div>
    </div>
  `;

  // Render game-specific form — only for active players
  const formEl = container.querySelector('#scorer-form');
  formEl.innerHTML = gameModule.renderScorer(activePlayerIds, snapshot, totals, game);

  // Wire up game-specific interactive elements
  _bindFormInteractions(container, game.type, activePlayerIds);

  // Per-row clear + form-wide reset (edit-in-draft)
  formEl.querySelectorAll('.clear-row-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.player;
      gameModule.clearRow?.(container, pid);
    });
  });
  container.querySelector('#btn-reset-form')?.addEventListener('click', () => {
    gameModule.resetAll?.(container, activePlayerIds);
    const errorEl = container.querySelector('#validation-error');
    if (errorEl) errorEl.style.display = 'none';
  });

  // Submit handler
  container.querySelector('#btn-submit-round').addEventListener('click', () => {
    _submitRound(container, roomCode, game, gameModule);
  });
}

function _bindFormInteractions(container, gameType, playerIds) {
  if (gameType === 'flip7') {
    // Flip 7 toggle buttons. Color flip alone fails colorblind users, so the
    // label switches between F7 / F7\u2713 in addition to changing background.
    container.querySelectorAll('.flip7-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const isActive = btn.classList.contains('active');
        btn.setAttribute('aria-pressed', isActive.toString());
        const label = btn.querySelector('.flip7-label');
        if (label) label.textContent = isActive ? 'F7\u2713' : 'F7';
        if (isActive) {
          btn.style.background = '#000';
          btn.style.color = '#fff';
          btn.style.borderColor = '#000';
        } else {
          btn.style.background = '';
          btn.style.color = '';
          btn.style.borderColor = '';
        }
      });
    });
  }

  if (gameType === 'papayoo') {
    // Suit picker — single select
    container.querySelectorAll('.suit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.suit-btn').forEach((b) => {
          b.classList.remove('active');
          b.style.background = '';
          b.style.borderColor = '';
          b.style.color = '';
        });
        btn.classList.add('active');
        btn.style.background = '#000';
        btn.style.color = '#fff';
        btn.style.borderColor = '#000';
      });
    });

    // Live penalty sum
    const papayooInputs = Array.from(container.querySelectorAll('.papayoo-input'));
    const sumEl = container.querySelector('#penalty-sum');
    papayooInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const sum = papayooInputs.reduce((s, el) => s + (parseInt(el.value) || 0), 0);
        if (sumEl) {
          sumEl.textContent = sum;
          sumEl.style.color = sum === 250 ? '#00B85C' : sum > 250 ? '#ba1a1a' : '';
        }
      });
    });
  }

  if (gameType === 'cabo') {
    // Caller selection — single select
    container.querySelectorAll('.caller-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.caller-btn').forEach((b) => {
          b.classList.remove('active');
          b.style.background = '';
          b.style.borderColor = '';
          b.style.color = '';
        });
        btn.classList.add('active');
        btn.style.background = '#000';
        btn.style.color = '#fff';
        btn.style.borderColor = '#000';
      });
    });

    // Kamikaze toggle
    const kamikazeBtn = container.querySelector('#kamikaze-toggle');
    if (kamikazeBtn) {
      kamikazeBtn.addEventListener('click', () => {
        kamikazeBtn.classList.toggle('active');
        const isActive = kamikazeBtn.classList.contains('active');
        kamikazeBtn.setAttribute('aria-checked', isActive.toString());
        const dot = kamikazeBtn.querySelector('div');
        const cardSection = container.querySelector('#card-totals-section');
        if (isActive) {
          kamikazeBtn.style.background = '#000';
          kamikazeBtn.style.borderColor = '#000';
          dot.style.transform = 'translateX(20px)';
          dot.style.background = '#fff';
          // Disable card total inputs when kamikaze
          if (cardSection) cardSection.style.opacity = '0.3';
          cardSection?.querySelectorAll('input').forEach((i) => { i.disabled = true; });
        } else {
          kamikazeBtn.style.background = '';
          kamikazeBtn.style.borderColor = '';
          dot.style.transform = 'translateX(0)';
          dot.style.background = '';
          if (cardSection) cardSection.style.opacity = '1';
          cardSection?.querySelectorAll('input').forEach((i) => { i.disabled = false; });
        }
      });
    }
  }
}

async function _submitRound(container, roomCode, initialGame, gameModule) {
  // Re-read fresh game state to avoid stale closures (e.g. if undo happened)
  const game = state.currentGame() || initialGame;
  const playerIds = game.playerIds || [];
  const totals = game.totals || {};
  const rounds = game.rounds ? Object.values(game.rounds) : [];

  // Collect draft only for currently active players (those are the only rows rendered)
  const playersMap = state.get('players') || {};
  const activePlayerIds = playerIds.filter((id) => playersMap[id]?.isActive !== false);
  const draft = gameModule.collectDraft(container, activePlayerIds);

  // Validate
  const validation = gameModule.validateRound(draft, game);
  const errorEl = container.querySelector('#validation-error');

  if (!validation.valid) {
    errorEl.textContent = validation.error;
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';

  // Apply round to get new totals
  const newTotals = gameModule.applyRound({ ...totals }, draft, game);

  // Check end condition
  const newRoundCount = rounds.length + 1;
  const endResult = gameModule.checkEnd(newTotals, game.config, playerIds, newRoundCount);

  const btn = container.querySelector('#btn-submit-round');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner mx-auto"></div>';

  try {
    await fb.submitRound(roomCode, game.gameId, draft, newTotals, endResult.ended ? endResult : null);

    if (endResult.ended && endResult.winner) {
      router.navigate('winner', { roomCode });
    } else if (endResult.ended && endResult.overtime) {
      toast.show('Tied! Overtime round needed');
      router.navigate('dashboard', { roomCode });
    } else {
      // Always go to dashboard after submit — avoids stale state bugs
      toast.show(`Round ${newRoundCount} submitted`);
      router.navigate('dashboard', { roomCode });
    }
  } catch (e) {
    console.error('Submit round failed:', e);
    toast.show('Submit failed');
    btn.disabled = false;
    btn.innerHTML = 'CONFIRM ROUND <span aria-hidden="true" class="material-symbols-outlined text-lg">check</span>';
  }
}
