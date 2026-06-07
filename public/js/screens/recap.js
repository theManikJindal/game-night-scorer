// ═══════════════════════════════════════════
// Night Recap Screen
// ═══════════════════════════════════════════

import * as state from '../state.js';
import * as router from '../router.js';
import * as bottomNav from '../components/bottom-nav.js';
import * as hostMenu from '../components/host-menu.js';
import * as confetti from '../components/confetti.js';
import { computeNightStats } from '../stats.js';
import { escapeHTML } from '../utils.js';
import { buildSingleGameTables, wireSingleGameTables } from './single-game-tables.js';

// Backdrop for the View dropdown, reparented onto document.body while open.
// Tracked at module scope so unmount can tear it down if the screen changes
// while the dropdown is still open.
let _backdropEl = null;

// The night-lock we've already celebrated (confetti + fanfare), keyed by room +
// nightEndedAt, so the rain fires once when the night is called — not again on
// every tab/view switch — while a fresh "Call it a Night" re-celebrates.
let _celebratedNight = null;

// Live re-render subscriptions. Recap can stay mounted across a status change —
// e.g. the host taps "Call it a Night" from the recap tab, which locks the night
// but doesn't navigate (we're already here). Without this, the screen would show
// a stale "active" recap and the action would look like it did nothing. We also
// watch for a *new* game starting underneath us (e.g. a spectator left on the
// recap after "One More Game") so we can hand them off to the live board, the
// same way the Lobby tab does.
let _unsubLobby = null;
let _unsubGames = null;

