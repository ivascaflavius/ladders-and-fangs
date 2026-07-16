// stats.js
// Lightweight cumulative match history, kept in localStorage. Derived purely
// from the finished match's own gameState (log text + stats), so there's
// nothing to sync — every player just tracks their own local history.

const STORAGE_KEY = 'laddersAndFangs.stats.v1';

const DEFAULTS = {
  gamesPlayed: 0,
  wins: 0,
  vsComputerGamesPlayed: 0,
  vsComputerWins: 0,
  totalTurns: 0,
  longestSnakeSlide: 0,
  longestLadderClimb: 0,
  trapsSprungByMe: 0,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    /* ignore — stats just won't persist this session */
  }
}

// Scans the finished match's log for "A → B" style entries to pull out the
// longest single ladder climb / snake slide of the match, and counts how
// many times a trap the *viewer* placed was sprung by the opponent.
function deriveFromLog(log, myName) {
  let longestSnakeSlide = 0;
  let longestLadderClimb = 0;
  let trapsSprungByMe = 0;
  log.forEach((entry) => {
    const text = entry.text;
    const climbMatch = text.match(/climbed a ladder (\d+) → (\d+)/);
    if (climbMatch) longestLadderClimb = Math.max(longestLadderClimb, Number(climbMatch[2]) - Number(climbMatch[1]));
    const slideMatch = text.match(/slid (\d+) → (\d+)/);
    if (slideMatch && text.includes('bitten')) {
      longestSnakeSlide = Math.max(longestSnakeSlide, Number(slideMatch[1]) - Number(slideMatch[2]));
    }
    // Trap log lines read "<victim>: Token N triggered <owner>'s trap — ..."
    // — a trap I placed being sprung shows my name after "triggered".
    if (text.includes('triggered') && text.includes('trap') && text.includes(`triggered ${myName}'s trap`)) {
      trapsSprungByMe++;
    }
  });
  return { longestSnakeSlide, longestLadderClimb, trapsSprungByMe };
}

// Match-scoped highlights (not attributed to a particular player) for the
// game-over screen — how far did the biggest single slide/climb go, and how
// many traps went off in total this match.
export function matchHighlights(log) {
  let longestSlide = 0;
  let longestClimb = 0;
  let trapsSprungTotal = 0;
  log.forEach((entry) => {
    const text = entry.text;
    const climbMatch = text.match(/climbed a ladder (\d+) → (\d+)/);
    if (climbMatch) longestClimb = Math.max(longestClimb, Number(climbMatch[2]) - Number(climbMatch[1]));
    const slideMatch = text.match(/slid (\d+) → (\d+)/);
    if (slideMatch && text.includes('bitten')) {
      longestSlide = Math.max(longestSlide, Number(slideMatch[1]) - Number(slideMatch[2]));
    }
    if (text.includes('triggered') && text.includes('trap')) trapsSprungTotal++;
  });
  return { longestSlide, longestClimb, trapsSprungTotal };
}

// Call once, right when a match ends. `gameState` is the final synced state;
// `myName`/`didWin`/`vsComputer` describe the viewer's own outcome.
export function recordMatchResult(gameState, myName, didWin, vsComputer) {
  const state = load();
  state.gamesPlayed++;
  if (didWin) state.wins++;
  if (vsComputer) {
    state.vsComputerGamesPlayed++;
    if (didWin) state.vsComputerWins++;
  }
  state.totalTurns += gameState.stats.turns;
  const derived = deriveFromLog(gameState.log, myName);
  state.longestSnakeSlide = Math.max(state.longestSnakeSlide, derived.longestSnakeSlide);
  state.longestLadderClimb = Math.max(state.longestLadderClimb, derived.longestLadderClimb);
  state.trapsSprungByMe += derived.trapsSprungByMe;
  persist(state);
  return state;
}

export function getStats() {
  return load();
}

export default { recordMatchResult, getStats, matchHighlights };
