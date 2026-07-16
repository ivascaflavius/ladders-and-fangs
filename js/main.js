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
import { Icon } from './icons.js';
import * as AI from './ai.js';

const SESSION_KEY = 'laddersAndFangs.session.v1';
const COMPUTER_NAME = 'Computer';

let networkRoom = null;
let gameState = null;
let myPlayer = null; // 'host' | 'guest'
let oppPlayer = null;
let disconnectTimer = null;
let disconnectDeadline = null;
// Single-player mode: no networkRoom at all — the "opponent" (always
// 'guest') is played by js/ai.js instead of a remote peer. myPlayer is
// always 'host' in this mode so every existing isMyTurn()-gated input
// handler (roll button, token taps, card hand) already works unmodified.
let vsComputer = false;
let computerActionTimer = null;
let trapPlacementActive = false;
// True from the moment we notice the opponent has dropped until they say
// HELLO again — lets us tell "first handshake of the match" apart from
// "they actually came back", so the reconnect toast only fires for the
// latter.
let opponentWasDisconnected = false;
// True while we're the one re-establishing a dropped connection (via
// attemptAutoRejoin) — used the same way, for our own "Reconnected!" toast.
let isRejoining = false;

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
    })
    .then(() => {
      if (vsComputer) maybeRunComputerTurn();
    });
  return animationChain;
}

function applyAndMaybeBroadcast(event, broadcast) {
  gameState = Game.reduce(gameState, event);
  if (broadcast) send(event);
  processStateChange();
}

// ---------------------------------------------------------------- computer opponent (single-player)
// Runs one decision for the AI's turn, then relies on processStateChange's
// chain to call this again once the resulting animation/state settles —
// naturally advancing through ROLLING -> CHOOSE_TOKEN -> (SHIELD_DECISION?)
// -> back to the human's turn, one scheduled step at a time.
function maybeRunComputerTurn() {
  if (!vsComputer || !gameState || gameState.turn !== oppPlayer) return;
  if (gameState.phase === Game.Phase.GAME_OVER) return;

  if (gameState.phase === Game.Phase.SHIELD_DECISION) {
    if (!gameState.pending || gameState.pending.player !== oppPlayer) return;
    scheduleComputerAction(() => {
      const useShield = AI.shouldUseShield(gameState, oppPlayer);
      applyAndMaybeBroadcast(Game.prepareShieldDecisionEvent(gameState, oppPlayer, useShield), true);
    });
    return;
  }

  if (gameState.phase === Game.Phase.CHOOSE_TOKEN) {
    scheduleComputerAction(() => {
      const decision = AI.chooseTokenMoveOrDouble(gameState, oppPlayer, gameState.lastRoll);
      if (!decision) return;
      if (decision.type === 'double') {
        applyAndMaybeBroadcast(Game.prepareDoubleMoveEvent(gameState, oppPlayer), true);
      } else {
        applyAndMaybeBroadcast(Game.prepareChooseTokenEvent(gameState, oppPlayer, decision.tokenIndex), true);
      }
    });
    return;
  }

  if (gameState.phase === Game.Phase.ROLLING) {
    scheduleComputerAction(() => {
      const trapSquare = AI.chooseTrapSquare(gameState, oppPlayer);
      if (trapSquare !== null) {
        applyAndMaybeBroadcast(Game.prepareTrapEvent(gameState, oppPlayer, trapSquare), true);
        return;
      }
      const swap = AI.chooseSwap(gameState, oppPlayer);
      if (swap) {
        applyAndMaybeBroadcast(Game.prepareSwapEvent(gameState, oppPlayer, swap.myIdx, swap.oppIdx), true);
        return;
      }
      applyAndMaybeBroadcast(Game.prepareRollEvent(gameState, oppPlayer), true);
    });
  }
}

// A short "thinking" delay before each computer action — instant decisions
// would feel jarring and make its moves hard to follow.
function scheduleComputerAction(fn) {
  clearTimeout(computerActionTimer);
  computerActionTimer = setTimeout(fn, 650 + Math.random() * 500);
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
      if (opponentWasDisconnected) {
        opponentWasDisconnected = false;
        UI.flashEventToast(`${data.name} reconnected!`, Icon.link);
      }
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
    if (isRejoining) {
      isRejoining = false;
      UI.flashEventToast('Reconnected!', Icon.link);
    }
    return;
  }

  // Rematch is deliberately outside game.js's deterministic reducer, same as
  // HELLO/SYNC_STATE — only the host is authoritative for creating a fresh
  // match, so a guest's click just forwards a request the host acts on.
  if (data.type === 'REMATCH_REQUEST') {
    if (myPlayer === 'host' && gameState) startRematch();
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
  opponentWasDisconnected = true;
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
  clearTimeout(computerActionTimer);
  stopGameTimer();
  stopRollTimer();
  stopChoiceTimer();
  UI.hideDisconnectOverlay();
  UI.exitTrapPlacementMode();
  trapPlacementActive = false;
  opponentWasDisconnected = false;
  isRejoining = false;
  resetNetwork();
  gameState = null;
  vsComputer = false;
  clearSession();
  UI.showScreen('screen-menu');
}

