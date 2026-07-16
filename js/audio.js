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
  return audioCtx;
}

function volumeScale() {
  return Settings.getVolume() / 100;
}

const SOUND_FREQS = {
  roll: [220, 330],
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

// Quick, quiet click — deliberately lighter-weight than playSound()'s
// multi-tone chime so it can rattle rapidly through a roll without becoming
// a wall of noise.
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
  gain.gain.exponentialRampToValueAtTime(0.05 * vol, now + 0.004);
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
