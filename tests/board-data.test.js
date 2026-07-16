// tests/board-data.test.js
// Unit tests for the multi-board registry in board-data.js. BoardData is a
// mutable singleton (the active layout is swapped in place so every existing
// `BoardData.LADDERS`/etc. read picks it up without change) — each test that
// switches boards resets back to the default afterward so ordering within
// this file never leaks state between tests, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import BoardData from '../js/board-data.js';

describe('default board', () => {
  test('starts on classic', () => {
    assert.equal(BoardData.getBoardId(), 'classic');
  });
});

describe('getBoardList', () => {
  test('lists all boards with id + name', () => {
    const list = BoardData.getBoardList();
    const ids = list.map((b) => b.id).sort();
    assert.deepEqual(ids, ['classic', 'crossfire', 'switchback']);
    list.forEach((b) => assert.equal(typeof b.name, 'string'));
  });
});

describe('setBoard / getBoardId', () => {
  after(() => BoardData.setBoard('classic'));

  test('switches the active layout in place', () => {
    BoardData.setBoard('crossfire');
    assert.equal(BoardData.getBoardId(), 'crossfire');
    assert.deepEqual(BoardData.LADDERS[0], { from: 3, to: 20 });
  });

  test('falls back to the default board for an unknown id', () => {
    BoardData.setBoard('not-a-real-board');
    assert.equal(BoardData.getBoardId(), BoardData.DEFAULT_BOARD_ID);
  });

  test('isValidBoardId reflects the registry', () => {
    assert.equal(BoardData.isValidBoardId('switchback'), true);
    assert.equal(BoardData.isValidBoardId('not-a-real-board'), false);
  });
});

describe('board fairness invariants', () => {
  after(() => BoardData.setBoard('classic'));

  BoardData.getBoardList().forEach(({ id }) => {
    test(`${id}: 8 ladders, 8 snakes, 8 card squares, no overlaps`, () => {
      BoardData.setBoard(id);
      const { LADDERS, SNAKES, CARD_SQUARES, LAST_SQUARE } = BoardData;

      assert.equal(LADDERS.length, 8);
      assert.equal(SNAKES.length, 8);
      assert.equal(CARD_SQUARES.length, 8);

      LADDERS.forEach((l) => assert.ok(l.from < l.to && l.to <= LAST_SQUARE, `ladder ${l.from}->${l.to}`));
      SNAKES.forEach((s) => assert.ok(s.from > s.to && s.to >= 1, `snake ${s.from}->${s.to}`));

      // Every {ladder start/end, snake head/tail, card square} is unique —
      // no square plays two roles, so a landing never has to chain-resolve
      // and boards can't accidentally read as "harder" via stacked effects.
      const allSquares = [
        ...LADDERS.map((l) => l.from),
        ...LADDERS.map((l) => l.to),
        ...SNAKES.map((s) => s.from),
        ...SNAKES.map((s) => s.to),
        ...CARD_SQUARES,
      ];
      assert.equal(new Set(allSquares).size, allSquares.length);
    });
  });
});

describe('getLadder / getSnake / isSafeSquare / isCardSquare', () => {
  after(() => BoardData.setBoard('classic'));

  test('read the currently active board', () => {
    BoardData.setBoard('classic');
    assert.deepEqual(BoardData.getLadder(1), { from: 1, to: 38 });
    assert.equal(BoardData.getSnake(1), null);
    assert.deepEqual(BoardData.getSnake(17), { from: 17, to: 7 });
    assert.equal(BoardData.isSafeSquare(1), true); // shared entry point
    assert.equal(BoardData.isSafeSquare(100), true); // finish
    assert.equal(BoardData.isCardSquare(6), true);
    assert.equal(BoardData.isCardSquare(2), false);
  });

  test('update once setBoard switches layouts', () => {
    BoardData.setBoard('switchback');
    assert.equal(BoardData.getLadder(1), null); // classic-only ladder start
    assert.deepEqual(BoardData.getLadder(2), { from: 2, to: 15 });
  });
});
