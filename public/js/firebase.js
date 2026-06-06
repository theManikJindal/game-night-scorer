// ═══════════════════════════════════════════
// Firebase RTDB Helpers
// ═══════════════════════════════════════════

import * as state from './state.js';
import * as cache from './cache.js';
import { WORDS } from './wordlist.js';

let db = null;
let _roomUnsub = null;
let _connUnsub = null;

// ── Init ──

export function initFirebase(config) {
  if (!config || config.apiKey === 'PASTE_YOUR_API_KEY') {
    console.warn('Firebase not configured');
    return false;
  }
  try {
    firebase.initializeApp(config);
    db = firebase.database();
    return true;
  } catch (e) {
    console.error('Firebase init failed:', e);
    return false;
  }
}

export function isConfigured() {
  return db !== null;
}

export function isWatchingRoom() {
  return _roomUnsub !== null;
}

// ── Room Code Generation ──

function generateCode() {
  // 4-letter noun + 2 digits (e.g. DUCK37). Easy to say and spell verbally.
  // createRoom handles collisions by retrying — namespace is 5000 codes.
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  const word = WORDS[array[0] % WORDS.length];
  const digits = String(array[1] % 100).padStart(2, '0');
  return word + digits;
}

function generateKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ── Create Room ──

export async function createRoom() {
  if (!db) throw new Error('Firebase not configured');

  // The word+digits namespace is small enough (~100k) that collisions are
  // realistic, so check-then-write with a few retries.
  let roomCode;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCode();
    const snap = await db.ref(`rooms/${candidate}/lobby`).once('value');
    if (!snap.exists()) {
      roomCode = candidate;
      break;
    }
  }
  if (!roomCode) throw new Error('Could not allocate a room code, try again');

  const hostKey = generateKey();
  const now = Date.now();

  const lobby = {
    roomCode,
    hostKey,
    status: 'waiting',
    activeGameId: null,
    trackStats: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.ref(`rooms/${roomCode}/lobby`).set(lobby);

  // Store host key locally
  localStorage.setItem(`gns_host_${roomCode}`, hostKey);
  state.clearHostCache(roomCode);

  return roomCode;
}

// ── Join / Watch Room ──

export async function joinRoom(roomCode) {
  if (!db) throw new Error('Firebase not configured');

  const code = roomCode.toUpperCase().trim();
  const snap = await db.ref(`rooms/${code}/lobby`).once('value');
  if (!snap.exists()) return null;

  return code;
}

export function watchRoom(roomCode, onUpdate) {
  if (!db) return;

  // Clean up previous watcher
  unwatchRoom();

  const roomRef = db.ref(`rooms/${roomCode}`);
  const handler = roomRef.on('value', (snap) => {
    const data = snap.val();
    if (!data) {
      onUpdate(null);
      return;
    }

    // Update state store
    state.set('roomLobby', data.lobby || {});
    state.set('players', data.players || {});
    state.set('games', data.games || {});
    state.set('roomCode', roomCode);

    // Write-through to localStorage so a cold open can hydrate instantly
    // before this watcher reconnects. See docs/CACHING.md.
    cache.writeCache(roomCode, {
      lobby: data.lobby,
      players: data.players,
      games: data.games,
    });

    onUpdate(data);
  });

  _roomUnsub = () => roomRef.off('value', handler);
}

export function unwatchRoom() {
  if (_roomUnsub) {
    _roomUnsub();
    _roomUnsub = null;
  }
}

// ── Connection State ──

export function watchConnection(cb) {
  if (!db) return;
  unwatchConnection();
  const ref = db.ref('.info/connected');
  const handler = ref.on('value', (snap) => cb(snap.val() === true));
  _connUnsub = () => ref.off('value', handler);
}

export function unwatchConnection() {
  if (_connUnsub) {
    _connUnsub();
    _connUnsub = null;
  }
}

// ── Player Management ──

export async function addPlayer(roomCode, name, seatOrder, accentIndex) {
  if (!db) return;
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const randomSuffix = array[0].toString(36).substring(0, 4);
  const id = `p_${Date.now()}_${randomSuffix}`;
  await db.ref(`rooms/${roomCode}/players/${id}`).set({
    id,
    name: name.toUpperCase(),
    seatOrder,
    accentIndex,
  });
  return id;
}

export async function updatePlayer(roomCode, playerId, updates) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/players/${playerId}`).update(updates);
}

export async function removePlayer(roomCode, playerId) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/players/${playerId}`).remove();
}

