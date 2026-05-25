// ═══════════════════════════════════════════
// Night Recap — Stats Computation
// ═══════════════════════════════════════════

import { getGame } from './games/registry.js';

// Bolt Optimization: Memoize O(G*P*R) stats computation
// Firebase state syncing replaces the entire `games` object on any room update.
// We memoize by caching based on the games object reference to avoid redundant work on every render.
const _statsCache = new WeakMap();

/**
 * Compute end-of-night stats from all games in a room.
 * @param {Object} games - All games from rooms/{code}/games
 * @param {Object} players - All players from rooms/{code}/players
 * @returns {Object} { overall, perGame }
 */
export function computeNightStats(games, players) {
  if (games && typeof games === 'object') {
    const cached = _statsCache.get(games);
    if (cached && cached.playersRef === players) {
      return cached.result;
    }
  }

  const allGames = Object.values(games || {}).filter(
    (g) => g.rounds && Object.keys(g.rounds).length > 0
  );

  if (allGames.length === 0) return null;

  const playerIds = [...new Set(allGames.flatMap((g) => g.playerIds || []))];

  // ── Overall stats per player ──
  // Pre-compute maps to avoid O(N*G) lookups
  const playerNames = new Map();
  const playerAccents = new Map();

  // Populate from players object first
  if (players) {
    for (const [pid, p] of Object.entries(players)) {
      if (p.name !== undefined) playerNames.set(pid, p.name);
      if (p.accentIndex !== undefined) playerAccents.set(pid, p.accentIndex);
    }
  }

  // Populate from game snapshots
  for (const g of allGames) {
    if (g.playerSnapshot) {
      for (const [pid, p] of Object.entries(g.playerSnapshot)) {
        if (p.name !== undefined && !playerNames.has(pid)) playerNames.set(pid, p.name);
        if (p.accentIndex !== undefined && !playerAccents.has(pid)) playerAccents.set(pid, p.accentIndex);
      }
    }
  }

  const overall = {};
  playerIds.forEach((pid) => {
    overall[pid] = {
      playerId: pid,
      name: playerNames.has(pid) ? playerNames.get(pid) : pid,
      accentIndex: playerAccents.has(pid) ? playerAccents.get(pid) : 0,
      gamesPlayed: 0,
      gamesWon: 0,
      bestFinish: Infinity,
      finishes: [],
    };
  });

  // ── Per-game stats ──
  const perGame = allGames.map((game) => {
    const gameModule = getGame(game.type);
    if (!gameModule) return null;

    const snapshot = game.playerSnapshot || {};
    const totals = game.totals || {};
    const rounds = Object.values(game.rounds || {});
    const gPlayerIds = game.playerIds || [];
    const standings = gameModule.deriveStandings(totals, gPlayerIds);

    // Bolt Optimization: Replace O(N) array find with O(1) Map lookup
    const standingsMap = new Map(standings.map(s => [s.playerId, s]));

    // Update overall
    gPlayerIds.forEach((pid) => {
      if (!overall[pid]) return;
      overall[pid].gamesPlayed++;
      const standing = standingsMap.get(pid);
      if (standing) {
        overall[pid].finishes.push(standing.rank);
        if (standing.rank < overall[pid].bestFinish) {
          overall[pid].bestFinish = standing.rank;
        }
      }
      if (game.winner === pid) {
        overall[pid].gamesWon++;
      }
    });

    // Compute game-specific stats
    const gameStats = _computeGameSpecificStats(game, gameModule, rounds, gPlayerIds, snapshot, totals, standings);

    const isAbandoned = game.status === 'abandoned' || (!game.winner && game.status !== 'active' && game.status !== 'overtime');

    return {
      gameId: game.gameId,
      type: game.type,
      label: gameModule.label,
      standings,
      snapshot,
      winner: game.winner,
      roundCount: rounds.length,
      playerStats: gameStats,
      isAbandoned,
    };
  }).filter(Boolean);

  // Determine MVP (most wins, tiebreak: best avg finish)
  const overallList = Object.values(overall);

  // Bolt Optimization: Pre-calculate average finishes to avoid O(N log N) redundant reduce calls in sort comparator
  overallList.forEach(p => {
    p.avgFinish = p.finishes.length ? p.finishes.reduce((s, v) => s + v, 0) / p.finishes.length : 99;
  });

  overallList.sort((a, b) => {
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
    return a.avgFinish - b.avgFinish;
  });

  const mvpId = overallList.length > 0 && overallList[0].gamesWon > 0 ? overallList[0].playerId : null;

  const result = {
    totalGames: allGames.length,
    totalRounds: allGames.reduce((s, g) => s + Object.keys(g.rounds || {}).length, 0),
    mvpId,
    overall: overallList,
    perGame,
    winnings: _computeNightWinnings(allGames),
  };

  if (games && typeof games === 'object') {
    _statsCache.set(games, { result, playersRef: players });
  }

  return result;
}

