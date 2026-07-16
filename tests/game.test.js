// tests/game.test.js
// Unit + fuzz tests for the pure game.js reducer. No DOM, no network — just
// reduce(state, event) exercised directly, run with `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as Game from '../js/game.js';
import BoardData from '../js/board-data.js';

const { Phase, CARD_TYPES } = Game;

function freshState() {
  return Game.createInitialState('Host', 'Guest');
}

describe('isLegalTokenMove', () => {
  test('rejects overshoot past 100', () => {
    const state = freshState();
    state.players.host.tokens = [98, 0];
    assert.equal(Game.isLegalTokenMove(state, 'host', 0, 6), false);
  });

  test('rejects self-stacking on an ordinary square', () => {
    const state = freshState();
    state.players.host.tokens = [10, 4];
    assert.equal(Game.isLegalTokenMove(state, 'host', 1, 6), false); // 4+6=10, occupied by own other token
  });

  test('exempts square 100 from the self-stack rule (both tokens can finish)', () => {
    const state = freshState();
    state.players.host.tokens = [100, 94];
    assert.equal(Game.isLegalTokenMove(state, 'host', 1, 6), true);
  });
});

describe('canPlayDoubleMove', () => {
  test('false when the only movable token would overshoot 100 (locked-token case)', () => {
    const state = freshState();
    state.players.host.tokens = [100, 99];
    assert.equal(Game.canPlayDoubleMove(state, 'host', 1), false); // 99 + 1*2 = 101
  });

  test('true when roll*2 fits exactly', () => {
    const state = freshState();
    state.players.host.tokens = [100, 94];
    assert.equal(Game.canPlayDoubleMove(state, 'host', 3), true); // 94 + 3*2 = 100
  });

  test('true when neither token is locked and at least one fits the roll', () => {
    const state = freshState();
    state.players.host.tokens = [10, 20];
    assert.equal(Game.canPlayDoubleMove(state, 'host', 4), true);
  });
});

describe('isTrapPlaceable', () => {
  test('rejects safe squares (ladder bottoms, snake heads, square 1, square 100)', () => {
    const state = freshState();
    assert.equal(Game.isTrapPlaceable(state, 1), false);
    assert.equal(Game.isTrapPlaceable(state, BoardData.LAST_SQUARE), false);
    BoardData.LADDERS.forEach((l) => assert.equal(Game.isTrapPlaceable(state, l.from), false));
    BoardData.SNAKES.forEach((s) => assert.equal(Game.isTrapPlaceable(state, s.from), false));
  });

  test('rejects card squares', () => {
    const state = freshState();
    BoardData.CARD_SQUARES.forEach((sq) => assert.equal(Game.isTrapPlaceable(state, sq), false));
  });

  test('rejects an already-occupied square', () => {
    const state = freshState();
    state.players.host.tokens = [50, 0];
    assert.equal(Game.isTrapPlaceable(state, 50), false);
  });

  test('rejects a square that already has a trap', () => {
    const state = freshState();
    state.traps = { 50: 'guest' };
    assert.equal(Game.isTrapPlaceable(state, 50), false);
  });

  test('accepts an ordinary empty square', () => {
    const state = freshState();
    assert.equal(Game.isTrapPlaceable(state, 50), true);
  });
});

describe('ladder climb via reduce()', () => {
  test('token lands on a ladder bottom and climbs to the top', () => {
    let state = freshState();
    state.players.host.tokens = [0, 0];
    // square 1 has a ladder to 38 (see board-data.js)
    state = Game.reduce(state, { type: 'ROLL', player: 'host', value: 1 });
    assert.equal(state.phase, Phase.CHOOSE_TOKEN);
    state = Game.reduce(state, {
      type: 'CHOOSE_TOKEN',
      player: 'host',
      queue: [{ tokenIndex: 0, roll: 1, cardDraw: null, cardDraw2: null, trapRoll: 3 }],
      auto: false,
    });
    assert.equal(state.players.host.tokens[0], 38);
    assert.ok(state.log.some((e) => e.text.includes('climbed a ladder 1 → 38')));
  });
});

