import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const grab = (re, name) => {
  const match = html.match(re);
  assert(match, `Could not locate ${name} in index.html`);
  return match[0];
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const backupSources = [
  grab(/const RELATIONSHIP_PROFILES = \[[\s\S]*?\n    \];/, "RELATIONSHIP_PROFILES"),
  grab(/function createBackupPayload\(\) \{[\s\S]*?\n    \}(?=\n\n    function backupToState)/, "createBackupPayload"),
  grab(/function backupToState\(payload\) \{[\s\S]*?\n    \}(?=\n\n    function exportBackup)/, "backupToState"),
  grab(/function roundHandOffPending\(\) \{[\s\S]*?\n    \}/, "roundHandOffPending"),
  grab(/function readableBackupPayload\(\) \{[\s\S]*?\n    \}/, "readableBackupPayload"),
  grab(/function keepLocalVoiceNotes\(importedState, payload\) \{[\s\S]*?\n    \}/, "keepLocalVoiceNotes")
].join("\n\n");

function backupApi(state) {
  const context = { state, BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"]) };
  vm.createContext(context);
  vm.runInContext(`${backupSources}\nthis.api = { createBackupPayload, backupToState, readableBackupPayload, keepLocalVoiceNotes };`, context);
  return context.api;
}

function sampleState(extra = {}) {
  return {
    names: ["Ana", "Ben"], questionMode: "mixed", sessionPreset: "custom", playStyle: "pass-and-play", questionCount: 1,
    questionIntensity: "curious", selectedTopics: ["connection"], soundEnabled: true, soundTheme: "cute", soundVolume: 0.8,
    ambientMusicEnabled: false, hapticsEnabled: true, visualTheme: "midnight", textSize: "normal", highContrast: false,
    reducedMotion: false, privatePinHash: "", tutorialSeen: true, answeredQuestionIds: [], excludedQuestionIds: [],
    neverQuestionIds: [], favoriteQuestionIds: [], questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [],
    customPacks: [], completedRounds: [], screen: "reveal", selectedQuestionIds: ["q1"], activePlayer: 0, questionIndex: 0,
    answers: [{ q1: 5 }, { q1: 6 }], comments: [{}, {}], privateNotes: [{}, {}], importance: [{}, {}], notReady: [{}, {}],
    textRatings: {}, conversationStatus: {}, sharedIntentions: [], resumeScreen: null, revealedIds: [], completedPlayers: [true, true],
    guesses: [{}, {}], seenIds: [], revealCelebrated: "", textRatingTimes: {}, conversationTimes: {}, cardPrompts: {},
    relationshipProfile: "roommates",
    voiceNotes: { q1: "data:audio/webm;base64,AAA", bad: "javascript:alert(1)" },
    wildcards: ["q1", null],
    cardWagers: { q1: "match", q2: "nonsense" },
    whileYouWait: { sync: "a", answered: true },
    ...extra
  };
}

describe("Backup round trip keeps voice memories, wagers, wildcards and the profile (A-04)", () => {
  it("restores them from the full (encrypted) payload", () => {
    const api = backupApi(sampleState());
    const restored = plain(api.backupToState(plain(api.createBackupPayload())));
    assert.deepEqual(restored.voiceNotes, { q1: "data:audio/webm;base64,AAA" }, "Only data:audio/ recordings survive");
    assert.deepEqual(restored.wildcards, ["q1", null]);
    assert.deepEqual(restored.cardWagers, { q1: "match" });
    assert.deepEqual(restored.whileYouWait, { sync: "a", answered: true });
    assert.equal(restored.relationshipProfile, "roommates");
  });

  it("keeps every relationship profile and falls back for unknown ones", () => {
    for (const id of ["romantic", "friends", "roommates", "collaborators"]) {
      const api = backupApi(sampleState({ relationshipProfile: id }));
      assert.equal(api.backupToState(plain(api.createBackupPayload())).relationshipProfile, id);
    }
    const api = backupApi(sampleState({ relationshipProfile: "spicy" }));
    assert.equal(api.backupToState(plain(api.createBackupPayload())).relationshipProfile, "romantic");
  });

  it("gives older backups without the new fields safe defaults", () => {
    const api = backupApi(sampleState());
    const payload = plain(api.createBackupPayload());
    delete payload.voiceNotes;
    delete payload.currentGame.wildcards;
    delete payload.currentGame.cardWagers;
    delete payload.currentGame.whileYouWait;
    const restored = plain(api.backupToState(payload));
    assert.deepEqual(restored.voiceNotes, {});
    assert.deepEqual(restored.wildcards, [null, null]);
    assert.deepEqual(restored.cardWagers, {});
    assert.deepEqual(restored.whileYouWait, {});
  });

  it("leaves recordings out of the readable file, and restoring it keeps this phone's", () => {
    const state = sampleState();
    const api = backupApi(state);
    const payload = plain(api.readableBackupPayload());
    assert(!JSON.stringify(payload).includes("data:audio/"), "Readable backup must not carry recordings");
    assert.equal(payload.voiceNotesIncluded, false);
    const restored = api.keepLocalVoiceNotes(api.backupToState(payload), payload);
    assert.deepEqual(plain(restored.voiceNotes), plain(state.voiceNotes));
  });

  it("lets an encrypted backup's recordings replace this phone's", () => {
    const api = backupApi(sampleState({ voiceNotes: { q9: "data:audio/mp4;base64,BBB" } }));
    const other = backupApi(sampleState());
    const payload = plain(other.createBackupPayload());
    const restored = api.keepLocalVoiceNotes(api.backupToState(payload), payload);
    assert.deepEqual(plain(restored.voiceNotes), { q1: "data:audio/webm;base64,AAA" });
  });

  it("lets a full backup with no recordings replace this phone's, but keeps them for one from before the field", () => {
    const api = backupApi(sampleState({ voiceNotes: { q9: "data:audio/mp4;base64,BBB" } }));
    const other = backupApi(sampleState({ voiceNotes: {} }));
    const payload = plain(other.createBackupPayload());
    assert.deepEqual(plain(api.keepLocalVoiceNotes(api.backupToState(payload), payload).voiceNotes), {});
    delete payload.voiceNotes;
    assert.deepEqual(plain(api.keepLocalVoiceNotes(api.backupToState(payload), payload).voiceNotes), { q9: "data:audio/mp4;base64,BBB" });
  });

  it("never lets a quota retry drop recordings kept from this phone", () => {
    const handler = grab(/const backupVoice = importedState\.voiceNotes;[\s\S]*?voiceLeftOut = true;/, "import quota retry");
    assert.match(handler, /const voiceFromBackup = importedState\.voiceNotes === backupVoice;/);
    assert.match(handler, /if \(!voiceFromBackup \|\| !Object\.keys\(importedState\.voiceNotes \|\| \{\}\)\.length\) throw quotaError;/);
  });
});

function quotaStorage(limit) {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      if (String(value).length > limit) { const err = new Error("quota exceeded"); err.name = "QuotaExceededError"; throw err; }
      store.set(key, String(value));
    },
    removeItem: (key) => store.delete(key)
  };
}

