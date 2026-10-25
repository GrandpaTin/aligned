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
    assert.equal(kept.effectsEnabled, true, "saves from before the Effects switch read as on");
  });

  it("keeps the Effects switch off once the player turns it off", () => {
    const state = {
      names: ["A", "B"], selectedTopics: [], answeredQuestionIds: [], excludedQuestionIds: [], neverQuestionIds: [], favoriteQuestionIds: [],
      questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [], customPacks: [], completedRounds: [],
      conversationStatus: {}, sharedIntentions: [], effectsEnabled: false
    };
    const kept = vm.runInNewContext(`(${extract("persistentSetupState")})()`, { state });
    assert.equal(kept.effectsEnabled, false);
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
  // The sync loop reads its key list from the real persistentSetupState, so derive the keys from it once.
  const persistedKeys = Object.keys(vm.runInNewContext(`(${extract("persistentSetupState")})()`, { state: {
    names: [], selectedTopics: [], answeredQuestionIds: [], excludedQuestionIds: [], neverQuestionIds: [], favoriteQuestionIds: [],
    questionEdits: {}, questionFlags: {}, questionTagOverrides: {}, customQuestions: [], customPacks: [], completedRounds: [],
    conversationStatus: {}, sharedIntentions: []
  } }));
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
      persistentSetupState: () => Object.fromEntries(persistedKeys.map((key) => [key, null])),
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

  it("syncs the PIN, question edits and other persisted prefs so a stale tab cannot revert them", () => {
    const mine = { ...base, screen: "settings", privatePinHash: "", questionEdits: {}, questionFlags: {}, soundTheme: "chimes", tutorialSeen: false };
    const fresh = { ...base, screen: "settings", privatePinHash: "abc123", questionEdits: { q1: { text: "Edited" } }, questionFlags: { q2: "flag" }, soundTheme: "soft", tutorialSeen: true };
    const { state, calls } = run(mine, fresh);
    assert.equal(state.privatePinHash, "abc123");
    assert.deepEqual(plain(state.questionEdits), fresh.questionEdits);
    assert.deepEqual(plain(state.questionFlags), fresh.questionFlags);
    assert.equal(state.soundTheme, "soft");
    assert.equal(state.tutorialSeen, true);
    assert.equal(calls.render, 1);
  });

  it("keeps round-setup keys out of a tab mid-round while still syncing the PIN", () => {
    const mine = { ...base, screen: "question", playStyle: "local", questionCount: 5, privatePinHash: "" };
    const fresh = { ...base, screen: "settings", playStyle: "nearby", questionCount: 12, names: ["X", "Y"], privatePinHash: "pin" };
    const { state, calls } = run(mine, fresh);
    assert.equal(state.playStyle, "local");
    assert.equal(state.questionCount, 5);
    assert.deepEqual(state.names, ["A", "B"]);
    assert.equal(state.privatePinHash, "pin");
    assert.equal(calls.render, 0);
  });

  for (const board of ["reveal", "celebration"]) {
    it(`a tab holding its ${board} board is not pulled to another tab's Settings`, () => {
      const mine = { ...base, screen: board, playStyle: "nearby" };
      const { state, calls } = run(mine, { ...base, screen: "settings", names: ["C", "D"], playStyle: "local" });
      assert.equal(state.screen, board);
      assert.equal(state.playStyle, "nearby");
      assert.deepEqual(state.names, ["C", "D"]);
      assert.equal(calls.render, 0, "no rebuild, so a running discussion timer survives");
    });
  }

  it("a Library tab beside another tab's two-phone round rebuilds only when a shown preference changed", () => {
    const fresh = { ...base, screen: "question", playStyle: "nearby", privatePinHash: "", questionEdits: {} };
    const idle = run({ ...base, screen: "library", privatePinHash: "", questionEdits: {} }, fresh);
    assert.equal(idle.calls.render, 0, "an unrelated partner save must not wipe the Library search or scroll");
    const changed = run({ ...base, screen: "library", privatePinHash: "", questionEdits: {} }, { ...fresh, questionEdits: { q1: { text: "Edited" } } });
    assert.equal(changed.calls.render, 1);
  });

  it("still follows non-round screens", () => {
    const { state } = run({ ...base }, { ...base, screen: "library", names: ["C", "D"] });
    assert.equal(state.screen, "library");
    assert.deepEqual(state.names, ["C", "D"]);
  });
});

describe("Reveal re-renders keep the discussion timer running", () => {
  it("the reveal cleanup clears timers only when leaving the reveal screen", () => {
    const at = html.indexOf("cleanupResponsiveRender = () => {\n        // A rating, voice save");
    assert.ok(at > 0, "reveal cleanup closure found");
    const body = html.slice(at, at + 700);
    assert.match(body, /if \(state\.screen !== "reveal" \|\| \(state\.selectedQuestionIds \|\| \[\]\)\.join\("\|"\) !== timerRoundIds\) clearAllDiscussionTimers\(\);/);
    assert.ok(html.includes('const timerRoundIds = state.selectedQuestionIds.join("|");'), "the board records which round its timers belong to");
  });

  it("clearAllDiscussionTimers keeps the true remaining time", () => {
    const realNow = Date.now;
    const ctx = { discussionTimers: {}, clearInterval() {}, Date: { now: () => 1_000_000 }, Math };
    vm.runInNewContext(`${extract("clearAllDiscussionTimers")}\ndiscussionTimers.q1 = { running: true, interval: 7, seconds: 120, targetTime: 1_000_000 + 116_400 };\nclearAllDiscussionTimers();`, ctx);
    assert.equal(Date.now, realNow);
    assert.equal(ctx.discussionTimers.q1.running, false);
    assert.equal(ctx.discussionTimers.q1.interval, null);
    assert.equal(ctx.discussionTimers.q1.seconds, 117);
  });
});
