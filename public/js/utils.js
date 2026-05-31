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
    // A player gets their own row if they scored, hit flip7, or earned a first save —
    // even when that score is 0 (first save at 0 points still counts).
    const shown = playerScores
      .filter((p) => p.score !== 0 || p.flip7 || p.firstSave)
      .sort((a, b) => (b.flip7 || b.firstSave ? 1 : 0) - (a.flip7 || a.firstSave ? 1 : 0));
    const others = playerScores.filter((p) => p.score === 0 && !p.flip7 && !p.firstSave);

    const rows = [
      ...shown.map((p) => ({
        name: p.name,
        value: `${p.flip7 ? '🔥 ' : p.firstSave ? '❤️ ' : ''}${p.score}`,
      })),
      ...(others.length > 0 ? [{ name: shown.length === 0 ? 'All' : 'Others', value: '0' }] : []),
    ];

    const el = document.createElement('div');
    el.className = 'fixed inset-0 z-50 flex items-center justify-center px-6';
    el.style.cssText = 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div id="crd-backdrop" class="absolute inset-0 bg-black/50"></div>
      <div class="relative w-full max-w-sm bg-surface-container-low border-2 border-outline">
        <div class="px-5 pt-5 pb-3 border-b border-outline-variant">
          <p class="font-headline font-extrabold text-xl uppercase">
            Confirm round
          </p>
        </div>
        <div class="px-5 pt-3 pb-2 max-h-48 overflow-y-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-b-primary">
                <th class="px-3 py-2 font-mono text-lg uppercase tracking-widest text-left">Player</th>
                <th class="px-3 py-2 font-mono text-lg uppercase tracking-widest text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="border-b border-outline-variant last:border-0">
                  <td class="px-3 py-2 font-headline font-bold text-base uppercase truncate">${escapeHTML(r.name)}</td>
                  <td class="px-3 py-2 font-mono font-bold text-base text-right whitespace-nowrap">${r.value}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="px-5 pb-5 pt-3 flex gap-2">
          <button id="crd-cancel" type="button" aria-label="Cancel" class="btn-secondary flex-none flex items-center justify-center self-stretch" style="padding:0;background:#f4f4f2">
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
          <button id="crd-confirm" type="button" class="btn-primary" style="flex:3">CONFIRM</button>
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
    const crdCancel = el.querySelector('#crd-cancel');
    crdCancel.addEventListener('click', () => cleanup(false));
    el.querySelector('#crd-confirm').addEventListener('click', () => cleanup(true));
    requestAnimationFrame(() => { crdCancel.style.width = crdCancel.offsetHeight + 'px'; });
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
    el.style.cssText = 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div id="csd-backdrop" class="absolute inset-0 bg-black/50"></div>
      <div class="relative w-full max-w-sm bg-surface-container-low border-2 border-outline">
        <div class="px-5 pt-5 pb-3 border-b border-outline-variant">
          <p class="font-headline font-extrabold text-xl uppercase">Save changes?</p>
        </div>
        <div class="px-5 pt-3 pb-2 max-h-48 overflow-y-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-b-primary">
                <th class="px-3 py-2 font-mono text-lg uppercase tracking-widest text-left">Player</th>
                <th class="px-3 py-2 font-mono text-lg uppercase tracking-widest text-right">Before</th>
                <th class="px-3 py-2 font-mono text-lg uppercase tracking-widest text-right">After</th>
              </tr>
            </thead>
            <tbody>
              ${changes.map((p) => `
                <tr class="border-b border-outline-variant last:border-0">
                  <td class="px-3 py-2 font-headline font-bold text-base uppercase truncate">${escapeHTML(p.name)}</td>
                  <td class="px-3 py-2 font-mono font-bold text-base text-right whitespace-nowrap">${scoreLabel(p.beforeScore, p.beforeFirstSave, p.flip7)}</td>
                  <td class="px-3 py-2 font-mono font-bold text-base text-right whitespace-nowrap">${scoreLabel(p.afterScore, p.afterFirstSave, p.flip7)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="px-5 pb-5 pt-3 flex gap-2">
          <button id="csd-cancel" type="button" aria-label="Cancel" class="btn-secondary flex-none flex items-center justify-center self-stretch" style="padding:0;background:#f4f4f2">
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
          <button id="csd-confirm" type="button" class="btn-primary" style="flex:3">SAVE</button>
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
    const csdCancel = el.querySelector('#csd-cancel');
    csdCancel.addEventListener('click', () => cleanup(false));
    el.querySelector('#csd-confirm').addEventListener('click', () => cleanup(true));
    requestAnimationFrame(() => { csdCancel.style.width = csdCancel.offsetHeight + 'px'; });
  });
}