function _closeDropdown(dropdownEl, trigger) {
  if (_backdropEl) { _backdropEl.remove(); _backdropEl = null; }
  if (dropdownEl) dropdownEl.style.display = 'none';
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

export function mount(container, params = {}) {
  // A re-mount (tab switch or live status change) supersedes any prior listeners
  // and closes a dropdown left open on the previous render.
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_unsubGames) { _unsubGames(); _unsubGames = null; }
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
  // The header title stays "RECAP" even once the night is called — the locked
  // state is conveyed by the "Tonight's Winner" hero, not the header.
  document.getElementById('top-bar-title').textContent = 'RECAP';

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

  // Scores/Winnings selection persists across navigation (like the Winner
  // screen's segmented control), keyed by room. On a Jua night, default to
  // Winnings — that's the headline of a money night — whether or not the night
  // has been called, unless the user has already expressed a preference.
  const TAB_KEY = `gns_recap_tab_${roomCode}`;
  let tab = localStorage.getItem(TAB_KEY) || 'scores';   // 'scores' | 'winnings'
  if (stats.winnings && !localStorage.getItem(TAB_KEY)) tab = 'winnings';

  // The game that was active when we mounted. If a *different* game becomes
  // active under us, a new game has started and we hand off to the board.
  const mountActiveGameId = lobby.activeGameId || null;

  // Look up the raw game (config/rounds/totals/juaFines) backing a perGame entry.
  const rawGameOf = (pg) => games[pg.gameId] || Object.values(games).find((g) => g.gameId === pg.gameId);

  const totalGames = stats.totalGames;
  const hasDropdown = totalGames > 1;

  // Header: a per-game / "Last N Games" title while the night runs, or — once the
  // night's been called and we're in the All Games view — a "Tonight's Winner"
  // hero (trophy + name) styled like the Winner screen.
  const _renderHeader = () => {
    const el = container.querySelector('#recap-header');
    if (viewSel === 'all' && locked) {
      el.innerHTML = _winnerHero(_tonightWinners(stats), !!stats.winnings);
      // Tap the hero to replay the confetti rain + fanfare, like the Winner screen.
      const hero = el.querySelector('#recap-winner-hero');
      if (hero) {
        const celebrate = () => confetti.startRain();
        hero.addEventListener('click', celebrate);
        hero.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); celebrate(); }
        });
      }
      // Auto-celebrate the first time this night's lock is shown.
      const key = `${roomCode}:${lobby.nightEndedAt || ''}`;
      if (_celebratedNight !== key) { _celebratedNight = key; confetti.startRain(); }
      return;
    }
    const txt = viewSel !== 'all'
      ? `Game ${viewSel + 1}`
      : (totalGames === 1 ? 'Last Game' : `Last ${totalGames} Games`);
    el.innerHTML = `<p class="font-mono text-3xl font-bold uppercase">${escapeHTML(txt)}</p>`;
  };

  // ── Static shell ──
  // The dropdown only appears once there's more than one game to choose between.
  // Order: Game 1 … Game N, then "All Games" at the bottom.
  const dropdownItems = stats.perGame
    .map((pg, i) =>
      `<button type="button" data-view="${i}" class="view-dropdown-item" style="${_ITEM_STYLE}border-bottom:1px solid #c6c6c6;">Game ${i + 1}</button>`
    )
    .concat('<button type="button" data-view="all" class="view-dropdown-item" style="' + _ITEM_STYLE + '">All Games</button>')
    .join('');

  // The header block carries a hero-sized bottom gap so the table starts at the
  // same height as the Winner screen's table (which sits below its trophy hero).
  container.innerHTML = `
    <div class="screen-body pb-40">
      <div id="recap-header" class="mb-12"></div>
      <div id="recap-table-region"></div>
    </div>

    <!-- Docked View dropdown + Standings/Winnings switcher (flush above the bottom nav, like the winner screen) -->
    <div id="recap-docked" class="docked-bar p-4 bg-surface-container-low">
      ${hasDropdown ? `
      <div class="relative mb-3">
        <button id="view-trigger" aria-haspopup="listbox" aria-expanded="false"
          class="relative w-full flex items-center justify-center border border-outline bg-surface-container-lowest px-4 py-3 font-mono text-sm uppercase tracking-wide">
          <span id="view-trigger-label">All Games</span>
          <span class="material-symbols-outlined text-lg absolute right-3" aria-hidden="true">expand_more</span>
        </button>
        <div id="view-dropdown" role="listbox" style="display:none;position:absolute;bottom:100%;left:0;margin-bottom:4px;background:#f4f4f2;border:1px solid #000;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
          ${dropdownItems}
        </div>
      </div>` : ''}
      <div id="recap-segmented"></div>
    </div>
  `;

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

    _renderHeader();

    // The first tab is the night's medal tally ("Standings") in the All Games
    // view, or a single game's "Scores"; the second is always "Winnings".
    const scoresLabel = viewSel === 'all' ? 'Standings' : 'Scores';
    segContainer.innerHTML = hasWinnings
      ? `<div role="tablist" aria-label="View" class="flex border border-outline">
           <button id="seg-scores" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">${scoresLabel}</button>
           <button id="seg-winnings" role="tab" class="flex-1 py-2.5 font-headline uppercase tracking-widest text-sm transition-colors">Winnings</button>
         </div>`
      : '';
    // The docked bar shows when there's a dropdown and/or a segmented control.
    dockedEl.style.display = (hasDropdown || hasWinnings) ? '' : 'none';

    region.innerHTML = scoresHTML + winningsHTML + tieHTML;
    // Wire the winnings breakdown toggles. The All Games total expands to its
    // per-game breakdown but keeps the "Total" column label in both states; the
    // per-game view keeps the Winner screen's "Winnings"/"Breakdown" labels.
    if (viewSel === 'all') {
      wireSingleGameTables(region, { collapsedLabel: 'Total', expandedLabel: 'Total' });
    } else {
      wireSingleGameTables(region);
    }

    if (hasWinnings) {
      segContainer.querySelector('#seg-scores').addEventListener('click', () => { tab = 'scores'; localStorage.setItem(TAB_KEY, tab); _applyTab(); });
      segContainer.querySelector('#seg-winnings').addEventListener('click', () => { tab = 'winnings'; localStorage.setItem(TAB_KEY, tab); _applyTab(); });
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

      // Docked just above the segmented control, so the panel opens upward.
      const rect = trigger.getBoundingClientRect();
      dropdownEl.style.position = 'fixed';
      dropdownEl.style.zIndex = '9999';
      dropdownEl.style.left = `${rect.left}px`;
      dropdownEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      dropdownEl.style.top = 'auto';
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

  // React to room/game changes underneath us:
  //  1. A new game becomes active → leave the recap for the live board, exactly
  //     as the Lobby tab does (covers a spectator stranded on the recap after
  //     "One More Game", and the activeGameId is fresh vs. when we mounted).
  //  2. The night is locked/unlocked → re-mount so the heading, hero, and
  //     "called" state stay in sync (the host can trigger this from the recap
  //     tab itself via "Call it a Night" / "One More Game").
  // We watch both roomLobby and games, since a new game arrives as two separate
  // RTDB events; either one calling the shared handler is enough.
  const _onRoomChange = () => {
    const lob = state.get('roomLobby') || {};
    const activeId = lob.activeGameId || null;
    const activeGame = (state.get('games') || {})[activeId];
    if (activeId && activeId !== mountActiveGameId && activeGame?.status === 'active') {
      router.navigate('dashboard', { roomCode });
      return;
    }
    const newLocked = (lob.status === 'night-ended');
    if (newLocked !== locked) mount(container, { roomCode });
  };
  _unsubLobby = state.on('roomLobby', _onRoomChange);
  _unsubGames = state.on('games', _onRoomChange);
}

