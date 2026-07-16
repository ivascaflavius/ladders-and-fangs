// ui.js
// Barrel module: re-exports the board (board-render.js), modals (modals.js),
// sound/haptics (audio.js) and screen switching (screens.js) submodules
// under one namespace, plus renders the HUD (header, leaderboard, card
// hand, event log, toasts, menu stats) directly. No game rules live here —
// this layer only reads state and forwards user intent (via callbacks) to
// whoever wires it up (main.js).

import BoardData from './board-data.js';
import Settings from './settings.js';
import { Icon } from './icons.js';
import { CARD_META } from './card-meta.js';

export * from './screens.js';
export * from './audio.js';
export * from './board-render.js';
export * from './modals.js';

const el = (id) => document.getElementById(id);

// Replaces every static `data-icon="name"` placeholder in index.html with its
// matching SVG at boot — keeps every hand-authored icon defined in one place
// (icons.js) instead of duplicated as inline markup across the HTML.
export function initStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const icon = Icon[node.dataset.icon];
    if (icon) node.innerHTML = icon;
  });
}

// Stamps data-theme on <html> so style.css's [data-theme="light"] overrides
// (or lack thereof, for dark) take effect. Dark is the implicit default from
// :root's own variable values, but the attribute is set explicitly either
// way for clarity.
export function applyTheme() {
  document.documentElement.setAttribute('data-theme', Settings.isDarkTheme() ? 'dark' : 'light');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// bindSettingsInputs lives in modals.js but needs applyTheme (defined here)
// without creating a circular import — wrap it so main.js's call site
// (`UI.bindSettingsInputs()`) stays unchanged.
import { bindSettingsInputs as bindSettingsInputsBase } from './modals.js';
export function bindSettingsInputs() {
  bindSettingsInputsBase(applyTheme);
}

// ---------------------------------------------------------------- header
function renderCardIcons(container, player, cards, revealActual) {
  container.innerHTML = '';
  if (cards.length === 0) {
    container.textContent = '—';
    return;
  }
  cards.forEach((cardType) => {
    const span = document.createElement('span');
    if (revealActual) {
      span.className = 'mini-card';
      span.innerHTML = CARD_META[cardType].icon;
      span.title = CARD_META[cardType].label;
    } else {
      span.className = 'mini-card mini-card-back';
      span.innerHTML = Icon.cardBack;
      span.title = 'Hidden card';
    }
    container.appendChild(span);
  });
}

export function renderHeader(state, myPlayer, oppPlayer) {
  const turnEl = el('turn-indicator');
  const isMyTurn = state.turn === myPlayer;
  const turnName = state.players[state.turn].name;
  turnEl.textContent = state.phase === 'game-over' ? 'Game Over' : isMyTurn ? 'Your turn' : `${turnName}'s turn`;

  const meChip = el('chip-me');
  const oppChip = el('chip-opp');
  // Colors follow the actual host/guest role, not "me vs opponent" — so a
  // given player's tokens are the same color on both screens.
  meChip.className = `player-chip ${myPlayer}`;
  oppChip.className = `player-chip ${oppPlayer}`;
  meChip.classList.toggle('active-turn', state.turn === myPlayer);
  oppChip.classList.toggle('active-turn', state.turn === oppPlayer);

  el('chip-me-name').textContent = `${state.players[myPlayer].name} (You)`;
  el('chip-opp-name').textContent = state.players[oppPlayer].name;
  // Both players' actual card types are shown — knowing what your opponent
  // is holding is part of the strategy (e.g. whether a Swap is coming).
  renderCardIcons(el('chip-me-cards'), myPlayer, state.players[myPlayer].cards, true);
  renderCardIcons(el('chip-opp-cards'), oppPlayer, state.players[oppPlayer].cards, true);

  el('stat-turn').textContent = `Turn ${state.stats.turns + 1}`;
}

// Subtle colored glow around the game screen's edges echoing whose turn it
// is (host/guest color, same mapping as the player chips) — readable at a
// glance without having to read the turn-indicator text, useful when the
// board itself is zoomed in on mobile. `player` is null to clear it (e.g.
// game over).
export function setTurnGlow(player) {
  const layout = el('game-layout');
  if (!layout) return;
  layout.classList.toggle('turn-glow-host', player === 'host');
  layout.classList.toggle('turn-glow-guest', player === 'guest');
}

export function renderGameTimer(startedAt, endedAt) {
  const elapsedMs = (endedAt || Date.now()) - startedAt;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  el('stat-time').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
}

export function renderLeaderboard(state, myPlayer, oppPlayer) {
  const container = el('token-leaderboard');
  container.innerHTML = '';
  // Each viewer sees their own tokens first — a "me-centric" view rather
  // than a fixed host/guest order.
  const order = [
    [myPlayer, 0], [myPlayer, 1], [oppPlayer, 0], [oppPlayer, 1],
  ];
  order.forEach(([player, idx], i) => {
    if (i === 2) {
      const sep = document.createElement('div');
      sep.className = 'leaderboard-sep';
      container.appendChild(sep);
    }
    const square = state.players[player].tokens[idx];
    const locked = square === BoardData.LAST_SQUARE;
    const entry = document.createElement('div');
    entry.className = `leaderboard-entry${locked ? ' locked' : ''}`;
    const icon = document.createElement('span');
    icon.className = `mini-token ${player} idx-${idx}`;
    entry.appendChild(icon);
    const label = document.createElement('span');
    label.innerHTML = locked ? `<span class="inline-icon">${Icon.lock}</span>100` : square === 0 ? 'Start' : String(square);
    entry.appendChild(label);
    container.appendChild(entry);
  });
}

// ---------------------------------------------------------------- cards
// Two fixed slots, always visible (even empty), so the footer layout never
// reflows as cards are drawn/played.
export function renderCardHand(state, myPlayer, onPlayCard) {
  const cards = state.players[myPlayer].cards;
  const slots = [el('card-hand').querySelector('[data-slot="0"]'), el('card-hand').querySelector('[data-slot="1"]')];
  slots.forEach((slot, i) => {
    const cardType = cards[i];
    slot.innerHTML = '';
    slot.onclick = null;
    if (cardType) {
      const meta = CARD_META[cardType];
      slot.className = 'card-slot filled';
      slot.innerHTML = `<span class="card-icon">${meta.icon}</span>`;
      slot.title = meta.label;
      slot.onclick = () => onPlayCard(cardType, i);
    } else {
      slot.className = 'card-slot';
      slot.removeAttribute('title');
    }
  });
}

// ---------------------------------------------------------------- log
let lastLogLen = 0;
export function renderLog(state) {
  const logEl = el('event-log');
  if (state.log.length === lastLogLen) return;
  lastLogLen = state.log.length;
  logEl.innerHTML = '';
  // Full history is retained (game.js no longer caps it) so the panel scrolls
  // through everything since the start of the match.
  state.log.forEach((entry) => {
    const div = document.createElement('div');
    div.className = entry.text.startsWith('Turn ') ? 'log-entry log-entry-turn' : 'log-entry';
    // A move that lands a token on the finish square (100) is worth calling
    // out with a lock glyph, since that token is now locked in for good.
    if (/→ 100\b/.test(entry.text)) {
      div.classList.add('log-entry-lock');
      div.innerHTML = `<span class="inline-icon">${Icon.lock}</span><span>${escapeHtml(entry.text)}</span>`;
    } else {
      div.textContent = entry.text;
    }
    logEl.appendChild(div);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

export function resetLogTracking() {
  lastLogLen = 0;
}

// ---------------------------------------------------------------- transient center-screen toast
let toastTimer = null;
export function flashEventToast(text, iconHtml) {
  const toast = el('event-toast');
  toast.innerHTML = (iconHtml ? `${iconHtml} ` : '') + escapeHtml(text);
  toast.classList.remove('show');
  void toast.offsetWidth; // restart animation
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
}

// ---------------------------------------------------------------- menu stats
export function renderMenuStats(stats) {
  const panel = el('menu-stats-panel');
  if (!stats || stats.gamesPlayed === 0) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  const winRate = Math.round((stats.wins / stats.gamesPlayed) * 100);
  const rows = [
    [Icon.trophy, `${stats.gamesPlayed} games played — ${winRate}% win rate`],
  ];
  if (stats.vsComputerGamesPlayed > 0) {
    const aiWinRate = Math.round((stats.vsComputerWins / stats.vsComputerGamesPlayed) * 100);
    rows.push([Icon.computer, `${aiWinRate}% win rate vs AI`]);
  }
  if (stats.longestSnakeSlide > 0) rows.push([Icon.snake, `Longest slide: ${stats.longestSnakeSlide} squares`]);
  if (stats.longestLadderClimb > 0) rows.push([Icon.ladder, `Longest climb: ${stats.longestLadderClimb} squares`]);
  if (stats.trapsSprungByMe > 0) rows.push([Icon.trap, `${stats.trapsSprungByMe} of your traps sprung`]);

  panel.innerHTML = rows
    .map(([icon, text]) => `<div class="menu-stat-row"><span class="menu-stat-icon">${icon}</span><span>${escapeHtml(text)}</span></div>`)
    .join('');
  panel.classList.remove('hidden');
}