// ---------------------------------------------------------------- vs computer
function startComputerGame() {
  resetNetwork();
  clearTimeout(computerActionTimer);
  UI.exitTrapPlacementMode();
  trapPlacementActive = false;
  myPlayer = 'host';
  oppPlayer = 'guest';
  vsComputer = true;
  clearSession(); // single-player has no room to rejoin
  gameState = Game.createInitialState(Settings.getPlayerName(), COMPUTER_NAME);
  enterGameScreen();
}

// Starts a fresh match reusing the same connection/room (P2P) or just resets
// local state (vs computer). Only the host is authoritative for P2P — see
// the REMATCH_REQUEST handling in handleIncoming for the guest-initiated path.
function startRematch() {
  if (vsComputer) {
    startComputerGame();
    return;
  }
  if (!gameState) return;
  if (myPlayer !== 'host') {
    send({ type: 'REMATCH_REQUEST' });
    UI.flashEventToast('Rematch requested — waiting for the host…', Icon.refresh);
    return;
  }
  const hostName = gameState.players.host.name;
  const guestName = gameState.players.guest.name;
  gameState = Game.createInitialState(hostName, guestName);
  send({ type: 'SYNC_STATE', state: gameState });
  if (networkRoom) saveSession(networkRoom.roomCode, 'host');
  enterGameScreen();
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
  isRejoining = true;

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
    isRejoining = false;
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

// The countdown only needs to display for the player whose own client would
// broadcast the forfeit — showing it while watching the opponent (or the
// computer) roll would tick down to zero for no reason on the passive side.
const ROLL_TIME_LIMIT_SEC = 30;
let rollTimerInterval = null;
let rollTimerDeadline = null;
let rollTimerKey = null;

function updateRollTimer() {
  if (!gameState || gameState.phase !== Game.Phase.ROLLING || !isMyTurn()) {
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

// Idle-choice timer: when it's my turn and I'm sitting on a token-choice
// (incl. Double Move) or shield decision without acting, a 30s countdown
// runs in that modal. On timeout, a random valid option is picked — with a
// visible "cycling through the choices" roulette effect first — and it's
// logged/toasted as an auto-pick so both players understand what happened.
const CHOICE_TIME_LIMIT_SEC = 30;
let choiceTimerInterval = null;
let choiceTimerDeadline = null;
let choiceTimerKey = null;
let choiceTimerTarget = null; // 'dice-modal-timer' | 'shield-modal-timer'

function updateChoiceTimer() {
  const tokenChoiceOpen = gameState && isMyTurn() && gameState.phase === Game.Phase.CHOOSE_TOKEN && UI.isDiceModalOpen();
  const shieldChoiceOpen = gameState && gameState.phase === Game.Phase.SHIELD_DECISION
    && gameState.pending && gameState.pending.player === myPlayer;

  if (!tokenChoiceOpen && !shieldChoiceOpen) {
    stopChoiceTimer();
    return;
  }

  const target = tokenChoiceOpen ? 'dice-modal-timer' : 'shield-modal-timer';
  const key = tokenChoiceOpen
    ? `choice-${gameState.moveTraceId}`
    : `shield-${gameState.moveTraceId}-${gameState.pending.queue.length}`;

  if (key !== choiceTimerKey) {
    choiceTimerKey = key;
    choiceTimerTarget = target;
    choiceTimerDeadline = Date.now() + CHOICE_TIME_LIMIT_SEC * 1000;
    if (choiceTimerInterval) clearInterval(choiceTimerInterval);
    choiceTimerInterval = setInterval(tickChoiceTimer, 250);
  }
  tickChoiceTimer();
}

function tickChoiceTimer() {
  const remainingMs = choiceTimerDeadline - Date.now();
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  UI.setChoiceTimer(choiceTimerTarget, remainingSec);
  if (remainingMs <= 0) {
    const target = choiceTimerTarget;
    stopChoiceTimer();
    resolveChoiceTimeout(target);
  }
}

function stopChoiceTimer() {
  if (choiceTimerInterval) {
    clearInterval(choiceTimerInterval);
    choiceTimerInterval = null;
  }
  if (choiceTimerTarget) UI.setChoiceTimer(choiceTimerTarget, null);
  choiceTimerKey = null;
  choiceTimerTarget = null;
}

async function resolveChoiceTimeout(target) {
  if (!gameState) return;

  if (target === 'dice-modal-timer' && gameState.phase === Game.Phase.CHOOSE_TOKEN && isMyTurn()) {
    const legal = Game.legalTokenIndices(gameState, myPlayer, gameState.lastRoll);
    const hasDoubleMove = gameState.players[myPlayer].cards.includes(Game.CARD_TYPES.DOUBLE_MOVE);
    const options = [...legal.map((idx) => ({ kind: 'token', idx })), ...(hasDoubleMove ? [{ kind: 'double' }] : [])];
    if (options.length === 0) return;
    const chosenPos = Math.floor(Math.random() * options.length);
    const chosen = options[chosenPos];
    await UI.animateModalRoulette('#dice-modal-tokens .dice-modal-choice', chosenPos);
    UI.closeDiceModal();
    if (chosen.kind === 'double') {
      playDoubleMove(true);
    } else {
      onTokenTap(myPlayer, chosen.idx, true);
    }
    return;
  }

  if (target === 'shield-modal-timer' && gameState.phase === Game.Phase.SHIELD_DECISION
    && gameState.pending && gameState.pending.player === myPlayer) {
    const useShield = Math.random() < 0.5;
    await UI.animateModalRoulette('#shield-overlay .btn', useShield ? 0 : 1);
    const event = Game.prepareShieldDecisionEvent(gameState, myPlayer, useShield, true);
    applyAndMaybeBroadcast(event, true);
  }
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
    } else if (text.includes('bitten') || text.includes('slid')) {
      UI.playSound('snake');
      UI.haptic('capture');
    } else if (text.includes('triggered') && text.includes('trap')) {
      UI.playSound('trap');
      UI.haptic('capture');
    } else if (text.includes('hand is full')) {
      UI.playSound('cardEmpty');
      UI.haptic('step');
    } else if (text.includes('drew a') || text.includes('played') || text.includes('set a trap')) {
      UI.playSound('card');
      UI.haptic('card');
    }
  });
  // Surface the "took too long" auto-pick note if present in this batch —
  // it's the more noteworthy event even if it's not the last log line.
  const autoPickEntry = newEntries.find((e) => e.text.includes('took too long'));
  UI.flashEventToast(autoPickEntry ? autoPickEntry.text : newEntries[newEntries.length - 1].text);
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
  UI.renderTraps(gameState, myPlayer);
  UI.setTurnGlow(gameState.phase === Game.Phase.GAME_OVER ? null : gameState.turn);

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
    // Double Move can rescue an otherwise-forfeited roll (e.g. one token is
    // already locked at 100 and the other can't fit the roll normally, but
    // could fit roll*2) — game.js's applyRoll already accounted for this when
    // deciding to enter CHOOSE_TOKEN at all, so the modal must offer it even
    // with zero normally-legal token moves.
    const doubleMoveViable = hasDoubleMove && Game.canPlayDoubleMove(gameState, myPlayer, gameState.lastRoll);
    if (legal.length > 1 || (legal.length === 1 && hasDoubleMove) || (legal.length === 0 && doubleMoveViable)) {
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
      const hasLockedToken = gameState.players[myPlayer].tokens.some((pos) => !Game.isTokenSwappable(pos));
      const doubleMove = hasDoubleMove
        ? { onPlay: () => { stopChoiceTimer(); UI.closeDiceModal(); playDoubleMove(); }, locked: hasLockedToken }
        : null;
      UI.showDiceModalTokenChoice(
        options,
        (tokenIndex) => { stopChoiceTimer(); UI.closeDiceModal(); onTokenTap(myPlayer, tokenIndex); },
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
      stopChoiceTimer();
      const event = Game.prepareShieldDecisionEvent(gameState, myPlayer, useShield);
      applyAndMaybeBroadcast(event, true);
    });
  } else {
    UI.hideOverlay('shield-overlay');
  }
  updateChoiceTimer();

  if (gameState.phase === Game.Phase.GAME_OVER) {
    const didWin = gameState.winner === myPlayer;
    UI.playSound(didWin ? 'win' : 'lose');
    UI.haptic(didWin ? 'win' : 'move');
    const loserPlayer = gameState.winner === 'host' ? 'guest' : 'host';
    const stats = {
      durationMs: (gameState.endedAt || Date.now()) - gameState.startedAt,
      turns: gameState.stats.turns,
      myCardsPlayed: gameState.stats.cardsPlayed[myPlayer],
      oppCardsPlayed: gameState.stats.cardsPlayed[oppPlayer],
      winnerPlayer: gameState.winner,
      loserPlayer,
      loserName: gameState.players[loserPlayer].name,
      winnerTokens: gameState.players[gameState.winner].tokens,
      loserTokens: gameState.players[loserPlayer].tokens,
    };
    UI.showGameOver(didWin, gameState.players[myPlayer].name, gameState.players[gameState.winner].name, stats);
    clearSession();
  }
}

