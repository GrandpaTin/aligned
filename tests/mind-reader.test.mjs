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
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract guessHit, mindReaderHeadline, mindReaderTally, isQuickPickQuestion
const isQuickPickMatch = html.match(/function isQuickPickQuestion\(question\) \{[\s\S]*?\n    \}/);
assert(isQuickPickMatch, "Could not locate isQuickPickQuestion");

const guessHitMatch = html.match(/function guessHit\(question, playerIndex\) \{[\s\S]*?\n    \}/);
assert(guessHitMatch, "Could not locate guessHit");

const headlineMatch = html.match(/function mindReaderHeadline\(tally\) \{[\s\S]*?\n    \}/);
assert(headlineMatch, "Could not locate mindReaderHeadline");

const tallyMatch = html.match(/function mindReaderTally\(questions\) \{[\s\S]*?\n    \}/);
assert(tallyMatch, "Could not locate mindReaderTally");

const escapeMatch = html.match(/function escapeHTML\(str\) \{[\s\S]*?\n    \}/);
const escapeHTML = escapeMatch ? vm.runInNewContext(`(${escapeMatch[0]})`) : (s) => String(s);

describe("Mind-Reader Intuition Scoring & Wagering Math", () => {
  let vmContext;

  beforeEach(() => {
    vmContext = {
      escapeHTML,
      state: {
        names: ["Casey", "Riley"],
        answers: [{}, {}],
        guesses: [{}, {}],
        notReady: [{}, {}]
      }
    };
    vm.runInNewContext(isQuickPickMatch[0], vmContext);
    vm.runInNewContext(guessHitMatch[0], vmContext);
    vm.runInNewContext(headlineMatch[0], vmContext);
    vm.runInNewContext(tallyMatch[0], vmContext);
  });

  it("scores standard slider guesses with exact match (0) and proximity tolerance (1)", () => {
    const q1 = { id: "q_slider_1", type: "slider", prompt: "Spontaneity level?" };
    const { guessHit } = vmContext;

    // 1. Exact hit: guess 7, actual 7 -> distance 0, hit true
    vmContext.state.guesses[0]["q_slider_1"] = 7;
    vmContext.state.answers[1]["q_slider_1"] = 7;
    const exactHit = guessHit(q1, 0);
    assert.deepEqual({ ...exactHit }, { guess: 7, actual: 7, distance: 0, hit: true });

    // 2. Proximity hit (off by 1): guess 6, actual 7 -> distance 1, hit true
    vmContext.state.guesses[0]["q_slider_1"] = 6;
    const proxHit = guessHit(q1, 0);
    assert.deepEqual({ ...proxHit }, { guess: 6, actual: 7, distance: 1, hit: true });

    // 3. Near miss (off by 2): guess 5, actual 7 -> distance 2, hit false
    vmContext.state.guesses[0]["q_slider_1"] = 5;
    const miss = guessHit(q1, 0);
    assert.deepEqual({ ...miss }, { guess: 5, actual: 7, distance: 2, hit: false });

    // 4. Large divergence (off by 6)
    vmContext.state.guesses[0]["q_slider_1"] = 1;
    const largeMiss = guessHit(q1, 0);
    assert.deepEqual({ ...largeMiss }, { guess: 1, actual: 7, distance: 6, hit: false });
  });

  it("scores binary quick-pick intuition wagers by side parity", () => {
    const qQuick = {
      id: "q_qp_1",
      type: "slider",
      prompt: "Early bird or Night owl?",
      labels: ["Morning", "Night"]
    };
    const { guessHit } = vmContext;

    // Both on Left side (<= 5): hit true, distance 0
    vmContext.state.guesses[0]["q_qp_1"] = 2;
    vmContext.state.answers[1]["q_qp_1"] = 3;
    const hitSameSide = guessHit(qQuick, 0);
    assert.equal(hitSameSide.hit, true);
    assert.equal(hitSameSide.distance, 0);
    assert.equal(hitSameSide.side, true);

    // Split sides (Left vs Right): hit false, distance 7
    vmContext.state.guesses[0]["q_qp_1"] = 2;
    vmContext.state.answers[1]["q_qp_1"] = 9;
    const missSplitSide = guessHit(qQuick, 0);
    assert.equal(missSplitSide.hit, false);
    assert.equal(missSplitSide.distance, 7);
    assert.equal(missSplitSide.side, true);
  });

  it("returns null when questions are unready, un-guessed, or missing answers", () => {
    const q = { id: "q_test", type: "slider" };
    const { guessHit } = vmContext;

    assert.equal(guessHit(q, 0), null);

    vmContext.state.guesses[0]["q_test"] = 5;
    assert.equal(guessHit(q, 0), null);

    vmContext.state.answers[1]["q_test"] = 5;
    vmContext.state.notReady[0]["q_test"] = true;
    assert.equal(guessHit(q, 0), null, "Must return null when question is notReady");
  });

  it("aggregates player mind-reader tally across round questions", () => {
    const qList = [
      { id: "q1", type: "slider" },
      { id: "q2", type: "slider" },
      { id: "q3", type: "slider" }
    ];
    const { mindReaderTally } = vmContext;

    vmContext.state.answers[0] = { q1: 5, q2: 8, q3: 2 };
    vmContext.state.guesses[1] = { q1: 5, q2: 7, q3: 9 }; // Hit (dist 0), Hit (dist 1), Miss (dist 7)

    vmContext.state.answers[1] = { q1: 4, q2: 6, q3: 1 };
    vmContext.state.guesses[0] = { q1: 4, q2: 3, q3: 8 }; // Hit (dist 0), Miss (dist 3), Miss (dist 7)

    const tally = mindReaderTally(qList);

    assert.equal(tally[0].player, 0);
    assert.equal(tally[0].made, 3);
    assert.equal(tally[0].hits, 1, "Player 0 scored 1 hit");

    assert.equal(tally[1].player, 1);
    assert.equal(tally[1].made, 3);
    assert.equal(tally[1].hits, 2, "Player 1 scored 2 hits");
  });

  it("determines correct headline narrative based on hit rate thresholds", () => {
    const { mindReaderHeadline } = vmContext;

    // 1. High intuition crowned (>= 80% with >= 2 attempts)
    const crownTally = [
      { player: 0, made: 5, hits: 4 },
      { player: 1, made: 5, hits: 2 }
    ];
    const crownHeadline = mindReaderHeadline(crownTally);
    assert(crownHeadline.includes("👑 Casey is this round’s mind reader — 4 of 5!"));

    // 2. Moderate intuition winner (< 80% and >= 50%)
    const modTally = [
      { player: 0, made: 5, hits: 3 },
      { player: 1, made: 5, hits: 1 }
    ];
    const modHeadline = mindReaderHeadline(modTally);
    assert(modHeadline.includes("Casey is this round’s mind reader — 3 of 5!"));
    assert(!modHeadline.includes("👑"));

    // 3. Narrow edge with low hit rate (< 50%)
    const lowTally = [
      { player: 0, made: 5, hits: 2 },
      { player: 1, made: 5, hits: 1 }
    ];
    const lowHeadline = mindReaderHeadline(lowTally);
    assert(lowHeadline.includes("Casey edges it — 2 of 5. Plenty left to learn!"));

    // 4. Equal tie with hits
    const tieTally = [
      { player: 0, made: 4, hits: 2 },
      { player: 1, made: 4, hits: 2 }
    ];
    const tieHeadline = mindReaderHeadline(tieTally);
    assert.equal(tieHeadline, "A tie — you each read 2 right");

    // 5. Zero hits
    const zeroTally = [
      { player: 0, made: 4, hits: 0 },
      { player: 1, made: 4, hits: 0 }
    ];
    const zeroHeadline = mindReaderHeadline(zeroTally);
    assert.equal(zeroHeadline, "No mind reading this round — plenty left to learn!");
  });
});
