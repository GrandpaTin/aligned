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

// Extract saveState from index.html
const saveStateMatch = html.match(/function saveState\(\) \{[\s\S]*?\n    \}/);
assert(saveStateMatch, "Could not locate saveState in index.html");

describe("LocalStorage Quota Exceeded & Storage Failure Recovery", () => {
  let mockStorage;
  let quotaTriggered;
  let maxStorageChars;
  let vmContext;

  beforeEach(() => {
    quotaTriggered = false;
    maxStorageChars = 10000; // Simulating small quota for test
    const store = new Map();

    mockStorage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => {
        const valStr = String(value);
        if (valStr.length > maxStorageChars) {
          quotaTriggered = true;
          const err = new Error("The quota has been exceeded.");
          err.name = "QuotaExceededError";
          err.code = 22;
          throw err;
        }
        store.set(key, valStr);
      },
      removeItem: (key) => store.delete(key),
      clear: () => store.clear()
    };

    vmContext = {
      STORAGE_KEY: "aligned-state-v1",
      LEGACY_STORAGE_KEYS: ["are-we-compatible-state-v1"],
      localStorage: mockStorage,
      state: {
        version: 2,
        names: ["Alex", "Jordan"],
        screen: "question",
        selectedQuestionIds: ["int_1", "int_2"],
        answers: [{ int_1: 8 }, {}],
        completedRounds: []
      }
    };
  });

  it("absorbs QuotaExceededError without crashing and preserves state in memory", () => {
    // Force quota exceeded error by lowering max storage limit
    maxStorageChars = 50;

    const saveStateFn = vm.runInNewContext(`(${saveStateMatch[0]})`, vmContext);

    // Call saveState; must NOT throw an uncaught exception
    assert.doesNotThrow(() => {
      saveStateFn();
    }, "saveState must safely catch and absorb QuotaExceededError");

    assert.equal(quotaTriggered, true, "Quota error must have been triggered");

    // In-memory state must remain completely intact
    assert.deepEqual(vmContext.state.names, ["Alex", "Jordan"]);
    assert.equal(vmContext.state.screen, "question");
    assert.equal(vmContext.state.answers[0].int_1, 8);
    assert.equal(mockStorage.getItem("aligned-state-v1"), null, "Failed write must not leave corrupted partial data");
  });

  it("recovers via defensive pruning of oldest completed rounds when payload exceeds quota", () => {
    // Generate 30 completed rounds to simulate long-history couple
    const rounds = [];
    for (let i = 0; i < 30; i++) {
      rounds.push({
        id: `round_${i}`,
        completedAt: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
        questionIds: ["q1", "q2", "q3", "q4", "q5"],
        answers: [{ q1: 5 }, { q1: 5 }],
        alignment: { overall: 85 }
      });
    }
    vmContext.state.completedRounds = rounds;

    // Set quota threshold that allows ~15 rounds (~3500 chars) but fails on 30 rounds (~7000 chars)
    maxStorageChars = 4000;

    const saveStateFn = vm.runInNewContext(`(${saveStateMatch[0]})`, vmContext);

    // Execute saveState: first write fails, prunes oldest 15 rounds, retries, and succeeds
    assert.doesNotThrow(() => {
      saveStateFn();
    });

    assert.equal(quotaTriggered, true, "QuotaExceededError occurred initially");
    assert.equal(vmContext.state.completedRounds.length, 15, "Oldest rounds pruned to fit within quota");
    assert.equal(vmContext.state.completedRounds[0].id, "round_15", "Kept most recent rounds");
    assert.notEqual(mockStorage.getItem(vmContext.STORAGE_KEY), null, "Successfully persisted pruned state");
  });

  it("handles storage restoration after transient storage unavailability", () => {
    let storageDisabled = true;
    const flakeyStorage = {
      getItem: () => null,
      setItem: () => {
        if (storageDisabled) throw new Error("SecurityError: localStorage is disabled");
      }
    };
    vmContext.localStorage = flakeyStorage;

    const saveFn = vm.runInNewContext(`(${saveStateMatch[0]})`, vmContext);

    // Call while disabled: runs safely
    assert.doesNotThrow(() => saveFn());

    // Storage re-enabled: runs cleanly
    storageDisabled = false;
    assert.doesNotThrow(() => saveFn());
    assert.equal(vmContext.state.names[0], "Alex");
  });
});
