// ═══════════════════════════════════════════
// Winner Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import * as confetti from '../components/confetti.js';
import { getGame } from '../games/registry.js';
import { accentColor } from '../state.js';
import { cumulativeJuaNets } from '../stats.js';
import { escapeHTML } from '../utils.js';

// Tracks which game's winner we've already auto-celebrated, so returning to the
// winner tab for the same game doesn't re-fire the confetti.
let _celebratedGameId = null;
let _unsubLobby = null;
let _unsubGames = null;

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
  document.getElementById('top-bar-title').textContent = 'Flip 7';
  // No back button — winner is a bottom-nav tab, navigable like the other tabs.
  const backBtn = document.getElementById('top-bar-back');
  backBtn.classList.add('hidden');
  backBtn.onclick = null;
  hostMenu.renderTopBarActions(roomCode);
  bottomNav.show('winner');

  const gameModule = getGame(game.type);
  const snapshot = game.playerSnapshot || {};
  const totals = game.totals || {};
  const juaOn = !!(game.config?.jua);

  // Derive standings
  const standings = gameModule.deriveStandings(totals, game.playerIds);
  const winner = snapshot[game.winner] || {};
  const winnerColor = accentColor(winner.accentIndex);

  container.innerHTML = `
    <div class="h-full flex flex-col bg-background text-on-surface">
      <!-- Hero -->
      <main class="screen-body flex-1 flex flex-col items-center overflow-y-auto min-h-0 ${juaOn ? 'pb-28' : 'pb-8'}">
        <div id="hero-section" role="button" tabindex="0" aria-label="Celebrate again" title="Tap to celebrate again" class="text-center w-full max-w-sm mx-auto mb-12 cursor-pointer select-none">
          <div class="flex items-center justify-center gap-2 mb-4">
            <span aria-hidden="true" class="material-symbols-outlined text-[2.5rem]" style="font-variation-settings: 'FILL' 1;">emoji_events</span>
            <span class="font-headline text-xl uppercase tracking-widest opacity-80">WINNER</span>
          </div>

          <h1 class="confetti-text font-headline font-black text-7xl uppercase tracking-tight leading-none truncate">${escapeHTML(winner.name || 'UNKNOWN')}</h1>
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

            // Only show the Saves/Fines column for JUA games that actually had
            // at least one save or fine — otherwise it's an empty column.
            const showSavesFines = juaOn && (
              Object.values(savesCounts).some((n) => n > 0)
              || Object.values(game.juaFines || {}).some((n) => n > 0)
            );

            // This game's net winnings for a standing (0 when JUA is off). Used
            // below as the displayed amount in the Winnings column.
            const netOf = (s) => {
              if (!juaOn) return 0;
              const savesCount = savesCounts[s.playerId] || 0;
              const finesCount = (game.juaFines || {})[s.playerId] || 0;
              return positionReward(s.rank) - buyIn
                - savesCount * firstSaveAmt - finesCount * influenceFine;
            };

            // Secondary sort key: each player's cumulative net winnings across the
            // night's completed games so far — excluding the game shown here (the
            // active game). Filter by the games map key so it's robust even if a
            // game object lacks a gameId field.
            const allGames = state.get('games') || {};
            const activeId = state.get('roomLobby')?.activeGameId || null;
            const priorGames = Object.entries(allGames)
              .filter(([id]) => id !== activeId)
              .map(([, g]) => g);
            const priorWinnings = cumulativeJuaNets(priorGames);

            // Order: rank ascending, then cumulative prior winnings descending
            // within the same rank (higher earners first). Both tables render from
            // this single sorted list so Scores and Winnings stay aligned.
            const sortedStandings = [...standings].sort((a, b) => {
              if (a.rank !== b.rank) return a.rank - b.rank;
              return (priorWinnings.get(b.playerId) || 0) - (priorWinnings.get(a.playerId) || 0);
            });

            const rows = sortedStandings.map((s) => {
              const p = snapshot[s.playerId] || {};
              const savesCount = savesCounts[s.playerId] || 0;
              const finesCount = (game.juaFines || {})[s.playerId] || 0;

              // Saves/Fines chips shown in the scores table (JUA only) — mirror the
              // fine chip on the dashboard: a heart save chip and a 👎 fine chip,
              // each rendered only when the player has a non-zero count.
              const chipCls = 'inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface';
              const sfChips = [];
              if (juaOn && savesCount > 0) sfChips.push(`<span class="${chipCls}">❤️ ${savesCount}</span>`);
              if (juaOn && finesCount > 0) sfChips.push(`<span class="${chipCls}">👎 ${finesCount}</span>`);
              const sfText = sfChips.length > 0 ? `<div class="flex gap-1 justify-center">${sfChips.join('')}</div>` : '';

              // Winnings math shown in winnings view
              let formulaStr = '';
              let amountStr = '';
              let amountCls = ''; // green for a net gain, red for a net loss
              if (juaOn) {
                const savesCost = savesCount * firstSaveAmt;
                const finesCost = finesCount * influenceFine;
                const reward = positionReward(s.rank);
                const net = netOf(s);
                // Each term carries its own operator. Rewards (prize/pool) add;
                // saves, fines and buy-in subtract — shown as " - " separators with
                // the magnitude only (no inner minus sign on the number).
                const terms = [];
                if (s.rank === 1 && n1 === 1) {
                  terms.push({ op: '+', text: `${prize1}` });
                  if (pool > 0) terms.push({ op: '+', text: `${pool}` });
                } else if (s.rank <= 3) {
                  terms.push({ op: '+', text: `${d1(reward)}` });
                }
                // Non-breaking spaces inside the parens keep each "(a x b)" term on
                // one line; the surrounding " + " / " - " separators stay breakable.
                if (savesCount > 0) terms.push({ op: '-', text: `(${firstSaveAmt} x ${savesCount})` });
                if (finesCount > 0) terms.push({ op: '-', text: `(${influenceFine} x ${finesCount})` });
                if (buyIn > 0) terms.push({ op: '-', text: `${buyIn}` });
                const absNet = parseFloat(Math.abs(net).toFixed(1));
                // Sign, a small gap, then the amount. A flex row vertically centers
                // the sign, the larger ₹ (1.4x) and the digits as one unit, so the
                // alignment is consistent across rows regardless of content.
                amountStr = `<span class="inline-flex items-center justify-end">${net >= 0 ? '+' : '-'}<span class="ml-1.5 text-[1.4em] leading-none">₹</span>${absNet}</span>`;
                amountCls = net >= 0 ? 'text-green-600' : 'text-red-600';
                formulaStr = terms.length > 0
                  // Each "operator + term" is rendered as one nowrap span, joined by
                  // ordinary (breakable) spaces. A line can therefore only break
                  // between terms — never between an operator and the term it applies to.
                  ? terms.map((t, i) => {
                      const op = i === 0 ? (t.op === '-' ? '- ' : '') : `${t.op} `;
                      return `<span class="whitespace-nowrap">${op}${t.text}</span>`;
                    }).join(' ')
                  : '';
              }

              const scoreTr = `
                <tr>
                  <td class="py-3 pl-4 pr-3 text-center font-mono font-bold text-lg">${s.rank}</td>
                  <td class="py-3 pr-3 font-headline font-bold text-lg uppercase leading-tight">${escapeHTML(p.name || s.playerId)}</td>
                  ${showSavesFines ? `<td class="py-3 px-3 font-bold whitespace-nowrap">${sfText}</td>` : ''}
                  <td class="py-3 pl-3 pr-4 text-right font-mono font-bold text-lg">${s.total}</td>
                </tr>`;

              // The winnings cell holds both the amount and the (hidden) breakdown.
              // Tapping the cell swaps one for the other — per player, in place — so
              // the breakdown replaces the winnings number for just that row.
              const pid = escapeHTML(s.playerId);
              const name = escapeHTML(p.name || s.playerId);
              const winningsCell = formulaStr
                ? `<td data-winnings-pid="${pid}" role="button" tabindex="0" aria-pressed="false" aria-label="Show breakdown for ${name}" class="pt-3 pb-3 pl-3 pr-4 text-right align-middle cursor-pointer select-none">
                     <span class="winnings-amount font-mono font-bold text-lg whitespace-nowrap ${amountCls}">${amountStr}</span>
                     <span class="winnings-breakdown font-mono font-bold text-sm opacity-70 leading-relaxed" style="display:none">${formulaStr}</span>
                   </td>`
                : `<td class="pt-3 pb-3 pl-3 pr-4 text-right font-mono font-bold text-lg whitespace-nowrap align-middle ${amountCls}">${amountStr}</td>`;
              const winningsRow = juaOn ? `
                <tr>
                  <td class="pt-3 pb-3 pl-4 pr-3 text-center font-mono font-bold text-lg align-middle">${s.rank}</td>
                  <td class="pt-3 pb-3 pr-3 font-headline font-bold text-lg uppercase leading-tight align-middle">${name}</td>
                  ${winningsCell}
                </tr>` : '';

              return { scoreTr, winningsRow, hasBreakdown: !!formulaStr };
            });
            const scoreTrs = rows.map((r) => r.scoreTr).join('');
            const winningsRows = rows.map((r) => r.winningsRow).join('');

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
                <div id="tie-card" style="display:none" class="mt-4 mb-6 bg-surface-container-lowest border border-outline text-on-surface p-4">
                  <table class="w-full text-sm border-collapse">
                    <thead>
                      <tr class="border-b border-outline">
                        <th class="text-left pb-2 font-headline uppercase tracking-widest">#</th>
                        <th class="text-left pb-2 font-headline uppercase tracking-widest px-2">Winnings</th>
                        <th class="text-center pb-2 font-headline uppercase tracking-widest px-2">Players</th>
                        <th class="text-right pb-2 font-headline uppercase tracking-widest">Each</th>
                      </tr>
                    </thead>
                    <tbody class="font-mono">
                      ${tieRows.map((row) => `
                        <tr class="border-b border-outline-variant last:border-0">
                          <td class="py-1.5 pr-2">${escapeHTML(row.label)}</td>
                          <td class="py-1.5 px-2">${escapeHTML(row.math)}</td>
                          <td class="py-1.5 px-2 text-center">${row.count}</td>
                          <td class="py-1.5 text-right">${row.each !== null ? `₹${row.each}` : '—'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }

            const headCls = 'py-3 font-headline font-bold text-sm uppercase tracking-widest text-outline';
            // Fixed rank-column width shared by both tables so the rank cell and the
            // player column start at the same x — Scores and Winnings line up when
            // you switch tabs (and when breakdowns are hidden).
            const rankColStyle = 'width:3.5rem';
            const scoresTable = `
              <table id="scores-view" class="w-full border-collapse">
                <thead>
                  <tr class="border-b border-outline">
                    <th class="${headCls} pl-4 pr-3 text-center" style="${rankColStyle}">Rank</th>
                    <th class="${headCls} pr-3 text-left">Player</th>
                    ${showSavesFines ? `<th class="${headCls} px-3"></th>` : ''}
                    <th class="${headCls} pl-3 pr-4 text-right">Score</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant">${scoreTrs}</tbody>
              </table>`;
            const winningsView = juaOn
              ? `<table id="winnings-view" class="w-full border-collapse" style="display:none">
                <thead>
                  <tr class="border-b border-outline">
                    <th class="${headCls} pl-4 pr-3 text-center" style="${rankColStyle}">Rank</th>
                    <th class="${headCls} pr-3 text-left">Player</th>
                    <th id="winnings-col-header" role="button" tabindex="0" aria-label="Expand all breakdowns" class="${headCls} pl-3 pr-4 text-right cursor-pointer select-none whitespace-nowrap"><span class="material-symbols-outlined" style="font-size:1.25rem;vertical-align:middle;line-height:1">unfold_more</span> <span class="col-header-label">Winnings</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant">${winningsRows}</tbody>
              </table>`
              : '';
            return scoresTable + winningsView + tieHtml;
          })()}
        </div>

      </main>

      ${juaOn ? `
      <!-- Docked view switcher: Scores / Winnings (sits flush above the bottom nav) -->
      <div class="docked-bar p-4 bg-surface-container-low">
        <div role="tablist" aria-label="View" class="flex border border-outline">
          <button id="seg-scores" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Scores</button>
          <button id="seg-winnings" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Winnings</button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  const segScores = container.querySelector('#seg-scores');
  const segWinnings = container.querySelector('#seg-winnings');

  const _applyView = (showWinnings) => {
    if (segScores && segWinnings) {
      const active = 'bg-primary text-on-primary';
      segScores.className = `flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors ${showWinnings ? '' : active}`;
      segWinnings.className = `flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors ${showWinnings ? active : ''}`;
      segScores.setAttribute('aria-selected', String(!showWinnings));
      segWinnings.setAttribute('aria-selected', String(showWinnings));
    }
    // Hero (trophy + winner name) stays visible on both Scores and Winnings tabs.
    const scoresView = container.querySelector('#scores-view');
    if (scoresView) scoresView.style.display = showWinnings ? 'none' : '';
    const winningsView = container.querySelector('#winnings-view');
    if (winningsView) winningsView.style.display = showWinnings ? '' : 'none';
    const tieCard = container.querySelector('#tie-card');
    if (tieCard) tieCard.style.display = showWinnings ? 'block' : 'none';
  };

  const activeGameId = state.get('roomLobby')?.activeGameId || null;

  // Winnings breakdowns: each player's winnings cell can swap its amount for the
  // breakdown text. Tapping a cell toggles just that player, in place.
  const winningsCells = Array.from(container.querySelectorAll('[data-winnings-pid]'));

  const _setCellBreakdown = (cell, show) => {
    const amt = cell.querySelector('.winnings-amount');
    const bd = cell.querySelector('.winnings-breakdown');
    if (amt) amt.style.display = show ? 'none' : '';
    if (bd) bd.style.display = show ? '' : 'none';
    cell.setAttribute('aria-pressed', String(show));
  };

  let _allExpanded = false;

  const _setAllBreakdowns = (show) => {
    _allExpanded = show;
    winningsCells.forEach((cell) => _setCellBreakdown(cell, show));
    const header = container.querySelector('#winnings-col-header');
    if (header) {
      header.querySelector('.material-symbols-outlined').textContent = show ? 'unfold_less' : 'unfold_more';
      header.querySelector('.col-header-label').textContent = show ? 'Breakdown' : 'Winnings';
      header.setAttribute('aria-label', show ? 'Collapse all breakdowns' : 'Expand all breakdowns');
    }
  };

  winningsCells.forEach((cell) => {
    const toggle = () => {
      const amt = cell.querySelector('.winnings-amount');
      const showing = amt && amt.style.display === 'none';
      _setCellBreakdown(cell, !showing);
    };
    cell.addEventListener('click', toggle);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  const winningsHeader = container.querySelector('#winnings-col-header');
  if (winningsHeader) {
    winningsHeader.addEventListener('click', () => _setAllBreakdowns(!_allExpanded));
    winningsHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _setAllBreakdowns(!_allExpanded); }
    });
  }

  // The Scores/Winnings choice is remembered per game, so it survives tab
  // navigation but resets to Scores once a new game ends (the activeGameId
  // changes). Older string-only values fail the parse and fall back to Scores.
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('gns_winner_view')); } catch { /* legacy/invalid */ }

  let showWinnings = juaOn && stored?.gameId === activeGameId && stored?.view === 'winnings';
  _applyView(showWinnings);

  const _setView = (next) => {
    showWinnings = next;
    localStorage.setItem('gns_winner_view', JSON.stringify({
      gameId: activeGameId,
      view: showWinnings ? 'winnings' : 'scores',
    }));
    _applyView(showWinnings);
  };
  segScores?.addEventListener('click', () => _setView(false));
  segWinnings?.addEventListener('click', () => _setView(true));

  // Tapping the hero (trophy, "WINNER" label, or winner name) retriggers the rain.
  const hero = container.querySelector('#hero-section');
  if (hero) {
    hero.addEventListener('click', () => confetti.startRain());
    hero.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confetti.startRain(); }
    });
  }

  // Auto-celebrate the first time a game's winner is revealed — but not when
  // simply returning to the winner tab for the same game. The rain isn't tied to
  // this screen: it keeps falling even if you navigate away mid-celebration.
  if (_celebratedGameId !== activeGameId) {
    _celebratedGameId = activeGameId;
    confetti.startRain();
  }

  // When the host starts a new game while this screen is open, navigate everyone
  // to the dashboard so they land on the live board automatically.
  const shownGameId = game.gameId;
  const _checkNewGame = () => {
    const lobby = state.get('roomLobby') || {};
    if (lobby.activeGameId && lobby.activeGameId !== shownGameId) {
      const newGame = state.currentGame();
      if (newGame?.status === 'active') {
        router.navigate('dashboard', { roomCode });
      }
    }
  };
  _unsubLobby = state.on('roomLobby', _checkNewGame);
  _unsubGames = state.on('games', _checkNewGame);
}

export function unmount() {
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_unsubGames) { _unsubGames(); _unsubGames = null; }
}
