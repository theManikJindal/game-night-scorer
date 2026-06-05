// ═══════════════════════════════════════════
// Reactive State Store
// ═══════════════════════════════════════════

const _state = {};
const _listeners = new Map();

export function get(key) {
  return key ? _state[key] : { ..._state };
}

export function set(key, value) {
  const prev = _state[key];
  _state[key] = value;
  if (prev !== value) {
    _emit(key, value, prev);
  }
}

export function update(key, fn) {
  set(key, fn(_state[key]));
}

export function on(key, fn) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(fn);
  return () => _listeners.get(key).delete(fn);
}

function _emit(key, value, prev) {
  const fns = _listeners.get(key);
  if (fns) fns.forEach((fn) => fn(value, prev));
  // Also emit wildcard
  const wild = _listeners.get('*');
  if (wild) wild.forEach((fn) => fn(key, value, prev));
}

// ── Convenience getters ──

// Bolt Optimization: Memoize synchronous localStorage reads
// isHost() is called frequently during UI rendering cycles. Caching this value
// prevents redundant synchronous disk access, which improves rendering performance.
const _hostCache = new Map();

export function clearHostCache(roomCode) {
  _hostCache.delete(roomCode);
}

export function isHost() {
  const roomCode = get('roomCode');
  if (!roomCode) return false;

  let storedKey = _hostCache.get(roomCode);
  if (storedKey === undefined) {
    storedKey = localStorage.getItem(`gns_host_${roomCode}`);
    _hostCache.set(roomCode, storedKey);
  }

  const lobby = get('roomLobby');
  return storedKey && lobby && storedKey === lobby.hostKey;
}

export function currentGame() {
  const games = get('games');
  const lobby = get('roomLobby');
  if (!games || !lobby || !lobby.activeGameId) return null;
  return games[lobby.activeGameId] || null;
}

export function activePlayers() {
  const players = get('players');
  if (!players) return [];
  return Object.values(players).sort((a, b) => a.seatOrder - b.seatOrder);
}

// ── Accent colors ──
// Curated player accent palette. Covers the common roster sizes; beyond it,
// accentColor() generates additional distinct hues (see below).
export const ACCENT_COLORS = [
  '#0047FF', '#FF2E2E', '#FFB800', '#00B85C', '#8B5CF6', // blue, red, amber, green, violet
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', // pink, teal, orange, indigo, lime
  '#831843', '#0EA5E9', '#92400E', '#0E7490', '#15803D', // wine, sky, cocoa, steel, forest
  '#1E3A8A', '#BE123C', '#D946EF', '#7E22CE', '#64748B', // navy, ruby, fuchsia, plum, slate
];

// Resolve a player's accent index to a colour (hybrid palette).
// Indices within the curated palette return those colours; anything past it is
// generated with evenly-spread golden-angle hues, so very large rosters never
// run out and each index maps to one stable, distinct colour.
export function accentColor(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  if (i < ACCENT_COLORS.length) return ACCENT_COLORS[i];
  const hue = ((i - ACCENT_COLORS.length) * 137.508) % 360;
  return _hslToHex(hue, 62, 58);
}

function _hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
