// card-meta.js
// Shared card icon/label lookup — used by board-render (card reveal), modals
// (dice-modal double move button, card choice overlay), and ui.js (card
// hand, header chips) alike, so it lives outside all of them.

import { CARD_TYPES } from './game.js';
import { Icon } from './icons.js';

export const CARD_META = {
  [CARD_TYPES.SHIELD]: { icon: Icon.shield, label: 'Shield' },
  [CARD_TYPES.SWAP]: { icon: Icon.swap, label: 'Swap' },
  [CARD_TYPES.DOUBLE_MOVE]: { icon: Icon.fastForward, label: 'Double' },
  [CARD_TYPES.TRAP]: { icon: Icon.trap, label: 'Trap' },
};

// Filled silver shield glyph — used everywhere instead of the outline-style
// shield icon so it reads consistently across platforms/fonts.
export const SHIELD_ICON_SVG = Icon.shield;
