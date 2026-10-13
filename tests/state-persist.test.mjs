import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
function extract(name) {
  const match = html.match(new RegExp(String.raw`\n    function ${name}\([^)]*\) \{[\s\S]*?\n    \}\n`));
  assert(match, `Could not locate ${name} in index.html`);
  return match[0];
}
const plain = (value) => JSON.parse(JSON.stringify(value));

describe("Round resets keep long-lived state (persistentSetupState)", () => {
  it("carries the ritual streak, warmup progress, soundscape and voice memories", () => {
    const state = {
      names: ["A", "B"], selectedTopics: [], answeredQuestionIds: [], excludedQuestionIds: [], neverQuestionIds: [], favoriteQuestionIds: [],
      questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [], customPacks: [], completedRounds: [],
      conversationStatus: {}, sharedIntentions: [],
      dailyRitual: { streak: 12, lastDate: "2026-10-13", answers: { "2026-10-13": { q: "x" } }, completedDates: ["2026-10-12", "2026-10-13"] },
      seenLightningIds: ["l1", "l2"], ambientMix: { synth: 0, rain: 1, hearth: 0.5 }, ambientSoundscape: "rain",
      voiceNotes: { q1: "data:audio/webm;base64,AAA" }
    };
    const ctx = { state };
    const kept = vm.runInNewContext(`(${extract("persistentSetupState")})()`, ctx);
    assert.deepEqual(plain(kept.dailyRitual), state.dailyRitual);
    assert.notEqual(kept.dailyRitual, state.dailyRitual, "deep copy");
    assert.deepEqual(plain(kept.seenLightningIds), ["l1", "l2"]);
    assert.deepEqual(plain(kept.ambientMix), { synth: 0, rain: 1, hearth: 0.5 });
    assert.equal(kept.ambientSoundscape, "rain");
    assert.deepEqual(plain(kept.voiceNotes), state.voiceNotes);
  });

  it("falls back to safe defaults for missing or bad values", () => {
    const state = {
      names: ["A", "B"], selectedTopics: [], answeredQuestionIds: [], excludedQuestionIds: [], neverQuestionIds: [], favoriteQuestionIds: [],
      questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [], customPacks: [], completedRounds: [],
      conversationStatus: {}, sharedIntentions: [], ambientSoundscape: "jazz"
    };
    const kept = vm.runInNewContext(`(${extract("persistentSetupState")})()`, { state });
    assert.equal(kept.ambientSoundscape, "synth");
    assert.deepEqual(plain(kept.ambientMix), { synth: 0.8, rain: 0, hearth: 0 });
    assert.deepEqual(plain(kept.dailyRitual), { streak: 0, lastDate: "", answers: {}, completedDates: [] });
    assert.deepEqual(plain(kept.seenLightningIds), []);
    assert.deepEqual(plain(kept.voiceNotes), {});
  });
});

describe("Mind-Reader rivalry is derived from completed rounds", () => {
  const src = ["isTonightRound", "sameCouple", "roundMindReaderHits", "calculateTonightRivalry"].map(extract).join("\n");
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString();
  function run(rounds, names = ["Avery", "Jordan"]) {
    const ctx = { state: { names, completedRounds: rounds }, escapeHTML: (v) => String(v) };
    return vm.runInNewContext(`${src}\n({ rivalry: calculateTonightRivalry(), lifetime: state.completedRounds.filter(sameCouple).reduce((s, r) => s + roundMindReaderHits(r)[0] + roundMindReaderHits(r)[1], 0) })`, ctx);
  }

  it("sums only tonight's rounds for this couple, each counted once", () => {
    const { rivalry } = run([
      { completedAt: yesterday, names: ["Avery", "Jordan"], mindReaderHits: [9, 9] },
      { completedAt: today, names: ["Avery", "Jordan"], mindReaderHits: [2, 1] },
      { completedAt: today, names: ["Sam", "Lee"], mindReaderHits: [5, 5] },
      { completedAt: today, names: ["Avery", "Jordan"], mindReaderHits: [1, 0] }
    ]);
    assert.equal(rivalry.hits0, 3);
    assert.equal(rivalry.hits1, 1);
    assert.match(rivalry.leaderText, /Avery leads by 2/);
  });

  it("re-orders hits from rounds played with the seats swapped", () => {
    const { rivalry } = run([{ completedAt: today, names: ["Jordan", "Avery"], mindReaderHits: [4, 1] }]);
    assert.equal(rivalry.hits0, 1);
    assert.equal(rivalry.hits1, 4);
  });

  it("treats legacy rounds without hits as zero; lifetime total drives the milestone", () => {
    const { rivalry, lifetime } = run([
      { completedAt: today, names: ["Avery", "Jordan"] },
      { completedAt: yesterday, names: ["Avery", "Jordan"], mindReaderHits: [2, 1] }
    ]);
    assert.equal(rivalry.hits0 + rivalry.hits1, 0);
    assert.equal(lifetime, 3);
  });

  it("no longer tallies hits in the new-round handler", () => {
    assert.ok(!/state\.rivalryScores/.test(html), "state.rivalryScores is gone; rounds carry mindReaderHits");
  });
});

