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

// Extract LIGHTNING_PAIRS catalog from index.html
const pairsMatch = html.match(/const LIGHTNING_PAIRS = (\[[\s\S]*?\n    \]);/);
assert(pairsMatch, "Could not locate LIGHTNING_PAIRS in index.html");
const LIGHTNING_PAIRS = vm.runInNewContext(pairsMatch[1]);

// Extract selectLightningPairs from index.html
const selectFnMatch = html.match(/function selectLightningPairs\(count = 10\) \{([\s\S]*?)\n    \}/);
assert(selectFnMatch, "Could not locate selectLightningPairs in index.html");

// Extract shuffled from index.html
const shuffledMatch = html.match(/function shuffled\(values\) \{[\s\S]*?\n    \}/);
assert(shuffledMatch, "Could not locate shuffled in index.html");

describe("Rapid-Fire Warmup Pool & Non-Repeat Tracking Suite", () => {
  describe("1. Lightning Pairs Catalog Taxonomy", () => {
    it("contains at least 50 diverse 'This or That' pairs", () => {
      assert(LIGHTNING_PAIRS.length >= 50, `Expected at least 50 pairs, found ${LIGHTNING_PAIRS.length}`);
    });

    it("verifies unique identifiers across all pairs", () => {
      const ids = LIGHTNING_PAIRS.map((p) => p.id);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, ids.length, "All rapid-fire pair IDs must be unique");
      LIGHTNING_PAIRS.forEach((p) => {
        assert(typeof p.id === "string" && /^lp_\d+$/.test(p.id), `Invalid pair id format: ${p.id}`);
      });
    });

    it("verifies prompt validity and non-empty options for every pair", () => {
      LIGHTNING_PAIRS.forEach((p, idx) => {
        assert(typeof p.a === "string" && p.a.trim().length >= 4, `Pair ${idx} option A too short: ${p.a}`);
        assert(typeof p.b === "string" && p.b.trim().length >= 4, `Pair ${idx} option B too short: ${p.b}`);
        assert.notEqual(p.a.trim().toLowerCase(), p.b.trim().toLowerCase(), `Pair ${idx} options must be distinct`);
      });
    });
  });

  describe("2. Selection, Randomization & Non-Repeat Lifecycle", () => {
    const createSandbox = (initialSeen = []) => {
      const mockState = { seenLightningIds: [...initialSeen] };
      const sandbox = {
        state: mockState,
        LIGHTNING_PAIRS,
        shuffled: (values) => {
          // Deterministic reverse shuffle for test reproducibility
          return [...values].reverse();
        }
      };
      const selectLightningPairs = vm.runInNewContext(`(${selectFnMatch[0]})`, sandbox);
      return { selectLightningPairs, sandbox };
    };

    it("returns exactly 10 pairs when requested", () => {
      const { selectLightningPairs } = createSandbox();
      const selection = selectLightningPairs(10);
      assert.equal(selection.length, 10, "Must return exactly 10 pairs");
      const ids = selection.map((p) => p.id);
      assert.equal(new Set(ids).size, 10, "Selected pairs must all be unique within a single round");
    });

    it("excludes previously seen pairs across consecutive warmups", () => {
      const { selectLightningPairs, sandbox } = createSandbox();

      // Round 1
      const round1 = selectLightningPairs(10);
      round1.forEach((p) => sandbox.state.seenLightningIds.push(p.id));
      assert.equal(sandbox.state.seenLightningIds.length, 10);

      // Round 2
      const round2 = selectLightningPairs(10);
      const round1Set = new Set(round1.map((p) => p.id));
      round2.forEach((p) => {
        assert(!round1Set.has(p.id), `Pair ${p.id} was repeated in Round 2 before pool was exhausted`);
        sandbox.state.seenLightningIds.push(p.id);
      });
      assert.equal(sandbox.state.seenLightningIds.length, 20);

      // Round 3
      const round3 = selectLightningPairs(10);
      const round2Set = new Set(round2.map((p) => p.id));
      round3.forEach((p) => {
        assert(!round1Set.has(p.id), `Pair ${p.id} from Round 1 was repeated in Round 3`);
        assert(!round2Set.has(p.id), `Pair ${p.id} from Round 2 was repeated in Round 3`);
      });
    });

    it("smoothly recycles pool when remaining unplayed pairs drop below count", () => {
      // Simulate 45 of 50 pairs already seen (only 5 left, but 10 requested)
      const seen45 = LIGHTNING_PAIRS.slice(0, 45).map((p) => p.id);
      const { selectLightningPairs, sandbox } = createSandbox(seen45);

      const recycledSelection = selectLightningPairs(10);
      assert.equal(recycledSelection.length, 10, "Must still return 10 pairs upon recycling");
      assert.equal(sandbox.state.seenLightningIds.length, 0, "Must reset seenLightningIds to empty array when recycling pool");
    });
  });

  describe("3. State & Backup Schema Integration", () => {
    it("initialState defines seenLightningIds as empty array", () => {
      assert(html.includes("seenLightningIds: []"), "initialState must define seenLightningIds");
    });

    it("loadState deserializes and sanitizes seenLightningIds from storage", () => {
      const loadStateMatch = html.match(/function loadState\(\) \{[\s\S]*?\n    \}/);
      assert(loadStateMatch, "Could not locate loadState in index.html");
      assert(
        loadStateMatch[0].includes("seenLightningIds"),
        "loadState must include seenLightningIds sanitization"
      );
    });

    it("backup export and restore preserves seenLightningIds", () => {
      const createBackupMatch = html.match(/function createBackupPayload\(\) \{[\s\S]*?\n    \}\n\n    function backupToState/);
      assert(createBackupMatch, "Could not locate createBackupPayload");
      assert(
        createBackupMatch[0].includes("seenLightningIds"),
        "createBackupPayload must include seenLightningIds in backup"
      );

      const backupToStateMatch = html.match(/function backupToState\(payload\) \{[\s\S]*?\n    \}\n\n    function exportBackup/);
      assert(backupToStateMatch, "Could not locate backupToState");
      assert(
        backupToStateMatch[0].includes("seenLightningIds"),
        "backupToState must restore seenLightningIds"
      );
    });
  });
});
