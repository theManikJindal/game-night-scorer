// ═══════════════════════════════════════════
// Confetti — lightweight, self-contained
// ═══════════════════════════════════════════
// No external dependency (works offline in the PWA, no watermark, no
// third-party script). Draws onto a single fixed, pointer-transparent canvas
// appended to <body>.
//   startRain()/stopRain() — continuous full-width fall of tumbling flakes that
//                            fade out toward the bottom of the screen.
//   burst()                — angled cannons from given origin points.

import { ACCENT_COLORS } from '../state.js';

let _canvas = null;
let _ctx = null;
let _raf = null;
let _particles = [];

let _raining = false;
let _rate = 0.5;     // flakes emitted per frame while raining
let _emitAcc = 0;    // fractional-emit accumulator
let _stopTimer = null;

const DRAG = 0.99;          // air resistance on horizontal drift
const FADE_FRAMES = 30;     // life-based fade-out window (used by burst)
const FALL_FADE = 0.65;     // smaller = fade kicks in higher up the screen

// 5 accent colors — red, amber, green, violet, pink (blue dropped).
const PALETTE = ACCENT_COLORS.slice(1, 6);

// Shapes: 0 = square, 1 = circle, 2 = ribbon/streamer. Weighted toward rects.
const SHAPES = [0, 0, 0, 2, 1];

function _reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Celebration fanfare played whenever the rain starts. A single reused Audio
// element means a retrigger replaces the previous play rather than stacking
// overlapping sounds.
const FANFARES = ['sounds/trumpet-fanfare.mp3'];
let _fanfare = null;

function _playFanfare() {
  try {
    if (!_fanfare) _fanfare = new Audio();
    _fanfare.pause();
    _fanfare.src = FANFARES[(Math.random() * FANFARES.length) | 0];
    _fanfare.currentTime = 0;
    // Autoplay may be blocked without a user gesture (e.g. a reload that lands
    // straight on the winner's confetti) — that's fine, just stay silent then.
    _fanfare.play().catch(() => { /* autoplay blocked / file missing — ignore */ });
  } catch (_) { /* Audio unavailable — ignore */ }
}

function _resize() {
  if (!_canvas) return;
  const dpr = window.devicePixelRatio || 1;
  _canvas.width = window.innerWidth * dpr;
  _canvas.height = window.innerHeight * dpr;
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _ensureCanvas() {
  if (_canvas) return;
  _canvas = document.createElement('canvas');
  _canvas.id = 'confetti-canvas';
  Object.assign(_canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '300',
  });
  document.body.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  _resize();
  window.addEventListener('resize', _resize);
}

// Build one flake. `over` overrides defaults (position/velocity/flags).
function _flake(over) {
  const shape = SHAPES[(Math.random() * SHAPES.length) | 0];
  const isRibbon = shape === 2;
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    g: 0.03,
    fadeFall: false,                          // dim toward the bottom?
    shape,
    color: PALETTE[(Math.random() * PALETTE.length) | 0],
    w: isRibbon ? 4 + Math.random() * 2 : 6 + Math.random() * 5,
    h: isRibbon ? 11 + Math.random() * 6 : 5 + Math.random() * 5,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * (isRibbon ? 0.36 : 0.2),
    tilt: Math.random() * Math.PI * 2,
    vtilt: 0.1 + Math.random() * 0.16,        // 3D flutter speed
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleFreq: 0.04 + Math.random() * 0.06,  // sideways sway
    wobbleAmp: 0.3 + Math.random() * 0.8,
    life: 0,
    ttl: 600,
    ...over,
  };
}

// A rain flake entering from just above the top edge.
function _rainFlake(w) {
  return _flake({
    x: Math.random() * w,
    y: -20 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 1.6,
    vy: 2 + Math.random() * 2,
    g: 0.03,
    fadeFall: true,
    ttl: Infinity, // lives until it falls off the bottom
  });
}

