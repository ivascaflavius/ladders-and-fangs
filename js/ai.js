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

// Risk-term weight per difficulty: how heavily "opponent could capture me
// next turn" counts against a move. Easy barely notices it; Hard weighs it
// (and its severity, via the exact square) much more heavily.
const RISK_WEIGHT = { easy: 0.3, normal: 1, hard: 2 };

// Scores the outcome of moving `tokenIndex` by `roll` squares, from the
// current state, from `player`'s perspective. Higher is better. Returns
// -Infinity for a move that isn't legal (self-stack, overshoot).
function evaluateSingleMove(state, player, tokenIndex, roll, difficulty = 'normal') {
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
  // Weighted by difficulty, and (on hard) by how many of the opponent's
  // rolls (1-6) would actually reach it, not just whether any could.
  if (!BoardData.isSafeSquare(to)) {
    const weight = RISK_WEIGHT[difficulty] || 1;
    state.players[opp].tokens.forEach((oppPos) => {
      const diff = to - oppPos;
      if (diff >= 1 && diff <= 6) {
        const severity = difficulty === 'hard' ? 7 - diff : 1; // closer rolls are more likely-feeling and more punishing to walk into
        score -= 10 * weight * severity;
      }
    });
  }

  return score;
}

// { type: 'double' } | { type: 'token', tokenIndex } | null
export function chooseTokenMoveOrDouble(state, player, roll, difficulty = 'normal') {
  const legal = Game.legalTokenIndices(state, player, roll);

  // Easy: mostly plays legally but carelessly — a third of the time it just
  // grabs a random legal token instead of the best one.
  if (difficulty === 'easy' && legal.length > 0 && Math.random() < 0.35) {
    return { type: 'token', tokenIndex: legal[Math.floor(Math.random() * legal.length)] };
  }

  let bestTokenIdx = null;
  let bestTokenScore = -Infinity;
  legal.forEach((idx) => {
    const s = evaluateSingleMove(state, player, idx, roll, difficulty);
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
      doubleScore = evaluateSingleMove(state, player, otherIdx, roll * 2, difficulty);
    } else {
      let sum = 0;
      let any = false;
      [0, 1].forEach((idx) => {
        if (tokens[idx] + roll <= BoardData.LAST_SQUARE) {
          sum += evaluateSingleMove(state, player, idx, roll, difficulty);
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

// How many of the opponent's tokens could roll exactly onto `square` this
// turn (a 1-6 direct roll, no ladder chaining considered — same blind spot
// a human placing a trap would have).
function trapReachScore(state, opp, square) {
  let score = 0;
  state.players[opp].tokens.forEach((pos) => {
    if (pos === BoardData.LAST_SQUARE) return;
    const diff = square - pos;
    if (diff >= 1 && diff <= 6) score += 1;
  });
  return score;
}

// Places a trap. Never peeks at the opponent's own traps to decide anything
// (the AI has no special knowledge beyond what a human would see), so this
// stays fair at every difficulty.
//
// - Easy: the original naive heuristic — always plants it a few squares
//   ahead of the opponent's lead token, whether or not that's actually a
//   good spot this turn.
// - Normal: scores every eligible square near the opponent's tokens by how
//   many of them could roll directly onto it this turn, and picks the best;
//   falls back to the easy heuristic if nothing scores.
// - Hard: same scoring but searches further ahead and, if nothing is
//   immediately reachable, holds the card for a better moment instead of
//   wasting it on a low-odds square.
export function chooseTrapSquare(state, player, difficulty = 'normal') {
  if (!state.players[player].cards.includes(CARD_TYPES.TRAP)) return null;
  const opp = otherPlayer(player);
  const oppTokens = state.players[opp].tokens.filter((pos) => pos !== BoardData.LAST_SQUARE);
  if (oppTokens.length === 0) return null;

  const placeAheadOfLeadToken = () => {
    const target = Math.max(...oppTokens);
    for (let offset = 2; offset <= 6; offset++) {
      const sq = target + offset;
      if (sq >= BoardData.LAST_SQUARE) continue;
      if (Game.isTrapPlaceable(state, sq)) return sq;
    }
    return null;
  };

  if (difficulty === 'easy') return placeAheadOfLeadToken();

  let best = null;
  let bestScore = 0;
  const lookahead = difficulty === 'hard' ? 12 : 6;
  const minSquare = Math.max(1, Math.min(...oppTokens) - 1);
  const maxSquare = Math.min(BoardData.LAST_SQUARE - 1, Math.max(...oppTokens) + lookahead);
  for (let sq = minSquare; sq <= maxSquare; sq++) {
    if (!Game.isTrapPlaceable(state, sq)) continue;
    const score = trapReachScore(state, opp, sq);
    if (score > bestScore) {
      bestScore = score;
      best = sq;
    }
  }
  if (best !== null) return best;
  if (difficulty === 'hard') return null; // hold the card rather than waste it on a cold square
  return placeAheadOfLeadToken();
}

// Comeback mechanic: when the AI is trailing and lands on a card square, it
// gets to pick between two candidate cards. Ranked by rough general
// usefulness — Trap and Shield are the strongest reactive/proactive tools,
// Swap is situational, Double Move is nice-to-have.
const CARD_PREFERENCE = [CARD_TYPES.TRAP, CARD_TYPES.SHIELD, CARD_TYPES.SWAP, CARD_TYPES.DOUBLE_MOVE];

export function chooseCardOption(options) {
  let best = 0;
  let bestRank = Infinity;
  options.forEach((cardType, idx) => {
    const rank = CARD_PREFERENCE.indexOf(cardType);
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      best = idx;
    }
  });
  return best;
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
