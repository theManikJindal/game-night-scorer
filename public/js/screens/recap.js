// ═══════════════════════════════════════════
// Night Recap Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import { computeNightStats } from '../stats.js';
import { escapeHTML } from '../utils.js';
import { buildSingleGameTables, wireSingleGameTables } from './single-game-tables.js';

// Backdrop for the View dropdown, reparented onto document.body while open.
// Tracked at module scope so unmount can tear it down if the screen changes
// while the dropdown is still open.
let _backdropEl = null;

// Live re-render subscription. Recap can stay mounted across a status change —
// e.g. the host taps "Call it a Night" from the recap tab, which locks the night
// but doesn't navigate (we're already here). Without this, the screen would show
// a stale "active" recap and the action would look like it did nothing.
let _unsubLobby = null;

function _closeDropdown(dropdownEl, trigger) {
  if (_backdropEl) { _backdropEl.remove(); _backdropEl = null; }
  if (dropdownEl) dropdownEl.style.display = 'none';
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

export function mount(container, params = {}) {
  // A re-mount (tab switch or live status change) supersedes any prior listener
  // and closes a dropdown left open on the previous render.
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_backdropEl) { _backdropEl.remove(); _backdropEl = null; }

  const roomCode = params.roomCode || state.get('roomCode');
  const lobby = state.get('roomLobby') || {};
  const locked = lobby.status === 'night-ended';

  // Recap is a bottom-nav tab in a Flip 7 night — including once it's locked,
  // so the recap stays browsable alongside the lobby/results.
  const isFlip7Night = Object.values(state.get('games') || {}).some((g) => g.type === 'flip7');
  if (isFlip7Night) {
    bottomNav.show('recap');
  } else {
    bottomNav.hide();
  }
  const topBar = document.getElementById('top-bar');
  topBar.style.display = 'flex';
  document.getElementById('top-bar-title').textContent = locked ? 'FINAL RECAP' : 'RECAP';

  // No back button — recap is a nav tab; the header carries the shared
  // copy-link + QR + overflow (host only), matching the Lobby and Game tabs.
  document.getElementById('top-bar-back').classList.add('hidden');
  hostMenu.hide();
  hostMenu.renderTopBarActions(roomCode);

  if (!roomCode) {
    router.navigate('home');
    return;
  }
  const games = state.get('games') || {};
  const players = state.get('players') || {};
  const stats = computeNightStats(games, players);

  if (!stats) {
    const trackOn = !!lobby.trackStats;
    container.innerHTML = `
      <div class="screen-body screen-body--center text-center">
        <span class="material-symbols-outlined text-5xl text-outline mb-4" aria-hidden="true">bar_chart</span>
        <p class="font-headline font-bold text-lg uppercase mb-2">No Stats Yet</p>
        <p class="font-body text-sm text-on-surface-variant max-w-xs mx-auto">${
          trackOn
            ? 'Play at least one game and the per-game scores, winnings, and standings will show up here.'
            : 'Turn on <span class="font-bold">Track Tonight’s Stats</span> in the Lobby and play at least one game to see scores, winnings, and standings here.'
        }</p>
      </div>
    `;
    return;
  }

  // ── UI state ──
  let viewSel = 'all';          // 'all' or a 0-based index into stats.perGame
  let tab = 'scores';           // 'scores' | 'winnings'

  // Look up the raw game (config/rounds/totals/juaFines) backing a perGame entry.
  const rawGameOf = (pg) => games[pg.gameId] || Object.values(games).find((g) => g.gameId === pg.gameId);

  const totalGames = stats.totalGames;
  const hasDropdown = totalGames > 1;

  // Page heading: depends on whether the night's been called and which view is up.
  const _headingText = () => {
    if (viewSel !== 'all') return `Game ${viewSel + 1}`;
    if (locked) return 'Tonight’s Recap';
    return totalGames === 1 ? 'Last Game' : `Last ${totalGames} Games`;
  };

  // ── Static shell ──
  // The dropdown only appears once there's more than one game to choose between.
  const dropdownItems = ['<button type="button" data-view="all" class="view-dropdown-item" style="' + _ITEM_STYLE + '">All Games</button>']
    .concat(stats.perGame.map((pg, i) =>
      `<button type="button" data-view="${i}" class="view-dropdown-item" style="${_ITEM_STYLE}${i < stats.perGame.length - 1 ? 'border-bottom:1px solid #c6c6c6;' : ''}">Game ${i + 1}</button>`
    )).join('');

  // The header block carries a hero-sized bottom gap so the table starts at the
  // same height as the Winner screen's table (which sits below its trophy hero).
  container.innerHTML = `
    <div class="screen-body pb-28">
      <div class="mb-12">
        <p id="recap-heading" class="font-mono text-3xl font-bold uppercase mb-6"></p>
        ${hasDropdown ? `
        <div class="relative">
          <button id="view-trigger" aria-haspopup="listbox" aria-expanded="false"
            class="relative w-full flex items-center justify-center border border-outline bg-surface-container-lowest px-4 py-3 font-mono text-sm uppercase tracking-wide">
            <span id="view-trigger-label">All Games</span>
            <span class="material-symbols-outlined text-lg absolute right-3" aria-hidden="true">expand_more</span>
          </button>
          <div id="view-dropdown" role="listbox" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:#f4f4f2;border:1px solid #000;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
            ${dropdownItems}
          </div>
        </div>` : ''}
      </div>

      <div id="recap-table-region"></div>
    </div>

    <!-- Docked Scores/Winnings switcher (flush above the bottom nav, like the winner screen) -->
    <div id="recap-docked" class="docked-bar p-4 bg-surface-container-low">
      <div id="recap-segmented"></div>
    </div>
  `;

  const headingEl = container.querySelector('#recap-heading');
  const segContainer = container.querySelector('#recap-segmented');
  const dockedEl = container.querySelector('#recap-docked');
  const region = container.querySelector('#recap-table-region');

  // ── Tab visibility (shared by both views via the #scores-view/#winnings-view ids) ──
  const _applyTab = () => {
    const showWinnings = tab === 'winnings';
    const sv = region.querySelector('#scores-view');
    if (sv) sv.style.display = showWinnings ? 'none' : '';
    const wv = region.querySelector('#winnings-view');
    if (wv) wv.style.display = showWinnings ? '' : 'none';
    const tc = region.querySelector('#tie-card');
    if (tc) tc.style.display = showWinnings ? 'block' : 'none';
    const segScores = segContainer.querySelector('#seg-scores');
    const segWinnings = segContainer.querySelector('#seg-winnings');
    if (segScores && segWinnings) {
      const active = 'bg-primary text-on-primary';
      const base = 'flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors';
      segScores.className = `${base} ${showWinnings ? '' : active}`;
      segWinnings.className = `${base} ${showWinnings ? active : ''}`;
      segScores.setAttribute('aria-selected', String(!showWinnings));
      segWinnings.setAttribute('aria-selected', String(showWinnings));
    }
  };

  // ── Render the segmented control + tables for the current view ──
  const renderRegion = () => {
    let hasWinnings, scoresHTML, winningsHTML = '', tieHTML = '';

    if (viewSel === 'all') {
      hasWinnings = !!stats.winnings;
      scoresHTML = _allScoresTable(stats);
      if (hasWinnings) winningsHTML = _allWinningsTable(stats);
    } else {
      const pg = stats.perGame[viewSel];
      const rawGame = rawGameOf(pg);
      const priorGames = stats.perGame.slice(0, viewSel).map(rawGameOf).filter(Boolean);
      const tables = buildSingleGameTables(rawGame, priorGames);
      // Winnings only settle on a finished Jua game — mirror the winner screen.
      const finished = rawGame.status === 'finished';
      hasWinnings = tables.hasWinnings && finished;
      scoresHTML = tables.scoresTableHTML;
      if (hasWinnings) { winningsHTML = tables.winningsTableHTML; tieHTML = tables.tieCardHTML; }
    }

    // Hide the segmented control + fall back to Scores when there's nothing to show.
    if (!hasWinnings) tab = 'scores';

    headingEl.textContent = _headingText();

    // The first tab is the night's medal tally ("Standings") in the All Games
    // view, or a single game's "Scores"; the second is always "Winnings".
    const scoresLabel = viewSel === 'all' ? 'Standings' : 'Scores';
    segContainer.innerHTML = hasWinnings
      ? `<div role="tablist" aria-label="View" class="flex border border-outline">
           <button id="seg-scores" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">${scoresLabel}</button>
           <button id="seg-winnings" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Winnings</button>
         </div>`
      : '';
    dockedEl.style.display = hasWinnings ? '' : 'none';

    region.innerHTML = scoresHTML + winningsHTML + tieHTML;
    // No-op for the All Games tables (no breakdown cells); wires the per-game view.
    wireSingleGameTables(region);

    if (hasWinnings) {
      segContainer.querySelector('#seg-scores').addEventListener('click', () => { tab = 'scores'; _applyTab(); });
      segContainer.querySelector('#seg-winnings').addEventListener('click', () => { tab = 'winnings'; _applyTab(); });
    }
    _applyTab();
  };

  // ── View dropdown (custom panel reparented onto a click-catching backdrop) ──
  // Only present when there's more than one game to choose between.
  const trigger = container.querySelector('#view-trigger');
  const triggerLabel = container.querySelector('#view-trigger-label');
  const dropdownEl = container.querySelector('#view-dropdown');

  if (trigger && dropdownEl) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_backdropEl) { _closeDropdown(dropdownEl, trigger); return; }

      _backdropEl = document.createElement('div');
      _backdropEl.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.15)';
      _backdropEl.addEventListener('click', () => _closeDropdown(dropdownEl, trigger));
      document.body.appendChild(_backdropEl);

      // Anchored at the top of the screen, so the panel opens downward.
      const rect = trigger.getBoundingClientRect();
      dropdownEl.style.position = 'fixed';
      dropdownEl.style.zIndex = '9999';
      dropdownEl.style.left = `${rect.left}px`;
      dropdownEl.style.top = `${rect.bottom + 4}px`;
      dropdownEl.style.bottom = 'auto';
      dropdownEl.style.width = `${rect.width}px`;
      dropdownEl.style.margin = '0';
      dropdownEl.style.display = 'block';
      _backdropEl.appendChild(dropdownEl);
      trigger.setAttribute('aria-expanded', 'true');
    });

    dropdownEl.querySelectorAll('.view-dropdown-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        _closeDropdown(dropdownEl, trigger);
        const v = item.dataset.view;
        viewSel = v === 'all' ? 'all' : parseInt(v, 10);
        triggerLabel.textContent = item.textContent.trim();
        renderRegion();
      });
    });
  }

  renderRegion();

  // Re-mount when the night is locked/unlocked underneath us so the heading,
  // top-bar title, and "called" state stay in sync (the host can trigger this
  // from the recap tab itself via "Call it a Night").
  _unsubLobby = state.on('roomLobby', (newLobby) => {
    const newLocked = (newLobby?.status === 'night-ended');
    if (newLocked !== locked) mount(container, { roomCode });
  });
}

