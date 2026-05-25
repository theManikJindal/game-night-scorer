// ═══════════════════════════════════════════
// Winner Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import { getGame } from '../games/registry.js';
import { ACCENT_COLORS } from '../state.js';
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
    <div class="h-full flex flex-col bg-primary text-on-primary">
      <!-- Back button -->
      <div class="flex items-center px-4 pt-4 shrink-0">
        <button id="btn-back-lobby" aria-label="Back to lobby" class="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">
          <span aria-hidden="true" class="material-symbols-outlined text-base">arrow_back</span>
          LOBBY
        </button>
      </div>
      <!-- Hero -->
      <main class="flex-1 flex flex-col items-center justify-center px-6 pt-4 pb-8">
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
        <div class="w-full max-w-sm mx-auto divide-y divide-white/20">
          ${(() => {
            const cfg = game.config || {};
            const juaOn = !!cfg.jua;
            const buyIn = cfg.juaBuyIn || 0;
            const firstSaveAmt = cfg.juaFirstSave || 5;
            const influenceFine = cfg.juaInfluenceFine || 10;
            const numPlayers = (game.playerIds || []).length;
            const baseShare = (buyIn * numPlayers) / 3;

            const rounds = Object.values(game.rounds || {});
            const savesCounts = {};
            rounds.forEach((rnd) => {
              const pid = rnd.jua?.firstSavePid;
              if (pid) savesCounts[pid] = (savesCounts[pid] || 0) + 1;
            });

            let pool = rounds.filter((r) => r.jua?.firstSavePid).length * firstSaveAmt;
            pool += Object.values(game.juaFines || {}).reduce((s, n) => s + n, 0) * influenceFine;

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
            const pot1 = baseShare + 20 + pool;
            const pot2 = baseShare;
            const pot3 = baseShare - 20;

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
              let netLabel = '';
              if (juaOn) {
                const savesCount = savesCounts[s.playerId] || 0;
                const finesCount = (game.juaFines || {})[s.playerId] || 0;
                const savesCost = savesCount * firstSaveAmt;
                const finesCost = finesCount * influenceFine;
                const reward = positionReward(s.rank);
                const net = reward - buyIn - savesCost - finesCost;
                const terms = [];
                if (s.rank === 1) {
                  // Split into base position amount and pool share, even for ties
                  const potsCount = Math.min(n1, 3);
                  const totalNoPool = [pot1, pot2, pot3].slice(0, potsCount).reduce((a, b) => a + b, 0) - pool;
                  terms.push(fmt(Math.round(totalNoPool / n1)));
                  if (pool > 0) terms.push(fmt(Math.round(pool / n1)));
                } else if (s.rank <= 3) {
                  terms.push(fmt(Math.round(reward)));
                }
                if (savesCount > 0) terms.push(`+ (-${firstSaveAmt} x ${savesCount})`);
                if (finesCount > 0) terms.push(`+ (-${influenceFine} x ${finesCount})`);
                terms.push(fmt(-buyIn));
                const mathStr = terms.length > 1
                  ? `${terms.join(' ')} = ${fmt(Math.round(net))}`
                  : fmt(Math.round(net));
                netLabel = `<p class="font-mono text-sm opacity-70">${mathStr}</p>`;
              }
              return `
                <div class="flex flex-col py-2">
                  <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                      <span class="font-mono text-sm opacity-50 w-6 text-center">${s.rank}</span>
                      <span class="font-headline font-bold text-lg uppercase">${escapeHTML(p.name || s.playerId)}</span>
                    </div>
                    <span class="font-mono text-xl font-bold">${s.total}</span>
                  </div>
                  ${netLabel ? `<div class="text-right mt-1">${netLabel}</div>` : ''}
                </div>
              `;
            }).join('');

            // Tie breakdown explanation — only shown when jua is on and there's a tie
            const hasTie = juaOn && (n1 > 1 || n2 > 1 || n3 > 1);
            let tieHtml = '';
            if (hasTie) {
              const r = (v) => Math.round(v);
              const posLine = (rank, count) => {
                const label = ['1st', '2nd', '3rd'][rank - 1];
                const pot = [pot1, pot2, pot3][rank - 1];
                if (count === 0) return `${label} (0 players)`;
                if (rank === 1 && count >= 3) {
                  const each = r((pot1 + pot2 + pot3) / count);
                  return `${label} (tie, ${count} players): +${r(pot1)} + ${r(pot2)} + ${r(pot3)} / ${count} = ${each}`;
                }
                if (rank === 1 && count === 2) {
                  const each = r((pot1 + pot2) / 2);
                  return `${label} (tie, 2 players): +${r(pot1)} + ${r(pot2)} / 2 = ${each}`;
                }
                if (rank === 2 && count >= 2) {
                  const each = r((pot2 + pot3) / count);
                  return `${label} (tie, ${count} players): +${r(pot2)} + ${r(pot3)} / ${count} = ${each}`;
                }
                if (rank === 3 && count >= 2) {
                  const each = r(pot3 / count);
                  return `${label} (tie, ${count} players): +${r(pot3)} / ${count} = ${each}`;
                }
                return `${label} (1 player): +${r(pot)}`;
              };
              const lines = [posLine(1, n1), posLine(2, n2), posLine(3, n3)];
              tieHtml = `
                <div class="mt-4 bg-white text-black p-4 space-y-1">
                  ${lines.map((l) => `<p class="font-mono text-xs">${escapeHTML(l)}</p>`).join('')}
                </div>
              `;
            }

            return rowsHtml + tieHtml;
          })()}
        </div>

      </main>

      <!-- Actions -->
      <footer class="p-6 space-y-3 shrink-0">
        <button id="btn-lobby" class="w-full py-4 bg-surface-container-lowest text-primary font-headline font-extrabold uppercase tracking-widest text-base transition-colors hover:bg-surface-container-high">
          BACK TO LOBBY
        </button>
        ${trackStats ? `
        <button id="btn-recap" class="w-full py-4 border border-white/40 text-white font-headline font-extrabold uppercase tracking-widest text-base transition-colors hover:bg-white/10 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-lg" aria-hidden="true">bar_chart</span>
          VIEW NIGHT RECAP
        </button>
        ` : ''}
      </footer>
    </div>
  `;

  container.querySelector('#btn-back-lobby')?.addEventListener('click', () => {
    router.navigate('lobby', { roomCode });
  });

  container.querySelector('#btn-lobby')?.addEventListener('click', () => {
    router.navigate('lobby', { roomCode });
  });

  container.querySelector('#btn-recap')?.addEventListener('click', () => {
    router.navigate('recap', { roomCode });
  });
}

export function unmount() {}
