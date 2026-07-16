// screens.js
// Top-level screen switching. Split out on its own (rather than living in
// ui.js) so both ui.js and modals.js can import it without a circular
// dependency between the two.

const SCREEN_IDS = [
  'screen-menu',
  'screen-host-waiting',
  'screen-join-enter',
  'screen-join-connecting',
  'screen-join-timeout',
  'screen-game',
  'screen-pause',
  'screen-game-over',
];

export function showScreen(id) {
  SCREEN_IDS.forEach((sid) => {
    const node = document.getElementById(sid);
    if (!node) return;
    node.classList.toggle('active', sid === id);
  });
}