function _draw(p, alpha) {
  _ctx.save();
  _ctx.globalAlpha = alpha;
  _ctx.translate(p.x, p.y);
  _ctx.rotate(p.rot);
  _ctx.scale(1, Math.cos(p.tilt)); // squash on a horizontal axis → 3D flutter
  _ctx.fillStyle = p.color;
  if (p.shape === 1) {
    _ctx.beginPath();
    _ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
    _ctx.fill();
  } else {
    _ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  }
  _ctx.restore();
}

function _tick() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  _ctx.clearRect(0, 0, w, h);

  // Steady emission from the top while raining.
  if (_raining) {
    _emitAcc += _rate;
    while (_emitAcc >= 1) {
      _emitAcc -= 1;
      _particles.push(_rainFlake(w));
    }
  }

  _particles = _particles.filter((p) => {
    p.life += 1;
    p.vx *= DRAG;
    p.vy += p.g;
    // Sideways sway (sin integrates to a bounded wobble) + tumbling flutter.
    p.x += p.vx + Math.sin(p.life * p.wobbleFreq + p.wobblePhase) * p.wobbleAmp;
    p.y += p.vy;
    p.rot += p.vrot;
    p.tilt += p.vtilt;
    let alpha = Math.min(1, (p.ttl - p.life) / FADE_FRAMES);
    // Fade with depth — fully visible up top, vanishing toward the bottom.
    if (p.fadeFall) alpha *= Math.max(0, Math.min(1, (h - p.y) / (h * FALL_FADE)));
    if (alpha > 0 && p.y > -40) _draw(p, alpha);
    return p.life < p.ttl && p.y < h + 60;
  });

  if (_raining || _particles.length > 0) {
    _raf = requestAnimationFrame(_tick);
  } else {
    _raf = null;
    _ctx.clearRect(0, 0, w, h);
  }
}

function _run() {
  if (!_raf) _raf = requestAnimationFrame(_tick);
}

// Start a full-width rain that fades as it falls. Emits for `duration` ms, then
// stops *producing* new flakes — those already on screen keep falling naturally.
// Production begins at the top with an empty screen; the rain fills in as flakes
// fall. Calling again retriggers it (and restarts the countdown).
export function startRain({ rate = 0.5, duration = 5000 } = {}) {
  if (_reducedMotion()) return;
  _playFanfare();
  _ensureCanvas();
  _rate = rate;
  // Restart the auto-stop countdown on every call (so taps retrigger/extend it).
  if (_stopTimer) clearTimeout(_stopTimer);
  _stopTimer = setTimeout(() => { _raining = false; _stopTimer = null; }, duration);
  _raining = true;
  _run();
}

// Stop emitting immediately; existing flakes finish falling.
export function stopRain() {
  _raining = false;
  if (_stopTimer) { clearTimeout(_stopTimer); _stopTimer = null; }
}

// Angled cannons. `origins`: [{ x, y, dir }] where dir is +1 (right) / -1 (left).
export function burst({ count = 40, origins } = {}) {
  if (_reducedMotion()) return;
  _ensureCanvas();
  const sources = (origins && origins.length)
    ? origins
    : [{ x: window.innerWidth / 2, y: 0, dir: 0 }];
  sources.forEach((src) => {
    const dir = src.dir || 0;
    for (let i = 0; i < count; i++) {
      const speed = dir === 0 ? (3 + Math.random() * 3) : (13 + Math.random() * 11);
      const elev = (25 + Math.random() * 50) * (Math.PI / 180);
      _particles.push(_flake({
        x: src.x,
        y: src.y,
        vx: dir === 0 ? (Math.random() - 0.5) * 4 : dir * Math.cos(elev) * speed,
        vy: dir === 0 ? (3 + Math.random() * 3) : -Math.sin(elev) * speed,
        g: 0.11,
        ttl: 260 + Math.random() * 140,
      }));
    }
  });
  _run();
}
