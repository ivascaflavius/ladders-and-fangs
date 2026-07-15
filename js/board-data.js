// board-data.js
// Standalone board layout module. Kept independent of game.js/ui.js so a future
// "Shuffled" mode (seeded random generation, host seed shared with guest) can
// generate an alternate BoardData object without touching the rest of the engine.

const BOARD_SIZE = 10;
const LAST_SQUARE = BOARD_SIZE * BOARD_SIZE; // 100

// Ladders: climb from a lower square to a higher square.
const LADDERS = [
  { from: 1, to: 38 },
  { from: 4, to: 14 },
  { from: 9, to: 31 },
  { from: 21, to: 42 },
  { from: 28, to: 84 },
  { from: 51, to: 67 },
  { from: 71, to: 91 },
  { from: 80, to: 100 },
];

// Snakes: slide from a higher square (head) down to a lower square (tail).
const SNAKES = [
  { from: 17, to: 7 },
  { from: 54, to: 34 },
  { from: 62, to: 19 },
  { from: 64, to: 60 },
  { from: 87, to: 24 },
  { from: 93, to: 73 },
  { from: 95, to: 75 },
  { from: 98, to: 79 },
];

// Card squares: land exactly here to draw a power-up card.
const CARD_SQUARES = [6, 12, 23, 45, 58, 76, 89, 99];

// Safe squares (no capturing here): every ladder bottom, every snake head,
// square 1 (the shared entry point), and square 100 — once a token finishes,
// it's locked in and can't be bumped back to start. Derived rather than
// hand-authored so it can never drift out of sync with the ladders/snakes
// lists above.
const SAFE_SQUARES = new Set([
  1,
  LAST_SQUARE,
  ...LADDERS.map((l) => l.from),
  ...SNAKES.map((s) => s.from),
]);

const LADDER_MAP = new Map(LADDERS.map((l) => [l.from, l.to]));
const SNAKE_MAP = new Map(SNAKES.map((s) => [s.from, s.to]));
const CARD_SQUARE_SET = new Set(CARD_SQUARES);

function getLadder(square) {
  return LADDER_MAP.has(square) ? { from: square, to: LADDER_MAP.get(square) } : null;
}

function getSnake(square) {
  return SNAKE_MAP.has(square) ? { from: square, to: SNAKE_MAP.get(square) } : null;
}

function isSafeSquare(square) {
  return SAFE_SQUARES.has(square);
}

function isCardSquare(square) {
  return CARD_SQUARE_SET.has(square);
}

// Boustrophedon numbering -> zero-indexed {row, col} grid position.
// row 0 is the bottom row (squares 1-10), row (BOARD_SIZE-1) is the top row.
function squareToRowCol(square) {
  const index = square - 1; // 0-based
  const row = Math.floor(index / BOARD_SIZE);
  const posInRow = index % BOARD_SIZE;
  const leftToRight = row % 2 === 0;
  const col = leftToRight ? posInRow : BOARD_SIZE - 1 - posInRow;
  return { row, col };
}

const BoardData = {
  BOARD_SIZE,
  LAST_SQUARE,
  LADDERS,
  SNAKES,
  CARD_SQUARES,
  SAFE_SQUARES,
  getLadder,
  getSnake,
  isSafeSquare,
  isCardSquare,
  squareToRowCol,
};

export default BoardData;