function onTokenTap(player, tokenIndex, auto = false) {
  if (player !== myPlayer || !isMyTurn() || gameState.phase !== Game.Phase.CHOOSE_TOKEN) return;
  const event = Game.prepareChooseTokenEvent(gameState, myPlayer, tokenIndex, auto);
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
      UI.flashEventToast('Double Move: roll first, then pick it from the roll popup', Icon.fastForward);
      return;
    }
    playDoubleMove();
    return;
  }

  if (cardType === Game.CARD_TYPES.SHIELD) {
    UI.flashEventToast('Shield activates automatically when a snake bites you', Icon.shield);
    return;
  }

  if (cardType === Game.CARD_TYPES.TRAP) {
    if (gameState.phase !== Game.Phase.ROLLING) {
      UI.flashEventToast('Trap: play it instead of rolling, at the start of your turn', Icon.trap);
      return;
    }
    startTrapPlacement();
    return;
  }
}

function startTrapPlacement() {
  if (!isMyTurn() || gameState.phase !== Game.Phase.ROLLING) return;
  trapPlacementActive = true;
  // The 30s roll timer is wall-clock based and keeps ticking regardless of
  // local UI state — without pausing it here, a placement that takes a
  // while can get auto-forfeited out from under the player while the board
  // squares are still sitting there clickable. cancelTrapPlacement()'s
  // renderGame() call restarts it fresh via updateRollTimer().
  stopRollTimer();
  UI.setRollButtonEnabled(false, 'Placing trap…');
  UI.enterTrapPlacementMode(
    (square) => Game.isTrapPlaceable(gameState, square),
    (square) => {
      trapPlacementActive = false;
      UI.exitTrapPlacementMode();
      const event = Game.prepareTrapEvent(gameState, myPlayer, square);
      UI.playSound('card');
      UI.haptic('card');
      applyAndMaybeBroadcast(event, true);
    },
  );
}