export function unmount() {
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_backdropEl) { _backdropEl.remove(); _backdropEl = null; }
}

// ── All-Games tables ──

const _HEAD_CLS = 'py-3 font-headline font-bold text-sm uppercase tracking-widest text-outline';
const _RANK_COL = 'width:3.5rem';
const _ITEM_STYLE = 'display:block;width:100%;text-align:center;padding:10px 16px;font-family:monospace;font-size:1rem;text-transform:uppercase;letter-spacing:0.05em;color:#000;background:#f4f4f2;border:none;cursor:pointer;white-space:nowrap;';
// Medal chip — emoji only, no count, mirroring the dashboard save/fine chips.
const _MEDAL_CHIP = 'inline-block font-mono text-sm bg-surface-container-low border border-outline-variant px-1.5 py-0.5 text-on-surface';

// Standings: one row per player with a medal chip for each 1st/2nd/3rd finish,
// sorted lexicographically by (1sts, 2nds, 3rds) descending.
function _allScoresTable(stats) {
  const rows = stats.overall.map((p) => {
    const ones = p.finishes.filter((r) => r === 1).length;
    const twos = p.finishes.filter((r) => r === 2).length;
    const threes = p.finishes.filter((r) => r === 3).length;
    return { name: p.name, ones, twos, threes };
  }).sort((a, b) => (b.ones - a.ones) || (b.twos - a.twos) || (b.threes - a.threes));

  const medals = (emoji, n) => Array.from({ length: n }, () => `<span class="${_MEDAL_CHIP}">${emoji}</span>`).join('');

  const body = rows.map((p, i) => {
    const chips = medals('🥇', p.ones) + medals('🥈', p.twos) + medals('🥉', p.threes);
    return `
    <tr>
      <td class="py-3 pl-4 pr-3 text-center font-mono font-bold text-lg align-middle">${i + 1}</td>
      <td class="py-3 pr-3 font-headline font-bold text-lg uppercase leading-tight align-middle">${escapeHTML(p.name)}</td>
      <td class="py-3 pl-3 pr-4 align-middle"><div class="flex flex-wrap gap-1">${chips || '<span class="text-outline">—</span>'}</div></td>
    </tr>`;
  }).join('');

  return `
    <table id="scores-view" class="w-full border-collapse">
      <thead>
        <tr class="border-b border-outline">
          <th class="${_HEAD_CLS} pl-4 pr-3 text-center" style="${_RANK_COL}">Rank</th>
          <th class="${_HEAD_CLS} pr-3 text-left">Player</th>
          <th class="${_HEAD_CLS} pl-3 pr-4 text-left">Standings</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant">${body}</tbody>
    </table>`;
}