describe('trap trigger via reduce()', () => {
  test('setback equals trapRoll * 5, and the trap is consumed', () => {
    let state = freshState();
    state.traps = { 25: 'guest' };
    state.players.host.tokens = [19, 0]; // 19 + 6 = 25
    state.turn = 'host';
    state.lastRoll = 6;
    state.phase = Phase.CHOOSE_TOKEN;
    state = Game.reduce(state, {
      type: 'CHOOSE_TOKEN',
      player: 'host',
      queue: [{ tokenIndex: 0, roll: 6, cardDraw: null, cardDraw2: null, trapRoll: 4 }],
      auto: false,
    });
    assert.equal(state.players.host.tokens[0], 5); // 25 - 4*5
    assert.equal(state.traps[25], undefined);
    assert.ok(state.log.some((e) => e.text.includes('rolled a 4, knocked back 20 squares, 25 → 5')));
  });

  test('a trap never affects its own placer', () => {
    let state = freshState();
    state.traps = { 25: 'host' };
    state.players.host.tokens = [19, 0];
    state.turn = 'host';
    state.lastRoll = 6;
    state.phase = Phase.CHOOSE_TOKEN;
    state = Game.reduce(state, {
      type: 'CHOOSE_TOKEN',
      player: 'host',
      queue: [{ tokenIndex: 0, roll: 6, cardDraw: null, cardDraw2: null, trapRoll: 4 }],
      auto: false,
    });
    assert.equal(state.players.host.tokens[0], 25); // untouched
    assert.equal(state.traps[25], 'host'); // still armed
  });
});

describe('comeback card choice (CARD_CHOICE phase)', () => {
  test('a trailing player landing on a card square with two distinct draws must choose', () => {
    let state = freshState();
    // host trails guest by more than the 30-square comeback threshold
    state.players.host.tokens = [0, 0];
    state.players.guest.tokens = [50, 50];
    state.turn = 'host';
    state.lastRoll = 6;
    state.phase = Phase.CHOOSE_TOKEN;
    assert.equal(Game.isTrailingPlayer(state, 'host'), true);
    // square 6 is a card square (see board-data.js)
    state = Game.reduce(state, {
      type: 'CHOOSE_TOKEN',
      player: 'host',
      queue: [{ tokenIndex: 0, roll: 6, cardDraw: CARD_TYPES.SHIELD, cardDraw2: CARD_TYPES.TRAP, trapRoll: 2 }],
      auto: false,
    });
    assert.equal(state.phase, Phase.CARD_CHOICE);
    assert.deepEqual(state.pending.cardChoice.options, [CARD_TYPES.SHIELD, CARD_TYPES.TRAP]);
    assert.equal(state.players.host.cards.length, 0); // not drawn yet

    state = Game.reduce(state, Game.prepareCardChoiceEvent(state, 'host', 1));
    assert.deepEqual(state.players.host.cards, [CARD_TYPES.TRAP]);
    assert.equal(state.phase, Phase.ROLLING); // turn ended, back to the top for the other player... actually host->guest
    assert.equal(state.turn, 'guest');
  });

  test('a non-trailing player just draws one card as usual (no pause)', () => {
    let state = freshState();
    state.players.host.tokens = [0, 0];
    state.players.guest.tokens = [0, 0];
    state.turn = 'host';
    state.lastRoll = 6;
    state.phase = Phase.CHOOSE_TOKEN;
    state = Game.reduce(state, {
      type: 'CHOOSE_TOKEN',
      player: 'host',
      queue: [{ tokenIndex: 0, roll: 6, cardDraw: CARD_TYPES.SHIELD, cardDraw2: CARD_TYPES.TRAP, trapRoll: 2 }],
      auto: false,
    });
    assert.notEqual(state.phase, Phase.CARD_CHOICE);
    assert.deepEqual(state.players.host.cards, [CARD_TYPES.SHIELD]);
  });
});

