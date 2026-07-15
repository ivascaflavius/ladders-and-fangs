// ui.js
// Rendering, animations, and pointer-event input handling. No game rules
// live here — this module only reads state and forwards user intent (via
// callbacks) to whoever wires it up (main.js).

import BoardData from './board-data.js';
import Settings from './settings.js';
import { CARD_TYPES } from './game.js';

// Filled silver shield glyph — used everywhere instead of the outline-style
// 🛡 emoji so the icon reads consistently across platforms/fonts.
export const SHIELD_ICON_SVG =
  '<svg class="shield-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<defs><linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0%" stop-color="#f1f3f7"/><stop offset="45%" stop-color="#b7bcc9"/>' +
  '<stop offset="100%" stop-color="#7d828f"/></linearGradient></defs>' +
  '<path fill="url(#shieldGrad)" stroke="#5a5e69" stroke-width="0.6" ' +
  'd="M12 2.2l7.5 3v5.6c0 5.3-3.3 9.2-7.5 10.9-4.2-1.7-7.5-5.6-7.5-10.9V5.2l7.5-3z"/>' +
  '</svg>';

const CARD_META = {
  [CARD_TYPES.SHIELD]: { icon: SHIELD_ICON_SVG, label: 'Shield' },
  [CARD_TYPES.SWAP]: { icon: '🔀', label: 'Swap' },
  [CARD_TYPES.DOUBLE_MOVE]: { icon: '⏩', label: 'Double' },
};

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- screens
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
    const node = el(sid);
    if (!node) return;
    node.classList.toggle('active', sid === id);
  });
}

// ---------------------------------------------------------------- audio
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

const SOUND_FREQS = {
  roll: [220, 330],
  move: [440],
  step: [340],
  capture: [180, 120],
  ladder: [440, 660, 880],
  snake: [500, 300, 180],
  card: [520, 660],
  shieldSave: [660, 880, 990],
  win: [523, 659, 784, 1046],
  lose: [300, 250, 200],
};

