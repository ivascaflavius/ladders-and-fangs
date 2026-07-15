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
  - ⏩ **Double Move** — play right after rolling; move *both* of your tokens by the roll instead of just one.
- First player to get **both** tokens to exactly square 100 wins.

### Host or Join

- **Host a Game** generates a short room code — share it with your opponent.
- **Join a Game** connects you to their code.
- No accounts, no server: connections are made peer-to-peer over WebRTC via [Trystero](https://github.com/dmotz/trystero).

## Running locally

This is a static site with ES modules, no build step, no bundler:

```
npx serve .
```

(or any other static file server — module imports need `http(s)://`, so opening `index.html` directly via `file://` won't work in most browsers).

## Tech stack

- Vanilla HTML/CSS/JavaScript (ES modules), no frameworks
- [Trystero](https://github.com/dmotz/trystero) for serverless WebRTC multiplayer (torrent strategy by default)
- No backend, no database — deploys as a static site to GitHub Pages

## Known limitations

- If **both** players refresh or close their tab at the same time, the in-progress match state is lost (only the still-connected peer can re-sync a rejoining one).
- Both players need to keep their tab open and connected for the match to continue; there's no way to resume a match later from a completely different device/session.
- Direct P2P (WebRTC) connections may occasionally fail to establish on very restrictive networks (e.g. some corporate firewalls or symmetric NATs) since this project uses no TURN relay server.
- The board layout is fixed for v1 (not randomized) — a "Shuffled" mode with a seeded, host-shared random board is planned but not yet implemented (see `js/board-data.js`).

## License

MIT
