// ═══════════════════════════════════════════
// Layout — shared screen shell
// ═══════════════════════════════════════════
//
// One wrapper so every screen gets identical top/left/right padding (the
// .screen-body token in css/app.css). Keeps the cross-screen rhythm consistent
// and gives us a single place to tune screen padding for phone vs tablet.

/**
 * Wrap a screen's markup in the standardized padded root.
 *
 * @param {string} inner  The screen's inner HTML.
 * @param {object} [opts]
 * @param {boolean} [opts.center]  Vertically/horizontally center content in the
 *                                 viewport (home, empty/error states).
 * @param {string}  [opts.pb]      Bottom-padding utility to clear a docked bar /
 *                                 nav, e.g. 'pb-8', 'pb-32'. Defaults to 'pb-8'.
 * @param {string}  [opts.extra]   Extra classes (e.g. 'min-h-full', an id-less
 *                                 modifier) appended to the root.
 * @returns {string} HTML string.
 */
export function screenBody(inner, { center = false, pb = 'pb-8', extra = '' } = {}) {
  const cls = [
    'screen-body',
    center ? 'screen-body--center' : '',
    pb,
    extra,
  ].filter(Boolean).join(' ');
  return `<div class="${cls}">${inner}</div>`;
}