function _computeGameSpecificStats(game, gameModule, rounds, playerIds, snapshot, totals, standings) {
  const stats = {};

// Bolt Optimization: Replace O(N) array find with O(1) Map lookup
  const standingsMap = new Map(standings.map(s => [s.playerId, s]));

  const juaNets = (game.type === 'flip7' && game.config?.jua) ? _computeJuaNets(game) : null;

  // Precompute minCard for cabo rounds to avoid O(P*R) redundant calculations
  const caboMinCards = new Map();
  if (game.type === 'cabo') {
    rounds.forEach((rnd) => {
      if (!rnd.kamikaze) {
        const allTotals = Object.entries(rnd.entries || {}).map(([id, e]) => e.cardTotal || 0);
        caboMinCards.set(rnd, allTotals.length ? Math.min(...allTotals) : 0);
      }
    });
  }

  playerIds.forEach((pid) => {

    const standing = standingsMap.get(pid);
    const base = {
      playerId: pid,
      name: snapshot[pid]?.name || pid,
      accentIndex: snapshot[pid]?.accentIndex || 0,
      finalRank: standing?.rank || 0,
      totalScore: totals[pid] || 0,
      isWinner: game.winner === pid,
    };

    const roundScores = [];

    if (game.type === 'flip7') {
      let f7Bonuses = 0;
      rounds.forEach((rnd) => {
        const entry = rnd.entries?.[pid];
        if (entry) {
          const pts = (entry.basePoints || 0) + (entry.flip7 ? 15 : 0);
          roundScores.push(pts);
          if (entry.flip7) f7Bonuses++;
        }
      });
      stats[pid] = {
        ...base,
        roundScores,
        bestRound: roundScores.length ? Math.max(...roundScores) : 0,
        worstRound: roundScores.length ? Math.min(...roundScores) : 0,
        f7Bonuses,
        juaNet: juaNets ? (juaNets.has(pid) ? juaNets.get(pid) : null) : null,
      };
    } else if (game.type === 'papayoo') {
      let zeroRounds = 0;
      let heavy40Rounds = 0;
      rounds.forEach((rnd) => {
        const entry = rnd.entries?.[pid];
        if (entry) {
          const pts = entry.penaltyPoints || 0;
          roundScores.push(pts);
          if (pts === 0) zeroRounds++;
          if (pts >= 40) heavy40Rounds++;
        }
      });
      stats[pid] = {
        ...base,
        roundScores,
        bestRound: roundScores.length ? Math.min(...roundScores) : 0,
        worstRound: roundScores.length ? Math.max(...roundScores) : 0,
        zeroRounds,
        heavy40Rounds,
      };
    } else if (game.type === 'cabo') {
      let caboCalls = 0;
      let successfulCabos = 0;
      let kamikazeAttempts = 0;
      let exact100Resets = 0;
      let runningTotal = 0;

      rounds.forEach((rnd) => {
        const entry = rnd.entries?.[pid];
        if (!entry) return;

        const isCaller = rnd.callerId === pid;
        if (isCaller) {
          caboCalls++;
          if (rnd.kamikaze) {
            kamikazeAttempts++;
          }
        }

        // Compute round points for this player
        let roundPts = 0;
        if (rnd.kamikaze) {
          roundPts = isCaller ? 0 : 50;
          if (isCaller) successfulCabos++;
        } else {
          const minCard = caboMinCards.get(rnd);
          if (isCaller) {
            roundPts = (entry.cardTotal || 0) <= minCard ? 0 : (entry.cardTotal || 0) + 10;
            if (roundPts === 0) successfulCabos++;
          } else {
            roundPts = entry.cardTotal || 0;
          }
        }

        roundScores.push(roundPts);
        runningTotal += roundPts;
        if (runningTotal === 100) {
          exact100Resets++;
          runningTotal = 50;
        }
      });

      stats[pid] = {
        ...base,
        roundScores,
        bestRound: roundScores.length ? Math.min(...roundScores) : 0,
        worstRound: roundScores.length ? Math.max(...roundScores) : 0,
        caboCalls,
        successfulCabos,
        kamikazeAttempts,
        exact100Resets,
      };
    }
  });

  return stats;
}

