// board-render.js
// The board itself: grid squares, connectors (ladders/snakes), tokens, traps,
// and the move-trace animation that walks/slides tokens across it. Split out
// of ui.js so the board's DOM/animation logic isn't tangled up with modals
// and HUD rendering.

import BoardData from './board-data.js';
import { Icon } from './icons.js';
import { playSound, haptic, sleep } from './audio.js';
import { showCardReveal as showCardRevealOverlay } from './modals.js';

const el = (id) => document.getElementById(id);

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

// Samples points along the same wiggle curve a snake connector is drawn
// with, so a token sliding down a snake can visually follow the actual
// drawn path instead of a straight line. Kept separate from the quadratic
// Bezier control-point math in buildConnectionsSvg (which only needs to look
// right as a stroked path) — this just needs a reasonable set of waypoints.
function snakeCurvePoints(snake, sampleCount = 18) {
  const a = squareCenterPercent(snake.from);
  const b = squareCenterPercent(snake.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 3.2;
  const py = (dx / len) * 3.2;
  const points = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const wiggle = Math.sin(t * Math.PI * 2.4) * (1 - t * 0.3);
    points.push({ x: a.x + dx * t + px * wiggle, y: a.y + dy * t + py * wiggle });
  }
  return points;
}

function buildConnectionsSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'connections-layer');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');

  const mkLine = (cls, x1, y1, x2, y2) => {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', cls);
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    return line;
  };
  const mkPath = (cls, d) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', d);
    return path;
  };
  const mkCircle = (cls, cx, cy, r) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    return c;
  };

  // Wooden ladders: every rail/rung is drawn twice — a wider dark stroke
  // underneath and a wood-colored stroke on top — which reads as a solid
  // outlined plank instead of a translucent line.
  BoardData.LADDERS.forEach((ladder) => {
    const a = squareCenterPercent(ladder.from);
    const b = squareCenterPercent(ladder.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // perpendicular unit vector, scaled to a ~2-unit rail spread
    const px = (-dy / len) * 2;
    const py = (dx / len) * 2;

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'ladder-group');

    const segs = [
      [a.x + px, a.y + py, b.x + px, b.y + py, 'rail'],
      [a.x - px, a.y - py, b.x - px, b.y - py, 'rail'],
    ];
    const rungCount = Math.max(3, Math.round(len / 5));
    for (let i = 1; i < rungCount; i++) {
      const t = i / rungCount;
      const cx = a.x + dx * t;
      const cy = a.y + dy * t;
      segs.push([cx + px, cy + py, cx - px, cy - py, 'rung']);
    }
    // all shadow strokes first so the wood strokes sit cleanly on top
    segs.forEach(([x1, y1, x2, y2, kind]) => g.appendChild(mkLine(`ladder-${kind}-shadow`, x1, y1, x2, y2)));
    segs.forEach(([x1, y1, x2, y2, kind]) => g.appendChild(mkLine(`ladder-${kind}`, x1, y1, x2, y2)));

    svg.appendChild(g);
  });

  // Snakes: a layered body (dark outline, main color, light belly stripe)
  // with a thinner tail section, plus a proper head — eyes and a forked
  // tongue pointing away from the body.
  BoardData.SNAKES.forEach((snake, snakeIndex) => {
    const a = squareCenterPercent(snake.from); // head
    const b = squareCenterPercent(snake.to); // tail
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * 3.2;
    const py = (dx / len) * 3.2;

    const segments = 6;
    const pointAt = (t) => {
      const wiggle = Math.sin(t * Math.PI * 2.4) * (1 - t * 0.3);
      return {
        mx: a.x + dx * (t - 0.5 / segments) + px * wiggle,
        my: a.y + dy * (t - 0.5 / segments) + py * wiggle,
        x: a.x + dx * t,
        y: a.y + dy * t,
      };
    };

    // split the spine into a main (head-side) part and a thinner tail part
    const tailStart = segments - 2;
    let dMain = `M ${a.x} ${a.y}`;
    let dTail = '';
    for (let i = 1; i <= segments; i++) {
      const p = pointAt(i / segments);
      const q = ` Q ${p.mx} ${p.my} ${p.x} ${p.y}`;
      if (i <= tailStart) {
        dMain += q;
        if (i === tailStart) dTail = `M ${p.x} ${p.y}`;
      } else {
        dTail += q;
      }
    }

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'snake-group');
    g.appendChild(mkPath('snake-body-outline', dMain));
    g.appendChild(mkPath('snake-tail-outline', dTail));
    g.appendChild(mkPath('snake-body', dMain));
    g.appendChild(mkPath('snake-tail', dTail));
    g.appendChild(mkPath('snake-belly', dMain));

    // head direction: away from the first body point
    const p1 = pointAt(1 / segments);
    const hx = a.x - p1.x;
    const hy = a.y - p1.y;
    const hlen = Math.hypot(hx, hy) || 1;
    const ux = hx / hlen;
    const uy = hy / hlen;
    const vx = -uy; // perpendicular
    const vy = ux;

    g.appendChild(mkCircle('snake-head-marker', a.x, a.y, 2.4));
    // Staggered blink delay per snake so they don't all blink in unison —
    // ambient board life, gated by prefers-reduced-motion in CSS.
    const blinkDelay = `${(snakeIndex * 0.9) % 5.5}s`;
    const eye1 = mkCircle('snake-eye', a.x + ux * 0.7 + vx * 1.05, a.y + uy * 0.7 + vy * 1.05, 0.5);
    const eye2 = mkCircle('snake-eye', a.x + ux * 0.7 - vx * 1.05, a.y + uy * 0.7 - vy * 1.05, 0.5);
    eye1.style.setProperty('--blink-delay', blinkDelay);
    eye2.style.setProperty('--blink-delay', blinkDelay);
    g.appendChild(eye1);
    g.appendChild(eye2);

    const tBase = { x: a.x + ux * 2.3, y: a.y + uy * 2.3 };
    const tTip = { x: a.x + ux * 3.9, y: a.y + uy * 3.9 };
    const fork1 = { x: tTip.x + ux * 1 + vx * 0.8, y: tTip.y + uy * 1 + vy * 0.8 };
    const fork2 = { x: tTip.x + ux * 1 - vx * 0.8, y: tTip.y + uy * 1 - vy * 0.8 };
    g.appendChild(mkPath('snake-tongue-line', `M ${tBase.x} ${tBase.y} L ${tTip.x} ${tTip.y} M ${tTip.x} ${tTip.y} L ${fork1.x} ${fork1.y} M ${tTip.x} ${tTip.y} L ${fork2.x} ${fork2.y}`));

    svg.appendChild(g);
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
      icon.innerHTML = `${Icon.ladder}<span class="square-icon-num">${ladder.to}</span>`;
      icon.style.color = 'var(--ladder-color)';
      div.appendChild(icon);
    } else if (snake) {
      const icon = document.createElement('span');
      icon.className = 'square-icon';
      icon.innerHTML = `${Icon.snake}<span class="square-icon-num">${snake.to}</span>`;
      icon.style.color = 'var(--snake-color)';
      div.appendChild(icon);
    } else if (BoardData.isCardSquare(sq)) {
      const icon = document.createElement('span');
      icon.className = 'square-icon';
      icon.innerHTML = Icon.card;
      div.appendChild(icon);
    }

    boardEl.appendChild(div);
    squareEls[sq] = div;
  }

  BoardData.LADDERS.forEach((l) => squareEls[l.to]?.classList.add('ladder-end'));
  BoardData.SNAKES.forEach((s) => squareEls[s.to]?.classList.add('snake-end'));

  // One-time staggered pop-in for every ladder/snake/card square icon when
  // the board first mounts — echoes the main-menu critter animation so the
  // two screens feel like part of the same toy.
  boardEl.querySelectorAll('.square-icon').forEach((iconEl, i) => {
    iconEl.classList.add('board-icon-settle');
    iconEl.style.animationDelay = `${Math.min(i * 14, 500)}ms`;
  });

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

