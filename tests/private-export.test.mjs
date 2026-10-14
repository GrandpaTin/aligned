import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import crypto from "node:crypto";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const grab = (re, name) => {
  const match = html.match(re);
  assert(match, `Could not locate ${name} in index.html`);
  return match[0];
};

const sources = [
  grab(/function createBackupPayload\(\) \{[\s\S]*?\n    \}(?=\n\n    function backupToState)/, "createBackupPayload"),
  grab(/function backupToState\(payload\) \{[\s\S]*?\n    \}(?=\n\n    function exportBackup)/, "backupToState"),
  grab(/function roundHandOffPending\(\) \{[\s\S]*?\n    \}/, "roundHandOffPending"),
  grab(/function unreadablePinHashes\(keys\) \{[\s\S]*?\n    \}/, "unreadablePinHashes"),
  grab(/function savedQuestionAnswersMarkup\(question, round\) \{[\s\S]*?\n    \}/, "savedQuestionAnswersMarkup"),
  grab(/function readableBackupPayload\(\) \{[\s\S]*?\n    \}/, "readableBackupPayload"),
  grab(/function keepLocalPrivateNotes\(importedState\) \{[\s\S]*?\n    \}/, "keepLocalPrivateNotes"),
  grab(/function bytesToBase64\(bytes\) \{[\s\S]*?\n    \}/, "bytesToBase64"),
  grab(/function base64ToBytes\(value\) \{[\s\S]*?\n    \}/, "base64ToBytes"),
  grab(/async function hashPin\(pin\) \{[\s\S]*?\n    \}/, "hashPin"),
  grab(/const PIN_KDF_ITER = \d+;/, "PIN_KDF_ITER"),
  grab(/async function derivePinHash\(pin, salt, iterations\) \{[\s\S]*?\n    \}/, "derivePinHash"),
  grab(/async function createPinHash\(pin\) \{[\s\S]*?\n    \}/, "createPinHash"),
  grab(/function legacyLocalPinHash\(pin\) \{[\s\S]*?\n    \}/, "legacyLocalPinHash"),
  grab(/async function verifyPin\(pin, storedOverride\) \{[\s\S]*?\n    \}/, "verifyPin")
].join("\n\n");

function makeContext(state, { withCrypto = true } = {}) {
  const context = {
    state,
    saves: 0,
    BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"]),
    TextEncoder,
    Uint8Array,
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    atob: (str) => Buffer.from(str, "base64").toString("binary"),
    window: withCrypto ? { crypto: crypto.webcrypto } : {},
    crypto: crypto.webcrypto,
    storage: {},
    escapeHTML: (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    formatRoundDate: (value) => String(value || ""),
    pickLabel: () => ""
  };
  context.localStorage = { getItem: (key) => (key in context.storage ? context.storage[key] : null) };
  context.saveState = () => { context.saves += 1; };
  vm.createContext(context);
  vm.runInContext(`${sources}\nthis.api = { createBackupPayload, backupToState, readableBackupPayload, keepLocalPrivateNotes, hashPin, createPinHash, verifyPin, legacyLocalPinHash, roundHandOffPending, unreadablePinHashes, savedQuestionAnswersMarkup };`, context);
  return context;
}

function sampleState() {
  return {
    names: ["Ana", "Ben"], questionMode: "mixed", sessionPreset: "custom", playStyle: "pass-and-play", questionCount: 1,
    questionIntensity: "curious", selectedTopics: ["connection"], soundEnabled: true, soundTheme: "cute", soundVolume: 0.8,
    ambientMusicEnabled: false, hapticsEnabled: true, visualTheme: "midnight", textSize: "normal", highContrast: false,
    reducedMotion: false, privatePinHash: "p2$1$AAAA$BBBB", tutorialSeen: true, answeredQuestionIds: ["q1"], excludedQuestionIds: [],
    neverQuestionIds: [], favoriteQuestionIds: [], questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [],
    customPacks: [],
    completedRounds: [{ id: "r1", date: "2026-10-01", names: ["Ana", "Ben"], questionIds: ["q1"], answers: [{ q1: "Yes" }, { q1: "No" }], privateNotes: [{ q1: "Ana secret" }, { q1: "Ben secret" }] }],
    screen: "question", selectedQuestionIds: ["q1"], activePlayer: 0, questionIndex: 0, answers: [{ q1: "Yes" }, {}], comments: [{}, {}],
    privateNotes: [{ q1: "Current secret" }, {}], importance: [{}, {}], notReady: [{}, {}], textRatings: {}, conversationStatus: {},
    sharedIntentions: [], resumeScreen: null, revealedIds: [], completedPlayers: [false, false], guesses: [{}, {}], seenIds: [],
    revealCelebrated: "", textRatingTimes: {}, conversationTimes: {}, cardPrompts: {}
  };
}

describe("Readable backup privacy (A-04)", () => {
  it("leaves private notes and the PIN hash out of the readable export", () => {
    const { api } = makeContext(sampleState());
    const text = JSON.stringify(api.readableBackupPayload());
    assert(!text.includes("secret"), "Readable backup must not contain private reflections");
    assert(!text.includes("p2$"), "Readable backup must not contain the PIN hash");
    const payload = JSON.parse(text);
    assert.equal(payload.privateReflectionsIncluded, false);
    assert.equal(payload.history.completedRounds[0].answers[1].q1, "No", "Shared answers stay in the readable backup");
  });

  it("keeps the full payload (used by the encrypted backup) lossless", () => {
    const { api } = makeContext(sampleState());
    const full = api.createBackupPayload();
    assert.equal(full.history.completedRounds[0].privateNotes[0].q1, "Ana secret");
    assert.equal(full.settings.privatePinHash, "p2$1$AAAA$BBBB");
  });

  it("does not mutate live state while stripping", () => {
    const state = sampleState();
    const { api } = makeContext(state);
    api.readableBackupPayload();
    assert.equal(state.completedRounds[0].privateNotes[0].q1, "Ana secret");
    assert.equal(state.privateNotes[0].q1, "Current secret");
  });

  it("imports a readable backup through backupToState with safe defaults", () => {
    const { api } = makeContext(sampleState());
    const restored = api.backupToState(JSON.parse(JSON.stringify(api.readableBackupPayload())));
    assert.equal(restored.privatePinHash, "");
    assert.equal(restored.completedRounds.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.privateNotes)), [{}, {}]);
  });
});

