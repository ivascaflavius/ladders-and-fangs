# Ladders & Fangs

A strategy twist on Snakes & Ladders, playable P2P with a friend — no server required.

**Play now:** https://ivascaflavius.github.io/ladders-and-fangs/

## How to play

- Each player controls **2 tokens**, both starting off-board.
- On your turn, roll one die, then **choose which of your two tokens to move**. That choice — not the roll — is the game.
- A token can't move past square 100; it must land exactly on 100.
- Land exactly on an opponent's token and it gets sent back to start — unless that square is marked **safe** (ladder bottoms, snake heads, and square 1 are always safe).
- You can't stack your own two tokens on one square.
- Land exactly on a **card square** to draw a power-up card (max 2 held at once):
  - 🛡 **Shield** — cancels a snake bite when it happens, keeping your token in place.
  - 🔀 **Swap** — play instead of rolling; swap one of your tokens with any opponent token.
  - ⏩ **Double Move** — play right after rolling; move *both* of your tokens by the roll instead of just one. If one of your tokens is already locked in at 100, it instead sends your other token twice as far (roll × 2).
  - 🪤 **Trap** — play instead of rolling; pick an empty, ordinary square to rig. If your opponent's token lands there, a die is rolled and it's knocked back that many squares ×5 (5-30 squares — a real threat, not a minor setback). Shield doesn't block it (Shield only stops snakes). Traps are hidden — you only ever see your own on the board, never your opponent's, until one springs.
- First player to get **both** tokens to exactly square 100 wins.
- Landing on a card square with a full hand (max 2 cards) still gets an acknowledgment — a log line and a quick toast — instead of silently doing nothing.
- **Comeback mechanic:** if you're trailing your opponent by more than 30 combined squares of token progress when you land on a card square, you draw *two* candidate cards and pick which one to keep, instead of getting one at random — a small assist so falling behind doesn't also mean worse cards.

### Host or Join

- **Host a Game** generates a short room code — share it with your opponent.
- **Join a Game** connects you to their code.
- No accounts, no server: connections are made peer-to-peer over WebRTC via [Trystero](https://github.com/dmotz/trystero).
- When your opponent's connection drops mid-match, you'll see a reconnect toast the moment they (or you, after a refresh) come back — not just a disconnect notice.
- **Rematch** on the game-over screen starts a fresh match without a trip back to the main menu. In a P2P match the host is authoritative for starting it (a guest's click just asks the host to).

### Play vs Computer

- No opponent handy? **Play vs Computer** starts an instant local match against an AI opponent — no room code, no networking.
- The AI (`js/ai.js`) is a hand-tuned heuristic, not a lookup table or minimax search: for every decision (which token to move, whether to play Double Move/Shield/Swap) it scores the legal options and picks the best one, weighing finishing/locking a token in highest, then ladder climbs, capturing an opponent token, avoiding squares the opponent could capture on their next roll, and picking up cards. It always uses Shield when bitten, and only plays Swap when trading token positions clearly favors it (since Swap costs a whole turn). It never reads where *your* traps are — it plays as blind to that as a human would.
- **AI Difficulty** (Settings → AI Difficulty: Easy / Normal / Hard) tunes how sharply it plays:
  - **Easy** occasionally grabs a random legal token instead of the best one, barely weighs the risk of walking into a capture, and always places a Trap a few squares ahead of your lead token regardless of whether that's actually a good spot.
  - **Normal** always plays its best-scored move and scores every eligible square near your tokens by how many could roll directly onto it this turn before placing a Trap, falling back to the naive placement if nothing scores.
  - **Hard** weighs capture risk more heavily (and by how likely a given roll actually is), searches further ahead for a strong Trap square, and — unlike the other levels — will hold the Trap card for a better moment instead of wasting it on a cold square.

## Theme & settings

- Settings has a **Dark Theme** toggle (on by default) for a light "parchment" look, if you'd rather have a paper-and-ink board than the default ink-purple night table.
- A **Volume** slider scales every in-game sound (separate from the Sound on/off toggle, which mutes entirely).
- If a match tab is backgrounded while it's your turn to roll, the browser tab's title flashes ("🎲 Your turn!") until you switch back or act — a lightweight nudge with no notification permission needed.

## Match stats

Your own local play history (games played, win rate, win rate vs the AI, longest single ladder climb/snake slide, and how many of your traps have sprung) is kept in `localStorage` and shown on the main menu once you've played at least one match. It's per-browser/device, not synced anywhere.

## Running locally

This is a static site with ES modules, no build step, no bundler:

```
npx serve .
```

(or any other static file server — module imports need `http(s)://`, so opening `index.html` directly via `file://` won't work in most browsers).

## Tests

The rules engine (`js/game.js`) is a pure `reduce(state, event)` function with no DOM/network dependencies, so it's covered by a plain `node:test` suite — no build step or extra dependencies needed:

```
npm test
```

This covers move legality edge cases (self-stack exemption at 100, Double Move overshoot), trap placement rules, the comeback card-choice flow, and — most importantly — a determinism fuzz test that replays several full-length randomized games through two independently-cloned copies of state and asserts they never diverge. That invariant (both P2P peers always reach byte-identical state from the same event stream) is what the entire multiplayer model depends on.

## Tech stack

- Vanilla HTML/CSS/JavaScript (ES modules), no frameworks
- [Trystero](https://github.com/dmotz/trystero) for serverless WebRTC multiplayer (torrent strategy by default)
- No backend, no database — deploys as a static site to GitHub Pages

### Module layout

- `js/game.js` — pure rules engine (reducer, no DOM/network/Math.random inside `reduce()`)
- `js/board-data.js` — static board layout (ladders, snakes, card squares)
- `js/ai.js` — heuristic single-player opponent
- `js/main.js` — app bootstrap, network wiring, turn-by-turn glue between rules and rendering
- `js/ui.js` — barrel module re-exporting the rendering submodules below, plus HUD rendering (header, leaderboard, card hand, log, toasts, menu stats)
  - `js/board-render.js` — the board itself: grid, connectors, tokens, traps, move-trace animation
  - `js/modals.js` — dialogs: dice roll, shield/card-choice decisions, swap picker, settings, how-to-play, game over, confirm
  - `js/audio.js` — WebAudio sound effects and haptics
  - `js/screens.js` — top-level screen switching
  - `js/card-meta.js` — shared card icon/label lookup
- `js/stats.js` — local match-history tracking
- `js/settings.js` / `js/network.js` / `js/icons.js` — settings persistence, Trystero wiring, hand-authored SVG icon set

## Known limitations

- If **both** players refresh or close their tab at the same time, the in-progress match state is lost (only the still-connected peer can re-sync a rejoining one).
- Both players need to keep their tab open and connected for the match to continue; there's no way to resume a match later from a completely different device/session.
- Direct P2P (WebRTC) connections may occasionally fail to establish, or drop mid-game, on very restrictive networks (e.g. some corporate firewalls, symmetric NATs, or certain cellular/carrier NATs) since this project uses no TURN relay server — only STUN, which can't always broker a connection through the strictest NATs. This has been observed more often on iOS Safari than other browsers. Multiple public STUN servers are configured to improve the odds, but there's no fallback relay if all else fails.
- The board layout is fixed for v1 (not randomized) — a "Shuffled" mode with a seeded, host-shared random board is planned but not yet implemented (see `js/board-data.js`).

## License

MIT
