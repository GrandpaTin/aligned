import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import crypto from "node:crypto";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract helper functions and components from index.html
const escapeHTMLMatch = html.match(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/);
assert(escapeHTMLMatch, "Could not locate escapeHTML in index.html");
const escapeHTML = vm.runInNewContext(`(${escapeHTMLMatch[0]})`);

const bytesToBase64Match = html.match(/function bytesToBase64\(bytes\) \{[\s\S]*?\n    \}/);
assert(bytesToBase64Match, "Could not locate bytesToBase64 in index.html");
const bytesToBase64 = vm.runInNewContext(`(${bytesToBase64Match[0]})`, {
  btoa: (str) => Buffer.from(str, "binary").toString("base64")
});

const base64ToBytesMatch = html.match(/function base64ToBytes\(value\) \{[\s\S]*?\n    \}/);
assert(base64ToBytesMatch, "Could not locate base64ToBytes in index.html");
const base64ToBytes = vm.runInNewContext(`(${base64ToBytesMatch[0]})`);

const hashPinMatch = html.match(/async function hashPin\(pin\) \{[\s\S]*?\n    \}/);
assert(hashPinMatch, "Could not locate hashPin in index.html");

const deriveBackupKeyMatch = html.match(/async function deriveBackupKey\(passphrase, salt\) \{[\s\S]*?\n    \}/);
assert(deriveBackupKeyMatch, "Could not locate deriveBackupKey in index.html");

const snapshotMatch = html.match(/function createCompletedRoundSnapshot\(\) \{[\s\S]*?\n    \}/);
assert(snapshotMatch, "Could not locate createCompletedRoundSnapshot in index.html");

const nearbyPlayerPayloadMatch = html.match(/function nearbyPlayerPayload\(player = state\.activePlayer\) \{[\s\S]*?\n    \}/);
assert(nearbyPlayerPayloadMatch, "Could not locate nearbyPlayerPayload in index.html");

const savedAnswersMatch = html.match(/function savedQuestionAnswersMarkup\(question, round\) \{[\s\S]*?\n    \}/);
assert(savedAnswersMatch, "Could not locate savedQuestionAnswersMarkup in index.html");

