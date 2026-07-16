// ai.js
// Heuristic decision-making for the "Play vs Computer" single-player mode.
// No search/lookahead — every decision point (which token to move, whether
// to play Double Move, Shield, or Swap) is scored with a hand-tuned
// heuristic that favors finishing tokens, climbing ladders, capturing,
// avoiding exposure to capture, and picking up cards, in that rough order
// of importance. Reuses game.js's own legality helpers so the AI can never
// suggest an illegal move.

import BoardData from './board-data.js';
import * as Game from './game.js';

const { CARD_TYPES, MAX_CARDS } = Game;

function otherPlayer(player) {
  return player === 'host' ? 'guest' : 'host';
}

// Scores the outcome of moving `tokenIndex` by `roll` squares, from the
// current state, from `player`'s perspective. Higher is better. Returns
// -Infinity for a move that isn't legal (self-stack, overshoot).
function evaluateSingleMove(state, player, tokenIndex, roll) {
  const opp = otherPlayer(player);
  const tokens = state.players[player].tokens;
  const from = tokens[tokenIndex];
  const dest = from + roll;
  if (dest > BoardData.LAST_SQUARE) return -Infinity;
  const otherIdx = tokenIndex === 0 ? 1 : 0;
  if (dest !== 0 && dest === tokens[otherIdx] && dest !== BoardData.LAST_SQUARE) return -Infinity;

  const ladder = BoardData.getLadder(dest);
  const snake = BoardData.getSnake(dest);
  const hasShield = state.players[player].cards.includes(CARD_TYPES.SHIELD);

  let to = dest;
  let score = roll;

  if (ladder) {
    to = ladder.to;
    score += ladder.to - dest;
  } else if (snake) {
    if (hasShield) {
      // The Shield would negate the bite, leaving the token at the (safe)
      // snake head instead of sliding to the tail — no real penalty.
      to = dest;
    } else {
      to = snake.to;
      score -= (dest - snake.to) * 1.2; // sliding back is worse than never having moved
    }
  }

  if (to === BoardData.LAST_SQUARE) {
    const otherPos = tokens[otherIdx];
    score += otherPos === BoardData.LAST_SQUARE ? 100000 : 400;
  }

  if (!BoardData.isSafeSquare(to)) {
    state.players[opp].tokens.forEach((oppPos) => {
      if (oppPos === to && to !== 0) score += 150 + oppPos;
    });
  }

  if (BoardData.isCardSquare(to) && state.players[player].cards.length < MAX_CARDS) {
    score += 20;
  }

  // Risk: could the opponent land exactly here next turn and capture us?
  if (!BoardData.isSafeSquare(to)) {
    state.players[opp].tokens.forEach((oppPos) => {
      const diff = to - oppPos;
      if (diff >= 1 && diff <= 6) score -= 10;
    });
  }

  return score;
}

// { type: 'double' } | { type: 'token', tokenIndex } | null
export function chooseTokenMoveOrDouble(state, player, roll) {
  const legal = Game.legalTokenIndices(state, player, roll);
  let bestTokenIdx = null;
  let bestTokenScore = -Infinity;
  legal.forEach((idx) => {
    const s = evaluateSingleMove(state, player, idx, roll);
    if (s > bestTokenScore) {
      bestTokenScore = s;
      bestTokenIdx = idx;
    }
  });

  const hasDoubleMove = state.players[player].cards.includes(CARD_TYPES.DOUBLE_MOVE);
  let doubleScore = -Infinity;
  if (hasDoubleMove && Game.canPlayDoubleMove(state, player, roll)) {
    const tokens = state.players[player].tokens;
    const lockedIdx = tokens.indexOf(BoardData.LAST_SQUARE);
    if (lockedIdx !== -1) {
      const otherIdx = lockedIdx === 0 ? 1 : 0;
      doubleScore = evaluateSingleMove(state, player, otherIdx, roll * 2);
    } else {
      let sum = 0;
      let any = false;
      [0, 1].forEach((idx) => {
        if (tokens[idx] + roll <= BoardData.LAST_SQUARE) {
          sum += evaluateSingleMove(state, player, idx, roll);
          any = true;
        }
      });
      doubleScore = any ? sum + 5 : -Infinity; // small tempo bonus for advancing both tokens
    }
  }

  if (doubleScore > -Infinity && doubleScore >= bestTokenScore) {
    return { type: 'double' };
  }
  if (bestTokenIdx !== null) return { type: 'token', tokenIndex: bestTokenIdx };
  return null;
}

// Places a trap a few squares ahead of the opponent's most-advanced
// unfinished token — close enough to have a real chance of being landed on,
// without scanning the whole board for a low-odds shot. Never peeks at the
// opponent's own traps to decide anything (the AI has no special knowledge
// beyond what a human would see), so this stays fair.
export function chooseTrapSquare(state, player) {
  if (!state.players[player].cards.includes(CARD_TYPES.TRAP)) return null;
  const opp = otherPlayer(player);
  const oppTokens = state.players[opp].tokens.filter((pos) => pos !== BoardData.LAST_SQUARE);
  if (oppTokens.length === 0) return null;
  const target = Math.max(...oppTokens);
  for (let offset = 2; offset <= 6; offset++) {
    const sq = target + offset;
    if (sq >= BoardData.LAST_SQUARE) continue;
    if (Game.isTrapPlaceable(state, sq)) return sq;
  }
  return null;
}

export function shouldUseShield(state, player) {
  return state.players[player].cards.includes(CARD_TYPES.SHIELD);
}

// Swap gives up an entire turn (no roll), so only worth it when trading up
// meaningfully: send our least-advanced token to the opponent's most-
// advanced token's square, and vice versa. Finished (locked) tokens can't be
// targeted either way.
const SWAP_SWING_THRESHOLD = 12;

export function chooseSwap(state, player) {
  if (!state.players[player].cards.includes(CARD_TYPES.SWAP)) return null;
  const opp = otherPlayer(player);
  const myTokens = state.players[player].tokens;
  const oppTokens = state.players[opp].tokens;
  let best = null;
  let bestSwing = -Infinity;
  for (let i = 0; i < 2; i++) {
    if (!Game.isTokenSwappable(myTokens[i])) continue;
    for (let j = 0; j < 2; j++) {
      if (!Game.isTokenSwappable(oppTokens[j])) continue;
      const swing = oppTokens[j] - myTokens[i];
      if (swing > bestSwing) {
        bestSwing = swing;
        best = { myIdx: i, oppIdx: j };
      }
    }
  }
  return best && bestSwing > SWAP_SWING_THRESHOLD ? best : null;
}