// ---------------------------------------------------------------- determinism fuzz
// The whole P2P model hinges on reduce() never calling Math.random() itself —
// both peers must reach byte-identical state from the same event stream. This
// simulates several full-ish games, feeding the SAME prepare*()-generated
// event (which does the random rolling) into two independently-cloned copies
// of state, and asserts they never diverge.
function stripTimestamps(state) {
  return { ...state, log: state.log.map((e) => e.text) };
}

function deepClone(state) {
  return JSON.parse(JSON.stringify(state));
}

function playOneRandomStep(state) {
  const player = state.turn;
  if (state.phase === Phase.ROLLING) {
    const hand = state.players[player].cards;
    if (hand.includes(CARD_TYPES.TRAP) && Math.random() < 0.25) {
      const eligible = [];
      for (let sq = 1; sq < BoardData.LAST_SQUARE; sq++) {
        if (Game.isTrapPlaceable(state, sq)) eligible.push(sq);
      }
      if (eligible.length > 0) {
        const square = eligible[Math.floor(Math.random() * eligible.length)];
        return Game.prepareTrapEvent(state, player, square);
      }
    }
    if (hand.includes(CARD_TYPES.SWAP) && Math.random() < 0.15) {
      const oppTokens = state.players[player === 'host' ? 'guest' : 'host'].tokens;
      const myIdx = [0, 1].find((i) => Game.isTokenSwappable(state.players[player].tokens[i]));
      const oppIdx = [0, 1].find((i) => Game.isTokenSwappable(oppTokens[i]));
      if (myIdx !== undefined && oppIdx !== undefined) {
        return Game.prepareSwapEvent(state, player, myIdx, oppIdx);
      }
    }
    return Game.prepareRollEvent(state, player);
  }
  if (state.phase === Phase.CHOOSE_TOKEN) {
    const hasDoubleMove = state.players[player].cards.includes(CARD_TYPES.DOUBLE_MOVE);
    if (hasDoubleMove && Game.canPlayDoubleMove(state, player, state.lastRoll) && Math.random() < 0.5) {
      return Game.prepareDoubleMoveEvent(state, player);
    }
    const legal = Game.legalTokenIndices(state, player, state.lastRoll);
    if (legal.length === 0) return Game.prepareForfeitEvent(state, player);
    const tokenIndex = legal[Math.floor(Math.random() * legal.length)];
    return Game.prepareChooseTokenEvent(state, player, tokenIndex);
  }
  if (state.phase === Phase.SHIELD_DECISION) {
    return Game.prepareShieldDecisionEvent(state, player, Math.random() < 0.5);
  }
  if (state.phase === Phase.CARD_CHOICE) {
    return Game.prepareCardChoiceEvent(state, player, Math.random() < 0.5 ? 0 : 1);
  }
  return null;
}

describe('createInitialState boardId', () => {
  test('defaults to whatever board is currently active in BoardData', () => {
    const state = Game.createInitialState('Host', 'Guest');
    assert.equal(state.boardId, BoardData.getBoardId());
  });

  test('takes an explicit boardId regardless of the currently active board', () => {
    const state = Game.createInitialState('Host', 'Guest', 'switchback');
    assert.equal(state.boardId, 'switchback');
    // Passing an id doesn't itself switch BoardData's active layout — that's
    // main.js's job (applyActiveBoard) once it renders the match.
    assert.equal(BoardData.getBoardId(), 'classic');
  });
});

describe('determinism fuzz', () => {
  test('two independent state clones stay identical across many random turns, across several games', () => {
    for (let game = 0; game < 8; game++) {
      let a = freshState();
      let b = deepClone(a);
      for (let step = 0; step < 400; step++) {
        if (a.phase === Phase.GAME_OVER) break;
        const event = playOneRandomStep(a);
        if (!event) break;
        a = Game.reduce(a, event);
        b = Game.reduce(b, event);
        assert.deepEqual(
          stripTimestamps(a),
          stripTimestamps(b),
          `state diverged at game ${game} step ${step} on event ${JSON.stringify(event)}`,
        );
      }
    }
  });
});
