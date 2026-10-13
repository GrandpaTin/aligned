import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Resolve index.html portably (whether run from tests/, root, or external harness)
const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  return vm.runInNewContext(m[1]);
};
const questions = [...arraySource("questionBank"), ...arraySource("specialtyQuestionBank")];
const TOPIC_OPTIONS = arraySource("TOPIC_OPTIONS");
const SESSION_PRESETS = arraySource("SESSION_PRESETS");
const INTENSITY_OPTIONS = arraySource("INTENSITY_OPTIONS");
const DEFAULT_TOPICS = ["connection", "lifestyle", "future", "love", "fun"];

// Extract backupToState
const backupMatch = html.match(/function backupToState\(payload\) \{[\s\S]*?\n    \}\n\n    function exportBackup/);
assert(backupMatch, "Could not locate backupToState in index.html");
const backupToState = vm.runInNewContext(`(${backupMatch[0].replace(/\n\n    function exportBackup$/, "")})`, {
  BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"])
});

// Extract initialState, cleanAnswerMap, cleanRatings, cleanTextMaps, cleanImportanceMaps, sanitizeCompletedRounds, storedStateJSON, and loadState
const extractMatch = html.match(/function initialState\(\) \{[\s\S]*?function loadState\(\) \{[\s\S]*?\n    \}\n    let loadStateFailed/);
assert(extractMatch, "Could not locate initialState -> loadState engine in index.html");
const engineCode = extractMatch[0].replace(/\n    let loadStateFailed$/, "");

const storageMap = new Map();
const mockLocalStorage = {
  getItem: (key) => storageMap.get(key) || null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

const vmContext = {
  console,
  localStorage: mockLocalStorage,
  ALL_QUESTIONS: questions,
  TOPIC_OPTIONS,
  SESSION_PRESETS,
  INTENSITY_OPTIONS,
  DEFAULT_TOPICS,
  STORAGE_KEY: "aligned-state-v1",
  LEGACY_STORAGE_KEYS: ["are-we-compatible-state-v1"],
  loadStateFailed: false,
  normalizeAnswer: (s) => String(s || "").trim().toLowerCase(),
  randomIndex: (n) => Math.floor(Math.random() * n)
};

vm.runInNewContext(engineCode, vmContext);
const { loadState } = vmContext;

describe("Backup Schema & Deserialization Resilience", () => {
  beforeEach(() => {
    storageMap.clear();
    vmContext.loadStateFailed = false;
  });

  it("restores standard valid V2 backup accurately into state structure", () => {
    const validPayload = {
      app: "Aligned",
      formatVersion: 2,
      players: { names: ["Sam", "Taylor"] },
      settings: { questionMode: "sliders-only", questionCount: 10 },
      library: { favoriteQuestionIds: ["int_1"] },
      history: {
        completedRounds: [],
        dailyRitual: { streak: 3, lastDate: "2026-10-13", answers: { "2026-10-13": 8 }, completedDates: ["2026-10-13"] }
      }
    };
    const state = backupToState(validPayload);
    assert.deepEqual(Array.from(state.names), ["Sam", "Taylor"]);
    assert.equal(state.questionMode, "sliders-only");
    assert.equal(state.dailyRitual.streak, 3);
    assert.equal(state.dailyRitual.lastDate, "2026-10-13");
  });

  it("accepts legacy formatVersion 1 and legacy raw state backups", () => {
    // formatVersion 1 structured payload
    const legacyPayload = {
      app: "Are We Compatible?",
      formatVersion: 1,
      players: { names: ["Rowan", "Riley"] },
      settings: { questionMode: "mixed" }
    };
    const stateFromLegacy = backupToState(legacyPayload);
    assert.deepEqual(Array.from(stateFromLegacy.names), ["Rowan", "Riley"]);
    assert.equal(stateFromLegacy.version, 2);

    // Direct unencapsulated version 1/2 raw state payload
    const rawStatePayload = {
      version: 1,
      names: ["Jordan", "Casey"],
      questionCount: 5
    };
    const stateFromRaw = backupToState(rawStatePayload);
    assert.deepEqual(Array.from(stateFromRaw.names), ["Jordan", "Casey"]);
    assert.equal(stateFromRaw.version, 2);
  });

  it("safely rejects tampered, truncated, or unrecognized files without uncaught crashes", () => {
    // Missing / invalid app name
    assert.throws(() => backupToState({ app: "MaliciousApp", formatVersion: 2 }), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState({ formatVersion: 2 }), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState(null), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState(undefined), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState("corrupted-non-json-string"), /This does not look like an Aligned backup file/);

    // Unsupported formatVersion
    assert.throws(() => backupToState({ app: "Aligned", formatVersion: 99 }), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState({ app: "Aligned", formatVersion: -1 }), /This does not look like an Aligned backup file/);
    assert.throws(() => backupToState({ app: "Aligned", formatVersion: 0 }), /This does not look like an Aligned backup file/);
  });

  it("clamps out-of-bounds ambientMix values to safe [0, 1] defaults", () => {
    storageMap.set("aligned-state-v1", JSON.stringify({
      version: 2,
      names: ["Alex", "Jordan"],
      ambientMix: { synth: -5, rain: 999, hearth: "invalid" }
    }));
    const state = loadState();
    assert.equal(state.ambientMix.synth, 0, "Negative synth volume must clamp to 0");
    assert.equal(state.ambientMix.rain, 1, "Excessive rain volume must clamp to 1");
    assert.equal(state.ambientMix.hearth, 0, "Non-numeric hearth volume must default to 0");

    // Missing ambientMix defaults safely
    storageMap.set("aligned-state-v1", JSON.stringify({ version: 2, names: ["Alex", "Jordan"], ambientMix: null }));
    const fallbackState = loadState();
    assert.deepEqual({ ...fallbackState.ambientMix }, { synth: 0.8, rain: 0, hearth: 0 }, "Null ambientMix must use default soundscape values");
  });

  it("clamps non-string, truncated, or oversized player names to safe strings", () => {
    // Array with non-strings
    storageMap.set("aligned-state-v1", JSON.stringify({
      version: 2,
      names: [12345, null]
    }));
    const state1 = loadState();
    assert.deepEqual(Array.from(state1.names), ["", ""], "Non-string names must be replaced with empty strings");

    // Non-array names object
    storageMap.set("aligned-state-v1", JSON.stringify({
      version: 2,
      names: { player1: "Hacker" }
    }));
    const state2 = loadState();
    assert.deepEqual(Array.from(state2.names), ["", ""], "Corrupt names container must default to empty pair");

    // Oversized names are truncated to 40 characters
    storageMap.set("aligned-state-v1", JSON.stringify({
      version: 2,
      names: ["A".repeat(120), "B".repeat(120)]
    }));
    const state3 = loadState();
    assert.equal(state3.names[0].length, 40, "Player 1 name must be clamped to 40 characters max");
    assert.equal(state3.names[1].length, 40, "Player 2 name must be clamped to 40 characters max");
  });

  it("sanitizes corrupt or negative dailyRitual streak, dates, and answers", () => {
    storageMap.set("aligned-state-v1", JSON.stringify({
      version: 2,
      names: ["Alex", "Jordan"],
      dailyRitual: {
        streak: -20,
        lastDate: "2026-10-13-extra-garbage-chars",
        answers: { "int_1": 9999, "int_2": -50, "text_q": "C".repeat(1000) },
        completedDates: ["2026-10-13-overflow", 12345, null]
      }
    }));
    const state = loadState();
    assert.equal(state.dailyRitual.streak, 0, "Negative streak must clamp to 0");
    assert.equal(state.dailyRitual.lastDate, "2026-10-13", "Corrupt date must slice to 10 characters");
    assert.equal(state.dailyRitual.answers["int_1"], 10, "Slider answer > 10 must clamp to 10");
    assert.equal(state.dailyRitual.answers["int_2"], 1, "Slider answer < 1 must clamp to 1");
    assert.equal(state.dailyRitual.answers["text_q"].length, 600, "Text answer must clamp to 600 characters");
    assert.equal(state.dailyRitual.completedDates[0], "2026-10-13", "Completed date must slice to 10 characters");
  });

  it("verifies end-to-end import flow (backupToState -> localStorage -> loadState) on dirty payloads", () => {
    // 1. Structured dirty backup import
    const structuredDirtyBackup = {
      app: "Aligned",
      formatVersion: 2,
      players: { names: ["SuperLongPlayerNameExceedingTheMaximumAllowedThresholdForTesting".repeat(2), 99999] },
      settings: {
        soundVolume: 99
      },
      history: {
        dailyRitual: {
          streak: -99,
          lastDate: "2026-10-13-malformed-timestamp",
          answers: { "int_1": 500, "text_q": "Long answer ".repeat(100) },
          completedDates: ["2026-10-13-truncated", "invalid"]
        }
      }
    };

    const rawImported = backupToState(structuredDirtyBackup);
    assert.equal(rawImported.version, 2);

    storageMap.set("aligned-state-v1", JSON.stringify(rawImported));
    vmContext.loadStateFailed = false;
    const restoredStructured = loadState();

    assert.equal(vmContext.loadStateFailed, false, "Valid structural schema must not trigger load failure");
    assert.equal(restoredStructured.names[0].length, 40, "Player 1 name must be clamped to 40 characters");
    assert.equal(restoredStructured.names[1], "", "Non-string Player 2 name must be clamped to empty string");
    assert.equal(restoredStructured.soundVolume, 1, "Sound volume clamped to 1");
    assert.equal(restoredStructured.dailyRitual.streak, 0, "Negative streak clamped to 0");
    assert.equal(restoredStructured.dailyRitual.lastDate, "2026-10-13", "Date string clamped to 10 chars");
    assert.equal(restoredStructured.dailyRitual.answers["int_1"], 10, "Slider rating clamped to 10");
    assert.equal(restoredStructured.dailyRitual.answers["text_q"].length, 600, "Text response clamped to 600 chars");

    // 2. Direct state backup import with tampered ambientMix
    const rawStateWithTamperedMix = {
      version: 2,
      names: ["Robin", "Terry"],
      ambientMix: { synth: -42, rain: 100, hearth: NaN }
    };
    const importedRaw = backupToState(rawStateWithTamperedMix);
    storageMap.set("aligned-state-v1", JSON.stringify(importedRaw));
    const restoredRaw = loadState();
    assert.equal(restoredRaw.ambientMix.synth, 0, "Raw backup negative synth volume clamped to 0");
    assert.equal(restoredRaw.ambientMix.rain, 1, "Raw backup excessive rain volume clamped to 1");
    assert.equal(restoredRaw.ambientMix.hearth, 0, "Raw backup NaN hearth volume clamped to 0");
  });
});