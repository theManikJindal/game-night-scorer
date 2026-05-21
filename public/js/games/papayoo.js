// ═══════════════════════════════════════════
// Papayoo Game Module
// ═══════════════════════════════════════════

import { ACCENT_COLORS } from '../state.js';
import { escapeHTML } from '../utils.js';

const SUITS = [
  { id: 'spades', label: 'Spades', icon: 'playing_cards' },
  { id: 'hearts', label: 'Hearts', icon: 'favorite' },
  { id: 'diamonds', label: 'Diamonds', icon: 'diamond' },
  { id: 'clubs', label: 'Clubs', icon: 'eco' },
];

export default {
  id: 'papayoo',
  label: 'Papayoo',
  description: 'Avoid penalty cards, especially the dreaded Papayoo worth 40 points. Lowest score wins.',
  scoringHint: 'Pick the suit that held the Papayoo this round (the 7 of that suit is worth 40). Then enter each player\u2019s penalty points. The penalties must total exactly 250.',
  minPlayers: 3,
  maxPlayers: 8,
  winMode: 'lowest_total',
  defaultConfig: { roundLimit: 5 },
  configFields: [
    { key: 'roundLimit', label: 'Number of Rounds', type: 'number', min: 1 },
  ],

  validateRound(draft, gameState) {
    if (!draft.papayooSuit) return { valid: false, error: 'Select the Papayoo suit' };
    if (!draft.entries) return { valid: false, error: 'No scores entered' };

    for (const e of Object.values(draft.entries)) {
      if (!Number.isFinite(e.penaltyPoints)) return { valid: false, error: 'Penalty must be a number' };
      if (e.penaltyPoints < 0) return { valid: false, error: 'Penalty cannot be negative' };
    }

    const sum = Object.values(draft.entries).reduce((s, e) => s + (e.penaltyPoints || 0), 0);
    if (sum !== 250) return { valid: false, error: `Penalties must total 250 (currently ${sum})` };

    return { valid: true };
  },

  applyRound(currentTotals, roundData, gameState) {
    const newTotals = { ...currentTotals };
    const entries = roundData.entries || {};
    for (const [pid, entry] of Object.entries(entries)) {
      newTotals[pid] = (newTotals[pid] || 0) + (entry.penaltyPoints || 0);
    }
    return newTotals;
  },

  checkEnd(totals, config, playerIds, roundCount) {
    const roundLimit = parseInt(config?.roundLimit) || 5;

    if (roundCount == null || roundCount < roundLimit) return { ended: false, winner: null, overtime: false };

    // At or past round limit — find lowest
    const scores = playerIds.map((id) => ({ id, total: totals[id] || 0 }));
    scores.sort((a, b) => a.total - b.total);
    const minScore = scores[0].total;
    const leaders = scores.filter((s) => s.total === minScore);

    if (leaders.length === 1) {
      return { ended: true, winner: leaders[0].id, overtime: false };
    }
    // Tied at round limit — overtime
    return { ended: true, winner: null, overtime: true };
  },

  deriveStandings(totals, playerIds) {
    const sorted = playerIds
      .map((id) => ({ playerId: id, total: totals[id] || 0 }))
      .sort((a, b) => a.total - b.total); // lowest first
    let rank = 1;
    sorted.forEach((s, i) => {
      if (i > 0 && s.total > sorted[i - 1].total) rank = i + 1;
      s.rank = rank;
    });
    return sorted;
  },

  getRoundPoints(roundData, playerId) {
    return roundData.entries?.[playerId]?.penaltyPoints || 0;
  },

  // ── Scoring Form ──

  renderScorer(playerIds, snapshot, totals, game) {
    const rounds = game.rounds ? Object.values(game.rounds) : [];
    return `
      <!-- Papayoo Suit Picker -->
      <div class="bg-surface-container-lowest border border-outline p-4 mb-4">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-3">PAPAYOO SUIT THIS ROUND</p>
        <div class="grid grid-cols-4 gap-2">
          ${SUITS.map((suit) => `
            <button
              data-suit="${suit.id}"
              class="suit-btn flex flex-col items-center gap-1 p-3 border border-outline-variant hover:border-primary transition-colors"
            >
              <span aria-hidden="true" class="material-symbols-outlined text-xl">${suit.icon}</span>
              <span class="font-mono text-[9px] uppercase">${suit.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Player Penalty Inputs -->
      <div class="flex flex-col gap-2">
        ${playerIds.map((pid) => {
          const p = snapshot[pid] || {};
          const color = ACCENT_COLORS[p.accentIndex || 0];
          const currentTotal = totals[pid] || 0;
          return `
            <div class="bg-surface-container-lowest border border-outline">
              <div class="h-[3px]" style="background:${color}"></div>
              <div class="p-4 flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <p class="font-headline font-extrabold text-sm uppercase truncate">${escapeHTML(p.name || pid)}</p>
                  <p class="font-mono text-[10px] text-outline">${currentTotal} PTS</p>
                </div>
                <input
                  type="number"
                  inputmode="numeric"
                  data-player="${escapeHTML(pid)}"
                  data-field="penaltyPoints"
                  aria-label="Score for ${escapeHTML(p.name || pid)}"
                  class="score-input w-16 papayoo-input"
                  placeholder="0"
                  min="0"
                  value=""
                >
                <button
                  type="button"
                  data-player="${escapeHTML(pid)}"
                  aria-label="Clear ${escapeHTML(p.name || pid)}'s entry"
                  title="Clear entry"
                  class="clear-row-btn p-1 text-outline hover:text-on-surface transition-colors"
                ><span class="material-symbols-outlined text-base" aria-hidden="true">backspace</span></button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Running Total -->
      <div class="mt-4 bg-surface-container-high border border-outline p-4 flex justify-between items-center">
        <span class="font-mono text-[10px] uppercase tracking-widest">PENALTY SUM</span>
        <div class="flex items-center gap-2">
          <span id="penalty-sum" class="font-mono text-xl font-bold">0</span>
          <span class="font-mono text-sm text-outline">/ 250</span>
        </div>
      </div>

      <!-- Round info -->
      <p class="font-mono text-[10px] text-outline text-center mt-2 uppercase">
        ROUND ${rounds.length + 1} OF ${game.config?.roundLimit || 5}
      </p>
    `;
  },

  collectDraft(container, playerIds) {
    const suitBtn = container.querySelector('.suit-btn.active');
    const papayooSuit = suitBtn?.dataset.suit || null;

    const entries = {};
    playerIds.forEach((pid) => {
      const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="penaltyPoints"]`);
      entries[pid] = {
        penaltyPoints: parseInt(input?.value) || 0,
      };
    });

    return { papayooSuit, entries };
  },

  clearRow(container, pid) {
    const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="penaltyPoints"]`);
    if (input) {
      input.value = '';
      // Trigger the existing input listener so the live sum reflects the change
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },

  resetAll(container, playerIds) {
    playerIds.forEach((pid) => this.clearRow(container, pid));
    // Unselect the Papayoo suit
    container.querySelectorAll('.suit-btn').forEach((b) => {
      b.classList.remove('active');
      b.style.background = '';
      b.style.borderColor = '';
      b.style.color = '';
    });
  },

  rulesHTML: `
    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">01</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">The Objective</h3>
      </div>
      <div class="bg-surface-container-lowest p-6 border border-outline-variant">
        <p class="text-sm leading-relaxed">Avoid collecting penalty cards. The player with the <span class="font-bold">lowest total</span> after all rounds wins.</p>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[10px] uppercase text-outline mb-1">Penalties Per Round</p>
            <p class="font-mono text-lg font-bold">250 PTS</p>
          </div>
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[10px] uppercase text-outline mb-1">Players</p>
            <p class="font-mono text-lg font-bold">3-8</p>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">02</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">The Papayoo Card</h3>
      </div>
      <div class="bg-primary text-on-primary p-6">
        <p class="text-sm tracking-wide opacity-80 uppercase font-mono mb-2">THE MOST DANGEROUS CARD</p>
        <h4 class="text-2xl font-headline font-black uppercase tracking-tighter leading-none mb-3">Worth 40 Points</h4>
        <p class="opacity-90 leading-relaxed text-sm">Each round, a suit is randomly determined. The 7 of that suit becomes the Papayoo, worth 40 penalty points. All other 7s (Payoos) are worth their face value.</p>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">03</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Scoring</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">At the end of each round, count penalty points from collected cards. The total across all players must equal exactly <span class="font-bold">250</span>.</p>
        <p class="text-sm text-on-surface-variant leading-relaxed">Passing cards happens physically and is not tracked in the app. Only final penalty totals are entered.</p>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">04</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Winning</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">After the configured number of rounds, the player with the <span class="font-bold">lowest cumulative total</span> wins.</p>
        <p class="text-sm text-on-surface-variant leading-relaxed">If the lowest score is tied, the game enters <span class="font-bold uppercase">overtime</span> — play one more round at a time until a unique winner emerges.</p>
      </div>
    </section>
  `,
};
