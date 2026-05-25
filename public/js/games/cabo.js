// ═══════════════════════════════════════════
// Cabo Game Module
// ═══════════════════════════════════════════

import { ACCENT_COLORS } from '../state.js';
import { escapeHTML } from '../utils.js';

const minCardCache = new WeakMap();

export default {
  id: 'cabo',
  label: 'Cabo',
  description: 'Memory card game. Minimize your hand total. Caller risks a penalty if wrong. Lowest wins.',
  scoringHint: 'Tap who called Cabo, then enter each player\u2019s hand total. Caller scores 0 if lowest, otherwise their hand + 10. Hitting 100 exactly resets to 50. Kamikaze (two 12s + two 13s) gives caller 0, everyone else 50.',
  minPlayers: 3,
  maxPlayers: 10,
  winMode: 'lowest_total',
  defaultConfig: { lossThreshold: 100, deckCount: 1 },
  configFields: [
    {
      key: 'deckCount',
      label: 'Decks',
      type: 'select',
      options: [
        { value: 1, label: '1 deck (2-5 players)' },
        { value: 2, label: '2 decks (2-10 players)' },
      ],
    },
  ],

  validateRound(draft, gameState) {
    if (!draft.callerId) return { valid: false, error: 'Select who called Cabo' };
    if (!draft.entries) return { valid: false, error: 'No scores entered' };

    // Iterate the draft entries (active players only — inactive players aren't
    // rendered in the form post-P2 and aren't in the draft). The caller must
    // be among those entries, otherwise scoring is inconsistent.
    for (const entry of Object.values(draft.entries)) {
      if (!Number.isFinite(entry.cardTotal)) return { valid: false, error: 'Card total must be a number' };
      if (entry.cardTotal < 0) return { valid: false, error: 'Card totals cannot be negative' };
    }
    if (!draft.entries[draft.callerId]) {
      return { valid: false, error: 'Caller must be one of the active players' };
    }

    return { valid: true };
  },

  applyRound(currentTotals, roundData, gameState) {
    const newTotals = { ...currentTotals };
    const entries = roundData.entries || {};
    const callerId = roundData.callerId;
    const kamikaze = roundData.kamikaze || false;

    if (kamikaze) {
      // Kamikaze: caller gets 0, everyone else gets 50
      for (const pid of Object.keys(entries)) {
        if (pid === callerId) {
          newTotals[pid] = (newTotals[pid] || 0) + 0;
        } else {
          newTotals[pid] = (newTotals[pid] || 0) + 50;
        }
      }
    } else {
      // Find minimum card total - Bolt Optimization: Avoid multiple array allocations
      let minCardTotal = Infinity;
      for (const entry of Object.values(entries)) {
        const cardTotal = entry.cardTotal || 0;
        if (cardTotal < minCardTotal) {
          minCardTotal = cardTotal;
        }
      }

      // Memoize the min card total for getRoundPoints
      minCardCache.set(roundData, minCardTotal);

      for (const [pid, entry] of Object.entries(entries)) {
        const cardTotal = entry.cardTotal || 0;
        if (pid === callerId) {
          // Caller: 0 if they have the min, else cardTotal + 10
          if (cardTotal === minCardTotal) {
            newTotals[pid] = (newTotals[pid] || 0) + 0;
          } else {
            newTotals[pid] = (newTotals[pid] || 0) + cardTotal + 10;
          }
        } else {
          newTotals[pid] = (newTotals[pid] || 0) + cardTotal;
        }
      }
    }

    // Exact-100 rule: reset to 50
    for (const pid of Object.keys(newTotals)) {
      if (newTotals[pid] === 100) {
        newTotals[pid] = 50;
      }
    }

    return newTotals;
  },

  checkEnd(totals, config, playerIds, _roundCount) {
    const threshold = config?.lossThreshold || 100;

    // Check if anyone is over threshold
    const busted = playerIds.some((id) => (totals[id] || 0) > threshold);
    if (!busted) return { ended: false, winner: null, overtime: false };

    // Someone busted — find lowest
    const scores = playerIds.map((id) => ({ id, total: totals[id] || 0 }));
    scores.sort((a, b) => a.total - b.total);
    const minScore = scores[0].total;
    const leaders = scores.filter((s) => s.total === minScore);

    if (leaders.length === 1) {
      return { ended: true, winner: leaders[0].id, overtime: false };
    }
    // Tied — winner screen handles redistribution
    return { ended: true, winner: leaders[0].id, overtime: false };
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
    const entries = roundData.entries || {};
    const callerId = roundData.callerId;
    const kamikaze = roundData.kamikaze || false;

    if (kamikaze) {
      return playerId === callerId ? 0 : 50;
    }

    const cardTotal = entries[playerId]?.cardTotal || 0;

    // Bolt Optimization: Use memoized min card total or compute efficiently if missing
    let minCardTotal = minCardCache.get(roundData);
    if (minCardTotal === undefined) {
      minCardTotal = Infinity;
      for (const entry of Object.values(entries)) {
        const ct = entry.cardTotal || 0;
        if (ct < minCardTotal) minCardTotal = ct;
      }
      minCardCache.set(roundData, minCardTotal);
    }

    if (playerId === callerId) {
      return cardTotal === minCardTotal ? 0 : cardTotal + 10;
    }
    return cardTotal;
  },

  // ── Scoring Form ──

  renderScorer(playerIds, snapshot, totals, game) {
    return `
      <!-- Caller Selection -->
      <div class="bg-surface-container-lowest border border-outline p-4 mb-4">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-3">WHO CALLED CABO?</p>
        <div class="flex flex-wrap gap-2">
          ${playerIds.map((pid) => {
            const p = snapshot[pid] || {};
            const color = ACCENT_COLORS[p.accentIndex || 0];
            return `
              <button
                data-caller="${escapeHTML(pid)}"
                class="caller-btn px-3 py-2 border border-outline-variant font-headline font-bold text-xs uppercase tracking-widest transition-colors hover:border-primary"
              >${escapeHTML(p.name || pid)}</button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Kamikaze Toggle -->
      <div class="bg-surface-container-lowest border border-outline p-4 mb-4 flex items-center justify-between">
        <div>
          <p class="font-headline font-bold text-sm uppercase">Kamikaze</p>
          <p class="font-mono text-[10px] text-outline">Two 12s + Two 13s = 0 pts, others get 50</p>
        </div>
        <button id="kamikaze-toggle" role="switch" aria-checked="false" aria-label="Kamikaze toggle" class="w-12 h-7 border border-outline bg-surface-container-high transition-colors relative">
          <div class="absolute top-0.5 left-0.5 w-5.5 h-5.5 bg-outline transition-transform" style="width:22px;height:22px"></div>
        </button>
      </div>

      <!-- Card Totals -->
      <div class="flex flex-col gap-2" id="card-totals-section">
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
                  <p class="font-mono text-[10px] text-outline">${currentTotal} PTS${currentTotal === 50 ? ' (RESET)' : ''}</p>
                </div>
                <input
                  type="number"
                  inputmode="numeric"
                  data-player="${escapeHTML(pid)}"
                  data-field="cardTotal"
                  aria-label="Score for ${escapeHTML(p.name || pid)}"
                  class="score-input w-16 cabo-input"
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

      <!-- Cabo scoring reference -->
      <div class="mt-4 bg-surface-container-high border border-outline p-4">
        <p class="font-mono text-[10px] uppercase tracking-widest text-outline mb-2">SCORING REFERENCE</p>
        <div class="space-y-1 font-mono text-[11px]">
          <div class="flex justify-between"><span class="text-on-surface-variant">Caller has lowest</span><span class="font-bold">0 pts</span></div>
          <div class="flex justify-between"><span class="text-on-surface-variant">Caller doesn't have lowest</span><span class="font-bold">Sum + 10</span></div>
          <div class="flex justify-between"><span class="text-on-surface-variant">Everyone else</span><span class="font-bold">Card sum</span></div>
          <div class="flex justify-between"><span class="text-on-surface-variant">Land on exactly 100</span><span class="font-bold">Reset to 50</span></div>
          <div class="flex justify-between"><span class="text-on-surface-variant">Kamikaze (2x12 + 2x13)</span><span class="font-bold">Caller 0, rest 50</span></div>
        </div>
      </div>
    `;
  },

  collectDraft(container, playerIds) {
    const callerBtn = container.querySelector('.caller-btn.active');
    const callerId = callerBtn?.dataset.caller || null;

    const kamikazeToggle = container.querySelector('#kamikaze-toggle');
    const kamikaze = kamikazeToggle?.classList.contains('active') || false;

    const entries = {};
    playerIds.forEach((pid) => {
      const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="cardTotal"]`);
      entries[pid] = {
        cardTotal: parseInt(input?.value) || 0,
      };
    });

    return { callerId, kamikaze, entries };
  },

  clearRow(container, pid) {
    const input = container.querySelector(`[data-player="${escapeHTML(pid)}"][data-field="cardTotal"]`);
    if (input) input.value = '';
    // If this player was the caller, unselect the caller button
    const callerBtn = container.querySelector(`.caller-btn[data-caller="${escapeHTML(pid)}"]`);
    if (callerBtn?.classList.contains('active')) {
      callerBtn.classList.remove('active');
      callerBtn.style.background = '';
      callerBtn.style.borderColor = '';
      callerBtn.style.color = '';
    }
  },

  resetAll(container, playerIds) {
    playerIds.forEach((pid) => this.clearRow(container, pid));
    // Turn kamikaze off and re-enable the card inputs
    const kamikazeBtn = container.querySelector('#kamikaze-toggle');
    if (kamikazeBtn?.classList.contains('active')) {
      kamikazeBtn.classList.remove('active');
      kamikazeBtn.setAttribute('aria-checked', 'false');
      kamikazeBtn.style.background = '';
      kamikazeBtn.style.borderColor = '';
      const dot = kamikazeBtn.querySelector('div');
      if (dot) {
        dot.style.transform = 'translateX(0)';
        dot.style.background = '';
      }
      const cardSection = container.querySelector('#card-totals-section');
      if (cardSection) cardSection.style.opacity = '1';
      cardSection?.querySelectorAll('input').forEach((i) => { i.disabled = false; });
    }
  },

  rulesHTML: `
    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">01</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">The Objective</h3>
      </div>
      <div class="bg-surface-container-lowest p-6 border border-outline-variant">
        <p class="text-sm leading-relaxed">Memorize, swap, and peek at your cards to minimize your hand total. Call "Cabo" when you think you have the lowest score.</p>
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[10px] uppercase text-outline mb-1">Bust Threshold</p>
            <p class="font-mono text-lg font-bold">100 PTS</p>
          </div>
          <div class="p-3 bg-surface-container-low border border-outline-variant">
            <p class="font-mono text-[10px] uppercase text-outline mb-1">Players</p>
            <p class="font-mono text-lg font-bold">2-10</p>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">02</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Calling Cabo</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">When you call Cabo, every other player gets one more turn. Then all cards are revealed.</p>
        <ul class="space-y-2">
          <li class="flex items-start gap-3">
            <div class="mt-1.5 w-2 h-2 bg-secondary shrink-0"></div>
            <span class="text-sm"><span class="font-bold">Caller has lowest:</span> Score 0 for the round</span>
          </li>
          <li class="flex items-start gap-3">
            <div class="mt-1.5 w-2 h-2 bg-error shrink-0"></div>
            <span class="text-sm"><span class="font-bold">Caller doesn't have lowest:</span> Card total + 10 penalty</span>
          </li>
          <li class="flex items-start gap-3">
            <div class="mt-1.5 w-2 h-2 bg-[#FFB800] shrink-0"></div>
            <span class="text-sm"><span class="font-bold">Non-callers:</span> Their card total</span>
          </li>
        </ul>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">03</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">Special Rules</h3>
      </div>
      <div class="bg-primary text-on-primary p-6">
        <p class="text-sm tracking-wide opacity-80 uppercase font-mono mb-2">THE KAMIKAZE</p>
        <h4 class="text-2xl font-headline font-black uppercase tracking-tighter leading-none mb-3">The Perfect Reset</h4>
        <p class="opacity-90 leading-relaxed text-sm">End the round with exactly two 12s and two 13s: your score is 0, every other player gets 50 penalty points.</p>
      </div>
      <div class="mt-4 bg-surface-container-lowest p-4 border border-outline-variant">
        <p class="font-headline font-bold text-sm uppercase mb-2">Exact 100 Rule</p>
        <p class="text-sm text-on-surface-variant">If your cumulative total lands on exactly 100, it resets to 50.</p>
      </div>
    </section>

    <section>
      <div class="flex items-start gap-4 mb-4">
        <span class="font-mono text-sm text-outline border border-outline px-2 py-1">04</span>
        <h3 class="text-xl font-bold uppercase tracking-tight font-headline">End Condition</h3>
      </div>
      <div class="pl-6 border-l border-outline-variant space-y-3">
        <p class="text-sm text-on-surface-variant leading-relaxed">The game ends when any player's cumulative total exceeds 100. The player with the <span class="font-bold">lowest total</span> wins.</p>
        <p class="text-sm text-on-surface-variant leading-relaxed">If the lowest score is tied, the game enters <span class="font-bold uppercase">overtime</span> until a unique winner exists.</p>
      </div>
    </section>
  `,
};