// ---------------------------------------------------------------- traps
// Placement mode: highlights every currently-eligible square as clickable
// while a Trap card is being played, instead of a modal — placing a trap
// directly on the board it affects is the more natural interaction.
export function enterTrapPlacementMode(isEligible, onPick) {
  el('trap-prompt').classList.remove('hidden');
  for (let sq = 1; sq <= BoardData.LAST_SQUARE; sq++) {
    const node = squareEls[sq];
    if (!node || !isEligible(sq)) continue;
    node.classList.add('trap-target');
    node.onclick = () => onPick(sq);
  }
}

export function exitTrapPlacementMode() {
  el('trap-prompt').classList.add('hidden');
  Object.values(squareEls).forEach((node) => {
    node.classList.remove('trap-target');
    node.onclick = null;
  });
}

// Only ever renders the VIEWER's own traps — the opponent's are deliberately
// left invisible so a placed trap stays a surprise until it's triggered.
export function renderTraps(state, myPlayer) {
  for (let sq = 1; sq <= BoardData.LAST_SQUARE; sq++) {
    const node = squareEls[sq];
    if (!node) continue;
    const owner = state.traps ? state.traps[sq] : undefined;
    const shouldShow = owner === myPlayer;
    node.classList.toggle('trap-owned', shouldShow);
    let marker = node.querySelector('.trap-marker-icon');
    if (shouldShow && !marker) {
      marker = document.createElement('span');
      marker.className = 'trap-marker-icon';
      marker.innerHTML = Icon.trap;
      node.appendChild(marker);
    } else if (!shouldShow && marker) {
      marker.remove();
    }
  }
}