export function unmount() {
  if (_unsubLobby) { _unsubLobby(); _unsubLobby = null; }
  if (_unsubGames) { _unsubGames(); _unsubGames = null; }
  if (_backdropEl) { _backdropEl.remove(); _backdropEl = null; }
}

// ── Tonight's winner(s) ──

// The night's winner(s). Jua: the player(s) with the most total winnings.
// Non-Jua: the player(s) with the most 1st places, breaking ties on 2nds then
// 3rds. Ties (joint winners) are possible in both cases.
function _tonightWinners(stats) {
  if (stats.winnings) {
    const players = stats.winnings.players; // sorted by net desc, ≥1 entry
    const top = parseFloat(players[0].net.toFixed(1));
    return players
      .filter((p) => parseFloat(p.net.toFixed(1)) === top)
      .map((p) => ({ name: p.name }));
  }
  const rows = stats.overall.map((p) => ({
    name: p.name,
    ones: p.finishes.filter((r) => r === 1).length,
    twos: p.finishes.filter((r) => r === 2).length,
    threes: p.finishes.filter((r) => r === 3).length,
  })).sort((a, b) => (b.ones - a.ones) || (b.twos - a.twos) || (b.threes - a.threes));
  const top = rows[0];
  return rows
    .filter((r) => r.ones === top.ones && r.twos === top.twos && r.threes === top.threes)
    .map((r) => ({ name: r.name }));
}

// Tonight's winner(s) hero — confetti-text name(s) matching the Winner screen,
// with a Jua/non-Jua icon + label. Non-Jua: crown + "Champion(s)". Jua:
// poker chip + "High Roller(s)". One winner uses the full text-7xl name; ties
// shrink the names and lay them out side by side (2-up, then 3-up for 3+).
// Tapping the hero replays the celebration (wired up by _renderHeader).
function _winnerHero(winners, isJua) {
  const plural = winners.length > 1;
  const icon = isJua ? 'poker_chip' : 'crown';
  const label = isJua
    ? (plural ? 'HIGH ROLLERS' : 'HIGH ROLLER')
    : (plural ? 'CHAMPIONS' : 'CHAMPION');
  const nameFont = 'font-headline font-extrabold uppercase tracking-tight leading-none';
  let namesHTML;
  if (winners.length === 1) {
    // Single winner uses the same text-7xl name as the Winner screen's hero.
    namesHTML = `<h1 class="confetti-text ${nameFont} text-7xl truncate">${escapeHTML(winners[0].name)}</h1>`;
  } else {
    // One continuous gradient across all the names: confetti-text on the grid,
    // so its single clipped background image slides through every name as a unit
    // (the children inherit the transparent text fill). Always two names per row;
    // with an odd count the last one spans both columns so it sits centered on
    // its own row.
    const size = winners.length === 2 ? 'text-4xl' : 'text-3xl';
    const odd = winners.length % 2 === 1;
    namesHTML = `<div class="confetti-text grid grid-cols-2 gap-x-2 gap-y-3">${winners
      .map((w, i) => {
        const span = (odd && i === winners.length - 1) ? ' col-span-2' : '';
        return `<span class="${nameFont} ${size} text-center truncate min-w-0${span}">${escapeHTML(w.name)}</span>`;
      })
      .join('')}</div>`;
  }
  // Ties get more breathing room between the label/icon row and the names row.
  const rowGap = plural ? 'mb-8' : 'mb-4';
  return `
    <div id="recap-winner-hero" role="button" tabindex="0" aria-label="Celebrate again" title="Tap to celebrate again" class="text-center w-full cursor-pointer select-none">
      <div class="flex items-center justify-center gap-2 ${rowGap}">
        <span aria-hidden="true" class="material-symbols-outlined text-[2.5rem]" style="font-variation-settings: 'FILL' 1;">${icon}</span>
        <span class="font-headline font-bold text-xl uppercase tracking-widest opacity-80">${label}</span>
      </div>
      ${namesHTML}
    </div>`;
}

// ── All-Games tables ──