describe("Cross-tab sync keeps a screen with its round", () => {
  const src = extract("handleCrossTabSync");
  function run(current, fresh, linked = false) {
    const calls = { render: 0, toasts: [] };
    const ctx = {
      state: current,
      syncThrottleTimer: 0,
      crossTabNearbyNoticeShown: false,
      clearTimeout() {},
      window: { setTimeout: (fn) => { fn(); return 1; } },
      loadState: () => fresh,
      nearbyLinked: () => linked,
      applyPreferences() {},
      render() { calls.render++; },
      showToast: (msg) => calls.toasts.push(msg),
      console: { warn() {} }
    };
    vm.runInNewContext(`${src}\nhandleCrossTabSync();`, ctx);
    return { state: ctx.state, calls };
  }
  const base = { screen: "setup", names: ["A", "B"], selectedQuestionIds: [], completedRounds: [] };

  it("adopts the whole local round when another tab starts one", () => {
    const fresh = { ...base, screen: "question", playStyle: "local", selectedQuestionIds: ["q1", "q2"], questionIndex: 1 };
    const { state, calls } = run({ ...base }, fresh);
    assert.equal(state, fresh);
    assert.equal(calls.render, 1);
  });

  it("does not adopt a two-phone round; tells the user once instead", () => {
    const fresh = { ...base, screen: "question", playStyle: "nearby", selectedQuestionIds: ["q1"] };
    const { state, calls } = run({ ...base }, fresh);
    assert.equal(state.screen, "setup");
    assert.deepEqual(state.selectedQuestionIds, []);
    assert.equal(calls.toasts.length, 1);
  });

  it("leaves a tab mid-round alone", () => {
    const mine = { ...base, screen: "question", selectedQuestionIds: ["mine"] };
    const { state } = run(mine, { ...base, screen: "question", selectedQuestionIds: ["other"] });
    assert.equal(state, mine);
    assert.deepEqual(state.selectedQuestionIds, ["mine"]);
  });

  it("syncs the long-lived voice memories and warmup progress even mid-round", () => {
    const mine = { ...base, screen: "question", voiceNotes: {}, seenLightningIds: [], ambientSoundscape: "synth" };
    const fresh = { ...base, screen: "reveal", voiceNotes: { q1: "data:audio/webm;base64,AA" }, seenLightningIds: ["l1"], ambientSoundscape: "rain" };
    const { state } = run(mine, fresh);
    assert.deepEqual(plain(state.voiceNotes), fresh.voiceNotes);
    assert.deepEqual(plain(state.seenLightningIds), ["l1"]);
    assert.equal(state.ambientSoundscape, "rain");
  });

  it("still follows non-round screens", () => {
    const { state } = run({ ...base }, { ...base, screen: "library", names: ["C", "D"] });
    assert.equal(state.screen, "library");
    assert.deepEqual(state.names, ["C", "D"]);
  });
});
