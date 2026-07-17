// icons.js
// Hand-authored SVG icon set — a single consistent line-icon theme (2px
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

const S = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
// thinner stroke for fine interior details that would clog at 2px
const T = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const PIP_POSITIONS = {
  1: [[12, 12]],
  2: [[8, 8], [16, 16]],
  3: [[8, 8], [12, 12], [16, 16]],
  4: [[8, 8], [16, 8], [8, 16], [16, 16]],
  5: [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]],
  6: [[8, 7], [8, 12], [8, 17], [16, 7], [16, 12], [16, 17]],
};

function diceFace(n) {
  const pips = PIP_POSITIONS[n] || PIP_POSITIONS[1];
  const dots = pips.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7" fill="currentColor"/>`).join('');
  return svg(`<rect x="3" y="3" width="18" height="18" rx="5" ${S}/>${dots}`);
}

export const Icon = {
  dice: diceFace(3),
  diceFace,

  link: svg(`<path d="M9 15l6-6" ${S}/><path d="M11 6.5l1-1a3.9 3.9 0 015.5 5.5l-1.5 1.5" ${S}/><path d="M13 17.5l-1 1a3.9 3.9 0 01-5.5-5.5l1.5-1.5" ${S}/>`),

  help: svg(`<circle cx="12" cy="12" r="9" ${S}/><path d="M9.7 9.7a2.3 2.3 0 113.9 1.7c-.9.7-1.6 1.2-1.6 2.3" ${S}/><circle cx="12" cy="16.8" r="1.1" fill="currentColor" stroke="none"/>`),

  info: svg(`<circle cx="12" cy="12" r="9" ${S}/><path d="M12 11v6" ${S}/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>`),

  // Classic Octocat mark, filled (not stroked) since it's a solid logo, not
  // a line icon like the rest of the set — used only for the About modal's
  // GitHub link, so the one-off style break stays contained there.
  github:
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.66-.22.66-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.16.58.67.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z"/>' +
    '</svg>',

  // A proper toothed cogwheel (not just radiating spokes) so it reads as
  // "settings" at a glance instead of looking like a sun/asterisk.
  gear: svg(`<circle cx="12" cy="12" r="3" ${S}/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82A1.65 1.65 0 003.09 14H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" ${S}/>`),

  pencil: svg(`<path d="M4 20l.9-3.6L15.8 5.5a1.6 1.6 0 012.3 0l1.4 1.4a1.6 1.6 0 010 2.3L8.6 20.1z" ${S}/><path d="M14.3 7l3.7 3.7" ${T}/>`),

  hamburger: svg(`<path d="M4 6.5h16M4 12h16M4 17.5h16" ${S}/>`),

  scroll: svg(`<path d="M6 4h9a2.5 2.5 0 012.5 2.5V19a1.5 1.5 0 01-1.5 1.5H8A2.5 2.5 0 015.5 18V6A2 2 0 016 4z" ${S}/><path d="M17.5 6.5v10.8a2.2 2.2 0 002.2 2.2" ${S}/><path d="M9 9h6M9 12.5h6M9 16h3" ${T}/>`),

  close: svg(`<path d="M6 6l12 12M18 6L6 18" ${S}/>`),

  hourglass: svg(`<path d="M6.5 3.5h11M6.5 20.5h11" ${S}/><path d="M7.5 3.5v3.2c0 2 1.7 3.4 3.3 4.3v2c-1.6.9-3.3 2.3-3.3 4.3v3.2M16.5 3.5v3.2c0 2-1.7 3.4-3.3 4.3v2c1.6.9 3.3 2.3 3.3 4.3v3.2" ${S}/>`),

  stopwatch: svg(`<circle cx="12" cy="13" r="8" ${S}/><path d="M12 13l3.2-2M12 9V8M9.5 2.5h5" ${S}/>`),

  refresh: svg(`<path d="M4.5 12a7.5 7.5 0 0112.6-5.4M19.5 12a7.5 7.5 0 01-12.6 5.4" ${S}/><path d="M17.5 3.8v3.4h-3.4M6.5 20.2v-3.4h3.4" ${S}/>`),

  trophy: svg(`<path d="M8 4h8v6a4 4 0 01-8 0z" ${S}/><path d="M8 5.5H5.2a1 1 0 00-1 1.2c.4 2.3 1.8 3.6 3.8 3.9M16 5.5h2.8a1 1 0 011 1.2c-.4 2.3-1.8 3.6-3.8 3.9" ${T}/><path d="M12 14v3M9 20.5h6M9.5 20.5c0-2 .8-2.7 2.5-3 1.7.3 2.5 1 2.5 3" ${S}/>`),

  lock: svg(`<rect x="5" y="10.5" width="14" height="9.5" rx="2" ${S}/><path d="M8 10.5V7.5a4 4 0 018 0v3" ${S}/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/>`),

  user: svg(`<circle cx="12" cy="8" r="3.6" ${S}/><path d="M4.8 20c1-3.6 3.8-5.5 7.2-5.5s6.2 1.9 7.2 5.5" ${S}/>`),

  computer: svg(`<rect x="4" y="4.5" width="16" height="11" rx="1.8" ${S}/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 13h5" ${T}/><path d="M9 20h6M12 15.5V20" ${S}/>`),

  speaker: svg(`<path d="M4 9.5h3.2L12 6v12l-4.8-3.5H4z" ${S}/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.6 7.6 0 010 11" ${T}/>`),

  vibrate: svg(`<rect x="8" y="3.5" width="8" height="17" rx="2" ${S}/><path d="M3 9v6M21 9v6" ${S}/>`),

  swap: svg(`<path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5" ${S}/><path d="M20 16H7M10.5 12.5L7 16l3.5 3.5" ${S}/>`),

  fastForward: svg(`<path d="M3.5 6.5v11l7-5.5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.5 6.5v11l7-5.5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`),

  card: svg(`<rect x="4.5" y="3.5" width="15" height="17" rx="2.5" ${S}/><path d="M12 7.6l1.3 2.7 3 .4-2.15 2.1.5 3-2.65-1.4-2.65 1.4.5-3-2.15-2.1 3-.4z" fill="currentColor" stroke="none"/>`),

  cardBack: svg(`<rect x="4.5" y="3.5" width="15" height="17" rx="2.5" ${S}/><rect x="7.5" y="6.5" width="9" height="11" rx="1.2" ${T}/>`),

  ladder: svg(`<path d="M7.5 2.5v19M16.5 2.5v19" ${S}/><path d="M7.5 6.5h9M7.5 11h9M7.5 15.5h9M7.5 20h9" ${T}/>`),

  // Snake with a clearly readable head: eye dot + forked tongue flicking
  // forward, body curving away in an S.
  snake: svg(
    `<path d="M16.5 7.5c-4.5-.8-6.5 1.4-5.2 3.4s4.6 1.7 4.2 4.4c-.4 2.6-4.5 3.4-9 2.4" ${S}/>` +
    `<circle cx="17.2" cy="6.6" r="2.6" fill="currentColor" stroke="none"/>` +
    `<circle cx="16.7" cy="5.8" r="0.75" fill="#12101c" stroke="none"/>` +
    `<path d="M19.7 5.6l1.6-1.1M21.3 4.5l1-.2M21.3 4.5l.2 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
  ),

  fang: svg(`<path d="M7 4c0 4.5 1.4 6.8 2.7 6.8S12.3 8.5 12.3 4M12.3 4c0 4.5 1.4 6.8 2.7 6.8S17.6 8.5 17.6 4" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`),

  // Caltrop/spike-mine glyph for the Trap card and its on-board markers.
  trap: svg(`<path d="M12 3v18M3 12h18M6.5 6.5l11 11M17.5 6.5l-11 11" ${T}/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>`),

  copy: svg(`<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" ${S}/><path d="M15.5 8.5V6.5a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2" ${S}/>`),

  // Comma-shaped speech/share-out arrow for the invite-code share button.
  share: svg(`<circle cx="18" cy="5.5" r="2.6" ${S}/><circle cx="6" cy="12" r="2.6" ${S}/><circle cx="18" cy="18.5" r="2.6" ${S}/><path d="M8.3 10.7l7.4-3.7M8.3 13.3l7.4 3.7" ${S}/>`),

  moon: svg(`<path d="M20 14.2A8.3 8.3 0 1110.3 4a6.7 6.7 0 009.7 10.2z" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>`),

  // References the shared <linearGradient id="shieldGrad"> defined once in
  // index.html — see the comment there for why it isn't defined inline here.
  shield:
    '<svg class="icon-svg shield-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="url(#shieldGrad)" stroke="#5a5e69" stroke-width="0.6" ' +
    'd="M12 2.2l7.5 3v5.6c0 5.3-3.3 9.2-7.5 10.9-4.2-1.7-7.5-5.6-7.5-10.9V5.2l7.5-3z"/>' +
    '</svg>',
};
