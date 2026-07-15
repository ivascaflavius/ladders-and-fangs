// main.js
// App bootstrap: landing page host/join flow, network wiring, and the
// turn-by-turn glue between game.js (rules) and ui.js (rendering/input).

import Settings from './settings.js';
import {
  joinNetworkRoom,
  generateRoomCode,
  normalizeRoomCode,
  waitForPeer,
  JOIN_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
} from './network.js';
import * as Game from './game.js';
import * as UI from './ui.js';

const SESSION_KEY = 'laddersAndFangs.session.v1';

let networkRoom = null;
let gameState = null;
let myPlayer = null; // 'host' | 'guest'
let oppPlayer = null;
let disconnectTimer = null;
let disconnectDeadline = null;

// ---------------------------------------------------------------- session persistence
function saveSession(roomCode, role) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, role }));
  } catch (err) {
    /* ignore */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    /* ignore */
  }
}

// ---------------------------------------------------------------- network send helpers
function send(payload) {
  if (networkRoom) networkRoom.send(payload);
}

// Tears down whatever room connection is currently held, if any. Must be
// called before starting a new host/join/rejoin attempt — otherwise a
// previous room's WebRTC/tracker connections are left dangling (e.g. after
// an auto-rejoin attempt times out), which can prevent a subsequent join
// from ever connecting.
function resetNetwork() {
  if (networkRoom) {
    try {
      networkRoom.leave();
    } catch (err) {
      /* ignore teardown errors */
    }
  }
  networkRoom = null;
}

// Move-trace animation is asynchronous (walking through squares takes real
// time), but state updates can arrive faster than the animation plays — e.g.
// a network event landing mid-animation. Serializing all processing through
// one chained promise guarantees traces are animated in order, one at a
// time, and every processing step still ends with a renderGame() call.
let animationChain = Promise.resolve();
let lastAnimatedTraceId = null;
let lastAnimatedTraceLen = 0;

function processStateChange({ skipAnimation = false } = {}) {
  animationChain = animationChain
    .then(async () => {
      if (!gameState) {
        renderGame();
        return;
      }
      if (skipAnimation) {
        lastAnimatedTraceId = gameState.moveTraceId;
        lastAnimatedTraceLen = gameState.moveTrace.length;
        renderGame();
        return;
      }
      if (gameState.moveTraceId !== lastAnimatedTraceId) {
        lastAnimatedTraceId = gameState.moveTraceId;
        lastAnimatedTraceLen = 0;
      }
      const newEntries = gameState.moveTrace.slice(lastAnimatedTraceLen);
      lastAnimatedTraceLen = gameState.moveTrace.length;
      if (newEntries.length > 0) {
        await UI.animateTrace(newEntries);
      }
      renderGame();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Animation pipeline error', err);
      renderGame();
    });
  return animationChain;
}

function applyAndMaybeBroadcast(event, broadcast) {
  gameState = Game.reduce(gameState, event);
  if (broadcast) send(event);
  processStateChange();
}

// ---------------------------------------------------------------- incoming events
function handleIncoming(data) {
  if (!data || !data.type) return;

  if (data.type === 'HELLO') {
    if (gameState) {
      // I already have state (I'm the one who stayed connected) — this peer
      // is joining fresh or reconnecting. Tell them who I am and hand them
      // the authoritative state.
      gameState = Game.reduce(gameState, { type: 'SET_NAME', player: oppPlayer, name: data.name });
      send({ type: 'SYNC_STATE', state: gameState });
      send({ type: 'HELLO', name: Settings.getPlayerName() });
      renderGame();
      UI.hideDisconnectOverlay();
      clearDisconnectTimer();
    } else if (myPlayer === 'host') {
      // Host creates the authoritative initial state once the guest says hi.
      gameState = Game.createInitialState(Settings.getPlayerName(), data.name);
      send({ type: 'HELLO', name: Settings.getPlayerName() });
      send({ type: 'SYNC_STATE', state: gameState });
      enterGameScreen();
    }
    return;
  }

  if (data.type === 'SYNC_STATE') {
    gameState = data.state;
    UI.hideDisconnectOverlay();
    clearDisconnectTimer();
    enterGameScreen();
    return;
  }

  if (!gameState) return; // ignore game events until we have authoritative state
  gameState = Game.reduce(gameState, data);
  processStateChange();
}

