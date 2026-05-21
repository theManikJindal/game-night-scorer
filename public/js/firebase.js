// ═══════════════════════════════════════════
// Firebase RTDB Helpers
// ═══════════════════════════════════════════

import * as state from './state.js';
import * as cache from './cache.js';
import { WORDS } from './wordlist.js';

let db = null;
let _roomUnsub = null;

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

// ── Room Code Generation ──

function generateCode() {
  // 4-letter word + 2 digits (e.g. GAME42). Easier to share verbally
  // than a random 6-char alphanumeric. createRoom handles collisions by
  // retrying — namespace is ~96k codes.
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
    const snap = await db.ref(`rooms/${candidate}/meta`).once('value');
    if (!snap.exists()) {
      roomCode = candidate;
      break;
    }
  }
  if (!roomCode) throw new Error('Could not allocate a room code, try again');

  const hostKey = generateKey();
  const now = Date.now();

  const meta = {
    roomCode,
    hostKey,
    status: 'lobby',
    activeGameId: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.ref(`rooms/${roomCode}/meta`).set(meta);

  // Store host key locally
  localStorage.setItem(`gns_host_${roomCode}`, hostKey);
  state.clearHostCache(roomCode);

  return roomCode;
}

// ── Join / Watch Room ──

export async function joinRoom(roomCode) {
  if (!db) throw new Error('Firebase not configured');

  const code = roomCode.toUpperCase().trim();
  const snap = await db.ref(`rooms/${code}/meta`).once('value');
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
    state.set('roomMeta', data.meta || {});
    state.set('players', data.players || {});
    state.set('games', data.games || {});
    state.set('roomCode', roomCode);

    // Write-through to localStorage so a cold open can hydrate instantly
    // before this watcher reconnects. See docs/CACHING.md.
    cache.writeCache(roomCode, {
      meta: data.meta,
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
    isActive: true,
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
  await db.ref(`rooms/${roomCode}/meta`).update({
    activeGameId: gameId,
    status: 'playing',
    updatedAt: now,
  });

  return gameId;
}

export async function submitRound(roomCode, gameId, roundData, newTotals, endResult) {
  if (!db) return;


  const game = state.get('games')?.[gameId];
  if (!game) return;

  const roundIndex = Object.keys(game.rounds || {}).length;
  const updates = {};

  updates[`rooms/${roomCode}/games/${gameId}/rounds/${roundIndex}`] = roundData;
  updates[`rooms/${roomCode}/games/${gameId}/totals`] = newTotals;
  updates[`rooms/${roomCode}/meta/updatedAt`] = Date.now();

  if (endResult) {
    updates[`rooms/${roomCode}/games/${gameId}/status`] = endResult.overtime ? 'overtime' : 'finished';
    updates[`rooms/${roomCode}/games/${gameId}/overtime`] = endResult.overtime || false;
    if (endResult.winner) {
      updates[`rooms/${roomCode}/games/${gameId}/winner`] = endResult.winner;
      updates[`rooms/${roomCode}/games/${gameId}/finishedAt`] = Date.now();
    }
  }

  await db.ref().update(updates);
}

export async function undoLastRound(roomCode, gameId, newTotals, prevStatus, overtime = false) {
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
  updates[`rooms/${roomCode}/games/${gameId}/overtime`] = overtime;
  updates[`rooms/${roomCode}/games/${gameId}/winner`] = null;
  updates[`rooms/${roomCode}/games/${gameId}/finishedAt`] = null;
  updates[`rooms/${roomCode}/meta/updatedAt`] = Date.now();

  await db.ref().update(updates);
}

export async function setRoomStatus(roomCode, status) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/meta`).update({ status, updatedAt: Date.now() });
}

export async function updateRoomMeta(roomCode, updates) {
  if (!db) return;
  await db.ref(`rooms/${roomCode}/meta`).update({ ...updates, updatedAt: Date.now() });
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

// ── Night Lifecycle ──

export async function endNight(roomCode) {
  if (!db) return;
  const now = Date.now();
  await db.ref(`rooms/${roomCode}/meta`).update({
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
  updates[`rooms/${roomCode}/meta/status`] = 'lobby';
  updates[`rooms/${roomCode}/meta/activeGameId`] = null;
  updates[`rooms/${roomCode}/meta/nightEndedAt`] = null;
  updates[`rooms/${roomCode}/meta/updatedAt`] = now;

  await db.ref().update(updates);
}
