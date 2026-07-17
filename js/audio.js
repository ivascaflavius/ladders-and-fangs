// audio.js
// All sound (WebAudio synth beeps) and haptic feedback. No DOM/game-state
// dependencies beyond Settings, so it can be reused by any module that wants
// to make noise without importing the rest of the rendering layer.

import Settings from './settings.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let audioCtx = null;
export function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  // Browsers start (and can re-suspend) AudioContexts in a 'suspended' state
  // until explicitly resumed from within a user gesture — every playSound/
  // playDieTick call originates from one (a click), so this is always a
  // valid place to unlock it. Without this, oscillators schedule and "play"
  // silently with no error, which is why it can look like nothing is wrong.
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function volumeScale() {
  return Settings.getVolume() / 100;
}

const SOUND_FREQS = {
  move: [440],
  step: [340],
  capture: [180, 120],
  ladder: [440, 660, 880],
  snake: [500, 300, 180],
  card: [520, 660],
  cardEmpty: [260, 190],
  shieldSave: [660, 880, 990],
  trap: [210, 150, 100],
  win: [523, 659, 784, 1046],
  lose: [300, 250, 200],
};

export function playSound(name) {
  if (!Settings.isSoundOn()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const vol = volumeScale();
  if (vol <= 0) return;
  if (name === 'roll') {
    playRollLandSound(ctx, vol);
    return;
  }
  const freqs = SOUND_FREQS[name] || [440];
  const now = ctx.currentTime;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + i * 0.09;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.15 * vol, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

// The "the die has landed" payoff — plays once the rolled number settles.
// Built as its own layered hit rather than reusing the generic thin
// two-tone chime above, since a single rolled value needs to read clearly
// over a whole run of step/move sounds: a filtered noise "clack" for the
// physical impact, a low sine "thud" underneath for weight, and a brighter
// ascending triangle chime on top for the satisfying payoff. Peak gains
// here are noticeably higher than the generic chime's 0.15 so it actually
// cuts through instead of getting buried under other sounds.
function playRollLandSound(ctx, vol) {
  const now = ctx.currentTime;

  const noiseDur = 0.09;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * noiseDur));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1400;
  noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.55 * vol, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDur);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);

  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, now);
  thud.frequency.exponentialRampToValueAtTime(70, now + 0.12);
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.26 * vol, now + 0.012);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(now);
  thud.stop(now + 0.22);

  [330, 494, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + 0.05 + i * 0.07;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3 * vol, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.24);
  });
}

// Quick click, one per rattle step during the roll animation — lighter-weight
// than playSound()'s multi-tone chime so it can repeat rapidly without
// becoming a wall of noise, but still present enough to read as "rolling"
// against the final landing thump.
export function playDieTick() {
  if (!Settings.isSoundOn()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const vol = volumeScale();
  if (vol <= 0) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 160 + Math.random() * 90;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.11 * vol, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

const HAPTIC_PATTERNS = {
  roll: 15,
  move: 10,
  step: 6,
  capture: [30, 40, 30],
  card: [15, 30, 15],
  win: [20, 40, 20, 40, 60],
};

export function haptic(name) {
  Settings.vibrate(HAPTIC_PATTERNS[name] || 15);
}
