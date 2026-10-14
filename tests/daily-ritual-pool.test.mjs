import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const html = readFileSync(resolve(root, "index.html"), "utf8");

const grab = (re, label) => {
  const m = html.match(re);
  assert(m, `Could not locate ${label}`);
  return m[0];
};
const arraySource = (name) => vm.runInNewContext(grab(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`), name).replace(/^const \w+ = /, "").replace(/;$/, ""));
const constLine = (name) => grab(new RegExp(`const ${name} = .*;`), name);

const questionBank = arraySource("questionBank");
const specialty = arraySource("specialtyQuestionBank");
const CLASSIC_TOPIC_MAP = vm.runInNewContext(`(${grab(/const CLASSIC_TOPIC_MAP = (\{[\s\S]*?\n    \});/, "CLASSIC_TOPIC_MAP").replace(/^const CLASSIC_TOPIC_MAP = /, "").replace(/;$/, "")})`);
const ALL_QUESTIONS = [...questionBank.map((q) => ({ ...q, topic: CLASSIC_TOPIC_MAP[q.category] })), ...specialty];
const SENSITIVE = new Set(["spicy", "money", "politics", "dealbreakers"]);

const source = [
  constLine("DEFAULT_TOPICS"),
  `const TOPIC_OPTIONS = ${JSON.stringify(arraySource("TOPIC_OPTIONS"))};`,
  constLine("SENSITIVE_TOPICS"),
  constLine("DEEP_PROMPT_PATTERN"),
  constLine("LIGHT_PROMPT_PATTERN"),
  constLine("HISTORY_PROMPT_PATTERN"),
  grab(/function questionTone\(question\) \{[\s\S]*?\n    \}/, "questionTone"),
  grab(/function questionNeedsHistory\(question\) \{[\s\S]*?\n    \}/, "questionNeedsHistory"),
  grab(/const PROFILE_EXCLUDED_TOPICS = \{[\s\S]*?\n    \};/, "PROFILE_EXCLUDED_TOPICS"),
  grab(/function profileExcludesTopic\(topic, profileId = state\?\.relationshipProfile\) \{[\s\S]*?\n    \}/, "profileExcludesTopic"),
  constLine("COUPLE_ONLY_IDS"),
  constLine("COUPLE_ONLY_RE"),
  grab(/function profileIsCouple\(profileId = state\?\.relationshipProfile\) \{[\s\S]*?\n    \}/, "profileIsCouple"),
  grab(/function profileAllowsQuestion\(question, profileId = state\?\.relationshipProfile\) \{[\s\S]*?\n    \}/, "profileAllowsQuestion"),
  grab(/function allowedTopicsForIntensity\(intensity = state\.questionIntensity\) \{[\s\S]*?\n    \}/, "allowedTopicsForIntensity"),
  grab(/function dailyQuestionForDate\(dateStr\) \{[\s\S]*?\n    \}/, "dailyQuestionForDate"),
  grab(/function dailyRitualPool\(\) \{[\s\S]*?\n    \}/, "dailyRitualPool"),
  grab(/function dailyRitualPinnedQuestion\(dateStr\) \{[\s\S]*?\n    \}/, "dailyRitualPinnedQuestion"),
  grab(/function dailyRitualGapCopy\(a, b\) \{[\s\S]*?\n    \}/, "dailyRitualGapCopy"),
  "this.api = { dailyQuestionForDate, dailyRitualPool, dailyRitualGapCopy };"
].join("\n");

function makeApi(stateOverrides = {}) {
  const state = {
    questionIntensity: "curious",
    relationshipProfile: "romantic",
    neverQuestionIds: [],
    excludedQuestionIds: [],
    dailyRitual: { streak: 0, lastDate: "", answers: {}, completedDates: [] },
    ...stateOverrides
  };
  const ctx = { state, ALL_QUESTIONS, getQuestionCatalog: () => ALL_QUESTIONS.slice() };
  vm.runInNewContext(source, ctx);
  return ctx.api;
}

function days(count, start = "2026-10-13") {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("Daily ritual question pool", () => {
  it("never prints an opt-in (sensitive) pack prompt on Home, at any intensity", () => {
    for (const intensity of ["cozy", "curious", "deep", "spicy", "no-filter"]) {
      const api = makeApi({ questionIntensity: intensity });
      for (const day of days(365)) {
        const q = api.dailyQuestionForDate(day);
        assert(q && q.prompt, `${intensity} ${day} has a prompt`);
        assert(!SENSITIVE.has(q.topic), `${intensity} ${day} drew sensitive topic ${q.topic}`);
      }
    }
  });

  it("keeps cozy to cozy topics and gentle prompts", () => {
    const api = makeApi({ questionIntensity: "cozy" });
    const cozy = new Set(["connection", "love", "fun", "lifestyle"]);
    for (const q of api.dailyRitualPool()) assert(cozy.has(q.topic), `cozy pool has ${q.topic}`);
  });

  it("keeps love prompts for legacy couple profiles from 1.7.1 saves", () => {
    for (const profile of ["early-dating", "spicy"]) {
      const api = makeApi({ relationshipProfile: profile });
      assert(api.dailyRitualPool().some((q) => q.topic === "love"), `${profile} pool lost love prompts`);
    }
  });

  it("drops romance-assuming prompts for non-couple profiles", () => {
    const api = makeApi({ relationshipProfile: "friends", questionIntensity: "no-filter" });
    assert(!api.dailyRitualPool().some((q) => /\b(romantic|romance|marriage|married|spouse)\b/i.test(q.prompt || "")), "friends pool has romance-assuming prompts");
  });

  it("drops love prompts for non-romantic profiles", () => {
    for (const profile of ["friends", "roommates", "collaborators"]) {
      const api = makeApi({ relationshipProfile: profile });
      assert(api.dailyRitualPool().length > 20);
      assert(!api.dailyRitualPool().some((q) => q.topic === "love"), `${profile} pool has love prompts`);
    }
  });

  it("honours the never and excluded lists", () => {
    const base = makeApi();
    const first = base.dailyQuestionForDate("2026-10-13");
    const api = makeApi({ neverQuestionIds: [first.id], excludedQuestionIds: [base.dailyQuestionForDate("2026-10-14").id] });
    assert(!api.dailyRitualPool().some((q) => q.id === first.id));
    for (const day of days(120)) assert.notEqual(api.dailyQuestionForDate(day).id, first.id);
  });

  it("is deterministic and spreads neighbouring days across topics", () => {
    for (const intensity of ["cozy", "curious", "no-filter"]) {
      const api = makeApi({ questionIntensity: intensity });
      assert.equal(api.dailyQuestionForDate("2026-10-13").id, api.dailyQuestionForDate("2026-10-13").id);
      let run = 1;
      let longest = 1;
      let prev = "";
      for (const day of days(365)) {
        const q = api.dailyQuestionForDate(day);
        const key = q.category || q.topic;
        run = key === prev ? run + 1 : 1;
        longest = Math.max(longest, run);
        prev = key;
      }
      assert(longest <= 4, `${intensity}: one category ran ${longest} days in a row`);
    }
  });

  it("keeps today's question once answered, even if the filters change", () => {
    const api = makeApi();
    const answered = ALL_QUESTIONS.find((q) => q.topic === "fun");
    const pinned = makeApi({
      questionIntensity: "cozy",
      neverQuestionIds: [],
      dailyRitual: { streak: 1, lastDate: "2026-10-13", answers: { "2026-10-13": 7 }, completedDates: ["2026-10-13"], questionIds: { "2026-10-13": answered.id } }
    });
    assert.equal(pinned.dailyQuestionForDate("2026-10-13").id, answered.id);
    // Other days still follow the live filters.
    assert.equal(pinned.dailyQuestionForDate("2026-10-14").id, makeApi({ questionIntensity: "cozy" }).dailyQuestionForDate("2026-10-14").id);
    assert.notEqual(api.dailyQuestionForDate("2026-10-13"), undefined);
  });

  it("words the gap between two picks", () => {
    const api = makeApi();
    assert.equal(api.dailyRitualGapCopy(6, 6), "Same spot!");
    assert.equal(api.dailyRitualGapCopy(4, 6), "Close: 2 apart");
    assert.equal(api.dailyRitualGapCopy(1, 9), "8 apart — talk it over");
  });
});

describe("Daily ritual paired answers persist", () => {
  const cleaners = [
    grab(/function cleanAnswerMap\(source\) \{[\s\S]*?\n    \}/, "cleanAnswerMap"),
    grab(/function cleanDailyAnswers\(source\) \{[\s\S]*?\n    \}/, "cleanDailyAnswers"),
    grab(/function cleanDailyQuestionIds\(source, answers\) \{[\s\S]*?\n    \}/, "cleanDailyQuestionIds"),
    "this.api = { cleanDailyAnswers, cleanDailyQuestionIds };"
  ].join("\n");
  const ctx = {};
  vm.runInNewContext(cleaners, ctx);
  const { cleanDailyAnswers, cleanDailyQuestionIds } = ctx.api;

  it("keeps old number/string answers and clamps { a, b } pairs on load", () => {
    const answers = cleanDailyAnswers({ "2026-10-11": 9, "2026-10-12": "we laughed", "2026-10-13": { a: 14, b: -3 }, "2026-10-14": { a: "x", b: 2 }, "2026-10-15": [1, 2] });
    assert.equal(answers["2026-10-11"], 9);
    assert.equal(answers["2026-10-12"], "we laughed");
    assert.deepEqual({ ...answers["2026-10-13"] }, { a: 10, b: 1 });
    assert(!("2026-10-14" in answers));
    assert(!("2026-10-15" in answers));
    const polluted = cleanDailyAnswers(JSON.parse('{"__proto__": {"a": 3, "b": 4}, "2026-10-13": 5}'));
    assert.equal(polluted.a, undefined, "a __proto__ key must not become the map's prototype");
    assert.equal(polluted["2026-10-13"], 5);
    const ids = cleanDailyQuestionIds({ "2026-10-13": "cn_1", "2026-10-20": "cn_2", "2026-10-11": "<script>" }, answers);
    assert.deepEqual({ ...ids }, { "2026-10-13": "cn_1" });
  });

  it("round-trips { a, b } and questionIds through a backup", () => {
    const backupToState = vm.runInNewContext(
      `(${grab(/function backupToState\(payload\) \{[\s\S]*?\n    \}\n\n    function exportBackup/, "backupToState").replace(/\n\n    function exportBackup$/, "")})`,
      { BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"]) }
    );
    const restored = backupToState({
      app: "Aligned",
      formatVersion: 2,
      history: { dailyRitual: { streak: 2, lastDate: "2026-10-13", answers: { "2026-10-12": 4, "2026-10-13": { a: 3, b: 11 } }, completedDates: ["2026-10-12", "2026-10-13"], questionIds: { "2026-10-13": "cn_4", "2026-10-01": "cn_9" } } }
    });
    assert.deepEqual({ ...restored.dailyRitual.answers["2026-10-13"] }, { a: 3, b: 10 });
    assert.equal(restored.dailyRitual.answers["2026-10-12"], 4);
    assert.deepEqual({ ...restored.dailyRitual.questionIds }, { "2026-10-13": "cn_4" });
  });
});
