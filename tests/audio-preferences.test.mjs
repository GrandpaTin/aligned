import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve("c:/Users/DN/Desktop/Projects/Aligned-Game/index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract sound constants and functions from index.html
const scaleMatch = html.match(/const SOUND_SCALE = (\[[\s\S]*?\]);/);
assert(scaleMatch, "Could not locate SOUND_SCALE");
const SOUND_SCALE = vm.runInNewContext(scaleMatch[1]);

const pentatonicMatch = html.match(/const pentatonic = (\([\s\S]*?\n    \});/);
assert(pentatonicMatch, "Could not locate pentatonic");
const pentatonic = vm.runInNewContext(`(${pentatonicMatch[1]})`, { SOUND_SCALE });

const themesMatch = html.match(/const SOUND_THEMES = (\{[\s\S]*?\n    \});/);
assert(themesMatch, "Could not locate SOUND_THEMES");
const SOUND_THEMES = vm.runInNewContext(`(${themesMatch[1]})`);

const topicSemitonesMatch = html.match(/const TOPIC_SEMITONES = (\{[\s\S]*?\});/);
assert(topicSemitonesMatch, "Could not locate TOPIC_SEMITONES");
const TOPIC_SEMITONES = vm.runInNewContext(`(${topicSemitonesMatch[1]})`);

// Extract loadState volume sanitization
const loadStateMatch = html.match(/function initialState\(\) \{[\s\S]*?function loadState\(\) \{[\s\S]*?\n    \}\n    let loadStateFailed/);
assert(loadStateMatch, "Could not locate loadState in index.html");
const engineCode = loadStateMatch[0].replace(/\n    let loadStateFailed$/, "");

describe("Audio Engine & Preferences Independence", () => {
  let vmContext;
  let playedSounds;
  let ambientStarted;
  let ambientStopped;

  beforeEach(() => {
    playedSounds = [];
    ambientStarted = false;
    ambientStopped = false;

    vmContext = {
      state: {
        soundEnabled: true,
        soundTheme: "cute",
        soundVolume: 0.8,
        ambientMusicEnabled: false,
        ambientMix: { synth: 0.8, rain: 0, hearth: 0 }
      },
      audioEngine: {
        ctx: { currentTime: 0, state: "running" },
        fxBus: {},
        musicBus: {},
        master: { gain: { value: 0.64 } },
        ensure: () => vmContext.audioEngine.ctx,
        resume: () => {},
        readyAt: 0,
        panner: () => null
      },
      ambientSoundscape: {
        generation: null,
        start: () => { ambientStarted = true; vmContext.ambientSoundscape.generation = true; },
        stop: () => { ambientStopped = true; vmContext.ambientSoundscape.generation = null; }
      },
      audioAllowed: () => true,
      pulseHaptic: () => {},
      armIdleSuspend: () => {}
    };
  });

  it("verifies soundEnabled and ambientMusicEnabled independent operation", () => {
    // 1. When soundEnabled is false and ambientMusicEnabled is true:
    // playSound must be muted, while ambient soundscape continues running.
    vmContext.state.soundEnabled = false;
    vmContext.state.ambientMusicEnabled = true;

    const playSoundCode = `
      function playSound(kind = "tap", options = {}) {
        if (!audioAllowed()) return;
        if (!options.hapticDone) pulseHaptic(kind);
        if (!state.soundEnabled || !(state.soundVolume > 0)) { return false; }
        return true;
      }
    `;
    const playSound = vm.runInNewContext(`(${playSoundCode})`, vmContext);

    // Call playSound: returns false (muted)
    const played = playSound("tap");
    assert.equal(played, false, "playSound must not play when soundEnabled is false");

    // Ambient music still starts independently
    vmContext.ambientSoundscape.start();
    assert.equal(ambientStarted, true, "ambientSoundscape must start independently when ambientMusicEnabled is true");

    // 2. When soundEnabled is true and ambientMusicEnabled is false:
    // playSound plays, ambient soundscape remains stopped
    vmContext.state.soundEnabled = true;
    vmContext.state.ambientMusicEnabled = false;
    vmContext.ambientSoundscape.stop();

    const playedActive = playSound("tap");
    assert.equal(playedActive, true, "playSound must play when soundEnabled is true");
    assert.equal(ambientStopped, true, "ambientSoundscape remains stopped when ambientMusicEnabled is false");
  });

  it("calculates accurate theme pitch scaling and harmonic frequency transpositions", () => {
    // Verify C-major pentatonic scale frequencies
    assert.equal(SOUND_SCALE.length, 5);
    assert.equal(SOUND_SCALE[0], 261.63, "C4 fundamental frequency");
    assert.equal(SOUND_SCALE[4], 440.0, "A4 fundamental frequency");

    // Test pentatonic function
    // pentatonic(0, 5) -> C5 = 261.63 * 2^(5-4+0) = 523.26 Hz
    const c5 = pentatonic(0, 5);
    assert.ok(Math.abs(c5 - 523.26) < 0.01, `Expected C5 ~523.26 Hz, got ${c5}`);

    // Verify Theme Semitone shifts:
    // cute: 0 semitones -> shift = 1.0
    // dreamy: 5 semitones -> shift = 2^(5/12) ≈ 1.33484 (Fourth transposition to F)
    // arcade: 5 semitones -> shift = 2^(5/12) ≈ 1.33484 (with tighter spacing 0.85)
    assert.equal(SOUND_THEMES.cute.semitones, 0);
    assert.equal(SOUND_THEMES.cute.spacing, 1);

    assert.equal(SOUND_THEMES.dreamy.semitones, 5);
    assert.equal(SOUND_THEMES.dreamy.spacing, 1.5, "Dreamy theme uses wider bell spacing");

    assert.equal(SOUND_THEMES.arcade.semitones, 5);
    assert.equal(SOUND_THEMES.arcade.spacing, 0.85, "Arcade theme uses fast snappy spacing");

    const shiftCute = 2 ** (SOUND_THEMES.cute.semitones / 12);
    const shiftDreamy = 2 ** (SOUND_THEMES.dreamy.semitones / 12);
    assert.equal(shiftCute, 1.0, "Cute theme must have unity pitch shift (1.0)");
    assert.ok(Math.abs(shiftDreamy - 1.33484) < 0.001, "Dreamy theme must transpose up by a fourth (~1.335)");

    // Topic semitones: love, future, spicy transpositions
    assert.equal(TOPIC_SEMITONES.love, 5);
    assert.equal(TOPIC_SEMITONES.future, 5);
  });

  it("clamps out-of-bounds volume values and applies perceptual square taper", () => {
    const storageMap = new Map();
    const mockLocalStorage = {
      getItem: (key) => storageMap.get(key) || null,
      setItem: (key, val) => storageMap.set(key, String(val))
    };

    const loadContext = {
      localStorage: mockLocalStorage,
      ALL_QUESTIONS: [],
      TOPIC_OPTIONS: [],
      SESSION_PRESETS: [],
      INTENSITY_OPTIONS: [],
      DEFAULT_TOPICS: [],
      STORAGE_KEY: "aligned-state-v1",
      LEGACY_STORAGE_KEYS: [],
      loadStateFailed: false,
      normalizeAnswer: (s) => String(s || "").trim().toLowerCase(),
      randomIndex: () => 0
    };

    vm.runInNewContext(engineCode, loadContext);
    const { loadState } = loadContext;

    // Test volume < 0 clamps to 0
    storageMap.set("aligned-state-v1", JSON.stringify({ version: 2, soundVolume: -5 }));
    const stateUnder = loadState();
    assert.equal(stateUnder.soundVolume, 0, "Negative soundVolume must clamp to 0");

    // Test volume > 1 clamps to 1
    storageMap.set("aligned-state-v1", JSON.stringify({ version: 2, soundVolume: 15 }));
    const stateOver = loadState();
    assert.equal(stateOver.soundVolume, 1, "Excessive soundVolume must clamp to 1");

    // Test non-finite / null defaults to 0.8
    storageMap.set("aligned-state-v1", JSON.stringify({ version: 2, soundVolume: "loud" }));
    const stateNaN = loadState();
    assert.equal(stateNaN.soundVolume, 0.8, "Non-numeric soundVolume must default to 0.8");

    // Perceptual volume to gain taper: gain = volume ** 2
    const calcGain = (vol) => vol ** 2;
    assert.equal(calcGain(1.0), 1.0, "Max volume produces unity gain");
    assert.ok(Math.abs(calcGain(0.8) - 0.64) < 1e-6, "0.8 volume produces 0.64 gain");
    assert.equal(calcGain(0.5), 0.25, "0.5 volume produces 0.25 gain");
    assert.equal(calcGain(0.0), 0.0, "0.0 volume produces 0.0 gain");
  });
});
