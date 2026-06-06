// ═══════════════════════════════════════════
// Reusable Player Scoreboard Row
// ═══════════════════════════════════════════

import { accentColor } from '../state.js';
import { escapeHTML } from '../utils.js';

/**
 * Renders a player row for the dashboard scoreboard.
 * @param {Object} opts
 * @param {string} opts.name
 * @param {number} opts.total
 * @param {number} opts.accentIndex
 * @param {number} opts.rank - 1-based rank
 * @param {Array}  opts.rounds - array of round point values for chips
 * @param {number} opts.progressPct - 0-100 progress toward end condition
 * @param {boolean} opts.isLeader
 * @param {string} opts.winMode - 'highest_total' or 'lowest_total'
 * @returns {string} HTML string
 */
export function renderRow({
  name,
  total,
  accentIndex,
  rank,
  rounds = [],
  roundsMeta = [],
  roundsJuaMeta = [],

  hasLiveChip = false,
  progressPct = 0,
  isLeader = false,
  winMode = 'highest_total',
  fineCount = 0,
}) {
  const color = accentColor(accentIndex);
  const bgClass = 'bg-surface-container-lowest';

  // Guard against NaN/Infinity leaking into the UI. If we ever see one,
  // render a dash instead so the user isn't staring at 'NaN PTS' — and
  // leave a console trace so we can track down the source.
  let displayTotal = total;
  if (!Number.isFinite(total)) {
    console.warn('Non-finite total rendered in player row:', { name, total });
    displayTotal = '—';
  }

  const rankLabel = rank <= 3
    ? ['1ST', '2ND', '3RD'][rank - 1]
    : `${rank}TH`;

  const chipList = rounds.map((pts, i) => {
    const label = `${pts}${roundsMeta[i] ? ' 🔥' : ''}${roundsJuaMeta[i] ? ' ❤️' : ''}`;
    const isLive = hasLiveChip && i === rounds.length - 1;
    if (isLive) {
      return `<span class="inline-block font-mono text-sm px-1.5 py-0.5" style="background:#000;color:#fff;border:1px solid #000">${label}</span>`;
    }
    return `<span class="inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface">${label}</span>`;
  });
  const fineChips = fineCount > 0
    ? [`<span class="inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface">👎 ${fineCount}</span>`]
    : [];
  const allChips = [...fineChips, ...chipList];
  const roundChips = allChips.length === 0 ? '' : (() => {
    let rows = '';
    for (let i = 0; i < allChips.length; i += 5) {
      rows += `<div class="flex gap-1">${allChips.slice(i, i + 5).join('')}</div>`;
    }
    return rows;
  })();

  return `
    <div class="flex flex-col border border-outline ${bgClass}">
      <div class="accent-bar" style="background:${color}"></div>
      <div class="flex items-stretch flex-1">
        <div class="flex items-center justify-center shrink-0 min-w-[2.5rem] border-r border-outline">
          <span class="font-mono text-2xl font-bold">${rank}</span>
        </div>
        <div class="flex-1 accent-${accentIndex} group">
          <div class="p-4 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <p class="font-headline font-extrabold text-xl uppercase truncate">${escapeHTML(name)}</p>
              ${allChips.length > 0 ? `<div class="flex flex-col gap-1 mt-2">${roundChips}</div>` : ''}
            </div>
            <div class="text-right shrink-0">
              <p class="font-mono text-2xl font-bold">${displayTotal}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
