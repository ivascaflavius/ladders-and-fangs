// ui.js
// Barrel module: re-exports the board (board-render.js), modals (modals.js),
// sound/haptics (audio.js) and screen switching (screens.js) submodules
// under one namespace, plus renders the HUD (header, leaderboard, card
// hand, event log, toasts, menu stats) directly. No game rules live here —
// this layer only reads state and forwards user intent (via callbacks) to
// whoever wires it up (main.js).

import BoardData from './board-data.js';
import Settings from './settings.js';
import Stats from './stats.js';
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
  const isGameOver = state.phase === 'game-over';
  // Waiting on the opponent (AI "thinking" delay or a remote human's turn)
  // is otherwise a silent stretch of nothing happening — an animated
  // ellipsis (the same one used on the host-waiting screen) makes clear the
  // game hasn't stalled, not just whose turn it technically is.
  if (isGameOver) {
    turnEl.textContent = 'Game Over';
  } else if (isMyTurn) {
    turnEl.textContent = 'Your turn';
  } else {
    turnEl.innerHTML = `${escapeHtml(turnName)}'s turn<span class="inline-dots">...</span>`;
  }

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
// The log is append-only within a match (game.js never rewrites earlier
// entries), so only the new entries since the last render need DOM nodes —
// clearing and rebuilding the *entire* history on every single new line
// would make a long match's log panel do O(n) work per entry, i.e. O(n^2)
// DOM churn over the course of the game, for no benefit since nothing
// earlier ever changes.
export function renderLog(state) {
  const logEl = el('event-log');
  if (state.log.length === lastLogLen) return;
  const hostName = state.players.host.name;
  const guestName = state.players.guest.name;
  for (let i = lastLogLen; i < state.log.length; i++) {
    const entry = state.log[i];
    const div = document.createElement('div');
    const isTurn = entry.text.startsWith('Turn ');
    let className = isTurn ? 'log-entry log-entry-turn' : 'log-entry';
    // Turn headers ("Turn 4 — Flavius") name the player whose turn is
    // starting; color them by host/guest role (same mapping as the player
    // chips) so the log is scannable without reading every name.
    if (isTurn) {
      if (entry.text.endsWith(`— ${hostName}`)) className += ' log-entry-turn-host';
      else if (entry.text.endsWith(`— ${guestName}`)) className += ' log-entry-turn-guest';
    }
    div.className = className;
    // A move that lands a token on the finish square (100) is worth calling
    // out with a lock glyph, since that token is now locked in for good.
    if (/→ 100\b/.test(entry.text)) {
      div.classList.add('log-entry-lock');
      div.innerHTML = `<span class="inline-icon">${Icon.lock}</span><span>${escapeHtml(entry.text)}</span>`;
    } else {
      div.textContent = entry.text;
    }
    logEl.appendChild(div);
  }
  lastLogLen = state.log.length;
  logEl.scrollTop = logEl.scrollHeight;
}

export function resetLogTracking() {
  lastLogLen = 0;
  const logEl = el('event-log');
  if (logEl) logEl.innerHTML = '';
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
// Renders into the Stats modal's body (see modals.js's openStatsModal) —
// moved off the main menu itself since a stats block permanently on the
// menu pushed the menu buttons below the fold on short/toolbar-heavy
// mobile viewports.
export function renderMenuStats(stats) {
  const panel = el('stats-modal-body');
  if (!panel) return;
  if (!stats || stats.gamesPlayed === 0) {
    panel.innerHTML = `<div class="menu-stat-row"><span>No games played yet — go win one!</span></div>`;
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
  if (stats.currentStreak >= 2) rows.push([Icon.fastForward, `Current win streak: ${stats.currentStreak}`]);
  if (stats.bestStreak >= 2) rows.push([Icon.trophy, `Best win streak: ${stats.bestStreak}`]);

  const rowsHtml = rows
    .map(([icon, text]) => `<div class="menu-stat-row"><span class="menu-stat-icon">${icon}</span><span>${escapeHtml(text)}</span></div>`)
    .join('');

  const unlocked = Stats.getUnlockedAchievements(stats);
  const unlockedIds = new Set(unlocked.map((a) => a.id));
  const achievementsHtml = `
    <div class="menu-stat-section-label">Achievements (${unlocked.length}/${Stats.ACHIEVEMENTS.length})</div>
    <div class="achievement-grid">
      ${Stats.ACHIEVEMENTS.map((a) => {
        const isUnlocked = unlockedIds.has(a.id);
        return `<div class="achievement-badge${isUnlocked ? ' unlocked' : ''}">
          <span class="achievement-badge-icon">${Icon[a.icon]}</span>
          <span class="achievement-badge-label">${escapeHtml(a.label)}</span>
          <span class="achievement-badge-desc">${escapeHtml(a.desc)}</span>
        </div>`;
      }).join('')}
    </div>`;

  // Per-board breakdown — every board shows up (in the same order as the
  // board picker in Settings), even ones never played, so the list reads as
  // a complete roster rather than leaving the viewer wondering if a board
  // they haven't tried yet is even tracked.
  const byBoard = stats.byBoard || {};
  const boardRowsHtml = BoardData.getBoardList()
    .map(({ id, name }) => {
      const boardStats = byBoard[id];
      const text = boardStats && boardStats.gamesPlayed > 0
        ? (() => {
          const { gamesPlayed, wins } = boardStats;
          const winRatePct = Math.round((wins / gamesPlayed) * 100);
          return `${name}: ${gamesPlayed} game${gamesPlayed === 1 ? '' : 's'} — ${winRatePct}% win rate`;
        })()
        : `${name}: Not yet played`;
      return `<div class="menu-stat-row"><span class="menu-stat-icon">${Icon.ladder}</span><span>${escapeHtml(text)}</span></div>`;
    })
    .join('');

  panel.innerHTML = `${rowsHtml}<div class="menu-stat-section-label">By board</div>${boardRowsHtml}` + achievementsHtml;
}
