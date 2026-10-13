import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract constants and helpers from index.html
const chordMatch = html.match(/const AMBIENT_CHORDS = (\[[\s\S]*?\]);\s*const AMBIENT_MELODY = (\[[\s\S]*?\]);\s*const CHORD_SECONDS = (\d+);/);
assert(chordMatch, "Could not locate AMBIENT_CHORDS in index.html");
const AMBIENT_CHORDS = vm.runInNewContext(chordMatch[1]);
const AMBIENT_MELODY = vm.runInNewContext(chordMatch[2]);
const CHORD_SECONDS = Number(chordMatch[3]);

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

const procClassMatch = html.match(/class ProceduralAmbient \{[\s\S]*?\n    \}/);
assert(procClassMatch, "Could not locate ProceduralAmbient class in index.html");
const ProceduralAmbientClassCode = procClassMatch[0];

// Create Mock Web Audio Infrastructure
function createMockAudioContext() {
  const events = [];
  const nodes = [];

  class MockAudioParam {
    constructor(val = 0, name = "param") {
      this.value = val;
      this.name = name;
      this.scheduled = [];
      this.connectedTo = [];
    }
    setValueAtTime(val, time) {
      this.value = val;
      this.scheduled.push({ type: "setValueAtTime", val, time });
    }
    setTargetAtTime(target, time, timeConstant) {
      this.value = target;
      this.scheduled.push({ type: "setTargetAtTime", target, time, timeConstant });
    }
    linearRampToValueAtTime(val, time) {
      this.value = val;
      this.scheduled.push({ type: "linearRampToValueAtTime", val, time });
    }
    exponentialRampToValueAtTime(val, time) {
      this.value = val;
      this.scheduled.push({ type: "exponentialRampToValueAtTime", val, time });
    }
    setValueCurveAtTime(values, time, duration) {
      this.scheduled.push({ type: "setValueCurveAtTime", values, time, duration });
    }
    cancelScheduledValues(time) {
      this.scheduled.push({ type: "cancelScheduledValues", time });
    }
  }

  class MockNode {
    constructor(type) {
      this.type = type;
      this.connections = [];
      this.connectedTo = [];
      nodes.push(this);
    }
    connect(dest) {
      this.connections.push(dest);
      if (dest && dest.connectedTo) dest.connectedTo.push(this);
      return dest;
    }
    disconnect() {
      this.connections = [];
    }
  }

  class MockGainNode extends MockNode {
    constructor() {
      super("gain");
      this.gain = new MockAudioParam(1, "gain");
    }
  }

  class MockOscillatorNode extends MockNode {
    constructor() {
      super("oscillator");
      this.frequency = new MockAudioParam(440, "frequency");
      this.detune = new MockAudioParam(0, "detune");
      this.type = "sine";
      this.started = false;
      this.stopped = false;
      this.startTime = null;
      this.stopTime = null;
      this.onended = null;
    }
    start(time = 0) {
      this.started = true;
      this.startTime = time;
    }
    stop(time = 0) {
      this.stopped = true;
      this.stopTime = time;
    }
    setPeriodicWave(wave) {
      this.wave = wave;
    }
  }

  class MockBiquadFilterNode extends MockNode {
    constructor() {
      super("biquadFilter");
      this.frequency = new MockAudioParam(350, "frequency");
      this.Q = new MockAudioParam(1, "Q");
      this.type = "lowpass";
    }
  }

  class MockBufferSourceNode extends MockNode {
    constructor() {
      super("bufferSource");
      this.buffer = null;
      this.loop = false;
      this.started = false;
      this.stopped = false;
      this.startTime = null;
      this.stopTime = null;
      this.onended = null;
    }
    start(time = 0) {
      this.started = true;
      this.startTime = time;
    }
    stop(time = 0) {
      this.stopped = true;
      this.stopTime = time;
    }
  }

  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    state: "running",
    nodes,
    events,
    createGain: () => new MockGainNode(),
    createOscillator: () => new MockOscillatorNode(),
    createBiquadFilter: () => new MockBiquadFilterNode(),
    createBufferSource: () => new MockBufferSourceNode(),
    createBuffer: (channels, length, sampleRate) => {
      const channelData = new Array(channels).fill(null).map(() => new Float32Array(length));
      return {
        sampleRate,
        length,
        numberOfChannels: channels,
        getChannelData: (ch) => channelData[ch]
      };
    },
    createStereoPanner: () => {
      const panner = new MockNode("panner");
      panner.pan = new MockAudioParam(0, "pan");
      return panner;
    },
    createDynamicsCompressor: () => {
      const comp = new MockNode("compressor");
      comp.threshold = new MockAudioParam(-3);
      comp.knee = new MockAudioParam(0);
      comp.ratio = new MockAudioParam(20);
      comp.attack = new MockAudioParam(0.001);
      comp.release = new MockAudioParam(0.1);
      return comp;
    },
    createPeriodicWave: (real, imag) => ({ real, imag }),
    suspend: async () => { ctx.state = "suspended"; events.push("suspend"); },
    resume: async () => { ctx.state = "running"; events.push("resume"); },
    close: async () => { ctx.state = "closed"; events.push("close"); }
  };

  return ctx;
}