export function playSound(name) {
  if (!Settings.isSoundOn()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const freqs = SOUND_FREQS[name] || [440];
  const now = ctx.currentTime;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + i * 0.09;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

const HAPTIC_PATTERNS = {
  roll: 15,
  move: 10,
  step: 6,
  capture: [30, 40, 30],
  card: [15, 30, 15],
  win: [20, 40, 20, 40, 60],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function haptic(name) {
  Settings.vibrate(HAPTIC_PATTERNS[name] || 15);
}

// ---------------------------------------------------------------- board
let boardEl = null;
let tokensLayerEl = null;
const tokenEls = {};
const squareEls = {};
const lastSquareByToken = {}; // `${player}${idx}` -> last known square (for landing/capture animation)

function squareCenterPercent(square) {
  if (square === 0) {
    // off-board tokens rest just outside square 1's cell
    return { x: -4, y: 104 };
  }
  const { row, col } = BoardData.squareToRowCol(square);
  const gridRowFromTop = BoardData.BOARD_SIZE - 1 - row;
  const x = ((col + 0.5) / BoardData.BOARD_SIZE) * 100;
  const y = ((gridRowFromTop + 0.5) / BoardData.BOARD_SIZE) * 100;
  return { x, y };
}

function buildConnectionsSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'connections-layer');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');

  BoardData.LADDERS.forEach((ladder) => {
    const a = squareCenterPercent(ladder.from);
    const b = squareCenterPercent(ladder.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // perpendicular unit vector, scaled to a ~2.2-unit rail spread
    const px = (-dy / len) * 2.2;
    const py = (dx / len) * 2.2;

    const g = document.createElementNS(NS, 'g');

    const rail1 = document.createElementNS(NS, 'line');
    rail1.setAttribute('class', 'ladder-rail');
    rail1.setAttribute('x1', a.x + px);
    rail1.setAttribute('y1', a.y + py);
    rail1.setAttribute('x2', b.x + px);
    rail1.setAttribute('y2', b.y + py);
    g.appendChild(rail1);

    const rail2 = document.createElementNS(NS, 'line');
    rail2.setAttribute('class', 'ladder-rail');
    rail2.setAttribute('x1', a.x - px);
    rail2.setAttribute('y1', a.y - py);
    rail2.setAttribute('x2', b.x - px);
    rail2.setAttribute('y2', b.y - py);
    g.appendChild(rail2);

    const rungCount = Math.max(3, Math.round(len / 6));
    for (let i = 1; i < rungCount; i++) {
      const t = i / rungCount;
      const cx = a.x + dx * t;
      const cy = a.y + dy * t;
      const rung = document.createElementNS(NS, 'line');
      rung.setAttribute('class', 'ladder-rung');
      rung.setAttribute('x1', cx + px);
      rung.setAttribute('y1', cy + py);
      rung.setAttribute('x2', cx - px);
      rung.setAttribute('y2', cy - py);
      g.appendChild(rung);
    }

    svg.appendChild(g);
  });

  BoardData.SNAKES.forEach((snake) => {
    const a = squareCenterPercent(snake.from); // head
    const b = squareCenterPercent(snake.to); // tail
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 3.4;
    const py = (dx / len) * 3.4;

    const segments = 5;
    let d = `M ${a.x} ${a.y}`;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const wiggle = Math.sin(t * Math.PI * 2.4) * (1 - t * 0.3);
      const midX = a.x + dx * (t - 0.5 / segments) + px * wiggle;
      const midY = a.y + dy * (t - 0.5 / segments) + py * wiggle;
      const endX = a.x + dx * t;
      const endY = a.y + dy * t;
      d += ` Q ${midX} ${midY} ${endX} ${endY}`;
    }

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'snake-body');
    path.setAttribute('d', d);
    svg.appendChild(path);

    const head = document.createElementNS(NS, 'circle');
    head.setAttribute('class', 'snake-head-marker');
    head.setAttribute('cx', a.x);
    head.setAttribute('cy', a.y);
    head.setAttribute('r', 1.8);
    svg.appendChild(head);
  });

  return svg;
}

export function initBoard() {
  boardEl = el('board');
  boardEl.innerHTML = '';
  for (let sq = 1; sq <= BoardData.LAST_SQUARE; sq++) {
    const { row, col } = BoardData.squareToRowCol(sq);
    const gridRow = BoardData.BOARD_SIZE - row;
    const gridCol = col + 1;
    const div = document.createElement('div');
    div.className = 'square';
    div.style.gridRow = String(gridRow);
    div.style.gridColumn = String(gridCol);
    if ((row + col) % 2 === 1) div.classList.add('alt');
    if (BoardData.isSafeSquare(sq)) div.classList.add('safe');
    if (BoardData.isCardSquare(sq)) div.classList.add('card-square');

    const num = document.createElement('span');
    num.className = 'square-num';
    num.textContent = String(sq);
    div.appendChild(num);

    const ladder = BoardData.getLadder(sq);
    const snake = BoardData.getSnake(sq);
    if (ladder) {
      const icon = document.createElement('span');
      icon.className = 'square-icon';
      icon.textContent = `🪜${ladder.to}`;
      icon.style.color = 'var(--ladder-color)';
      div.appendChild(icon);
    } else if (snake) {
      const icon = document.createElement('span');
      icon.className = 'square-icon';
      icon.textContent = `🐍${snake.to}`;
      icon.style.color = 'var(--snake-color)';
      div.appendChild(icon);
    } else if (BoardData.isCardSquare(sq)) {
      const icon = document.createElement('span');
      icon.className = 'square-icon';
      icon.textContent = '🃏';
      div.appendChild(icon);
    }

    boardEl.appendChild(div);
    squareEls[sq] = div;
  }

  BoardData.LADDERS.forEach((l) => squareEls[l.to]?.classList.add('ladder-end'));
  BoardData.SNAKES.forEach((s) => squareEls[s.to]?.classList.add('snake-end'));

  boardEl.appendChild(buildConnectionsSvg());

  tokensLayerEl = document.createElement('div');
  tokensLayerEl.className = 'tokens-layer';
  boardEl.appendChild(tokensLayerEl);

  ['host', 'guest'].forEach((player) => {
    [0, 1].forEach((idx) => {
      const t = document.createElement('div');
      t.className = `token ${player} idx-${idx}`;
      t.dataset.player = player;
      t.dataset.tokenIndex = String(idx);
      const label = document.createElement('span');
      label.className = 'token-label';
      label.textContent = String(idx + 1);
      t.appendChild(label);
      tokensLayerEl.appendChild(t);
      tokenEls[`${player}${idx}`] = t;
      lastSquareByToken[`${player}${idx}`] = 0;
    });
  });
}

