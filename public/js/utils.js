// ═══════════════════════════════════════════
// Shared Utilities
// ═══════════════════════════════════════════

/**
 * Escape HTML special characters to prevent XSS when
 * interpolating user input into innerHTML template literals.
 */
export function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Show a centered modal confirmation dialog before committing a round.
 * playerScores: Array of { name: string, score: number } for all active players.
 * Returns a Promise<boolean> — true if host confirms, false if cancelled.
 */
export function confirmRoundDialog(playerScores) {
  return new Promise((resolve) => {
    const nonZero = playerScores
      .filter((p) => p.score !== 0)
      .sort((a, b) => (b.flip7 || b.firstSave ? 1 : 0) - (a.flip7 || a.firstSave ? 1 : 0));
    const zeros = playerScores.filter((p) => p.score === 0);
    const allZero = nonZero.length === 0;
    const zeroFirstSave = allZero ? zeros.find((p) => p.firstSave) : null;

    const el = document.createElement('div');
    el.className = 'fixed inset-0 z-50 flex items-center justify-center px-6';
    el.innerHTML = `
      <div id="crd-backdrop" class="absolute inset-0 bg-black/50"></div>
      <div class="relative w-full max-w-sm bg-surface-container-lowest border-2 border-outline">
        <div class="px-5 pt-5 pb-3 border-b border-outline-variant">
          <p class="font-headline font-bold text-xl uppercase">
            ${allZero ? 'All players scored zero?' : 'Scores this round'}
          </p>
        </div>
        <div class="px-5 pt-3 pb-2 space-y-2 max-h-48 overflow-y-auto">
          ${(!allZero ? nonZero : zeroFirstSave ? [zeroFirstSave] : []).map((p) => `
            <div class="flex items-center justify-between">
              <span class="font-headline font-bold text-sm uppercase truncate">${escapeHTML(p.name)}</span>
              <span class="font-mono font-bold text-sm shrink-0 ml-2">${p.flip7 ? '🔥 ' : p.firstSave ? '❤️ ' : ''}${zeroFirstSave === p ? '' : p.score}</span>
            </div>
          `).join('')}
          ${!allZero && zeros.length > 0 ? `
            <div class="pt-1 border-t border-outline-variant">
              <p class="font-mono text-[10px] uppercase tracking-widest text-outline">
                All other players scored 0
              </p>
            </div>
          ` : ''}
        </div>
        <div class="px-5 pb-5 pt-3 flex gap-2">
          <button id="crd-cancel" type="button" class="flex-1 btn-secondary py-2 text-sm">CANCEL</button>
          <button id="crd-confirm" type="button" class="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-1">
            CONFIRM
            <span aria-hidden="true" class="material-symbols-outlined text-base">check</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    const cleanup = (result) => {
      document.body.style.overflow = '';
      el.remove();
      resolve(result);
    };

    el.querySelector('#crd-backdrop').addEventListener('click', () => cleanup(false));
    el.querySelector('#crd-cancel').addEventListener('click', () => cleanup(false));
    el.querySelector('#crd-confirm').addEventListener('click', () => cleanup(true));
  });
}

/**
 * Confirm dialog for saving edits.
 * changes: Array of { name, beforeScore, beforeFirstSave, afterScore, afterFirstSave, flip7 }.
 * Returns Promise<boolean>.
 */
export function confirmSaveDialog(changes) {
  const scoreLabel = (score, firstSave, flip7) => {
    const parts = [];
    if (flip7) parts.push('🔥');
    if (firstSave) parts.push('❤️');
    parts.push(score);
    return parts.join(' ');
  };

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'fixed inset-0 z-50 flex items-center justify-center px-6';
    el.innerHTML = `
      <div id="csd-backdrop" class="absolute inset-0 bg-black/50"></div>
      <div class="relative w-full max-w-sm bg-surface-container-lowest border-2 border-outline">
        <div class="px-5 pt-5 pb-3 border-b border-outline-variant">
          <p class="font-headline font-bold text-xl uppercase">Save changes?</p>
        </div>
        <div class="px-5 pt-3 pb-2 max-h-48 overflow-y-auto">
          <div style="display:grid;grid-template-columns:1fr auto auto;column-gap:2rem;row-gap:0.5rem;align-items:center;">
            <div></div>
            <div class="font-mono text-[10px] uppercase tracking-widest text-outline text-right">Before</div>
            <div class="font-mono text-[10px] uppercase tracking-widest text-outline text-right">After</div>
            ${changes.map((p) => `
              <span class="font-headline font-bold text-sm uppercase truncate">${escapeHTML(p.name)}</span>
              <span class="font-mono text-sm text-right">${scoreLabel(p.beforeScore, p.beforeFirstSave, p.flip7)}</span>
              <span class="font-mono text-sm text-right">${scoreLabel(p.afterScore, p.afterFirstSave, p.flip7)}</span>
            `).join('')}
          </div>
        </div>
        <div class="px-5 pb-5 pt-3 flex gap-2">
          <button id="csd-cancel" type="button" class="flex-1 btn-secondary py-2 text-sm">CANCEL</button>
          <button id="csd-confirm" type="button" class="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-1">
            SAVE
            <span aria-hidden="true" class="material-symbols-outlined text-base">check</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    const cleanup = (result) => {
      document.body.style.overflow = '';
      el.remove();
      resolve(result);
    };

    el.querySelector('#csd-backdrop').addEventListener('click', () => cleanup(false));
    el.querySelector('#csd-cancel').addEventListener('click', () => cleanup(false));
    el.querySelector('#csd-confirm').addEventListener('click', () => cleanup(true));
  });
}