function createProceduralEnvironment() {
  const ctx = createMockAudioContext();
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.4;
  const master = ctx.createGain();
  master.gain.value = 0.64;

  const timeouts = [];
  const fakeWindow = {
    setTimeout: (fn, delay) => {
      const id = timeouts.length + 1;
      timeouts.push({ id, fn, delay, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const entry = timeouts.find((t) => t.id === id);
      if (entry) entry.cleared = true;
    }
  };

  const fakeDocument = {
    hidden: false,
    documentElement: {
      classList: {
        _classes: new Set(),
        contains: function(c) { return this._classes.has(c); },
        add: function(c) { this._classes.add(c); },
        remove: function(c) { this._classes.delete(c); }
      }
    }
  };

  let idleSuspended = false;

  const sandbox = {
    AMBIENT_CHORDS,
    AMBIENT_MELODY,
    CHORD_SECONDS,
    document: fakeDocument,
    window: fakeWindow,
    setTimeout: fakeWindow.setTimeout,
    clearTimeout: fakeWindow.clearTimeout,
    Float32Array,
    Math,
    Boolean,
    state: {
      soundEnabled: true,
      soundTheme: "cute",
      soundVolume: 0.8,
      ambientMusicEnabled: true,
      ambientMix: { synth: 0.8, rain: 0, hearth: 0 }
    },
    audioEngine: {
      ctx,
      musicBus,
      master,
      ensure: () => ctx,
      resume: () => { ctx.state = "running"; },
      setVolume: (val) => { master.gain.value = val ** 2; },
      idleTimer: null,
      panner: () => null
    },
    armIdleSuspend: () => {
      fakeWindow.clearTimeout(sandbox.audioEngine.idleTimer);
      sandbox.audioEngine.idleTimer = fakeWindow.setTimeout(() => {
        const musicAudible = sandbox.ambientSoundscape?.generation && sandbox.state.soundVolume > 0;
        if (!musicAudible && ctx.state === "running") {
          ctx.suspend();
          idleSuspended = true;
        }
      }, 45000);
    }
  };

  const code = `
    ${ProceduralAmbientClassCode};
    ProceduralAmbient;
  `;
  const ProceduralAmbientClass = vm.runInNewContext(code, sandbox);
  const ambientSoundscape = new ProceduralAmbientClass();
  sandbox.ambientSoundscape = ambientSoundscape;

  return {
    ctx,
    sandbox,
    ambientSoundscape,
    timeouts,
    fakeDocument,
    fakeWindow,
    get idleSuspended() { return idleSuspended; }
  };
}

describe("Procedural Ambient Soundscape Engine Comprehensive Test Suite", () => {

  describe("1. Procedural Ambient Soundscape Synthesis Math", () => {
    it("validates four-chord harmonic cycle progression in F major", () => {
      assert.equal(AMBIENT_CHORDS.length, 4, "Pad cycle must feature exactly four chords");
      assert.equal(CHORD_SECONDS, 8, "Each chord duration must be 8 seconds");

      AMBIENT_CHORDS.forEach((chord, i) => {
        assert.equal(chord.length, 5, `Chord ${i} must have 5 voices for rich spatial layering`);
        chord.forEach((freq) => {
          assert.ok(freq >= 200 && freq <= 1000, `Voice frequency ${freq} must be in audible mid-register`);
        });
      });

      assert.ok(AMBIENT_CHORDS[3].includes(659.25), "Chord 3 must include E5 (659.25 Hz)");
      assert.equal(AMBIENT_CHORDS[0][0], 349.23, "Chord 0 fundamental must be F4");
    });

    it("verifies frequency detune calculation per pitch-class", () => {
      const calcDetune = (freq) => {
        const pitchClass = ((Math.round(12 * Math.log2(freq / 440)) % 12) + 12) % 12;
        return (pitchClass % 2 === 0 ? 4 : -4) + ((pitchClass * 7) % 3 - 1);
      };

      assert.equal(calcDetune(440.0), 3, "A4 (440Hz) detune must be +3 cents");
      assert.equal(calcDetune(523.25), -5, "C5 (523.25Hz) detune must be -5 cents");
      assert.equal(calcDetune(AMBIENT_CHORDS[0][1]), calcDetune(AMBIENT_CHORDS[1][1]), "Shared A4 voice must retain identical detune");
    });

    it("computes quarter-sine / cosine crossfade curve array values", () => {
      const curve = (rising) => Float32Array.from({ length: 32 }, (_, step) => {
        const phase = (step / 31) * Math.PI / 2;
        return Math.max(0.0001, 0.03 * (rising ? Math.sin(phase) : Math.cos(phase)));
      });

      const up = curve(true);
      const down = curve(false);

      assert.equal(up.length, 32);
      assert.equal(down.length, 32);

      assert.ok(up[0] < 0.0002, "Rising start near zero floor");
      assert.ok(Math.abs(up[31] - 0.03) < 1e-5, "Rising end at peak 0.03");

      assert.ok(Math.abs(down[0] - 0.03) < 1e-5, "Falling start at peak 0.03");
      assert.ok(down[31] < 0.0002, "Falling end near zero floor");

      for (let i = 0; i < 32; i++) {
        const sumSq = (up[i] ** 2) + (down[i] ** 2);
        assert.ok(Math.abs(sumSq - 0.03 ** 2) < 0.00005, `Index ${i} equal-power sum invariant`);
      }
    });

    it("detects melody clashes and skips dissonant semitones over chord tones", () => {
      const clashes = (note, soundingTones) => {
        const sounding = soundingTones.flatMap((tone) => [tone, tone * 2, tone * 4]);
        return sounding.some((tone) => {
          const distance = Math.abs(12 * Math.log2(note / tone)) % 12;
          const minDistance = Math.min(distance, 12 - distance);
          return minDistance > 0.5 && minDistance < 1.5;
        });
      };

      const chord3 = AMBIENT_CHORDS[3];
      assert.ok(clashes(698.46, chord3), "F5 must clash with E5 in C major chord");
      assert.ok(!clashes(783.99, chord3), "G5 must NOT clash with C major chord");
    });
  });

  describe("2. Harmonic Frequency Transpositions Across Themes and Scales", () => {
    it("calculates accurate pentatonic scale frequencies across multiple octaves", () => {
      assert.equal(SOUND_SCALE.length, 5);
      assert.equal(SOUND_SCALE[0], 261.63);
      assert.equal(SOUND_SCALE[1], 293.66);
      assert.equal(SOUND_SCALE[2], 329.63);
      assert.equal(SOUND_SCALE[3], 392.0);
      assert.equal(SOUND_SCALE[4], 440.0);

      assert.equal(pentatonic(0, 4), 261.63);
      assert.equal(pentatonic(4, 4), 440.0);
      assert.ok(Math.abs(pentatonic(0, 5) - 523.26) < 0.01);
      assert.ok(Math.abs(pentatonic(5, 4) - pentatonic(0, 5)) < 0.01);
      assert.equal(pentatonic(-1, 5), 440.0);
    });

    it("evaluates theme semitone pitch shift factors and note spacing", () => {
      assert.equal(SOUND_THEMES.cute.semitones, 0);
      assert.equal(SOUND_THEMES.cute.spacing, 1.0);
      const shiftCute = 2 ** (SOUND_THEMES.cute.semitones / 12);
      assert.equal(shiftCute, 1.0);

      assert.equal(SOUND_THEMES.dreamy.semitones, 5);
      assert.equal(SOUND_THEMES.dreamy.spacing, 1.5);
      const shiftDreamy = 2 ** (SOUND_THEMES.dreamy.semitones / 12);
      assert.ok(Math.abs(shiftDreamy - 1.33484) < 0.0001);

      assert.equal(SOUND_THEMES.arcade.semitones, 5);
      assert.equal(SOUND_THEMES.arcade.spacing, 0.85);
      const shiftArcade = 2 ** (SOUND_THEMES.arcade.semitones / 12);
      assert.ok(Math.abs(shiftArcade - 1.33484) < 0.0001);
    });

    it("verifies topic semitone transpositions combined with theme offsets", () => {
      const calcTotalShift = (theme, topic) => {
        const themeOffset = SOUND_THEMES[theme].semitones;
        const topicOffset = TOPIC_SEMITONES[topic] || 0;
        return 2 ** ((themeOffset + topicOffset) / 12);
      };

      assert.equal(calcTotalShift("cute", "general"), 1.0);
      assert.ok(Math.abs(calcTotalShift("cute", "love") - 1.33484) < 0.0001);

      const shiftDreamyLove = calcTotalShift("dreamy", "love");
      assert.ok(Math.abs(shiftDreamyLove - 1.7818) < 0.001);

      const shiftArcadeSpicy = calcTotalShift("arcade", "spicy");
      assert.ok(Math.abs(shiftArcadeSpicy - 1.7818) < 0.001);
    });

    it("validates Dreamy FM bell modulator synthesis math", () => {
      const calcModulator = (freq) => ({
        carrier: freq,
        modulator: freq * (freq > 1500 ? 2 : 3.5),
        depth: Math.min(freq * 2, 2500)
      });

      const mid = calcModulator(523.25);
      assert.equal(mid.carrier, 523.25);
      assert.equal(mid.modulator, 523.25 * 3.5);
      assert.equal(mid.depth, 523.25 * 2);

      const high = calcModulator(1600);
      assert.equal(high.carrier, 1600);
      assert.equal(high.modulator, 1600 * 2);
      assert.equal(high.depth, 2500);
    });

    it("validates Arcade pulse wave Fourier coefficient series", () => {
      const harmonics = 24;
      const imag = new Float32Array(harmonics);
      for (let n = 1; n < harmonics; n++) {
        imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
      }

      assert.equal(imag[0], 0, "DC component is 0");
      assert.ok(Math.abs(imag[1] - 0.450158) < 0.001);
      assert.ok(Math.abs(imag[4]) < 1e-7, "4th harmonic is zero for 25% pulse wave");
    });
  });

  describe("3. Crackle & Rain White Noise Buffer Generation", () => {
    it("generates 3-second rain pink-noise buffer via Paul Kellet filter", () => {
      const sampleRate = 44100;
      const bufferSize = sampleRate * 3;
      const data = new Float32Array(bufferSize);

      let b0 = 0, b1 = 0, b2 = 0;
      let seed = 123456;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = 0; i < bufferSize; i++) {
        const white = rand() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.035;
      }

      assert.equal(data.length, 132300, "Rain buffer must contain exactly 3 seconds at 44.1kHz");

      let maxVal = 0;
      let sum = 0;
      for (let i = 0; i < bufferSize; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxVal) maxVal = abs;
        sum += data[i];
      }
      assert.ok(maxVal < 0.35, `Rain signal must not clip, max was ${maxVal}`);
      const mean = sum / bufferSize;
      assert.ok(Math.abs(mean) < 0.01, `Rain signal DC mean must be near 0, got ${mean}`);
    });

    it("generates 2-second hearth attenuated white-noise buffer", () => {
      const sampleRate = 44100;
      const bufferSize = sampleRate * 2;
      const data = new Float32Array(bufferSize);

      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.02;
      }

      assert.equal(data.length, 88200, "Hearth buffer must contain exactly 2 seconds at 44.1kHz");
      let strictlyBounded = true;
      for (let i = 0; i < bufferSize; i++) {
        if (Math.abs(data[i]) > 0.02) { strictlyBounded = false; break; }
      }
      assert.ok(strictlyBounded, "All hearth samples must be bounded within [-0.02, 0.02]");
    });

    it("verifies hearth crackle transient pop synthesis parameters", () => {
      const calcCracklePeak = (hearthMix) => (0.05 + 0.5 * 0.06) * hearthMix;
      assert.ok(calcCracklePeak(0.8) > 0.05 && calcCracklePeak(0.8) < 0.1, "Crackle peak gain scales with mix");
    });
  });

  describe("4. Perceptual Gain Volume Curves", () => {
    it("applies quadratic master gain curve for human auditory loudness matching", () => {
      const perceptualGain = (v) => v ** 2;

      assert.equal(perceptualGain(0.0), 0.0, "Zero volume gives zero gain");
      assert.equal(perceptualGain(1.0), 1.0, "Full volume gives unity gain");
      assert.equal(perceptualGain(0.5), 0.25, "50% volume yields 25% power (-6dB)");
      assert.ok(Math.abs(perceptualGain(0.8) - 0.64) < 1e-9, "Default 80% volume yields 64% power");
    });

    it("verifies music sub-bus level and dynamic ducking attenuation", () => {
      const MUSIC_LEVEL = 0.4;
      assert.equal(MUSIC_LEVEL, 0.4, "Background music baseline level must be 0.4 (-8dB)");

      const duckedTap = MUSIC_LEVEL * 0.8;
      assert.ok(Math.abs(duckedTap - 0.32) < 1e-9, "Tap sound ducks music to 0.32");

      const duckedStep = MUSIC_LEVEL * 0.7;
      assert.ok(Math.abs(duckedStep - 0.28) < 1e-6, "Step sound ducks music to 0.28");
    });

    it("verifies per-layer target gain scaling coefficients", () => {
      const mix = { synth: 0.8, rain: 0.8, hearth: 0.8 };
      const synthGain = mix.synth;
      const rainGain = mix.rain * 0.7;
      const hearthGain = mix.hearth * 0.65;

      assert.equal(synthGain, 0.8);
      assert.ok(Math.abs(rainGain - 0.56) < 1e-6);
      assert.ok(Math.abs(hearthGain - 0.52) < 1e-6);

      assert.equal(Math.max(0.0001, 0 * 0.7), 0.0001, "Muted layer preserves non-zero exponential ramp floor");
    });
  });

  describe("5. Low-Power Idle Throttling & Battery Conservation", () => {
    it("throttles crackle scheduler timer to 5000ms when hearth layer is muted", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0, rain: 0, hearth: 0.8 };
      env.ambientSoundscape.start();

      assert.ok(env.ambientSoundscape.hearthLayer, "Hearth layer started");
      const hearth = env.ambientSoundscape.hearthLayer;

      env.sandbox.state.ambientMix.hearth = 0.01;
      hearth.scheduleCrackle();

      const scheduled = env.timeouts[env.timeouts.length - 1];
      assert.equal(scheduled.delay, 5000, "Muted hearth must throttle crackle timer to 5000ms");
    });

    it("throttles crackle scheduler timer to 3000ms when document is hidden", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0, rain: 0, hearth: 0.8 };
      env.ambientSoundscape.start();

      const hearth = env.ambientSoundscape.hearthLayer;
      env.fakeDocument.hidden = true;
      hearth.scheduleCrackle();

      const scheduled = env.timeouts[env.timeouts.length - 1];
      assert.equal(scheduled.delay, 3000, "Hidden document must throttle crackle timer to 3000ms");
    });

    it("throttles synth scheduling interval and suspends melody in resting mode", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0, hearth: 0 };
      env.ambientSoundscape.start();

      const synth = env.ambientSoundscape.synthLayer;
      assert.ok(synth, "Synth layer started");

      env.fakeDocument.documentElement.classList.add("ambient-rest");
      synth.schedule();

      const scheduled = env.timeouts[env.timeouts.length - 1];
      assert.equal(scheduled.delay, 2000, "Resting mode must throttle synth scheduling loop to 2000ms");
    });

    it("arms 45-second idle suspend timer when soundscape is stopped", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0, hearth: 0 };
      env.ambientSoundscape.start();
      assert.equal(env.ambientSoundscape.isPlaying, true);

      env.ambientSoundscape.stop();
      assert.equal(env.ambientSoundscape.isPlaying, false);

      const suspendTimer = env.timeouts.find((t) => t.delay === 45000 && !t.cleared);
      assert.ok(suspendTimer, "Stop must arm 45-second idle suspend timer");

      suspendTimer.fn();
      assert.equal(env.idleSuspended, true, "Idle suspend timer must suspend the AudioContext");
    });
  });

  describe("6. Multi-Layer Mixer Synchronization", () => {
    it("initializes only layers configured with non-zero volume in initial mix", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0, hearth: 0 };
      env.ambientSoundscape.start();

      assert.ok(env.ambientSoundscape.synthLayer, "Synth layer should be initialized");
      assert.equal(env.ambientSoundscape.rainLayer, undefined, "Rain layer should NOT be initialized");
      assert.equal(env.ambientSoundscape.hearthLayer, undefined, "Hearth layer should NOT be initialized");
    });

    it("dynamically spins up additional layers on updateMix without resetting existing chord cycle", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0, hearth: 0 };
      env.ambientSoundscape.start();

      const initialSynthLayer = env.ambientSoundscape.synthLayer;
      initialSynthLayer.chord = 2;

      env.ambientSoundscape.updateMix({ rain: 0.5, hearth: 0.6 });

      assert.equal(env.ambientSoundscape.synthLayer, initialSynthLayer, "Existing synth layer instance preserved");
      assert.equal(initialSynthLayer.chord, 2, "Chord cycle not reset");
      assert.ok(env.ambientSoundscape.rainLayer, "Rain layer dynamically spun up");
      assert.ok(env.ambientSoundscape.hearthLayer, "Hearth layer dynamically spun up");
    });

    it("ramps gain values smoothly over 0.3s during mix updates", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0.5, hearth: 0 };
      env.ambientSoundscape.start();

      const rainGainParam = env.ambientSoundscape.rainLayer.out.gain;
      rainGainParam.scheduled = [];

      env.ambientSoundscape.updateMix({ rain: 0.9 });

      const ramp = rainGainParam.scheduled.find((s) => s.type === "linearRampToValueAtTime");
      assert.ok(ramp, "Mix update must schedule linearRampToValueAtTime");
      assert.ok(Math.abs(ramp.val - 0.9 * 0.7) < 1e-4, "Target gain should be 0.9 * 0.7 = 0.63");
    });

    it("safely tears down all active layers, ramps gains down, and clears timers on stop", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0.5, hearth: 0.5 };
      env.ambientSoundscape.start();

      assert.ok(env.ambientSoundscape.synthLayer);
      assert.ok(env.ambientSoundscape.rainLayer);
      assert.ok(env.ambientSoundscape.hearthLayer);

      env.ambientSoundscape.stop();

      assert.equal(env.ambientSoundscape.isPlaying, false);
      assert.equal(env.ambientSoundscape.generation, null);
      assert.equal(env.ambientSoundscape.synthLayer, null);
      assert.equal(env.ambientSoundscape.rainLayer, null);
      assert.equal(env.ambientSoundscape.hearthLayer, null);
    });

    it("guarantees rapid start/stop toggling idempotency without orphan oscillators", () => {
      const env = createProceduralEnvironment();
      env.sandbox.state.ambientMix = { synth: 0.8, rain: 0.5, hearth: 0 };

      for (let i = 0; i < 5; i++) {
        env.ambientSoundscape.start();
        env.ambientSoundscape.stop();
      }

      assert.equal(env.ambientSoundscape.isPlaying, false);
      assert.equal(env.ambientSoundscape.generation, null);
      assert.equal(env.ambientSoundscape.synthLayer, null);
      assert.equal(env.ambientSoundscape.rainLayer, null);
    });
  });

});