// Winnings: total net per player, sorted descending (already sorted by stats),
// using the winner screen's green/red + enlarged-₹ amount styling.
function _allWinningsTable(stats) {
  const body = stats.winnings.players.map((p, i) => {
    const net = parseFloat(p.net.toFixed(1));
    const absNet = parseFloat(Math.abs(net).toFixed(1));
    const amountStr = `<span class="inline-flex items-center justify-end">${net >= 0 ? '+' : '-'}<span class="ml-1.5 text-[1.4em] leading-none">₹</span>${absNet}</span>`;
    const amountCls = net >= 0 ? 'text-green-600' : 'text-red-600';
    return `
      <tr>
        <td class="pt-3 pb-3 pl-4 pr-3 text-center font-mono font-bold text-lg align-middle">${i + 1}</td>
        <td class="pt-3 pb-3 pr-3 font-headline font-bold text-lg uppercase leading-tight align-middle">${escapeHTML(p.name)}</td>
        <td class="pt-3 pb-3 pl-3 pr-4 text-right font-mono font-bold text-lg whitespace-nowrap align-middle ${amountCls}">${amountStr}</td>
      </tr>`;
  }).join('');

  return `
    <table id="winnings-view" class="w-full border-collapse" style="display:none">
      <thead>
        <tr class="border-b border-outline">
          <th class="${_HEAD_CLS} pl-4 pr-3 text-center" style="${_RANK_COL}">Rank</th>
          <th class="${_HEAD_CLS} pr-3 text-left">Player</th>
          <th class="${_HEAD_CLS} pl-3 pr-4 text-right">Total</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant">${body}</tbody>
    </table>`;
}