// tiny per-token offset so two tokens on the same square don't fully overlap
const TOKEN_JITTER = [
  { dx: -14, dy: -14 },
  { dx: 14, dy: -14 },
  { dx: -14, dy: 14 },
  { dx: 14, dy: 14 },
];

export function renderTokens(state, selectableTokens, onTokenTap) {
  const occupants = {}; // square -> list of {player, idx}
  ['host', 'guest'].forEach((player) => {
    state.players[player].tokens.forEach((sq, idx) => {
      occupants[sq] = occupants[sq] || [];
      occupants[sq].push({ player, idx });
    });
  });

  Object.entries(occupants).forEach(([sqStr, list]) => {
    const square = Number(sqStr);
    const { x, y } = squareCenterPercent(square);
    list.forEach((occ, i) => {
      const key = `${occ.player}${occ.idx}`;
      const t = tokenEls[key];
      const jitter = list.length > 1 ? TOKEN_JITTER[i % TOKEN_JITTER.length] : { dx: 0, dy: 0 };
      t.style.left = `calc(${x}% + ${jitter.dx * 0.4}px)`;
      t.style.top = `calc(${y}% + ${jitter.dy * 0.4}px)`;

      const prevSquare = lastSquareByToken[key];
      if (prevSquare !== square) {
        if (prevSquare !== 0 && square === 0) {
          t.classList.remove('landed');
          t.classList.add('captured-flash');
          setTimeout(() => t.classList.remove('captured-flash'), 550);
          flashBoard();
        } else if (prevSquare !== undefined) {
          t.classList.remove('captured-flash');
          t.classList.add('landed');
          setTimeout(() => t.classList.remove('landed'), 500);
          flashSquare(square);
        }
        lastSquareByToken[key] = square;
      }
    });
  });

  Object.values(tokenEls).forEach((t) => {
    t.classList.remove('selectable');
    t.onclick = null;
  });

  (selectableTokens || []).forEach(({ player, tokenIndex }) => {
    const t = tokenEls[`${player}${tokenIndex}`];
    t.classList.add('selectable');
    t.onclick = () => onTokenTap(player, tokenIndex);
  });
}

function flashSquare(square) {
  const sqEl = squareEls[square];
  if (!sqEl) return;
  sqEl.classList.remove('flash');
  // eslint-disable-next-line no-unused-expressions
  void sqEl.offsetWidth; // restart animation
  sqEl.classList.add('flash');
  setTimeout(() => sqEl.classList.remove('flash'), 650);
}

function flashBoard() {
  if (!boardEl) return;
  boardEl.classList.remove('shake');
  void boardEl.offsetWidth;
  boardEl.classList.add('shake');
  setTimeout(() => boardEl.classList.remove('shake'), 450);
}

function setTokenSquare(tokenEl, square, jitter) {
  const { x, y } = squareCenterPercent(square);
  const dx = jitter ? jitter.dx * 0.4 : 0;
  const dy = jitter ? jitter.dy * 0.4 : 0;
  tokenEl.style.left = `calc(${x}% + ${dx}px)`;
  tokenEl.style.top = `calc(${y}% + ${dy}px)`;
}