describe("Restoring a readable backup keeps this device's notes", () => {
  it("carries local notes into matching rounds and the same game, and keeps the PIN", () => {
    const state = sampleState();
    const { api } = makeContext(state);
    const payload = JSON.parse(JSON.stringify(api.readableBackupPayload()));
    payload.history.completedRounds.push({ id: "other", names: ["A", "B"], questionIds: ["q2"], answers: [{}, {}], privateNotes: [{}, {}] });
    const restored = api.keepLocalPrivateNotes(api.backupToState(payload));
    assert.equal(restored.completedRounds[0].privateNotes[0].q1, "Ana secret");
    assert.equal(restored.completedRounds[0].privateNotes[1].q1, "Ben secret");
    assert.deepEqual(JSON.parse(JSON.stringify(restored.completedRounds[1].privateNotes)), [{}, {}], "Unmatched rounds stay empty");
    assert.equal(restored.privateNotes[0].q1, "Current secret");
    assert.equal(restored.privatePinHash, "p2$1$AAAA$BBBB");
    restored.completedRounds[0].privateNotes[0].q1 = "changed";
    assert.equal(state.completedRounds[0].privateNotes[0].q1, "Ana secret", "Live state must not be aliased");
  });

  it("does not copy the current game's notes into a different game", () => {
    const state = sampleState();
    const { api } = makeContext(state);
    const payload = JSON.parse(JSON.stringify(api.readableBackupPayload()));
    payload.currentGame.selectedQuestionIds = ["q9"];
    const restored = api.keepLocalPrivateNotes(api.backupToState(payload));
    assert.deepEqual(JSON.parse(JSON.stringify(restored.privateNotes)), [{}, {}]);
  });
});

