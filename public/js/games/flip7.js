// ═══════════════════════════════════════════
// Flip 7 Game Module
// ═══════════════════════════════════════════

import { accentColor } from '../state.js';
import { escapeHTML } from '../utils.js';

export default {
  id: 'flip7',
  label: 'Flip 7',
  description: 'Flip cards and push your luck. Highest score wins when someone hits the target.',
  scoringHint: 'Enter each player\u2019s round score. If a player flipped seven different cards (Flip 7), tap the F7 toggle for a +15 bonus. First to the target total wins.',
  minPlayers: 3,
  maxPlayers: 20,
  winMode: 'highest_total',
  defaultConfig: { targetScore: 200, jua: true, juaBuyIn: 30, juaFirstSave: 5, juaInfluenceFine: 10 },
  configFields: [
    { key: 'targetScore', label: 'Win Target', type: 'number', min: 10 },
    {
      key: 'jua',
      label: 'Make it interesting',
      type: 'toggle',
      subFields: [
        { key: 'juaBuyIn', label: 'Buy In', type: 'number', min: 1, unit: '₹' },
        { key: 'juaPrize1', label: '1st Place', type: 'number', min: 0, unit: '₹', computeDefault: (cfg, n) => Math.round(n * cfg.juaBuyIn / 3) + 20 },
        { key: 'juaPrize2', label: '2nd Place', type: 'number', min: 0, unit: '₹', computeDefault: (cfg, n) => Math.round(n * cfg.juaBuyIn / 3) },
        { key: 'juaPrize3', label: '3rd Place', type: 'computed', unit: '₹' },
        { key: 'juaFirstSave', label: 'First Save', type: 'number', min: 1, unit: '₹' },
        { key: 'juaInfluenceFine', label: 'Fine', type: 'number', min: 1, unit: '₹' },
      ],
    },
  ],

  // Compute score from a card selection object (used by dashboard inline scoring).
  // Returns { basePoints, flip7 } compatible with applyRound / getRoundPoints.
  computeScoreFromCards({ numbers = [], actions = [], x2 = false, bust = false } = {}) {
    if (bust) return { basePoints: 0, flip7: false };
    const numberSum = numbers.reduce((s, n) => s + n, 0);
    const actionSum = actions.reduce((s, n) => s + n, 0);
    const subtotal = numberSum * (x2 ? 2 : 1) + actionSum;
    return { basePoints: subtotal, flip7: numbers.length === 7 };
  },

  validateRound(draft, gameState) {
    if (!draft.entries) return { valid: false, error: 'No scores entered' };
    for (const pid of Object.keys(draft.entries)) {
      const e = draft.entries[pid];
      if (!Number.isFinite(e.basePoints)) return { valid: false, error: 'Score must be a number' };
      if (e.basePoints < 0) return { valid: false, error: 'Score cannot be negative' };
    }
    return { valid: true };
  },

  applyRound(currentTotals, roundData, gameState) {
    const newTotals = { ...currentTotals };
    const entries = roundData.entries || {};
    for (const [pid, entry] of Object.entries(entries)) {
      const pts = (entry.basePoints || 0) + (entry.flip7 ? 15 : 0);
      newTotals[pid] = (newTotals[pid] || 0) + pts;
    }
    return newTotals;
  },

  checkEnd(totals, config, playerIds, _roundCount) {
    const target = config?.targetScore || 200;
    const maxScore = Math.max(...playerIds.map((id) => totals[id] || 0));

    if (maxScore < target) return { ended: false, winner: null, overtime: false };

    // Find all players at max
    const leaders = playerIds.filter((id) => (totals[id] || 0) === maxScore);
    if (leaders.length === 1) {
      return { ended: true, winner: leaders[0], overtime: false };
    }
    // Tied — winner screen handles redistribution
    return { ended: true, winner: leaders[0], overtime: false };
  },

  deriveStandings(totals, playerIds) {
    const sorted = playerIds
      .map((id) => ({ playerId: id, total: totals[id] || 0 }))
      .sort((a, b) => b.total - a.total); // highest first
    let rank = 1;
    sorted.forEach((s, i) => {
      if (i > 0 && s.total < sorted[i - 1].total) rank = i + 1;
      s.rank = rank;
    });
    return sorted;
  },

  computeJuaPayouts(game) {
    const config = game.config || {};
    if (!config.jua) return null;
    const numPlayers = (game.playerIds || []).length;
    const buyIn = config.juaBuyIn || 30;
    const firstSaveAmt = config.juaFirstSave || 5;
    const influenceFine = config.juaInfluenceFine || 10;
    const totalPot = buyIn * numPlayers;
    const prize1 = config.juaPrize1 || 0;
    const prize2 = config.juaPrize2 || 0;
    const prize3 = totalPot - prize1 - prize2;

    let pool = 0;
    const rounds = game.rounds ? Object.values(game.rounds) : [];
    rounds.forEach((rnd) => { if (rnd.jua?.firstSavePid) pool += firstSaveAmt; });
    const totalFines = Object.values(game.juaFines || {}).reduce((s, n) => s + n, 0);
    pool += totalFines * influenceFine;

    const pot1 = prize1 + pool;
    const pot2 = prize2;
    const pot3 = prize3;

    const standings = this.deriveStandings(game.totals || {}, game.playerIds || []);
    const payouts = standings
      .filter((s) => s.rank <= 3)
      .map((s) => ({
        playerId: s.playerId,
        rank: s.rank,
        amount: s.rank === 1 ? pot1 : s.rank === 2 ? pot2 : pot3,
      }));

    return { pool, payouts };
  },

  getRoundPoints(roundData, playerId) {
    const entry = roundData.entries?.[playerId];
    if (!entry) return 0;
    return (entry.basePoints || 0) + (entry.flip7 ? 15 : 0);
  },

  // ── Scoring Form ──

  renderScorer(playerIds, snapshot, totals, game) {
    return `
      <div class="flex flex-col gap-3">
        ${playerIds.map((pid) => {
          const p = snapshot[pid] || {};
          const color = accentColor(p.accentIndex);
          const currentTotal = totals[pid] || 0;
          return `
            <div class="bg-surface-container-lowest border border-outline">
              <div class="h-[3px]" style="background:${color}"></div>
              <div class="p-4 flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <p class="font-headline font-extrabold text-sm uppercase truncate">${escapeHTML(p.name || pid)}</p>
                  <p class="font-mono text-[0.625rem] text-outline">${currentTotal} PTS</p>
                </div>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    inputmode="numeric"
                    data-player="${escapeHTML(pid)}"
                    data-field="basePoints"
                    aria-label="Score for ${escapeHTML(p.name || pid)}"
                    class="score-input w-16"
                    placeholder="0"
                    min="0"
                    value=""
                  >
                  <button
                    type="button"
                    data-player="${escapeHTML(pid)}"
                    data-field="flip7"
                    aria-pressed="false"
                    aria-label="Flip 7 for ${escapeHTML(p.name || pid)}"
                    class="flip7-toggle min-w-[44px] min-h-[44px] px-2 border font-mono text-[0.625rem] uppercase tracking-widest transition-colors border-outline-variant text-outline hover:border-primary inline-flex items-center justify-center gap-1"
                  ><span class="flip7-label">🔥</span></button>
                  <button
                    type="button"
                    data-player="${escapeHTML(pid)}"
                    aria-label="Clear ${escapeHTML(p.name || pid)}'s entry"
                    title="Clear entry"
                    class="clear-row-btn p-1 text-outline hover:text-on-surface transition-colors"
                  ><span class="material-symbols-outlined text-base" aria-hidden="true">backspace</span></button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Live Preview -->
      <div id="live-preview" class="mt-4 bg-surface-container-high border border-outline p-4">
        <p class="font-mono text-[0.625rem] uppercase tracking-widest text-outline mb-3">PREVIEW</p>
        <div id="preview-rows" class="space-y-1"></div>
      </div>
    `;
  },

  collectDraft(container, playerIds) {
    const entries = {};
    playerIds.forEach((pid) => {
      const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="basePoints"]`);
      const toggle = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="flip7"]`);
      entries[pid] = {
        basePoints: parseInt(input?.value) || 0,
        flip7: toggle?.classList.contains('active') || false,
      };
    });
    return { entries };
  },

  clearRow(container, pid) {
    const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="basePoints"]`);
    if (input) input.value = '';
    const toggle = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="flip7"]`);
    if (toggle) {
      toggle.classList.remove('active');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.style.background = '';
      toggle.style.color = '';
      toggle.style.borderColor = '';
      const label = toggle.querySelector('.flip7-label');
      if (label) label.textContent = '🔥';
    }
  },

  resetAll(container, playerIds) {
    playerIds.forEach((pid) => this.clearRow(container, pid));
  },

  rulesHTML: `
    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">01</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">The Objective</h3>
      </div>
      <div class="bg-surface-container-lowest p-6 border border-outline-variant">
        <p class="text-sm leading-relaxed">Push your luck by flipping cards. Accumulate points each round. First player to reach the target score wins.</p>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[0.625rem] uppercase text-outline mb-1">Default Target</p>
            <p class="font-mono text-lg font-bold">200 PTS</p>
          </div>
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[0.625rem] uppercase text-outline mb-1">Players</p>
            <p class="font-mono text-lg font-bold">2-20</p>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">02</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Scoring</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">Each round, players earn points based on the cards they flipped.</p>
        <div class="bg-surface-container-lowest p-4 border border-outline-variant">
          <p class="font-headline font-bold text-sm uppercase mb-2">Flip 7 Bonus</p>
          <p class="text-sm text-on-surface-variant">If a player flips exactly a 7, they receive a <span class="font-bold">+15 point bonus</span> on top of their base score for that round.</p>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">03</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Winning</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">The game ends when any player's cumulative total reaches or exceeds the target score. The player with the <span class="font-bold">highest total</span> wins. In case of a tie, the prize pool is split equally among the tied players.</p>
      </div>
    </section>
  `,
};