// ---------------------------------------------------------------- connection lifecycle
function wireNetworkEvents() {
  networkRoom.onEvent((data) => handleIncoming(data));

  networkRoom.onPeerJoin(() => {
    send({ type: 'HELLO', name: Settings.getPlayerName() });
  });

  networkRoom.onPeerLeave(() => {
    if (!gameState || gameState.phase === Game.Phase.GAME_OVER) return;
    startDisconnectCountdown();
  });
}

function startDisconnectCountdown() {
  disconnectDeadline = Date.now() + DISCONNECT_GRACE_MS;
  UI.showDisconnectOverlay('Opponent disconnected — waiting to reconnect…', abandonMatch);
  tickDisconnectTimer();
}

function tickDisconnectTimer() {
  clearDisconnectTimer();
  disconnectTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((disconnectDeadline - Date.now()) / 1000));
    if (remaining <= 0) {
      UI.showDisconnectOverlay('Opponent has been gone a while.', abandonMatch);
      clearDisconnectTimer();
    } else {
      UI.showDisconnectOverlay(`Opponent disconnected — waiting to reconnect… (${remaining}s)`, abandonMatch);
    }
  }, 1000);
}

function clearDisconnectTimer() {
  if (disconnectTimer) {
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
}

// Hardened so a broken/duplicated WebRTC teardown can never leave the player
// stuck on the disconnect screen with a dead button.
function abandonMatch() {
  clearDisconnectTimer();
  stopGameTimer();
  stopRollTimer();
  UI.hideDisconnectOverlay();
  resetNetwork();
  gameState = null;
  clearSession();
  UI.showScreen('screen-menu');
}

// ---------------------------------------------------------------- host / join flows
async function hostGame() {
  resetNetwork();
  const code = generateRoomCode();
  el('room-code-display').textContent = code;
  UI.showScreen('screen-host-waiting');

  networkRoom = await joinNetworkRoom(code);
  myPlayer = 'host';
  oppPlayer = 'guest';
  wireNetworkEvents();
  saveSession(code, 'host');
  // Waiting for opponent's HELLO; handleIncoming() creates the game state.
}

async function joinGame(rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (code.length < 4) return;
  resetNetwork();
  el('join-connecting-code').textContent = code;
  UI.showScreen('screen-join-connecting');

  try {
    networkRoom = await joinNetworkRoom(code);
    myPlayer = 'guest';
    oppPlayer = 'host';
    await waitForPeer(networkRoom, JOIN_TIMEOUT_MS);
    wireNetworkEvents();
    saveSession(code, 'guest');
    send({ type: 'HELLO', name: Settings.getPlayerName() });
    // Now waiting for host's SYNC_STATE.
  } catch (err) {
    resetNetwork();
    UI.showScreen('screen-join-timeout');
  }
}

async function attemptAutoRejoin() {
  const session = loadSession();
  if (!session) return;
  resetNetwork();
  myPlayer = session.role;
  oppPlayer = myPlayer === 'host' ? 'guest' : 'host';

  el('join-connecting-code').textContent = session.roomCode;
  UI.showScreen('screen-join-connecting');

  try {
    networkRoom = await joinNetworkRoom(session.roomCode);
    await waitForPeer(networkRoom, JOIN_TIMEOUT_MS);
    wireNetworkEvents();
    send({ type: 'HELLO', name: Settings.getPlayerName() });
    UI.showDisconnectOverlay('Reconnecting to your match…', abandonMatch);
  } catch (err) {
    // Auto-rejoin failing (e.g. the old opponent is long gone) must not
    // leave a dangling room connection — otherwise the next manual
    // host/join attempt can silently fail to connect.
    resetNetwork();
    clearSession();
    UI.showScreen('screen-menu');
  }
}

// ---------------------------------------------------------------- game screen
let gameTimerInterval = null;
function startGameTimer() {
  stopGameTimer();
  gameTimerInterval = setInterval(() => {
    if (gameState && gameState.phase !== Game.Phase.GAME_OVER) {
      UI.renderGameTimer(gameState.startedAt, gameState.endedAt);
    }
  }, 1000);
}
function stopGameTimer() {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
}

// Both players see the countdown for whoever's turn it is to roll, but only
// the active player's own client is responsible for broadcasting the
// forfeit — otherwise both peers would race to send duplicate events.
const ROLL_TIME_LIMIT_SEC = 30;
let rollTimerInterval = null;
let rollTimerDeadline = null;
let rollTimerKey = null;

function updateRollTimer() {
  if (!gameState || gameState.phase !== Game.Phase.ROLLING) {
    stopRollTimer();
    return;
  }
  const key = `${gameState.turn}-${gameState.stats.turns}`;
  if (key !== rollTimerKey) {
    rollTimerKey = key;
    rollTimerDeadline = Date.now() + ROLL_TIME_LIMIT_SEC * 1000;
    if (rollTimerInterval) clearInterval(rollTimerInterval);
    rollTimerInterval = setInterval(tickRollTimer, 250);
  }
  tickRollTimer();
}

function tickRollTimer() {
  if (!gameState || gameState.phase !== Game.Phase.ROLLING) {
    stopRollTimer();
    return;
  }
  const remainingMs = rollTimerDeadline - Date.now();
  UI.setRollTimer(Math.max(0, Math.ceil(remainingMs / 1000)));
  if (remainingMs <= 0) {
    stopRollTimer();
    if (isMyTurn()) {
      applyAndMaybeBroadcast(Game.prepareForfeitEvent(gameState, myPlayer), true);
    }
  }
}

function stopRollTimer() {
  if (rollTimerInterval) {
    clearInterval(rollTimerInterval);
    rollTimerInterval = null;
  }
  rollTimerKey = null;
  UI.setRollTimer(null);
}

function enterGameScreen() {
  // Skip past any history already in the synced state so reconnecting/joining
  // doesn't replay every past event's sound/toast/move-animation at once.
  lastAnnouncedLogLen = gameState ? gameState.log.length : 0;
  lastAnimatedTraceId = gameState ? gameState.moveTraceId : null;
  lastAnimatedTraceLen = gameState ? gameState.moveTrace.length : 0;
  UI.resetLogTracking();
  UI.showScreen('screen-game');
  startGameTimer();
  renderGame();
}

function isMyTurn() {
  return gameState && gameState.turn === myPlayer;
}

let lastAnnouncedLogLen = 0;
function announceLogEvents() {
  if (gameState.log.length <= lastAnnouncedLogLen) {
    if (gameState.log.length < lastAnnouncedLogLen) lastAnnouncedLogLen = 0; // new match
    return;
  }
  const newEntries = gameState.log.slice(lastAnnouncedLogLen);
  newEntries.forEach((entry) => {
    const text = entry.text;
    if (text.includes('captured')) {
      UI.playSound('capture');
      UI.haptic('capture');
    } else if (text.includes('climbed a ladder')) {
      UI.playSound('ladder');
      UI.haptic('move');
    } else if (text.includes('bitten') || text.includes('slid to')) {
      UI.playSound('snake');
      UI.haptic('capture');
    } else if (text.includes('drew a card') || text.includes('played')) {
      UI.playSound('card');
      UI.haptic('card');
    }
  });
  UI.flashEventToast(newEntries[newEntries.length - 1].text);
  lastAnnouncedLogLen = gameState.log.length;
}

function renderGame() {
  if (!gameState) return;
  announceLogEvents();
  UI.renderHeader(gameState, myPlayer, oppPlayer);
  UI.renderGameTimer(gameState.startedAt, gameState.endedAt);
  UI.renderLeaderboard(gameState, myPlayer, oppPlayer);
  UI.renderCardHand(gameState, myPlayer, onPlayCard);
  UI.renderLog(gameState);

  const selectable = [];
  if (isMyTurn() && gameState.phase === Game.Phase.CHOOSE_TOKEN) {
    const legal = Game.legalTokenIndices(gameState, myPlayer, gameState.lastRoll);
    legal.forEach((tokenIndex) => selectable.push({ player: myPlayer, tokenIndex }));
  }
  UI.renderTokens(gameState, selectable, onTokenTap);

  const rollable = isMyTurn() && gameState.phase === Game.Phase.ROLLING;
  UI.setRollButtonEnabled(rollable, rollable ? 'Roll' : isMyTurn() ? 'Choose a token' : 'Waiting…');
  updateRollTimer();

  if (isMyTurn() && gameState.phase === Game.Phase.CHOOSE_TOKEN) {
    const legal = Game.legalTokenIndices(gameState, myPlayer, gameState.lastRoll);
    const hasDoubleMove = gameState.players[myPlayer].cards.includes(Game.CARD_TYPES.DOUBLE_MOVE);
    if (legal.length > 1 || (legal.length === 1 && hasDoubleMove)) {
      // If we got here without the roll animation having run (e.g. a fresh
      // SYNC_STATE arrived mid-choice on reconnect), open the modal directly.
      if (!UI.isDiceModalOpen()) {
        UI.openDiceModal();
        UI.setDiceModalResult(gameState.lastRoll);
      }
      const options = legal.map((idx) => ({
        player: myPlayer,
        ...Game.previewMove(gameState, myPlayer, idx, gameState.lastRoll),
      }));
      const doubleMove = hasDoubleMove
        ? { onPlay: () => { UI.closeDiceModal(); playDoubleMove(); } }
        : null;
      UI.showDiceModalTokenChoice(
        options,
        (tokenIndex) => { UI.closeDiceModal(); onTokenTap(myPlayer, tokenIndex); },
        doubleMove,
      );
    } else {
      UI.closeDiceModal();
      if (legal.length === 1) onTokenTap(myPlayer, legal[0]);
    }
  } else if (!rollInProgress) {
    UI.closeDiceModal();
  }

  if (
    gameState.phase === Game.Phase.SHIELD_DECISION &&
    gameState.pending &&
    gameState.pending.player === myPlayer
  ) {
    UI.showShieldOverlay((useShield) => {
      const event = Game.prepareShieldDecisionEvent(gameState, myPlayer, useShield);
      applyAndMaybeBroadcast(event, true);
    });
  } else {
    UI.hideOverlay('shield-overlay');
  }

  if (gameState.phase === Game.Phase.GAME_OVER) {
    const didWin = gameState.winner === myPlayer;
    UI.playSound(didWin ? 'win' : 'lose');
    UI.haptic(didWin ? 'win' : 'move');
    const stats = {
      durationMs: (gameState.endedAt || Date.now()) - gameState.startedAt,
      turns: gameState.stats.turns,
      myCardsPlayed: gameState.stats.cardsPlayed[myPlayer],
      oppCardsPlayed: gameState.stats.cardsPlayed[oppPlayer],
    };
    UI.showGameOver(didWin, gameState.players[myPlayer].name, gameState.players[gameState.winner].name, stats);
    clearSession();
  }
}

function onTokenTap(player, tokenIndex) {
  if (player !== myPlayer || !isMyTurn() || gameState.phase !== Game.Phase.CHOOSE_TOKEN) return;
  const event = Game.prepareChooseTokenEvent(gameState, myPlayer, tokenIndex);
  UI.playSound('move');
  UI.haptic('move');
  applyAndMaybeBroadcast(event, true);
}

function onPlayCard(cardType, _cardIdx) {
  if (!isMyTurn()) return;

  if (cardType === Game.CARD_TYPES.SWAP) {
    if (gameState.phase !== Game.Phase.ROLLING) return;
    UI.showSwapOverlay(
      myPlayer,
      oppPlayer,
      gameState.players[myPlayer].tokens,
      gameState.players[oppPlayer].tokens,
      () => {},
      (myIdx, oppIdx) => {
        const event = Game.prepareSwapEvent(gameState, myPlayer, myIdx, oppIdx);
        UI.playSound('card');
        UI.haptic('card');
        applyAndMaybeBroadcast(event, true);
      },
    );
    return;
  }

  if (cardType === Game.CARD_TYPES.DOUBLE_MOVE) {
    if (gameState.phase !== Game.Phase.CHOOSE_TOKEN) {
      UI.flashEventToast('⏩ Double Move: roll first, then pick it from the roll popup');
      return;
    }
    playDoubleMove();
    return;
  }

  if (cardType === Game.CARD_TYPES.SHIELD) {
    UI.flashEventToast('🛡 Shield activates automatically when a snake bites you');
    return;
  }
}

function playDoubleMove() {
  if (!isMyTurn() || gameState.phase !== Game.Phase.CHOOSE_TOKEN) return;
  const event = Game.prepareDoubleMoveEvent(gameState, myPlayer);
  UI.playSound('card');
  UI.haptic('card');
  applyAndMaybeBroadcast(event, true);
}

let rollInProgress = false;
function onRollClick() {
  if (rollInProgress || !isMyTurn() || gameState.phase !== Game.Phase.ROLLING) return;
  rollInProgress = true;
  stopRollTimer(); // clicking Roll counts even if the animation runs past the deadline
  UI.setRollButtonEnabled(false, 'Rolling…');
  UI.openDiceModal();
  const event = Game.prepareRollEvent(gameState, myPlayer);
  UI.animateDiceModal(event.value, () => {
    rollInProgress = false;
    UI.playSound('roll');
    UI.haptic('roll');
    applyAndMaybeBroadcast(event, true);
  });
}

function quitGame() {
  UI.showConfirm('Quit this match? Your opponent will see you as disconnected.', abandonMatch);
}

// ---------------------------------------------------------------- generic DOM helpers
function el(id) {
  return document.getElementById(id);
}

function renderIdentityChip() {
  const name = Settings.getPlayerName();
  el('menu-identity-name').textContent = name;
  el('menu-identity-avatar').textContent = name.charAt(0).toUpperCase();
}

function bindMenu() {
  el('btn-host').addEventListener('click', hostGame);
  el('btn-join').addEventListener('click', () => UI.showScreen('screen-join-enter'));
  el('btn-settings').addEventListener('click', UI.openSettingsModal);
  el('btn-menu-identity').addEventListener('click', UI.openSettingsModal);
  el('btn-howtoplay').addEventListener('click', UI.openHowToPlay);
  el('btn-howtoplay-close').addEventListener('click', UI.closeHowToPlay);

  el('btn-cancel-host').addEventListener('click', () => {
    resetNetwork();
    clearSession();
    UI.showScreen('screen-menu');
  });

  const codeInput = el('join-code-input');
  codeInput.addEventListener('input', () => {
    codeInput.value = normalizeRoomCode(codeInput.value).slice(0, 5);
  });
  el('btn-join-submit').addEventListener('click', () => joinGame(codeInput.value));
  el('btn-cancel-join').addEventListener('click', () => UI.showScreen('screen-menu'));

  el('btn-cancel-connecting').addEventListener('click', () => {
    resetNetwork();
    clearSession();
    UI.showScreen('screen-menu');
  });

  el('btn-join-retry').addEventListener('click', () => UI.showScreen('screen-join-enter'));
  el('btn-join-timeout-back').addEventListener('click', () => UI.showScreen('screen-menu'));
}

function bindGameScreen() {
  el('btn-roll').addEventListener('click', onRollClick);
  el('btn-pause').addEventListener('click', () => UI.showScreen('screen-pause'));
  el('btn-resume').addEventListener('click', () => UI.showScreen('screen-game'));
  el('btn-pause-settings').addEventListener('click', UI.openSettingsModal);
  el('btn-abandon').addEventListener('click', () => {
    UI.showConfirm('Leave this match?', abandonMatch);
  });
  el('btn-quit').addEventListener('click', quitGame);
  el('btn-howtoplay-ingame').addEventListener('click', UI.openHowToPlay);
  el('btn-log').addEventListener('click', UI.openLogModal);
  el('btn-log-close').addEventListener('click', UI.closeLogModal);
  el('btn-back-to-menu').addEventListener('click', () => {
    stopGameTimer();
    stopRollTimer();
    resetNetwork();
    gameState = null;
    clearSession();
    UI.showScreen('screen-menu');
  });
}

function bindSettingsModal() {
  UI.bindSettingsInputs();
  el('btn-settings-close').addEventListener('click', UI.closeSettingsModal);
  Settings.onChange(renderIdentityChip);
}

// ---------------------------------------------------------------- boot
function boot() {
  UI.initBoard();
  bindMenu();
  bindGameScreen();
  bindSettingsModal();
  renderIdentityChip();

  const session = loadSession();
  if (session) {
    attemptAutoRejoin();
  } else {
    UI.showScreen('screen-menu');
  }
}

document.addEventListener('DOMContentLoaded', boot);
