// icons.js
// Hand-authored SVG icon set — a single consistent line-icon theme (1.8px
// rounded stroke, 24x24 viewBox, currentColor) so every glyph in the app
// renders identically across operating systems instead of relying on the
// emoji font installed on a given device.
//
// Usage: set an element's innerHTML to Icon.xxx (or Icon.diceFace(n)). Icons
// size themselves via the shared `.icon-svg` CSS class (1em square, inherits
// the surrounding text color) so they drop into text flow like an emoji did.
// Static markup in index.html picks up icons at boot via `data-icon="name"`
// attributes — see UI.initStaticIcons().

function svg(inner) {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

const S = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PIP_POSITIONS = {
  1: [[12, 12]],
  2: [[7.5, 7.5], [16.5, 16.5]],
  3: [[7.5, 7.5], [12, 12], [16.5, 16.5]],
  4: [[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]],
  5: [[7.5, 7.5], [16.5, 7.5], [12, 12], [7.5, 16.5], [16.5, 16.5]],
  6: [[7.5, 6.5], [7.5, 12], [7.5, 17.5], [16.5, 6.5], [16.5, 12], [16.5, 17.5]],
};

function diceFace(n) {
  const pips = PIP_POSITIONS[n] || PIP_POSITIONS[1];
  const dots = pips.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`).join('');
  return svg(`<rect x="3" y="3" width="18" height="18" rx="5" ${S}/>${dots}`);
}

export const Icon = {
  dice: diceFace(3),
  diceFace,

  link: svg(`<path d="M9 15l6-6" ${S}/><path d="M11 6.5l1-1a3.9 3.9 0 015.5 5.5l-1.5 1.5" ${S}/><path d="M13 17.5l-1 1a3.9 3.9 0 01-5.5-5.5l1.5-1.5" ${S}/>`),

  help: svg(`<circle cx="12" cy="12" r="9" ${S}/><path d="M9.6 9.6a2.4 2.4 0 114 1.8c-.9.7-1.6 1.2-1.6 2.4" ${S}/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>`),

  gear: svg(`<circle cx="12" cy="12" r="3.2" ${S}/><path d="M12 3.6v2.6M12 17.8v2.6M20.4 12h-2.6M6.2 12H3.6M17.5 6.5l-1.8 1.8M8.3 15.7l-1.8 1.8M17.5 17.5l-1.8-1.8M8.3 8.3L6.5 6.5" ${S}/>`),

  pencil: svg(`<path d="M4 20l.9-3.6L15.8 5.5a1.6 1.6 0 012.3 0l1.4 1.4a1.6 1.6 0 010 2.3L8.6 20.1z" ${S}/><path d="M14.3 7l3.7 3.7" ${S}/>`),

  hamburger: svg(`<path d="M4 6.5h16M4 12h16M4 17.5h16" ${S}/>`),

  scroll: svg(`<path d="M6 4h9a2.5 2.5 0 012.5 2.5V19a1.5 1.5 0 01-1.5 1.5H8A2.5 2.5 0 015.5 18V6A2 2 0 016 4z" ${S}/><path d="M17.5 6.5v10.8a2.2 2.2 0 002.2 2.2" ${S}/><path d="M9 9h6M9 12.5h6M9 16h3" ${S}/>`),

  close: svg(`<path d="M6 6l12 12M18 6L6 18" ${S}/>`),

  hourglass: svg(`<path d="M6.5 3.5h11M6.5 20.5h11" ${S}/><path d="M7.5 3.5v3.2c0 2 1.7 3.4 3.3 4.3v2c-1.6.9-3.3 2.3-3.3 4.3v3.2M16.5 3.5v3.2c0 2-1.7 3.4-3.3 4.3v2c1.6.9 3.3 2.3 3.3 4.3v3.2" ${S}/>`),

  stopwatch: svg(`<circle cx="12" cy="13" r="8" ${S}/><path d="M12 13l3.2-2M12 9V8M9.5 2.5h5" ${S}/>`),

  refresh: svg(`<path d="M4.5 12a7.5 7.5 0 0112.6-5.4M19.5 12a7.5 7.5 0 01-12.6 5.4" ${S}/><path d="M17.5 3.8v3.4h-3.4M6.5 20.2v-3.4h3.4" ${S}/>`),

  trophy: svg(`<path d="M8 4h8v6a4 4 0 01-8 0z" ${S}/><path d="M8 5.5H5.2a1 1 0 00-1 1.2c.4 2.3 1.8 3.6 3.8 3.9M16 5.5h2.8a1 1 0 011 1.2c-.4 2.3-1.8 3.6-3.8 3.9" ${S}/><path d="M12 14v3M9 20.5h6M9.5 20.5c0-2 .8-2.7 2.5-3 1.7.3 2.5 1 2.5 3" ${S}/>`),

  lock: svg(`<rect x="5" y="10.5" width="14" height="9.5" rx="2" ${S}/><path d="M8 10.5V7.5a4 4 0 018 0v3" ${S}/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/>`),

  user: svg(`<circle cx="12" cy="8" r="3.6" ${S}/><path d="M4.8 20c1-3.6 3.8-5.5 7.2-5.5s6.2 1.9 7.2 5.5" ${S}/>`),

  speaker: svg(`<path d="M4 9.5h3.2L12 6v12l-4.8-3.5H4z" ${S}/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.6 7.6 0 010 11" ${S}/>`),

  vibrate: svg(`<rect x="8" y="3.5" width="8" height="17" rx="2" ${S}/><path d="M3 9v6M21 9v6" ${S}/>`),

  swap: svg(`<path d="M4 8h13M13 4l4 4-4 4" ${S}/><path d="M20 16H7M11 12l-4 4 4 4" ${S}/>`),

  fastForward: svg(`<path d="M3.5 6.5v11l7-5.5z" fill="currentColor" stroke="none"/><path d="M12.5 6.5v11l7-5.5z" fill="currentColor" stroke="none"/>`),

  card: svg(`<rect x="4" y="5" width="16" height="14" rx="2.5" ${S}/><path d="M12 8.3l1.3 2.7 3 .4-2.15 2.1.5 3-2.65-1.4-2.65 1.4.5-3-2.15-2.1 3-.4z" fill="currentColor" stroke="none"/>`),

  cardBack: svg(`<rect x="4" y="5" width="16" height="14" rx="2.5" ${S}/><rect x="7" y="8" width="10" height="8" rx="1.2" ${S}/>`),

  ladder: svg(`<path d="M8 2.5v19M16 2.5v19M8 7h8M8 11.5h8M8 16h8" ${S}/>`),

  snake: svg(`<path d="M4 18c2-3 0-4.5 2-7s5 1 6-2-1-4.5 1.5-6.5" ${S}/><circle cx="14.6" cy="3.6" r="1.7" fill="currentColor" stroke="none"/>`),

  fang: svg(`<path d="M7 4c0 4 1.3 6 2.6 6S12 8 12 4M12 4c0 4 1.3 6 2.6 6S17 8 17 4" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>`),

  shield:
    '<svg class="icon-svg shield-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<defs><linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#f1f3f7"/><stop offset="45%" stop-color="#b7bcc9"/>' +
    '<stop offset="100%" stop-color="#7d828f"/></linearGradient></defs>' +
    '<path fill="url(#shieldGrad)" stroke="#5a5e69" stroke-width="0.6" ' +
    'd="M12 2.2l7.5 3v5.6c0 5.3-3.3 9.2-7.5 10.9-4.2-1.7-7.5-5.6-7.5-10.9V5.2l7.5-3z"/>' +
    '</svg>',
};