// A short burst of little sparks radiating from a square, layered on top of
// the existing flash/shake for the "big" moments (captures, ladders, snake
// bites) so they read as more of an event than a plain color flash. Pure
// CSS-transform animation on throwaway divs — cheap enough to fire on every
// impact without worrying about mobile perf.
function spawnParticles(square, colorVar, count = 10) {
  if (!tokensLayerEl) return;
  const { x, y } = squareCenterPercent(square);
  const burst = document.createElement('div');
  burst.className = 'particle-burst';
  burst.style.left = `${x}%`;
  burst.style.top = `${y}%`;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    const angle = (i / count) * 360 + (Math.random() * 24 - 12);
    const dist = 26 + Math.random() * 18;
    const rad = (angle * Math.PI) / 180;
    p.style.setProperty('--dx', `${Math.cos(rad) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(rad) * dist}px`);
    p.style.setProperty('--particle-color', `var(${colorVar})`);
    p.style.animationDelay = `${Math.random() * 40}ms`;
    burst.appendChild(p);
  }
  tokensLayerEl.appendChild(burst);
  setTimeout(() => burst.remove(), 700);
}

// A small confetti pop right on the finish square when a token locks in at
// 100 — same "throwaway absolutely-positioned span" trick as spawnParticles,
// but with rectangular multi-color pieces that tumble/spin like real
// confetti instead of round single-color sparks, so reaching the finish
// reads as a distinctly bigger deal than a routine ladder/capture.
const LOCK_IN_CONFETTI_COLORS = ['var(--host-color)', 'var(--guest-color)', 'var(--gold)', '#fff3d6'];

function spawnLockInConfetti(square, count = 18) {
  if (!tokensLayerEl) return;
  const { x, y } = squareCenterPercent(square);
  const burst = document.createElement('div');
  burst.className = 'particle-burst';
  burst.style.left = `${x}%`;
  burst.style.top = `${y}%`;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-spark';
    const angle = Math.random() * 360;
    const dist = 22 + Math.random() * 28;
    const rad = (angle * Math.PI) / 180;
    p.style.setProperty('--dx', `${Math.cos(rad) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(rad) * dist - 12}px`);
    p.style.setProperty('--spin', `${(Math.random() - 0.5) * 540}deg`);
    p.style.background = LOCK_IN_CONFETTI_COLORS[i % LOCK_IN_CONFETTI_COLORS.length];
    p.style.animationDelay = `${Math.random() * 60}ms`;
    burst.appendChild(p);
  }
  tokensLayerEl.appendChild(burst);
  setTimeout(() => burst.remove(), 950);
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

