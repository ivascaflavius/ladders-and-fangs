// board-data.js
// Standalone board layout module. Supports multiple predefined board layouts
// (selected via setBoard) instead of one hardcoded layout — the currently
// active layout is swapped in-place onto this same exported object, so every
// consumer (game.js, board-render.js) that reads BoardData.LADDERS/SNAKES/etc.
// at call time automatically picks up whichever board is active without
// needing to be passed a board reference explicitly.

const BOARD_SIZE = 10;
const LAST_SQUARE = BOARD_SIZE * BOARD_SIZE; // 100

// Every board layout keeps the same shape (8 ladders, 8 snakes, 8 card
// squares) and the same disjointness rules as the original hand-tuned board
// — no square doubles up as two of {ladder start, ladder end, snake head,
// snake tail, card square} — so alternate boards read as "different, not
// harder/easier" and a run's stats stay comparable across boards.
const BOARDS = {
  classic: {
    id: 'classic',
    name: 'Classic',
    ladders: [
      { from: 1, to: 38 },
      { from: 4, to: 14 },
      { from: 9, to: 31 },
      { from: 21, to: 42 },
      { from: 28, to: 84 },
      { from: 51, to: 67 },
      { from: 71, to: 91 },
      { from: 80, to: 100 },
    ],
    snakes: [
      { from: 17, to: 7 },
      { from: 54, to: 34 },
      { from: 62, to: 19 },
      { from: 64, to: 60 },
      { from: 87, to: 24 },
      { from: 93, to: 73 },
      { from: 95, to: 75 },
      { from: 98, to: 79 },
    ],
    cardSquares: [6, 12, 23, 45, 58, 76, 89, 99],
  },
  crossfire: {
    id: 'crossfire',
    name: 'Crossfire',
    ladders: [
      { from: 3, to: 20 },
      { from: 8, to: 33 },
      { from: 27, to: 46 },
      { from: 40, to: 59 },
      { from: 50, to: 69 },
      { from: 63, to: 81 },
      { from: 72, to: 90 },
      { from: 85, to: 98 },
    ],
    snakes: [
      { from: 16, to: 6 },
      { from: 30, to: 11 },
      { from: 48, to: 22 },
      { from: 56, to: 37 },
      { from: 66, to: 45 },
      { from: 83, to: 61 },
      { from: 93, to: 70 },
      { from: 97, to: 78 },
    ],
    cardSquares: [14, 25, 35, 55, 65, 75, 88, 95],
  },
  switchback: {
    id: 'switchback',
    name: 'Switchback',
    ladders: [
      { from: 2, to: 15 },
      { from: 10, to: 29 },
      { from: 24, to: 43 },
      { from: 34, to: 52 },
      { from: 44, to: 62 },
      { from: 57, to: 74 },
      { from: 68, to: 86 },
      { from: 79, to: 96 },
    ],
    snakes: [
      { from: 19, to: 4 },
      { from: 32, to: 13 },
      { from: 47, to: 26 },
      { from: 60, to: 39 },
      { from: 70, to: 49 },
      { from: 82, to: 58 },
      { from: 91, to: 71 },
      { from: 99, to: 80 },
    ],
    cardSquares: [7, 21, 36, 46, 55, 65, 76, 88],
  },
};

const DEFAULT_BOARD_ID = 'classic';

let activeBoardId = DEFAULT_BOARD_ID;
let LADDERS = [];
let SNAKES = [];
let CARD_SQUARES = [];
let SAFE_SQUARES = new Set();
let LADDER_MAP = new Map();
let SNAKE_MAP = new Map();
let CARD_SQUARE_SET = new Set();

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

function isValidBoardId(id) {
  return Object.prototype.hasOwnProperty.call(BOARDS, id);
}

function getBoardList() {
  return Object.values(BOARDS).map((b) => ({ id: b.id, name: b.name }));
}

function getBoardId() {
  return activeBoardId;
}

// Swaps the active layout in place onto the exported BoardData object, so
// every existing `BoardData.LADDERS` / `BoardData.SNAKES` / etc. read (there's
// no destructuring at import time anywhere) picks up the new board without
// any consumer changes. Falls back to the default board for an unknown id
// (e.g. a stale/foreign id received over the network).
function setBoard(id) {
  const def = BOARDS[id] || BOARDS[DEFAULT_BOARD_ID];
  activeBoardId = def.id;
  LADDERS = def.ladders;
  SNAKES = def.snakes;
  CARD_SQUARES = def.cardSquares;
  SAFE_SQUARES = new Set([
    1,
    LAST_SQUARE,
    ...LADDERS.map((l) => l.from),
    ...SNAKES.map((s) => s.from),
  ]);
  LADDER_MAP = new Map(LADDERS.map((l) => [l.from, l.to]));
  SNAKE_MAP = new Map(SNAKES.map((s) => [s.from, s.to]));
  CARD_SQUARE_SET = new Set(CARD_SQUARES);

  BoardData.LADDERS = LADDERS;
  BoardData.SNAKES = SNAKES;
  BoardData.CARD_SQUARES = CARD_SQUARES;
  BoardData.SAFE_SQUARES = SAFE_SQUARES;
}

const BoardData = {
  BOARD_SIZE,
  LAST_SQUARE,
  DEFAULT_BOARD_ID,
  LADDERS,
  SNAKES,
  CARD_SQUARES,
  SAFE_SQUARES,
  getLadder,
  getSnake,
  isSafeSquare,
  isCardSquare,
  squareToRowCol,
  setBoard,
  getBoardId,
  getBoardList,
  isValidBoardId,
};

setBoard(DEFAULT_BOARD_ID);

export default BoardData;