const _HEAD_CLS = 'py-3 font-headline font-bold text-sm uppercase tracking-widest text-outline';
const _RANK_COL = 'width:3.5rem';
const _ITEM_STYLE = 'display:block;width:100%;text-align:center;padding:10px 16px;font-family:monospace;font-size:1rem;text-transform:uppercase;letter-spacing:0.05em;color:#000;background:#f4f4f2;border:none;cursor:pointer;white-space:nowrap;';
// Medal chip — borderless, emoji only (no count), enlarged 2× (0.875rem → 1.75rem).
const _MEDAL_CHIP = 'inline-block bg-surface-container-low px-1.5 py-0.5 text-[1.75rem] leading-none';

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
      <td class="py-3 pl-4 pr-3 text-center font-mono font-bold text-lg align-middle" style="height:3.5rem">${i + 1}</td>
      <td class="py-3 pr-3 font-headline font-bold text-lg uppercase leading-tight align-middle">${escapeHTML(p.name)}</td>
      <td class="py-3 pl-3 pr-4 align-middle"><div class="flex flex-wrap gap-1 justify-end">${chips || '<span class="text-outline">—</span>'}</div></td>
    </tr>`;
  }).join('');

  return `
    <table id="scores-view" class="w-full border-collapse">
      <thead>
        <tr class="border-b border-outline">
          <th class="${_HEAD_CLS} pl-4 pr-3 text-center" style="${_RANK_COL}">Rank</th>
          <th class="${_HEAD_CLS} pr-3 text-left">Player</th>
          <th class="${_HEAD_CLS} pl-3 pr-4 text-right">Standings</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant">${body}</tbody>
    </table>`;
}

// Winnings: total net per player, sorted descending (already sorted by stats),
// using the winner screen's green/red + enlarged-₹ amount styling. Each total
// taps to reveal its per-game breakdown (the per-game nets sum to the total),
// mirroring the Winner screen's winnings column — but the column label stays
// "Total" in both states (see the wireSingleGameTables call in renderRegion).
function _allWinningsTable(stats) {
  const body = stats.winnings.players.map((p, i) => {
    const net = parseFloat(p.net.toFixed(1));
    const absNet = parseFloat(Math.abs(net).toFixed(1));
    const amountStr = `<span class="inline-flex items-center justify-end">${net >= 0 ? '+' : '-'}<span class="ml-1.5 text-[1.4em] leading-none">₹</span>${absNet}</span>`;
    const amountCls = net >= 0 ? 'text-green-600' : 'text-red-600';
    // Per-game nets shown as additive terms (they sum to the total), each tinted
    // green/red by its own sign so a winning night reads at a glance.
    const breakdown = (p.gameNets || []).map((gn, idx) => {
      const v = parseFloat(gn.net.toFixed(1));
      const op = idx === 0 ? (v < 0 ? '- ' : '') : (v < 0 ? '- ' : '+ ');
      const cls = v >= 0 ? 'text-green-600' : 'text-red-600';
      return `<span class="whitespace-nowrap ${cls}">${op}${Math.abs(v)}</span>`;
    }).join(' ');
    const pid = escapeHTML(p.playerId);
    const name = escapeHTML(p.name);
    return `
      <tr>
        <td class="pt-3 pb-3 pl-4 pr-3 text-center font-mono font-bold text-lg align-middle" style="height:3.5rem">${i + 1}</td>
        <td class="pt-3 pb-3 pr-3 font-headline font-bold text-lg uppercase leading-tight align-middle">${name}</td>
        <td data-winnings-pid="${pid}" role="button" tabindex="0" aria-pressed="false" aria-label="Show breakdown for ${name}" class="pt-3 pb-3 pl-3 pr-4 text-right align-middle cursor-pointer select-none">
          <span class="winnings-amount font-mono font-bold text-lg whitespace-nowrap ${amountCls}">${amountStr}</span>
          <span class="winnings-breakdown font-mono font-bold text-sm leading-relaxed" style="display:none">${breakdown}</span>
        </td>
      </tr>`;
  }).join('');

  return `
    <table id="winnings-view" class="w-full border-collapse" style="display:none">
      <thead>
        <tr class="border-b border-outline">
          <th class="${_HEAD_CLS} pl-4 pr-3 text-center" style="${_RANK_COL}">Rank</th>
          <th class="${_HEAD_CLS} pr-3 text-left">Player</th>
          <th id="winnings-col-header" role="button" tabindex="0" aria-label="Expand all breakdowns" class="${_HEAD_CLS} pl-3 pr-4 text-right cursor-pointer select-none whitespace-nowrap"><span class="material-symbols-outlined" style="font-size:1.25rem;vertical-align:middle;line-height:1">unfold_more</span> <span class="col-header-label">Total</span></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant">${body}</tbody>
    </table>`;
}