describe("Privacy Shield & Confidential Reflections Test Suite", () => {
  it("shields private reflections by keeping the container empty in template markup until unlocked", () => {
    const openPrivateReflectionsSource = html.match(/function openPrivateReflections\(roundId, playerIndex\) \{[\s\S]*?\n    \}/)?.[0];
    assert(openPrivateReflectionsSource, "Could not locate openPrivateReflections in index.html");
    
    // Must contain <div id="private-note-content" hidden></div> with no inner HTML
    assert(
      openPrivateReflectionsSource.includes('<div id="private-note-content" hidden></div>'),
      "Initial template must render empty #private-note-content to protect against DOM queries and screen reader traversal"
    );
    
    // Verify note injection is deferred to unlock handler
    assert(
      openPrivateReflectionsSource.includes('noteContainer.innerHTML =') || openPrivateReflectionsSource.includes('contentContainer.innerHTML ='),
      "Private reflections must be injected dynamically into DOM only after unlock"
    );
  });

  it("never includes private notes in shared reveal board markup", () => {
    const savedQuestionAnswersMarkup = vm.runInNewContext(`(${savedAnswersMatch[0]})`, {
      state: { visualTheme: "midnight" },
      escapeHTML,
      formatRoundDate: () => "Oct 13, 2026",
      pickLabel: (q, v) => `${v} / 10`
    });

    const mockQuestion = {
      id: "sec_test_1",
      prompt: "What is your biggest unspoken fear?",
      type: "text",
      topic: "connection"
    };

    const mockRound = {
      completedAt: "2026-10-13T09:00:00.000Z",
      answers: [
        { sec_test_1: "Fear of heights" },
        { sec_test_1: "Fear of failure" }
      ],
      comments: [
        { sec_test_1: "Shared comment 1" },
        { sec_test_1: "Shared comment 2" }
      ],
      privateNotes: [
        { sec_test_1: "SUPER_SECRET_NOTE_PLAYER_0" },
        { sec_test_1: "SUPER_SECRET_NOTE_PLAYER_1" }
      ],
      names: ["Alex", "Jordan"]
    };

    const markup = savedQuestionAnswersMarkup(mockQuestion, mockRound);
    assert(!markup.includes("SUPER_SECRET_NOTE_PLAYER_0"), "Shared markup must not contain Player 0's private reflection");
    assert(!markup.includes("SUPER_SECRET_NOTE_PLAYER_1"), "Shared markup must not contain Player 1's private reflection");
    assert(markup.includes("Fear of heights"), "Shared markup must include answered text");
  });

  it("hashes device PINs deterministically with SHA-256 and prefix namespace", async () => {
    const context = {
      window: {
        crypto: {
          subtle: crypto.webcrypto.subtle
        }
      },
      crypto: crypto.webcrypto,
      TextEncoder,
      Uint8Array,
      btoa: (str) => Buffer.from(str, "binary").toString("base64"),
      bytesToBase64
    };

    const hashPin = vm.runInNewContext(`(${hashPinMatch[0]})`, context);
    const pin = "1234";
    const digestB64 = await hashPin(pin);

    // Compute expected base64 of SHA-256 over `awc-private-notes:${pin}`
    const rawExpected = crypto.createHash("sha256").update(Buffer.from(`awc-private-notes:${pin}`, "utf8")).digest("base64");
    assert.equal(digestB64, rawExpected, "PIN hash must match base64 SHA-256 over namespace-prefixed PIN");

    // Different PIN produces different hash
    const otherDigest = await hashPin("4321");
    assert.notEqual(digestB64, otherDigest, "Different PINs must generate unique non-colliding hashes");
  });

  it("falls back to deterministic FNV-like hash when crypto.subtle is unavailable", async () => {
    const contextWithoutCrypto = {
      window: {},
      Math
    };

    const hashPinFallback = vm.runInNewContext(`(${hashPinMatch[0]})`, contextWithoutCrypto);
    const hashA = await hashPinFallback("5678");
    const hashB = await hashPinFallback("5678");
    const hashC = await hashPinFallback("8765");

    assert.equal(hashA, hashB, "Fallback hash must be deterministic");
    assert(hashA.startsWith("local-"), "Fallback hash must have local- prefix");
    assert.notEqual(hashA, hashC, "Fallback hash must differentiate different inputs");
  });

  it("derives strong AES-GCM keys with PBKDF2 (250,000 iterations, SHA-256)", async () => {
    const passphrase = "test-secret-passphrase-2026";
    const salt = crypto.randomBytes(16);

    const context = {
      crypto: crypto.webcrypto,
      TextEncoder
    };

    const deriveBackupKey = vm.runInNewContext(`(${deriveBackupKeyMatch[0]})`, context);
    const key = await deriveBackupKey(passphrase, new Uint8Array(salt));
    assert(key, "Key derivation must return a CryptoKey");
    assert.equal(key.algorithm.name, "AES-GCM", "Derived key must target AES-GCM");

    // Encrypt test payload
    const iv = crypto.randomBytes(12);
    const plaintext = Buffer.from(JSON.stringify({ secret: "private notes payload" }), "utf8");
    const ciphertext = await crypto.webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      plaintext
    );

    // Decrypt with correct key
    const decrypted = await crypto.webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      ciphertext
    );
    const result = JSON.parse(new TextDecoder().decode(decrypted));
    assert.equal(result.secret, "private notes payload", "Decrypted payload must match original");

    // Decrypt with wrong passphrase fails
    const wrongKey = await deriveBackupKey("wrong-passphrase", new Uint8Array(salt));
    await assert.rejects(
      async () => {
        await crypto.webcrypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(iv) },
          wrongKey,
          ciphertext
        );
      },
      "Decryption with incorrect passphrase must be rejected"
    );
  });

  it("creates completed round snapshot with deep-copied private notes to prevent mutation leakage", () => {
    const state = {
      sessionPreset: "classic",
      names: ["Taylor", "Morgan"],
      selectedTopics: ["growth", "connection"],
      selectedQuestionIds: ["q1", "q2"],
      questionIntensity: "warm",
      textRatings: {},
      conversationStatus: {},
      sharedIntentions: [],
      answers: [
        { q1: 4, q2: "First text" },
        { q1: 4, q2: "Second text" }
      ],
      comments: [
        { q1: "Comment 1" },
        { q1: "Comment 2" }
      ],
      privateNotes: [
        { q1: "Private insight for Taylor", q2: "Taylor's secret reflection" },
        { q1: "Private insight for Morgan", q2: "Morgan's secret reflection" }
      ],
      importance: [
        { q1: 2 },
        { q1: 2 }
      ],
      notReady: [{}, {}],
      completedRounds: []
    };

    const calculateAlignmentSummary = () => ({ overall: 92, topics: [] });
    const getSelectedQuestions = () => [
      { id: "q1", prompt: "Prompt 1", type: "slider" },
      { id: "q2", prompt: "Prompt 2", type: "text" }
    ];
    const randomIndex = () => 12345;

    const createCompletedRoundSnapshot = vm.runInNewContext(`(${snapshotMatch[0]})`, {
      state,
      calculateAlignmentSummary,
      // Snapshots now store each round's Mind-Reader hits; the tally itself is covered in state-persist.test.mjs.
      mindReaderTally: () => [{ player: 0, made: 0, hits: 0 }, { player: 1, made: 0, hits: 0 }],
      getSelectedQuestions,
      randomIndex,
      Date,
      Set,
      Object,
      JSON
    });

    const snapshot = createCompletedRoundSnapshot();
    assert(snapshot.id, "Snapshot must have unique round ID");
    assert.deepEqual(Array.from(snapshot.names), ["Taylor", "Morgan"]);
    assert.equal(snapshot.privateNotes[0].q1, "Private insight for Taylor");
    assert.equal(snapshot.privateNotes[1].q1, "Private insight for Morgan");

    // Mutate state after snapshot creation
    state.privateNotes[0].q1 = "MUTATED_VALUE";
    state.privateNotes[1].q1 = "MUTATED_VALUE_2";
    state.answers[0].q1 = 999;

    // Snapshot must remain completely unchanged
    assert.equal(snapshot.privateNotes[0].q1, "Private insight for Taylor", "Snapshot privateNotes must be isolated from later state mutations");
    assert.equal(snapshot.privateNotes[1].q1, "Private insight for Morgan", "Snapshot privateNotes must be isolated from later state mutations");
    assert.equal(snapshot.answers[0].q1, 4, "Snapshot answers must be isolated from state mutations");
  });

  it("strictly excludes private notes from WebRTC nearby network sync payloads", () => {
    const state = {
      activePlayer: 0,
      nearbyRoundId: "round-test-123",
      answers: [
        { q1: 5 },
        { q1: 3 }
      ],
      guesses: [{}, {}],
      comments: [
        { q1: "Public note" },
        { q1: "Public partner note" }
      ],
      privateNotes: [
        { q1: "PRIVATE_NOTE_NEVER_SEND_OVER_WIRE" },
        { q1: "PARTNER_PRIVATE_NOTE" }
      ],
      importance: [
        { q1: 2 },
        { q1: 1 }
      ],
      notReady: [{}, {}]
    };

    const nearbyPlayerPayload = vm.runInNewContext(`(${nearbyPlayerPayloadMatch[0]})`, {
      state
    });

    const payload0 = nearbyPlayerPayload(0);
    assert.equal(payload0.type, "player-complete");
    assert.equal(payload0.roundId, "round-test-123");
    assert(payload0.answers, "Payload must include answers");
    assert(payload0.comments, "Payload must include comments");
    assert(payload0.importance, "Payload must include importance");
    assert(!("privateNotes" in payload0), "Payload MUST NOT contain privateNotes key");
    assert(!JSON.stringify(payload0).includes("PRIVATE_NOTE_NEVER_SEND_OVER_WIRE"), "Serialized payload must never leak private reflection strings");

    const payload1 = nearbyPlayerPayload(1);
    assert(!("privateNotes" in payload1), "Player 1 payload MUST NOT contain privateNotes key");
    assert(!JSON.stringify(payload1).includes("PARTNER_PRIVATE_NOTE"), "Player 1 private notes must never leak over wire");
  });
});