function bounceSettle(tokenEl) {
  tokenEl.classList.remove('landed');
  void tokenEl.offsetWidth;
  tokenEl.classList.add('landed');
  setTimeout(() => tokenEl.classList.remove('landed'), 500);
}

// ---------------------------------------------------------------- move trace animation
// Plays a deterministic sequence of walk/ladder/snake/capture/card sub-steps
// (see game.js's moveTrace) so both peers see the token physically travel
// the board instead of teleporting to the final square.
export async function animateTrace(trace) {
  const touched = new Set();
  for (const entry of trace) {
    // eslint-disable-next-line no-await-in-loop
    await animateTraceEntry(entry, touched);
  }
  touched.forEach((key) => {
    const t = tokenEls[key];
    if (t) bounceSettle(t);
  });
}

async function animateTraceEntry(entry, touched) {
  const key = `${entry.player}${entry.tokenIndex}`;
  const tokenEl = tokenEls[key];
  if (!tokenEl) return;

  if (entry.kind === 'walk') {
    if (entry.path.length === 0) return;
    touched.add(key);
    tokenEl.classList.remove('sliding');
    tokenEl.classList.add('walking');
    for (const sq of entry.path) {
      setTokenSquare(tokenEl, sq);
      lastSquareByToken[key] = sq;
      playSound('step');
      haptic('step');
      // eslint-disable-next-line no-await-in-loop
      await sleep(140);
    }
    tokenEl.classList.remove('walking');
    return;
  }

  if (entry.kind === 'ladder' || entry.kind === 'snake') {
    touched.add(key);
    tokenEl.classList.add('sliding');
    setTokenSquare(tokenEl, entry.to);
    lastSquareByToken[key] = entry.to;
    playSound(entry.kind);
    haptic(entry.kind === 'snake' ? 'capture' : 'move');
    await sleep(560);
    tokenEl.classList.remove('sliding');
    flashSquare(entry.to);
    return;
  }

  if (entry.kind === 'shieldSave') {
    tokenEl.classList.add('shield-glow');
    playSound('shieldSave');
    haptic('card');
    await sleep(700);
    tokenEl.classList.remove('shield-glow');
    return;
  }

  if (entry.kind === 'capture') {
    const capturedKey = `${entry.capturedPlayer}${entry.capturedIndex}`;
    const capturedEl = tokenEls[capturedKey];
    if (capturedEl) {
      capturedEl.classList.add('captured-flash');
      playSound('capture');
      haptic('capture');
      flashBoard();
      await sleep(500);
      capturedEl.classList.remove('captured-flash');
      setTokenSquare(capturedEl, 0);
      lastSquareByToken[capturedKey] = 0;
    }
    return;
  }

  if (entry.kind === 'card') {
    await showCardReveal(entry.cardType);
  }
}

export async function showCardReveal(cardType) {
  const overlay = el('card-reveal');
  const flipper = el('card-reveal-flipper');
  const front = el('card-reveal-front');
  const meta = CARD_META[cardType];
  front.innerHTML = `<span>${meta.icon}</span><span class="card-reveal-label">${meta.label}</span>`;
  flipper.classList.remove('flipped');
  overlay.classList.remove('hidden');
  playSound('card');
  haptic('card');
  await sleep(150);
  void flipper.offsetWidth;
  flipper.classList.add('flipped');
  await sleep(1000);
  overlay.classList.add('hidden');
  flipper.classList.remove('flipped');
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
      span.textContent = '🎴';
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
    label.textContent = locked ? '🔒100' : square === 0 ? 'Start' : String(square);
    entry.appendChild(label);
    container.appendChild(entry);
  });
}