function setTokenPercent(tokenEl, x, y) {
  tokenEl.style.left = `${x}%`;
  tokenEl.style.top = `${y}%`;
}

function bounceSettle(tokenEl) {
  tokenEl.classList.remove('landed');
  void tokenEl.offsetWidth;
  tokenEl.classList.add('landed');
  setTimeout(() => tokenEl.classList.remove('landed'), 500);
}

// Animates a token along a sampled curve (points: [{x,y}, ...] in board
// percent coordinates) over `duration` ms, so a snake slide visibly follows
// the same wiggle the connector is drawn with instead of teleporting.
// Stepped with setTimeout (like every other animation in this file) rather
// than requestAnimationFrame — rAF callbacks can be paused indefinitely by
// the browser while the tab is backgrounded, which would stall the shared
// move-animation pipeline (and the P2P sync waiting behind it) until the
// tab regains focus.
async function animateAlongCurve(tokenEl, points, duration) {
  const stepMs = 28;
  const steps = Math.max(1, Math.round(duration / stepMs));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const idx = Math.min(points.length - 1, Math.floor(t * (points.length - 1)));
    const p = points[idx];
    setTokenPercent(tokenEl, p.x, p.y);
    // eslint-disable-next-line no-await-in-loop
    if (i < steps) await sleep(stepMs);
  }
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
  // A token can only ever reach 100 once (it locks in for good, per game.js
  // rules) — so "touched and now sitting on 100" is exactly "just locked in
  // this trace", no extra bookkeeping needed to avoid re-firing on it.
  touched.forEach((key) => {
    if (lastSquareByToken[key] === BoardData.LAST_SQUARE) {
      spawnLockInConfetti(BoardData.LAST_SQUARE);
    }
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

  if (entry.kind === 'snake') {
    // Follows the actual drawn wiggle-curve instead of jumping straight to
    // the tail, so the slide reads as sliding down the snake's body.
    touched.add(key);
    tokenEl.classList.add('sliding');
    const snakeDef = BoardData.getSnake(entry.from);
    playSound('snake');
    haptic('capture');
    if (snakeDef) {
      await animateAlongCurve(tokenEl, snakeCurvePoints(snakeDef), 560);
    } else {
      setTokenSquare(tokenEl, entry.to);
    }
    lastSquareByToken[key] = entry.to;
    tokenEl.classList.remove('sliding');
    flashSquare(entry.to);
    spawnParticles(entry.to, '--snake-color');
    return;
  }

  if (entry.kind === 'ladder') {
    touched.add(key);
    tokenEl.classList.add('sliding');
    setTokenSquare(tokenEl, entry.to);
    lastSquareByToken[key] = entry.to;
    playSound('ladder');
    haptic('move');
    await sleep(560);
    tokenEl.classList.remove('sliding');
    flashSquare(entry.to);
    spawnParticles(entry.to, '--ladder-color');
    return;
  }

  if (entry.kind === 'trap') {
    touched.add(key);
    tokenEl.classList.add('sliding');
    setTokenSquare(tokenEl, entry.to);
    lastSquareByToken[key] = entry.to;
    playSound('trap');
    haptic('capture');
    flashBoard();
    await sleep(560);
    tokenEl.classList.remove('sliding');
    flashSquare(entry.to);
    return;
  }

  if (entry.kind === 'cardEmpty') {
    // Deliberately no full card-flip reveal here — just enough of a beat
    // (square flash + a muted "denied" blip) to make clear the square did
    // something, without pretending a card was actually drawn.
    flashSquare(entry.at);
    playSound('cardEmpty');
    haptic('step');
    await sleep(280);
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
      spawnParticles(entry.at != null ? entry.at : lastSquareByToken[capturedKey], '--danger', 14);
      await sleep(500);
      capturedEl.classList.remove('captured-flash');
      setTokenSquare(capturedEl, 0);
      lastSquareByToken[capturedKey] = 0;
    }
    return;
  }

  if (entry.kind === 'card') {
    await showCardRevealOverlay(entry.cardType);
  }
}