describe("Salted PIN hashing (A-54)", () => {
  it("creates salted hashes that verify and differ per call", async () => {
    const state = sampleState();
    const ctx = makeContext(state);
    const first = await ctx.api.createPinHash("4821");
    const second = await ctx.api.createPinHash("4821");
    assert.match(first, /^p2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.notEqual(first, second, "Each PIN hash must use its own salt");
    state.privatePinHash = first;
    assert.equal(await ctx.api.verifyPin("4821"), true);
    assert.equal(await ctx.api.verifyPin("4822"), false);
    assert.equal(ctx.saves, 0, "Verifying a current-format hash must not rewrite it");
  });

  it("still verifies a legacy SHA-256 hash and upgrades it on success", async () => {
    const state = sampleState();
    const ctx = makeContext(state);
    state.privatePinHash = await ctx.api.hashPin("1234");
    assert.equal(await ctx.api.verifyPin("9999"), false);
    assert.equal(state.privatePinHash.startsWith("p2$"), false, "A wrong PIN must not migrate");
    assert.equal(await ctx.api.verifyPin("1234"), true);
    assert(state.privatePinHash.startsWith("p2$"), "A correct legacy PIN must migrate to the salted format");
    assert.equal(ctx.saves, 1);
    assert.equal(await ctx.api.verifyPin("1234"), true, "The migrated hash must verify");
  });

  it("still verifies a legacy local- fallback hash once crypto is available", async () => {
    const state = sampleState();
    const noCrypto = makeContext(sampleState(), { withCrypto: false });
    state.privatePinHash = await noCrypto.api.hashPin("5678");
    assert(state.privatePinHash.startsWith("local-"));
    const ctx = makeContext(state);
    assert.equal(await ctx.api.verifyPin("5678"), true);
    assert(state.privatePinHash.startsWith("p2$"));
  });

  it("rejects malformed salted hashes instead of throwing", async () => {
    const state = sampleState();
    const ctx = makeContext(state);
    for (const bad of ["p2$", "p2$abc$AAAA$BBBB", "p2$0$AAAA$BBBB", "p2$250000$!!$BBBB"]) {
      state.privatePinHash = bad;
      assert.equal(await ctx.api.verifyPin("1234"), false, bad);
    }
  });
});

describe("Import cannot replace the device PIN (A-01)", () => {
  it("keeps the local PIN when a hand-edited readable file carries its own hash", () => {
    const state = sampleState();
    const { api } = makeContext(state);
    const payload = JSON.parse(JSON.stringify(api.readableBackupPayload()));
    payload.settings.privatePinHash = api.legacyLocalPinHash("0000");
    const restored = api.keepLocalPrivateNotes(api.backupToState(payload));
    assert.equal(restored.completedRounds[0].privateNotes[0].q1, "Ana secret", "Notes are still carried over");
    assert.equal(restored.privatePinHash, "p2$1$AAAA$BBBB", "The device PIN must survive");
  });

  it("drops a forged hash when the device has no PIN", () => {
    const state = sampleState();
    state.privatePinHash = "";
    const { api } = makeContext(state);
    const payload = JSON.parse(JSON.stringify(api.readableBackupPayload()));
    payload.settings.privatePinHash = api.legacyLocalPinHash("0000");
    const restored = api.keepLocalPrivateNotes(api.backupToState(payload));
    assert.equal(restored.privatePinHash, "");
  });
});

describe("Readable export mid hand-off (A-02)", () => {
  function handOffState() {
    const state = sampleState();
    state.screen = "intermission";
    state.completedPlayers = [true, false];
    state.answers = [{ q1: "I resent your mother" }, {}];
    state.comments = [{ q1: "P1 comment" }, {}];
    state.guesses = [{ q1: "P1 guess" }, {}];
    state.importance = [{ q1: 3 }, {}];
    return state;
  }

  it("leaves out the round in progress so locked answers stay hidden", () => {
    const { api } = makeContext(handOffState());
    assert.equal(api.roundHandOffPending(), true);
    const payload = api.readableBackupPayload();
    const text = JSON.stringify(payload);
    for (const leak of ["I resent", "P1 comment", "P1 guess"]) assert(!text.includes(leak), leak);
    assert.equal(payload.currentRoundOmitted, true);
    assert.equal(payload.history.completedRounds[0].answers[1].q1, "No", "History stays in the backup");
    const restored = api.backupToState(JSON.parse(text));
    assert.deepEqual(JSON.parse(JSON.stringify(restored.completedPlayers)), [false, false], "No locked-but-empty player on restore");
    assert.equal(restored.selectedQuestionIds.length, 0);
  });

  it("keeps the current round when nobody or both players have finished", () => {
    for (const done of [[false, false], [true, true]]) {
      const state = handOffState();
      state.completedPlayers = done;
      const { api } = makeContext(state);
      assert.equal(api.roundHandOffPending(), false);
      const payload = api.readableBackupPayload();
      assert.equal(payload.currentGame.answers[0].q1, "I resent your mother");
      assert.equal(payload.currentRoundOmitted, undefined);
    }
  });
});

describe("Held cards in the Library (A-33)", () => {
  it("hides both answers and comments for a held card", () => {
    const { api } = makeContext(sampleState());
    const round = { completedAt: "2026-10-01", names: ["Ana", "Ben"], answers: [{ q9: 2 }, {}], comments: [{}, { q9: "BEN'S HELD CONTEXT" }], notReady: [{}, { q9: true }] };
    const html = api.savedQuestionAnswersMarkup({ id: "q9", type: "slider" }, round);
    assert(html.includes("Held privately"));
    assert(!html.includes("HELD CONTEXT"));
    assert(!html.includes("2 / 10"));
    const open = api.savedQuestionAnswersMarkup({ id: "q9", type: "slider" }, { ...round, notReady: [{}, {}] });
    assert(open.includes("2 / 10"), "Unheld cards still show answers");
  });
});

describe("Unreadable save PIN gate (A-55)", () => {
  it("finds the PIN hash inside an unparseable blob and verifies it without touching state", async () => {
    const state = sampleState();
    state.privatePinHash = "";
    const ctx = makeContext(state);
    const hash = await ctx.api.createPinHash("2468");
    ctx.storage["k1"] = `{"settings":{"privatePinHash":"${hash}"},"broken`;
    ctx.storage["k2"] = "not json at all";
    const hashes = ctx.api.unreadablePinHashes(["k1", "k2"]);
    assert.deepEqual([...hashes], [hash]);
    assert.equal(await ctx.api.verifyPin("2468", hash), true);
    assert.equal(await ctx.api.verifyPin("1111", hash), false);
    const legacy = ctx.api.legacyLocalPinHash("2468");
    assert.equal(await ctx.api.verifyPin("2468", legacy), true);
    assert.equal(state.privatePinHash, "", "Checking an external hash must not plant it on the current state");
    assert.equal(ctx.saves, 0);
  });
});
