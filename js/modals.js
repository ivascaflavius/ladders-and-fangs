// modals.js
// All overlay/modal dialogs: dice roll + token choice, shield decision, the
// comeback card choice, swap picker, settings, how-to-play, event log,
// disconnect, game-over, and the generic confirm dialog. Board rendering and
// HUD (header/leaderboard/log list) live elsewhere.

import BoardData from './board-data.js';
import Settings from './settings.js';
import { Icon } from './icons.js';
import { CARD_META, SHIELD_ICON_SVG } from './card-meta.js';
import { playSound, playDieTick, haptic, sleep } from './audio.js';
import { showScreen } from './screens.js';

const el = (id) => document.getElementById(id);

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function hideOverlay(id) {
  el(id).classList.add('hidden');
}

// ---------------------------------------------------------------- card reveal
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

// ---------------------------------------------------------------- 3D dice cube
// A real CSS 3D cube (6 pip faces, standard opposite-faces-sum-to-7 layout)
// instead of a 2D icon that cycles through frames — the cube physically
// tumbles and lands on the rolled face.
const PIP_POS = {
  tl: [25, 25], tc: [50, 25], tr: [75, 25],
  ml: [25, 50], mc: [50, 50], mr: [75, 50],
  bl: [25, 75], bc: [50, 75], br: [75, 75],
};
const PIP_LAYOUTS = {
  1: ['mc'],
  2: ['tl', 'br'],
  3: ['tl', 'mc', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'mc', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
// Cube rotation that brings each value's face to the front, facing the
// viewer (derived as the inverse of that face's own placement transform —
// see the .die3d-face-* rules in style.css for the placements).
const FACE_ROTATION = {
  1: { x: 0, y: 0 },
  2: { x: 0, y: -90 },
  3: { x: -90, y: 0 },
  4: { x: 90, y: 0 },
  5: { x: 0, y: 90 },
  6: { x: 0, y: 180 },
};
const FACE_CLASS_FOR_VALUE = {
  1: 'die3d-face-front', 6: 'die3d-face-back',
  2: 'die3d-face-right', 5: 'die3d-face-left',
  3: 'die3d-face-top', 4: 'die3d-face-bottom',
};

function buildDieFace(value) {
  const face = document.createElement('div');
  face.className = `die3d-face ${FACE_CLASS_FOR_VALUE[value]}`;
  PIP_LAYOUTS[value].forEach((key) => {
    const [x, y] = PIP_POS[key];
    const pip = document.createElement('span');
    pip.className = 'die3d-pip';
    pip.style.left = `${x}%`;
    pip.style.top = `${y}%`;
    face.appendChild(pip);
  });
  return face;
}

let cubeEl = null;
let cubeRotX = 0;
let cubeRotY = 0;

function ensureDieCube() {
  if (cubeEl) return cubeEl;
  const container = el('dice-modal-face');
  container.innerHTML = '';
  const scene = document.createElement('div');
  scene.className = 'die3d-scene';
  const cube = document.createElement('div');
  cube.className = 'die3d';
  for (let v = 1; v <= 6; v++) cube.appendChild(buildDieFace(v));
  scene.appendChild(cube);
  container.appendChild(scene);
  cubeEl = cube;
  return cube;
}

// Shortest forward (non-negative) rotation from `current` (mod 360) to
// `target` (mod 360) — keeps the cube always spinning the same direction
// instead of snapping backward between rolls.
function forwardDelta(current, target) {
  const cur = ((current % 360) + 360) % 360;
  const tgt = ((target % 360) + 360) % 360;
  return ((tgt - cur) % 360 + 360) % 360;
}

// ---------------------------------------------------------------- dice modal
let dieTickTimer = null;

export function openDiceModal() {
  ensureDieCube();
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
  const cube = ensureDieCube();
  const target = FACE_ROTATION[value] || FACE_ROTATION[1];
  cube.classList.add('no-transition');
  cubeRotX = target.x;
  cubeRotY = target.y;
  cube.style.transform = `rotateX(${cubeRotX}deg) rotateY(${cubeRotY}deg)`;
  void cube.offsetWidth;
  cube.classList.remove('no-transition');
  el('dice-modal-result').textContent = `Rolled a ${value}`;
}

export function animateDiceModal(finalValue, onDone) {
  if (dieTickTimer) clearInterval(dieTickTimer); // guard against overlapping rolls
  const cube = ensureDieCube();

  // The dice modal is typically made visible (display:none -> flex) this
  // same call chain (see openDiceModal). If the cube's target transform were
  // set in that same synchronous tick, the browser has no rendered "before"
  // frame to transition from, so it jumps straight to the final orientation
  // instead of visibly tumbling. Explicitly paint the cube's CURRENT
  // orientation first and force a reflow, then defer the actual rotation
  // change to a later tick so the transition has a real starting frame.
  cube.classList.add('no-transition');
  cube.style.transform = `rotateX(${cubeRotX}deg) rotateY(${cubeRotY}deg)`;
  void cube.offsetWidth; // force layout/paint of the current orientation

  const target = FACE_ROTATION[finalValue] || FACE_ROTATION[1];
  const spinsX = 360 * (2 + Math.floor(Math.random() * 2));
  const spinsY = 360 * (2 + Math.floor(Math.random() * 2));
  cubeRotX += spinsX + forwardDelta(cubeRotX, target.x);
  cubeRotY += spinsY + forwardDelta(cubeRotY, target.y);

  const startDelay = 30;
  const durationMs = 900;
  setTimeout(() => {
    cube.classList.remove('no-transition');
    cube.style.transform = `rotateX(${cubeRotX}deg) rotateY(${cubeRotY}deg)`;
  }, startDelay);

  let elapsed = 0;
  const tickEvery = 70;
  dieTickTimer = setInterval(() => {
    playDieTick();
    elapsed += tickEvery;
    if (elapsed >= durationMs) {
      clearInterval(dieTickTimer);
      dieTickTimer = null;
    }
  }, tickEvery);

  setTimeout(() => {
    el('dice-modal-result').textContent = `Rolled a ${finalValue}`;
    if (onDone) onDone();
  }, startDelay + durationMs + 30);
}

// options: [{ player, tokenIndex, from, to, type }]
// doubleMove: null, or { onPlay } — when the player holds a Double Move card,
// this renders it as an extra choice right here (this modal is the ONLY
// place it can be played from, since it covers the footer card hand).
export function showDiceModalTokenChoice(options, onChoose, doubleMove) {
  const container = el('dice-modal-tokens');
  container.innerHTML = '';
  container.classList.remove('hidden');

  if (options.length > 0) {
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
      if (opt.type === 'ladder') destIcon = ` <span class="inline-icon">${Icon.ladder}</span>`;
      else if (opt.type === 'snake') destIcon = ` <span class="inline-icon">${Icon.snake}</span>`;
      else if (BoardData.isCardSquare(opt.to)) destIcon = ` <span class="inline-icon">${Icon.card}</span>`;
      if (opt.to === BoardData.LAST_SQUARE) destIcon += ` <span class="inline-icon">${Icon.lock}</span>`;
      text.innerHTML = `${fromLabel} → ${opt.to}${destIcon}`;
      btn.appendChild(text);

      btn.addEventListener('click', () => onChoose(opt.tokenIndex));
      row.appendChild(btn);
    });
    container.appendChild(row);
  }

  if (doubleMove) {
    const divider = document.createElement('p');
    divider.className = 'dice-modal-prompt';
    divider.textContent = options.length > 0 ? 'or play a card instead' : 'Your other token is locked in — play Double Move to send this one further';
    container.appendChild(divider);

    const dmBtn = document.createElement('button');
    dmBtn.type = 'button';
    dmBtn.className = 'dice-modal-choice dice-modal-choice-card';
    if (doubleMove.disabled) {
      // With a token locked at 100, roll×2 on the other token can overshoot
      // 100 (e.g. 99 + 1×2 = 101) — the card would still be spent for
      // nothing if played, so the button is shown but disabled instead of
      // silently wasting it.
      dmBtn.disabled = true;
      dmBtn.classList.add('dice-modal-choice-locked');
      dmBtn.innerHTML = `<span class="card-icon">${Icon.fastForward}</span><span>Double Move — would overshoot 100</span>`;
    } else {
      // With a token locked at 100, Double Move sends the remaining token
      // roll×2 instead of moving both — the label must say which one applies.
      const dmLabel = doubleMove.locked
        ? 'Play Double Move — move your token twice'
        : 'Play Double Move — move both tokens';
      dmBtn.innerHTML = `<span class="card-icon">${Icon.fastForward}</span><span>${dmLabel}</span>`;
      dmBtn.addEventListener('click', doubleMove.onPlay);
    }
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
// The ring is a rounded-rect <rect>, not a circle, so its perimeter is read
// directly off the element via getTotalLength() rather than computed by hand.
let rollRingPerimeter = null;

export function setRollTimer(remainingSec, totalSec = 30) {
  const ring = el('roll-ring-progress');
  if (rollRingPerimeter === null) {
    rollRingPerimeter = ring.getTotalLength();
    ring.style.strokeDasharray = String(rollRingPerimeter);
  }
  if (remainingSec === null || remainingSec === undefined) {
    ring.style.opacity = '0';
    return;
  }
  ring.style.opacity = '1';
  const fraction = Math.max(0, Math.min(1, remainingSec / totalSec));
  ring.style.strokeDashoffset = String(rollRingPerimeter * (1 - fraction));
  ring.classList.toggle('urgent', remainingSec <= 10);
}

// Idle-choice countdown shown inside a modal while waiting on a decision.
// targetId is 'dice-modal-timer' | 'shield-modal-timer' | 'trap-prompt-timer'
// | 'card-choice-timer'.
export function setChoiceTimer(targetId, remainingSec) {
  const badge = el(targetId);
  if (remainingSec === null || remainingSec === undefined) {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  badge.innerHTML = `${Icon.hourglass} ${remainingSec}s`;
  badge.classList.toggle('urgent', remainingSec <= 10);
}

// Cycles a highlight through `selector`'s matched elements (in DOM order),
// slowing down, then lands on chosenIndex — a visible "picking at random"
// effect before the auto-selected choice is actually applied.
export async function animateModalRoulette(selector, chosenIndex) {
  const buttons = Array.from(document.querySelectorAll(selector));
  if (buttons.length === 0) return;
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const idx = i % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('roulette-active', j === idx));
    playSound('step');
    // eslint-disable-next-line no-await-in-loop
    await sleep(60 + i * 10);
  }
  buttons.forEach((b, j) => b.classList.toggle('roulette-active', j === chosenIndex % buttons.length));
  playSound('card');
  await sleep(500);
  buttons.forEach((b) => b.classList.remove('roulette-active'));
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

// Comeback mechanic: the trailing player picks between two candidate cards
// instead of getting one at random. `options` is [cardType, cardType].
export function showCardChoiceOverlay(options, onChoose) {
  const overlay = el('card-choice-overlay');
  const container = el('card-choice-buttons');
  container.innerHTML = '';
  options.forEach((cardType, idx) => {
    const meta = CARD_META[cardType];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.innerHTML = `<span class="card-icon">${meta.icon}</span>${meta.label}`;
    btn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      onChoose(idx);
    });
    container.appendChild(btn);
  });
  overlay.classList.remove('hidden');
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
  text.innerHTML = pos === 0 ? 'Start' : locked ? `${pos} <span class="inline-icon">${Icon.lock}</span>` : `Square ${pos}`;
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

// Shown when the OPPONENT pauses a P2P match — blocks the board/roll (via
// this overlay sitting on top) but a quit path stays available, matching
// the disconnect overlay's "you're not trapped" philosophy.
export function showOpponentPausedOverlay(onQuit) {
  const overlay = el('opponent-paused-overlay');
  el('btn-opponent-paused-quit').onclick = onQuit;
  overlay.classList.remove('hidden');
}

export function hideOpponentPausedOverlay() {
  hideOverlay('opponent-paused-overlay');
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatTokenSquare(square) {
  return square === BoardData.LAST_SQUARE
    ? `<span class="inline-icon">${Icon.lock}</span>100`
    : String(square);
}

function renderGameOverTokenRow(label, rowClass, player, tokens) {
  const values = tokens
    .map((sq, idx) => `<span class="mini-token ${player} idx-${idx}"></span><span class="game-over-token-pos">${formatTokenSquare(sq)}</span>`)
    .join('');
  return `
    <div class="game-over-token-row ${rowClass}">
      <span class="game-over-token-label">${escapeHtml(label)}</span>
      <span class="game-over-token-values">${values}</span>
    </div>
  `;
}

export function showGameOver(didWin, myName, winnerName, stats) {
  el('game-over-title').innerHTML = didWin
    ? `You Win! <span class="inline-icon">${Icon.trophy}</span>`
    : escapeHtml(`${winnerName} Wins`);

  const tokensEl = el('game-over-tokens');
  if (stats && stats.winnerTokens && stats.loserTokens) {
    tokensEl.innerHTML =
      renderGameOverTokenRow(`${winnerName} (Winner)`, 'winner', stats.winnerPlayer, stats.winnerTokens) +
      renderGameOverTokenRow(stats.loserName, 'loser', stats.loserPlayer, stats.loserTokens);
  } else {
    tokensEl.innerHTML = '';
  }

  const statsEl = el('game-over-stats');
  if (stats) {
    const extraRows = [];
    if (stats.longestSlide > 0) {
      extraRows.push(`<div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.snake}</span>Longest slide</span><strong>${stats.longestSlide}</strong></div>`);
    }
    if (stats.longestClimb > 0) {
      extraRows.push(`<div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.ladder}</span>Longest climb</span><strong>${stats.longestClimb}</strong></div>`);
    }
    if (stats.trapsSprungTotal > 0) {
      extraRows.push(`<div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.trap}</span>Traps sprung</span><strong>${stats.trapsSprungTotal}</strong></div>`);
    }
    statsEl.innerHTML = `
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.stopwatch}</span>Match time</span><strong>${formatDuration(stats.durationMs)}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.refresh}</span>Turns played</span><strong>${stats.turns}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.card}</span>Power-ups used (you)</span><strong>${stats.myCardsPlayed}</strong></div>
      <div class="game-over-stat-row"><span><span class="game-over-stat-icon">${Icon.card}</span>Power-ups used (opponent)</span><strong>${stats.oppCardsPlayed}</strong></div>
      ${extraRows.join('')}
    `;
  } else {
    statsEl.innerHTML = '';
  }

  showScreen('screen-game-over');
}

// A modest confetti burst on a win — plain absolutely-positioned divs
// falling with a CSS keyframe, no canvas/library needed. Self-cleans after
// the animation finishes so repeated rematches don't pile up stale nodes.
const CONFETTI_COLORS = ['var(--host-color)', 'var(--guest-color)', 'var(--accent)', '#fff3d6'];

export function spawnConfetti(count = 46) {
  const layer = el('confetti-layer');
  if (!layer) return;
  layer.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`);
    layer.appendChild(piece);
  }
  setTimeout(() => { layer.innerHTML = ''; }, 3200);
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

// ---------------------------------------------------------------- stats
export function openStatsModal() {
  el('stats-modal').classList.remove('hidden');
}

export function closeStatsModal() {
  hideOverlay('stats-modal');
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
// disableDifficulty: true when opened mid-match (pause menu) — the AI
// difficulty can't be changed once a game is already running.
export function openSettingsModal(disableDifficulty) {
  el('settings-name').value = Settings.getPlayerName();
  el('settings-sound').checked = Settings.isSoundOn();
  el('settings-volume').value = String(Settings.getVolume());
  el('settings-haptics').checked = Settings.isHapticsOn();
  el('settings-theme-dark').checked = Settings.isDarkTheme();
  el('settings-ai-difficulty').value = Settings.getAiDifficulty();
  el('settings-ai-difficulty').disabled = !!disableDifficulty;
  el('settings-ai-difficulty-row').classList.toggle('settings-row-disabled', !!disableDifficulty);
  el('settings-modal').classList.remove('hidden');
}

export function closeSettingsModal() {
  hideOverlay('settings-modal');
}

export function bindSettingsInputs(applyTheme) {
  el('settings-name').addEventListener('change', (e) => Settings.setPlayerName(e.target.value));
  el('settings-sound').addEventListener('change', (e) => Settings.setSoundOn(e.target.checked));
  el('settings-volume').addEventListener('input', (e) => Settings.setVolume(e.target.value));
  el('settings-haptics').addEventListener('change', (e) => Settings.setHapticsOn(e.target.checked));
  el('settings-theme-dark').addEventListener('change', (e) => {
    Settings.setDarkTheme(e.target.checked);
    if (applyTheme) applyTheme();
  });
  el('settings-ai-difficulty').addEventListener('change', (e) => Settings.setAiDifficulty(e.target.value));
}
