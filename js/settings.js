// settings.js
// Single source of truth for user-facing settings (name, sound, haptics),
// backed by localStorage. Other modules should only read/write settings
// through this module rather than touching localStorage directly.

const STORAGE_KEY = 'laddersAndFangs.settings.v1';

const DEFAULTS = {
  playerName: '',
  soundOn: true,
  hapticsOn: true,
  themeDark: true,
};

function randomSuffix() {
  return Math.floor(1000 + Math.random() * 9000);
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // localStorage unavailable (private mode, quota, etc.) — settings just
    // won't persist across reloads; game still functions this session.
  }
  listeners.forEach((fn) => fn(state));
}

function getPlayerName() {
  if (state.playerName && state.playerName.trim().length > 0) {
    return state.playerName.trim();
  }
  // Generate the fallback name once and persist it, so it stays stable
  // across repeated calls (e.g. re-sent on every reconnect) and reloads.
  const fallback = `Player${randomSuffix()}`;
  state.playerName = fallback;
  persist();
  return fallback;
}

function setPlayerName(name) {
  state.playerName = (name || '').trim();
  persist();
}

function isSoundOn() {
  return !!state.soundOn;
}

function setSoundOn(on) {
  state.soundOn = !!on;
  persist();
}

function isHapticsOn() {
  return !!state.hapticsOn;
}

function setHapticsOn(on) {
  state.hapticsOn = !!on;
  persist();
}

function isDarkTheme() {
  return state.themeDark !== false;
}

function setDarkTheme(on) {
  state.themeDark = !!on;
  persist();
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function vibrate(pattern) {
  if (!isHapticsOn()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch (err) {
    // no-op: vibration not supported/allowed
  }
}

const Settings = {
  getPlayerName,
  setPlayerName,
  isSoundOn,
  setSoundOn,
  isHapticsOn,
  setHapticsOn,
  isDarkTheme,
  setDarkTheme,
  onChange,
  vibrate,
};

export default Settings;
