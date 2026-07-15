// network.js
// Trystero room setup, action wiring, and reconnection helpers.
// Strategy is loaded from a single URL so swapping torrent -> nostr (or any
// other Trystero strategy) later means changing STRATEGY_URL only — nothing
// in game.js/ui.js/main.js talks to Trystero directly.

const STRATEGY_URL = 'https://esm.sh/trystero@0.20.0/torrent';
const APP_ID = 'ladders-and-fangs-v1';

// How long a joining client waits for the host to appear before giving up.
export const JOIN_TIMEOUT_MS = 25000;
// How long we wait after a peer leaves before treating the match as abandoned.
export const DISCONNECT_GRACE_MS = 45000;

let strategyModulePromise = null;
function loadStrategy() {
  if (!strategyModulePromise) {
    strategyModulePromise = import(/* @vite-ignore */ STRATEGY_URL);
  }
  return strategyModulePromise;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

export function generateRoomCode(length = 5) {
  let code = '';
  const arr = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 0xffffffff);
  }
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(code) {
  return (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Wraps a Trystero room with the single structured 'game' action channel this
// app uses for every message type (move, roll, card, turn, sync, name...).
class NetworkRoom {
  constructor(room, selfId, roomCode) {
    this.room = room;
    this.selfId = selfId;
    this.roomCode = roomCode;
    const [sendGameEvent, onGameEvent] = room.makeAction('game');
    this._send = sendGameEvent;
    this._eventListeners = new Set();
    onGameEvent((data, peerId) => {
      this._eventListeners.forEach((fn) => fn(data, peerId));
    });
  }

  onEvent(fn) {
    this._eventListeners.add(fn);
    return () => this._eventListeners.delete(fn);
  }

  // Broadcasts to whichever peers are connected (in this 2-player game, the
  // one opponent, if present).
  send(payload) {
    this._send(payload);
  }

  onPeerJoin(fn) {
    this.room.onPeerJoin(fn);
  }

  onPeerLeave(fn) {
    this.room.onPeerLeave(fn);
  }

  getPeers() {
    return Object.keys(this.room.getPeers ? this.room.getPeers() : {});
  }

  leave() {
    this.room.leave();
  }
}

export async function joinNetworkRoom(roomCode) {
  const { joinRoom, selfId } = await loadStrategy();
  const room = joinRoom({ appId: APP_ID }, roomCode);
  return new NetworkRoom(room, selfId, roomCode);
}

// Races room-join against a timeout for the *joining* client, since
// discovery-based signaling has no explicit "room doesn't exist" error.
export function waitForPeer(networkRoom, timeoutMs = JOIN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, timeoutMs);

    networkRoom.onPeerJoin((peerId) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(peerId);
    });
  });
}