// Compute per-player Jua net for a single finished Flip 7 game with Jua enabled.
// Returns a Map<playerId, net> or null if the game isn't a qualifying Jua game.
function _computeJuaNets(game) {
  const cfg = game.config || {};
  if (!cfg.jua || game.status !== 'finished') return null;

  const buyIn = cfg.juaBuyIn || 30;
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

  const totals = game.totals || {};
  const sorted = (game.playerIds || [])
    .map((id) => ({ playerId: id, total: totals[id] || 0 }))
    .sort((a, b) => b.total - a.total);
  let rank = 1;
  sorted.forEach((s, i) => {
    if (i > 0 && s.total < sorted[i - 1].total) rank = i + 1;
    s.rank = rank;
  });

  const byRank = {};
  sorted.forEach((s) => {
    if (!byRank[s.rank]) byRank[s.rank] = [];
    byRank[s.rank].push(s);
  });
  const n1 = (byRank[1] || []).length;
  const n2 = (byRank[2] || []).length;
  const n3 = (byRank[3] || []).length;

  const pot1 = baseShare + 20 + pool;
  const pot2 = baseShare;
  const pot3 = baseShare - 20;

  const positionReward = (r) => {
    if (r === 1) {
      if (n1 >= 3) return (pot1 + pot2 + pot3) / n1;
      if (n1 === 2) return (pot1 + pot2) / 2;
      return pot1;
    }
    if (r === 2) {
      if (n2 >= 2) return (pot2 + pot3) / n2;
      return pot2;
    }
    if (r === 3) {
      if (n3 >= 2) return pot3 / n3;
      return pot3;
    }
    return 0;
  };

  const nets = new Map();
  sorted.forEach((s) => {
    const savesCount = savesCounts[s.playerId] || 0;
    const finesCount = (game.juaFines || {})[s.playerId] || 0;
    const reward = positionReward(s.rank);
    nets.set(s.playerId, reward - buyIn - savesCount * firstSaveAmt - finesCount * influenceFine);
  });

  return nets;
}

// Aggregate Jua nets across all finished Jua games in a night.
// Returns { players: [{playerId, name, accentIndex, net, gamesCount, gameNets}] } sorted by net desc, or null.
function _computeNightWinnings(allGames) {
  const playerNets = {};

  allGames.forEach((game, gi) => {
    if (game.type !== 'flip7') return;
    const nets = _computeJuaNets(game);
    if (!nets) return;

    const gameNum = gi + 1;
    const snapshot = game.playerSnapshot || {};
    nets.forEach((net, pid) => {
      if (!playerNets[pid]) {
        playerNets[pid] = {
          playerId: pid,
          name: snapshot[pid]?.name || pid,
          accentIndex: snapshot[pid]?.accentIndex || 0,
          net: 0,
          gamesCount: 0,
          gameNets: [],
        };
      }
      playerNets[pid].net += net;
      playerNets[pid].gamesCount++;
      playerNets[pid].gameNets.push({ gameNum, net });
    });
  });

  const players = Object.values(playerNets);
  if (players.length === 0) return null;
  players.sort((a, b) => b.net - a.net);
  return { players };
}