// ── Game Management ──

export async function createGame(roomCode, type, config, playerIds, playerSnapshot) {
  if (!db) return;

  const gameId = `g_${Date.now()}`;
  const now = Date.now();

  const game = {
    gameId,
    type,
    config,
    playerIds,
    playerSnapshot,
    rounds: {},
    totals: Object.fromEntries(playerIds.map((id) => [id, 0])),
    status: 'active',
    overtime: false,
    winner: null,
    startedAt: now,
    finishedAt: null,
  };

  await db.ref(`rooms/${roomCode}/games/${gameId}`).set(game);
  await db.ref(`rooms/${roomCode}/lobby`).update({
    activeGameId: gameId,
    status: 'playing',
    updatedAt: now,
  });

  return gameId;
}

export async function submitRound(roomCode, gameId, roundIndex, roundData, newTotals, endResult) {
  if (!db) throw new Error('Firebase not initialized');

  const updates = {};

  updates[`rooms/${roomCode}/games/${gameId}/rounds/${roundIndex}`] = roundData;
  updates[`rooms/${roomCode}/games/${gameId}/totals`] = newTotals;
  updates[`rooms/${roomCode}/games/${gameId}/liveRound`] = null; // clear live preview on commit
  updates[`rooms/${roomCode}/lobby/updatedAt`] = Date.now();

  if (endResult) {
    updates[`rooms/${roomCode}/games/${gameId}/status`] = 'finished';
    updates[`rooms/${roomCode}/games/${gameId}/winner`] = endResult.winner;
    updates[`rooms/${roomCode}/games/${gameId}/finishedAt`] = Date.now();
  }

  await db.ref().update(updates);
}

export async function undoLastRound(roomCode, gameId, newTotals, prevStatus) {
  if (!db) return;


  const game = state.get('games')?.[gameId];
  if (!game || !game.rounds) return;

  // Do not allow undo if game is finished or abandoned.
  if (game.status === 'finished' || game.status === 'abandoned') {
    return;
  }

  const roundKeys = Object.keys(game.rounds);
  if (roundKeys.length === 0) return;

  const lastKey = roundKeys[roundKeys.length - 1];
  const updates = {};

  updates[`rooms/${roomCode}/games/${gameId}/rounds/${lastKey}`] = null;
  updates[`rooms/${roomCode}/games/${gameId}/totals`] = newTotals;
  updates[`rooms/${roomCode}/games/${gameId}/status`] = prevStatus;
  updates[`rooms/${roomCode}/games/${gameId}/winner`] = null;
  updates[`rooms/${roomCode}/games/${gameId}/finishedAt`] = null;
  updates[`rooms/${roomCode}/lobby/updatedAt`] = Date.now();

  await db.ref().update(updates);
}

// Compare-and-swap save of a player's in-progress Flip 7 selection. liveRound is
// the single source of truth for the in-progress round; the live total is derived
// on read (totals[pid] + liveRound[pid].pts). first-save is stored per player as
// liveRound[pid].firstSave.
//
// The transaction runs on the PARENT liveRound node — not liveRound/{pid} —
// because first-save is exclusive: marking one player must atomically clear the
// previous holder, which is a second child. We guard on the edited player's .v
// (the baseline captured when the drawer opened); when this save marks first-save
// we also clear any other holder and bump their version, so a concurrent editor of
// that player CAS-fails too. Returns { ok } — ok:false means another device changed
// this player first, or the round was committed underneath us.
export async function saveLiveRoundCAS(roomCode, gameId, pid, baseVersion, newEntry) {
  if (!db) return { ok: false };
  const ref = db.ref(`rooms/${roomCode}/games/${gameId}/liveRound`);
  const result = await ref.transaction((current) => {
    const map = current || {};
    const cur = map[pid];
    const curV = cur ? (cur.v || 0) : 0;
    if (curV !== baseVersion) return; // abort — CAS fail
    const next = { ...map };
    next[pid] = { ...newEntry, v: curV + 1 };
    if (newEntry.firstSave) {
      Object.keys(next).forEach((id) => {
        if (id !== pid && next[id] && next[id].firstSave) {
          // This actor just modified the prior holder's entry, so its `by` (which
          // drives the row highlight) tracks them too, alongside the version bump.
          next[id] = { ...next[id], firstSave: false, by: newEntry.by, v: (next[id].v || 0) + 1 };
        }
      });
    }
    return next;
  });
  return { ok: result.committed };
}

