// ═══════════════════════════════════════════
// Winner Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import { getGame } from '../games/registry.js';
import { accentColor } from '../state.js';
import { escapeHTML } from '../utils.js';

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
  document.getElementById('top-bar-title').textContent = 'WINNER';
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.remove('hidden');
  backBtn.textContent = 'arrow_back';
  backBtn.setAttribute('aria-label', 'Go back');
  backBtn.onclick = () => router.navigate('lobby', { roomCode });
  document.getElementById('top-bar-actions').innerHTML = '';
  bottomNav.show('winner');

  const gameModule = getGame(game.type);
  const snapshot = game.playerSnapshot || {};
  const totals = game.totals || {};
  const juaOn = !!(game.config?.jua);

  // Derive standings
  const standings = gameModule.deriveStandings(totals, game.playerIds);
  const winner = snapshot[game.winner] || {};
  const winnerTotal = totals[game.winner] || 0;
  const winnerColor = accentColor(winner.accentIndex);

  container.innerHTML = `
    <div class="h-full flex flex-col bg-primary text-on-primary">
      <!-- Hero -->
      <main class="flex-1 flex flex-col items-center overflow-y-auto min-h-0 px-6 pt-6 pb-8">
        <div id="hero-section" class="text-center w-full max-w-sm mx-auto mb-12">
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
        <div class="w-full max-w-sm mx-auto">
          ${(() => {
            const cfg = game.config || {};
            const juaOn = !!cfg.jua;
            const buyIn = cfg.juaBuyIn || 0;
            const firstSaveAmt = cfg.juaFirstSave || 5;
            const influenceFine = cfg.juaInfluenceFine || 10;
            const numPlayers = (game.playerIds || []).length;
            const totalPot = buyIn * numPlayers;
            const prize1 = cfg.juaPrize1 || 0;
            const prize2 = cfg.juaPrize2 || 0;
            const prize3 = totalPot - prize1 - prize2;

            const rounds = Object.values(game.rounds || {});
            const savesCounts = {};
            rounds.forEach((rnd) => {
              const pid = rnd.jua?.firstSavePid;
              if (pid) savesCounts[pid] = (savesCounts[pid] || 0) + 1;
            });

            let pool = rounds.filter((r) => r.jua?.firstSavePid).length * firstSaveAmt;
            pool += Object.values(game.juaFines || {}).reduce((s, n) => s + n, 0) * influenceFine;

            const d1 = (v) => parseFloat(v.toFixed(1));
            const fmt = (n) => `${n >= 0 ? '+' : ''}${n}`;

            // Group standings by rank to detect ties
            const byRank = {};
            standings.forEach((s) => {
              if (!byRank[s.rank]) byRank[s.rank] = [];
              byRank[s.rank].push(s);
            });
            const n1 = (byRank[1] || []).length;
            const n2 = (byRank[2] || []).length;
            const n3 = (byRank[3] || []).length;

            // Base position pots (before personal costs)
            const pot1 = prize1 + pool;
            const pot2 = prize2;
            const pot3 = prize3;

            // Position reward per player accounting for ties
            const positionReward = (rank) => {
              if (rank === 1) {
                if (n1 >= 3) return (pot1 + pot2 + pot3) / n1;
                if (n1 === 2) return (pot1 + pot2) / 2;
                return pot1;
              }
              if (rank === 2) {
                if (n2 >= 2) return (pot2 + pot3) / n2;
                return pot2;
              }
              if (rank === 3) {
                if (n3 >= 2) return pot3 / n3;
                return pot3;
              }
              return 0;
            };

            const rowsHtml = standings.map((s) => {
              const p = snapshot[s.playerId] || {};
              const savesCount = savesCounts[s.playerId] || 0;
              const finesCount = (game.juaFines || {})[s.playerId] || 0;

              // Save/Fines label shown in scores view
              const sfParts = [];
              if (savesCount > 0) sfParts.push(`Save: ${savesCount}`);
              if (finesCount > 0) sfParts.push(`Fines: ${finesCount}`);
              const sfLine = juaOn && sfParts.length > 0
                ? `<p class="font-mono text-xs opacity-60 mt-2">${sfParts.join(', ')}</p>` : '';

              // Winnings math shown in winnings view
              let formulaStr = '';
              let amountStr = '';
              if (juaOn) {
                const savesCost = savesCount * firstSaveAmt;
                const finesCost = finesCount * influenceFine;
                const reward = positionReward(s.rank);
                const net = reward - buyIn - savesCost - finesCost;
                const terms = [];
                if (s.rank === 1 && n1 === 1) {
                  terms.push(fmt(prize1));
                  if (pool > 0) terms.push(fmt(pool));
                } else if (s.rank <= 3) {
                  terms.push(fmt(d1(reward)));
                }
                if (savesCount > 0) terms.push(`+ (-${firstSaveAmt} x ${savesCount})`);
                if (finesCount > 0) terms.push(`+ (-${influenceFine} x ${finesCount})`);
                terms.push(fmt(-buyIn));
                const absNet = parseFloat(Math.abs(net).toFixed(1));
                amountStr = `${net >= 0 ? '+' : '-'}₹${absNet}`;
                formulaStr = terms.length > 1 ? terms.join(' ') : '';
              }

              return `
                <div class="py-2">
                  <!-- Scores view -->
                  <div class="score-row flex justify-between items-start">
                    <div class="flex items-start gap-3">
                      <span class="font-mono text-sm opacity-50 w-6 text-center mt-1">${s.rank}</span>
                      <div>
                        <p class="font-headline font-bold text-lg uppercase leading-tight">${escapeHTML(p.name || s.playerId)}</p>
                        ${sfLine}
                      </div>
                    </div>
                    <span class="font-mono text-xl font-bold">${s.total}</span>
                  </div>
                  ${juaOn ? `
                  <!-- Winnings view -->
                  <div class="winnings-row flex justify-between items-start gap-3" style="display:none">
                    <div class="flex items-start gap-3 min-w-0">
                      <span class="font-mono text-sm opacity-50 w-6 shrink-0 text-center">${s.rank}</span>
                      <div class="min-w-0">
                        <p class="font-headline font-bold text-lg uppercase leading-tight">${escapeHTML(p.name || s.playerId)}</p>
                        ${formulaStr ? `<p class="font-mono text-xs opacity-70 leading-relaxed mt-1">${formulaStr}</p>` : ''}
                      </div>
                    </div>
                    <p class="font-headline font-bold text-lg shrink-0">${amountStr}</p>
                  </div>
                  ` : ''}
                </div>
              `;
            }).join('');

            // Tie breakdown card — hidden until winnings view is active
            const hasTie = juaOn && (n1 > 1 || n2 > 1 || n3 > 1);
            let tieHtml = '';
            if (juaOn) {
              const r = (v) => parseFloat(v.toFixed(1));
              const posRow = (rank, count) => {
                const label = ['1st', '2nd', '3rd'][rank - 1];
                const base1 = r(prize1);
                const poolPart = pool > 0 ? `+${r(pool)} ` : '';
                let math, each;
                if (rank === 1) {
                  if (count >= 3) {
                    math = `${poolPart}+${base1} + ${r(pot2)} + ${r(pot3)}`;
                    each = count > 0 ? r((pot1 + pot2 + pot3) / count) : null;
                  } else if (count === 2) {
                    math = `${poolPart}+${base1} + ${r(pot2)}`;
                    each = r((pot1 + pot2) / 2);
                  } else {
                    math = `${poolPart}+${base1}`;
                    each = count > 0 ? r(pot1) : null;
                  }
                } else if (rank === 2) {
                  if (count >= 2) {
                    math = `+${r(pot2)} + ${r(pot3)}`;
                    each = r((pot2 + pot3) / count);
                  } else {
                    math = `+${r(pot2)}`;
                    each = count > 0 ? r(pot2) : null;
                  }
                } else {
                  math = `+${r(pot3)}`;
                  each = count >= 2 ? r(pot3 / count) : (count > 0 ? r(pot3) : null);
                }
                return { label, math, count, each };
              };
              const tieRows = [posRow(1, n1), posRow(2, n2), posRow(3, n3)].filter((row) => row.count > 0);
              tieHtml = `
                <div id="tie-card" style="display:none" class="mt-4 mb-6 bg-white text-black p-4">
                  <table class="w-full font-mono text-xs border-collapse">
                    <thead>
                      <tr class="border-b border-black/20">
                        <th class="text-left pb-2 font-bold uppercase tracking-widest">#</th>
                        <th class="text-left pb-2 font-bold uppercase tracking-widest px-2">Winnings</th>
                        <th class="text-center pb-2 font-bold uppercase tracking-widest px-2">Players</th>
                        <th class="text-right pb-2 font-bold uppercase tracking-widest">Each</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tieRows.map((row) => `
                        <tr class="border-b border-black/10 last:border-0">
                          <td class="py-1.5 pr-2">${escapeHTML(row.label)}</td>
                          <td class="py-1.5 px-2">${escapeHTML(row.math)}</td>
                          <td class="py-1.5 px-2 text-center">${row.count}</td>
                          <td class="py-1.5 text-right font-bold">${row.each !== null ? `₹${row.each}` : '—'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }

            return tieHtml + `<div class="divide-y divide-white/20">${rowsHtml}</div>`;
          })()}
        </div>

      </main>

      <!-- Actions (jua winnings toggle; Lobby/Recap live in the bottom nav) -->
      ${juaOn ? `
      <footer class="p-6 shrink-0">
        <button id="btn-toggle-view" class="w-full py-4 bg-white text-primary font-headline font-extrabold uppercase tracking-widest text-base transition-opacity hover:opacity-90">
          VIEW WINNINGS
        </button>
      </footer>
      ` : ''}
    </div>
  `;

  const _applyView = (showWinnings) => {
    const btn = container.querySelector('#btn-toggle-view');
    if (btn) btn.textContent = showWinnings ? 'VIEW SCORES' : 'VIEW WINNINGS';
    const hero = container.querySelector('#hero-section');
    if (hero) hero.style.display = showWinnings ? 'none' : '';
    container.querySelectorAll('.score-row').forEach((el) => {
      el.style.display = showWinnings ? 'none' : 'flex';
    });
    container.querySelectorAll('.winnings-row').forEach((el) => {
      el.style.display = showWinnings ? 'flex' : 'none';
    });
    const tieCard = container.querySelector('#tie-card');
    if (tieCard) tieCard.style.display = showWinnings ? 'block' : 'none';
  };

  let showWinnings = juaOn && localStorage.getItem('gns_winner_view') === 'winnings';
  _applyView(showWinnings);

  container.querySelector('#btn-toggle-view')?.addEventListener('click', () => {
    showWinnings = !showWinnings;
    localStorage.setItem('gns_winner_view', showWinnings ? 'winnings' : 'scores');
    _applyView(showWinnings);
  });
}

export function unmount() {}