// ---------------------------------------------------------------- cards
export function renderCardHand(state, myPlayer, onPlayCard) {
  const hand = el('card-hand');
  hand.innerHTML = '';
  state.players[myPlayer].cards.forEach((cardType, idx) => {
    const meta = CARD_META[cardType];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'card-chip';
    chip.innerHTML = `<span class="card-icon">${meta.icon}</span><span>${meta.label}</span>`;
    chip.addEventListener('click', () => onPlayCard(cardType, idx));
    hand.appendChild(chip);
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
    div.textContent = entry.text;
    logEl.appendChild(div);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

export function resetLogTracking() {
  lastLogLen = 0;
}

// ---------------------------------------------------------------- transient center-screen toast
let toastTimer = null;
export function flashEventToast(text) {
  const toast = el('event-toast');
  toast.textContent = text;
  toast.classList.remove('show');
  void toast.offsetWidth; // restart animation
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
}

// ---------------------------------------------------------------- dice modal
const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let dieTimer = null;

export function openDiceModal() {
  el('dice-modal-face').textContent = '🎲';
  el('dice-modal-face').className = 'dice-modal-face';
  el('dice-modal-result').textContent = '';
  const tokensEl = el('dice-modal-tokens');
  tokensEl.innerHTML = '';
  tokensEl.classList.add('hidden');
  el('dice-modal').classList.remove('hidden');
}

export function isDiceModalOpen() {
  return !el('dice-modal').classList.contains('hidden');
}

// Used when the modal needs to reflect an already-known roll without
// re-running the animation (e.g. reconnect mid-choice).
export function setDiceModalResult(value) {
  const face = el('dice-modal-face');
  face.textContent = DIE_FACES[value - 1];
  el('dice-modal-result').textContent = `Rolled a ${value}`;
}

// Quick, quiet click — deliberately lighter-weight than playSound()'s
// multi-tone chime so it can rattle rapidly through a roll without becoming
// a wall of noise.
function playDieTick() {
  if (!Settings.isSoundOn()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 160 + Math.random() * 90;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

export function animateDiceModal(finalValue, onDone) {
  if (dieTimer) clearInterval(dieTimer); // guard against overlapping rolls
  const face = el('dice-modal-face');
  face.classList.remove('landed');
  face.classList.add('rolling');
  let ticks = 0;
  const totalTicks = 14;
  dieTimer = setInterval(() => {
    face.textContent = DIE_FACES[Math.floor(Math.random() * 6)];
    playDieTick();
    ticks++;
    if (ticks > totalTicks) {
      clearInterval(dieTimer);
      dieTimer = null;
      face.textContent = DIE_FACES[finalValue - 1];
      face.classList.remove('rolling');
      face.classList.add('landed');
      setTimeout(() => face.classList.remove('landed'), 450);
      el('dice-modal-result').textContent = `Rolled a ${finalValue}`;
      if (onDone) onDone();
    }
  }, 55);
}

// options: [{ player, tokenIndex, from, to, type }]
// doubleMove: null, or { onPlay } — when the player holds a Double Move card,
// this renders it as an extra choice right here (this modal is the ONLY
// place it can be played from, since it covers the footer card hand).
export function showDiceModalTokenChoice(options, onChoose, doubleMove) {
  const container = el('dice-modal-tokens');
  container.innerHTML = '';
  container.classList.remove('hidden');

  const label = document.createElement('p');
  label.className = 'dice-modal-prompt';
  label.textContent = 'Choose a token to move';
  container.appendChild(label);

  const row = document.createElement('div');
  row.className = 'dice-modal-choice-row';
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dice-modal-choice';

    const icon = document.createElement('span');
    icon.className = `mini-token ${opt.player} idx-${opt.tokenIndex}`;
    btn.appendChild(icon);

    const text = document.createElement('span');
    const fromLabel = opt.from === 0 ? 'Start' : opt.from;
    let destIcon = '';
    if (opt.type === 'ladder') destIcon = ' 🪜';
    else if (opt.type === 'snake') destIcon = ' 🐍';
    else if (BoardData.isCardSquare(opt.to)) destIcon = ' 🃏';
    text.innerHTML = `${fromLabel} → ${opt.to}${destIcon}`;
    btn.appendChild(text);

    btn.addEventListener('click', () => onChoose(opt.tokenIndex));
    row.appendChild(btn);
  });
  container.appendChild(row);

  if (doubleMove) {
    const divider = document.createElement('p');
    divider.className = 'dice-modal-prompt';
    divider.textContent = 'or play a card instead';
    container.appendChild(divider);

    const dmBtn = document.createElement('button');
    dmBtn.type = 'button';
    dmBtn.className = 'dice-modal-choice dice-modal-choice-card';
    dmBtn.innerHTML = '<span class="card-icon">⏩</span><span>Play Double Move — move both tokens</span>';
    dmBtn.addEventListener('click', doubleMove.onPlay);
    container.appendChild(dmBtn);
  }
}

export function closeDiceModal() {
  hideOverlay('dice-modal');
}

export function setRollButtonEnabled(enabled, label) {
  const btn = el('btn-roll');
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.5';
  if (label) el('die-label').textContent = label;
}

// remainingSec: null hides the badge entirely (not in the rolling phase).
export function setRollTimer(remainingSec) {
  const badge = el('roll-timer');
  if (remainingSec === null || remainingSec === undefined) {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  badge.textContent = `⏳ ${remainingSec}s`;
  badge.classList.toggle('urgent', remainingSec <= 10);
}

// ---------------------------------------------------------------- overlays
export function showShieldOverlay(onDecision) {
  const overlay = el('shield-overlay');
  overlay.classList.remove('hidden');
  const yes = el('btn-shield-yes');
  const no = el('btn-shield-no');
  const iconSlot = yes.querySelector('.shield-icon-slot');
  if (iconSlot && !iconSlot.innerHTML) iconSlot.innerHTML = SHIELD_ICON_SVG;
  const cleanup = () => {
    yes.onclick = null;
    no.onclick = null;
    overlay.classList.add('hidden');
  };
  yes.onclick = () => { cleanup(); onDecision(true); };
  no.onclick = () => { cleanup(); onDecision(false); };
}

function swapChoiceButton(player, tokenIndex, pos) {
  const locked = pos === BoardData.LAST_SQUARE;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dice-modal-choice';
  const icon = document.createElement('span');
  icon.className = `mini-token ${player} idx-${tokenIndex}`;
  btn.appendChild(icon);
  const text = document.createElement('span');
  text.textContent = pos === 0 ? 'Start' : locked ? `${pos} 🔒` : `Square ${pos}`;
  btn.appendChild(text);
  if (locked) {
    btn.disabled = true;
    btn.classList.add('dice-modal-choice-locked');
    btn.title = 'Finished tokens are locked in and can\'t be swapped';
  }
  return btn;
}

export function showSwapOverlay(myPlayer, oppPlayer, myTokens, oppTokens, onCancel, onPick) {
  const overlay = el('swap-overlay');
  const container = el('swap-choice-buttons');
  container.innerHTML = '';

  let myPick = null;

  const title = document.createElement('p');
  title.className = 'dice-modal-prompt';
  title.textContent = 'Your tokens — pick one';
  container.appendChild(title);

  const myRow = document.createElement('div');
  myRow.className = 'dice-modal-choice-row';
  myTokens.forEach((pos, idx) => {
    const btn = swapChoiceButton(myPlayer, idx, pos);
    btn.addEventListener('click', () => {
      myPick = idx;
      Array.from(myRow.children).forEach((c) => c.classList.remove('dice-modal-choice-selected'));
      btn.classList.add('dice-modal-choice-selected');
      oppTitle.textContent = 'Opponent tokens — swap with';
      oppRow.classList.remove('dice-modal-choice-row-disabled');
    });
    myRow.appendChild(btn);
  });
  container.appendChild(myRow);

  const swapIcon = document.createElement('div');
  swapIcon.className = 'swap-arrow';
  swapIcon.textContent = '⇅';
  container.appendChild(swapIcon);

  const oppTitle = document.createElement('p');
  oppTitle.className = 'dice-modal-prompt';
  oppTitle.textContent = 'Opponent tokens — pick your token first';
  container.appendChild(oppTitle);

  const oppRow = document.createElement('div');
  oppRow.className = 'dice-modal-choice-row dice-modal-choice-row-disabled';
  oppTokens.forEach((pos, idx) => {
    const btn = swapChoiceButton(oppPlayer, idx, pos);
    btn.addEventListener('click', () => {
      if (myPick === null) return;
      hideOverlay('swap-overlay');
      onPick(myPick, idx);
    });
    oppRow.appendChild(btn);
  });
  container.appendChild(oppRow);

  el('btn-swap-cancel').onclick = () => {
    hideOverlay('swap-overlay');
    onCancel();
  };

  overlay.classList.remove('hidden');
}

export function hideOverlay(id) {
  el(id).classList.add('hidden');
}

// The End Match button is always available once the overlay shows — the
// player shouldn't be stuck waiting out a grace period with no way out.
export function showDisconnectOverlay(message, onAbandon) {
  const overlay = el('disconnect-overlay');
  el('disconnect-message').textContent = message;
  const btn = el('btn-abandon-disconnected');
  btn.onclick = onAbandon;
  overlay.classList.remove('hidden');
}

export function hideDisconnectOverlay() {
  hideOverlay('disconnect-overlay');
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function showGameOver(didWin, myName, winnerName, stats) {
  el('game-over-title').textContent = didWin ? 'You Win! 🏆' : `${winnerName} Wins`;

  const statsEl = el('game-over-stats');
  if (stats) {
    statsEl.innerHTML = `
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">⏱</span>Match time</span><strong>${formatDuration(stats.durationMs)}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">🔁</span>Turns played</span><strong>${stats.turns}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">🃏</span>Power-ups used (you)</span><strong>${stats.myCardsPlayed}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">🃏</span>Power-ups used (opponent)</span><strong>${stats.oppCardsPlayed}</strong></div>
    `;
  } else {
    statsEl.innerHTML = '';
  }

  showScreen('screen-game-over');
}

// ---------------------------------------------------------------- generic confirm dialog
// Uses a custom overlay instead of window.confirm(), which some embedded/
// sandboxed browser contexts silently block.
export function showConfirm(message, onConfirm) {
  el('confirm-message').textContent = message;
  const overlay = el('confirm-modal');
  const yes = el('btn-confirm-yes');
  const no = el('btn-confirm-no');
  const cleanup = () => {
    yes.onclick = null;
    no.onclick = null;
    overlay.classList.add('hidden');
  };
  yes.onclick = () => { cleanup(); onConfirm(); };
  no.onclick = () => cleanup();
  overlay.classList.remove('hidden');
}

// ---------------------------------------------------------------- how to play
export function openHowToPlay() {
  el('howtoplay-modal').classList.remove('hidden');
}

export function closeHowToPlay() {
  hideOverlay('howtoplay-modal');
}

// ---------------------------------------------------------------- event log modal
export function openLogModal() {
  el('log-modal').classList.remove('hidden');
  const logEl = el('event-log');
  logEl.scrollTop = logEl.scrollHeight;
}

export function closeLogModal() {
  hideOverlay('log-modal');
}

// ---------------------------------------------------------------- settings modal
export function openSettingsModal() {
  el('settings-name').value = Settings.getPlayerName();
  el('settings-sound').checked = Settings.isSoundOn();
  el('settings-haptics').checked = Settings.isHapticsOn();
  el('settings-modal').classList.remove('hidden');
}

export function closeSettingsModal() {
  hideOverlay('settings-modal');
}

export function bindSettingsInputs() {
  el('settings-name').addEventListener('change', (e) => Settings.setPlayerName(e.target.value));
  el('settings-sound').addEventListener('change', (e) => Settings.setSoundOn(e.target.checked));
  el('settings-haptics').addEventListener('change', (e) => Settings.setHapticsOn(e.target.checked));
}