export async function updateJuaFines(roomCode, gameId, fines) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/games/${gameId}/juaFines`).set(fines);
}

export async function adjustTotals(roomCode, gameId, newTotals) {
  if (!db) return;
  await db.ref().update({
    [`rooms/${roomCode}/games/${gameId}/totals`]: newTotals,
    [`rooms/${roomCode}/lobby/updatedAt`]: Date.now(),
  });
}

export async function setRoomStatus(roomCode, status) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/lobby`).update({ status, updatedAt: Date.now() });
}

export async function updateRoomLobby(roomCode, updates) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/lobby`).update({ ...updates, updatedAt: Date.now() });
}

export async function releaseHost(roomCode) {
  if (!db) return;
  localStorage.removeItem(`gns_host_${roomCode}`);
  state.clearHostCache(roomCode);
  await db.ref(`rooms/${roomCode}/lobby/hostKey`).set(null);
}

export async function claimHost(roomCode) {
  if (!db) return;
  const newKey = generateKey();
  localStorage.setItem(`gns_host_${roomCode}`, newKey);
  state.clearHostCache(roomCode);
  await db.ref(`rooms/${roomCode}/lobby/hostKey`).set(newKey);
}

export async function submitGameEnd(roomCode, gameId, winnerId) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/games/${gameId}`).update({
    status: 'finished',
    winner: winnerId,
    finishedAt: Date.now(),
  });
}

export async function submitGameAbandon(roomCode, gameId) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/games/${gameId}`).update({
    status: 'abandoned',
    winner: null,
    finishedAt: Date.now(),
  });
}

export async function patchLastRoundMulti(roomCode, gameId, roundKey, pidEntries, newTotals, juaData) {
  if (!db) return;
  const updates = {
    [`rooms/${roomCode}/games/${gameId}/totals`]: newTotals,
    [`rooms/${roomCode}/lobby/updatedAt`]: Date.now(),
  };
  Object.entries(pidEntries).forEach(([pid, entry]) => {
    updates[`rooms/${roomCode}/games/${gameId}/rounds/${roundKey}/entries/${pid}`] = entry;
  });
  if (juaData !== undefined) {
    updates[`rooms/${roomCode}/games/${gameId}/rounds/${roundKey}/jua`] = juaData;
  }
  await db.ref().update(updates);
}

export async function addPlayerToGame(roomCode, gameId, playerId, playerName, accentIndex, currentPlayerIds) {
  if (!db) return;
  await db.ref().update({
    [`rooms/${roomCode}/games/${gameId}/playerIds`]: [...currentPlayerIds, playerId],
    [`rooms/${roomCode}/games/${gameId}/totals/${playerId}`]: 0,
    [`rooms/${roomCode}/games/${gameId}/playerSnapshot/${playerId}`]: { name: playerName, accentIndex },
    [`rooms/${roomCode}/lobby/updatedAt`]: Date.now(),
  });
}

export async function updateGameConfig(roomCode, gameId, configUpdates) {
  if (!db) return;
  const updates = { [`rooms/${roomCode}/lobby/updatedAt`]: Date.now() };
  for (const [key, value] of Object.entries(configUpdates)) {
    updates[`rooms/${roomCode}/games/${gameId}/config/${key}`] = value;
  }
  await db.ref().update(updates);
}

// ── Night Lifecycle ──

export async function endNight(roomCode) {
  if (!db) return;
  const now = Date.now();
  await db.ref(`rooms/${roomCode}/lobby`).update({
    status: 'night-ended',
    nightEndedAt: now,
    updatedAt: now,
  });
}

export async function startNewNight(roomCode) {
  if (!db) return;
  const now = Date.now();
  const gamesSnap = await db.ref(`rooms/${roomCode}/games`).once('value');
  const games = gamesSnap.val();

  const updates = {};
  if (games && Object.keys(games).length > 0) {
    const archiveKey = gamesSnap.val()?.__archivedAt || now;
    updates[`rooms/${roomCode}/nights/${archiveKey}`] = {
      endedAt: now,
      games,
    };
  }
  updates[`rooms/${roomCode}/games`] = null;
  updates[`rooms/${roomCode}/lobby/status`] = 'waiting';
  updates[`rooms/${roomCode}/lobby/activeGameId`] = null;
  updates[`rooms/${roomCode}/lobby/nightEndedAt`] = null;
  updates[`rooms/${roomCode}/lobby/updatedAt`] = now;

  await db.ref().update(updates);
}
