// tests/stats.test.js
// Unit tests for stats.js's per-board breakdown. stats.js reads/writes
// through the global `localStorage`, which node:test's environment doesn't
// provide — a tiny in-memory shim stands in so recordMatchResult's
// load()/persist() round-trip the same way they would in a browser, run
// with `node --test`.

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Stats from '../js/stats.js';

const STORAGE_KEY = 'laddersAndFangs.stats.v1';

before(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
});

beforeEach(() => {
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

function fakeGameState(boardId, turns = 10) {
  return { boardId, log: [], stats: { turns } };
}

describe('per-board stats breakdown', () => {
  test('records games played + wins per board independently', () => {
    Stats.recordMatchResult(fakeGameState('classic'), 'Me', true, false);
    Stats.recordMatchResult(fakeGameState('classic'), 'Me', false, false);
    Stats.recordMatchResult(fakeGameState('crossfire'), 'Me', true, false);

    const stats = Stats.getStats();
    assert.equal(stats.gamesPlayed, 3);
    assert.equal(stats.byBoard.classic.gamesPlayed, 2);
    assert.equal(stats.byBoard.classic.wins, 1);
    assert.equal(stats.byBoard.crossfire.gamesPlayed, 1);
    assert.equal(stats.byBoard.crossfire.wins, 1);
    assert.equal(stats.byBoard.switchback, undefined);
  });

  test('falls back to classic when gameState has no boardId', () => {
    Stats.recordMatchResult(fakeGameState(undefined), 'Me', true, false);
    const stats = Stats.getStats();
    assert.equal(stats.byBoard.classic.gamesPlayed, 1);
  });

  test('byBoard defaults to {} for stats saved before this feature existed', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ gamesPlayed: 5, wins: 3 }));
    const stats = Stats.getStats();
    assert.deepEqual(stats.byBoard, {});
  });
});