function cancelTrapPlacement() {
  trapPlacementActive = false;
  UI.exitTrapPlacementMode();
  renderGame();
}

function playDoubleMove(auto = false) {
  if (!isMyTurn() || gameState.phase !== Game.Phase.CHOOSE_TOKEN) return;
  const event = Game.prepareDoubleMoveEvent(gameState, myPlayer, auto);
  UI.playSound('card');
  UI.haptic('card');
  applyAndMaybeBroadcast(event, true);
}

let rollInProgress = false;
function onRollClick() {
  if (rollInProgress || trapPlacementActive || !isMyTurn() || gameState.phase !== Game.Phase.ROLLING) return;
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
  const message = vsComputer
    ? 'Quit this match?'
    : 'Quit this match? Your opponent will see you as disconnected.';
  UI.showConfirm(message, abandonMatch);
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
  el('btn-vs-computer').addEventListener('click', startComputerGame);
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
  el('btn-game-over-log').addEventListener('click', UI.openLogModal);
  el('btn-rematch').addEventListener('click', startRematch);
  el('btn-trap-cancel').addEventListener('click', cancelTrapPlacement);
  el('btn-back-to-menu').addEventListener('click', () => {
    clearTimeout(computerActionTimer);
    stopGameTimer();
    stopRollTimer();
    stopChoiceTimer();
    UI.exitTrapPlacementMode();
    trapPlacementActive = false;
    opponentWasDisconnected = false;
    isRejoining = false;
    resetNetwork();
    gameState = null;
    vsComputer = false;
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
  UI.applyTheme();
  UI.initStaticIcons();
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