const storedSource = grab(/function storedStateJSON\(\) \{[\s\S]*?\n    \}(?=\n\n    function loadState)/, "storedStateJSON");
const saveSource = grab(/function saveState\(\) \{[\s\S]*?\n    \}/, "saveState");

function legacyContext(storage) {
  const context = {
    STORAGE_KEY: "aligned-state-v1",
    LEGACY_STORAGE_KEYS: ["are-we-compatible-state-v1"],
    localStorage: storage,
    state: { version: 2, names: ["A", "B"], revealedIds: [] },
    tabSyncChannel: null
  };
  vm.createContext(context);
  vm.runInContext(`${storedSource}\n${saveSource}\nthis.api = { storedStateJSON, saveState };`, context);
  return context.api;
}

describe("Legacy save migration never loses the old save (A-32)", () => {
  it("returns the legacy save even when copying it hits the quota, and saveState keeps it", () => {
    const legacy = JSON.stringify({ version: 2, names: ["Old", "Save"], pad: "x".repeat(500) });
    const storage = quotaStorage(400);
    storage.store.set("are-we-compatible-state-v1", legacy);
    const api = legacyContext(storage);
    assert.equal(api.storedStateJSON(), legacy);
    assert.equal(api.storedStateJSON.legacyPending, true);
    api.saveState();
    assert.equal(storage.getItem("are-we-compatible-state-v1"), legacy, "Legacy save must survive until it is loaded");
    api.storedStateJSON.legacyPending = false;
    assert.equal(api.saveState(), true);
    assert.equal(storage.getItem("are-we-compatible-state-v1"), null, "Once loaded, the legacy key is released");
  });

  it("returns a malformed legacy save without writing it to the new key", () => {
    const storage = quotaStorage(1e6);
    storage.store.set("are-we-compatible-state-v1", "{broken");
    const api = legacyContext(storage);
    assert.equal(api.storedStateJSON(), "{broken");
    assert.equal(storage.getItem("aligned-state-v1"), null);
    api.saveState();
    assert.equal(storage.getItem("are-we-compatible-state-v1"), "{broken");
  });
});

describe("Guess slider debounces its saves (A-54)", () => {
  it("schedules on input and flushes when the gesture ends", () => {
    const block = grab(/guessInput\?\.addEventListener\("input", \(\) => \{[\s\S]*?\n      \}\);\n[^\n]*\n[^\n]*\n/, "guess input handler");
    assert.match(block, /scheduleSaveState\(\);\n      \}\);/);
    assert.doesNotMatch(block, /\n        saveState\(\);/);
    assert.match(block, /\["change", "pointerup"\]\.forEach\(\(type\) => guessInput\?\.addEventListener\(type, flushScheduledSave\)\);/);
  });
});
