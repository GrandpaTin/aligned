import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  assert(m, `Could not locate array ${name}`);
  return m[1];
};
// Source of a top-level (4-space indented) function: up to its closing brace at the same indent.
const functionSource = (name) => {
  const start = html.indexOf(`\n    function ${name}(`);
  assert(start >= 0, `Could not locate function ${name}`);
  const end = html.indexOf("\n    }\n", start);
  assert(end > start, `Could not find the end of ${name}`);
  return html.slice(start + 1, end + 6);
};

const profileBlockStart = html.indexOf("    const PROFILE_EXCLUDED_TOPICS = {");
const lastHelper = functionSource("profilePresetVisible");
const profileBlockEnd = html.indexOf(lastHelper) + lastHelper.length;
assert(profileBlockStart > 0 && profileBlockEnd > profileBlockStart, "profile helper block present");
const profileBlock = html.slice(profileBlockStart, profileBlockEnd);
const classicMap = html.match(/const CLASSIC_TOPIC_MAP = (\{[\s\S]*?\n    \});/)[1];

const ctx = vm.createContext({ state: { relationshipProfile: "romantic" } });
vm.runInContext(`
  const questionBank = ${arraySource("questionBank")};
  const specialtyQuestionBank = ${arraySource("specialtyQuestionBank")};
  const CLASSIC_TOPIC_MAP = ${classicMap};
  const SESSION_PRESETS = ${arraySource("SESSION_PRESETS")};
  var ALL_QUESTIONS = [...questionBank.map((q) => ({ ...q, topic: CLASSIC_TOPIC_MAP[q.category] })), ...specialtyQuestionBank];
  ${profileBlock}
  Object.assign(globalThis, { ALL_QUESTIONS, SESSION_PRESETS, profileAllowsQuestion, profileTopics, profilePreset, profilePresetVisible, profileIsCouple });
`, ctx);

const NON_COUPLES = ["friends", "roommates", "collaborators"];
const COUPLE_WORDS = /\b(relationships?|partners?|romantic|couples?|date night|marry|marriage|prenuptial|anniversary|infidelity)\b/i;

describe("Relationship profile filters the question pool (A-06)", () => {
  it("keeps the full pool for romantic and legacy couple profiles", () => {
    for (const id of ["romantic", "early-dating", "spicy", undefined]) {
      assert(ctx.ALL_QUESTIONS.every((q) => ctx.profileAllowsQuestion(q, id)), `${id} keeps every question`);
      assert.deepEqual([...ctx.profileTopics(["connection", "love"], null, id)], ["connection", "love"]);
    }
  });

  it("drops intimacy, love, spicy and dealbreaker packs and couple-only prompts for non-couples", () => {
    for (const id of NON_COUPLES) {
      const allowed = ctx.ALL_QUESTIONS.filter((q) => ctx.profileAllowsQuestion(q, id));
      assert(allowed.length > 150, `${id} still has a real pool`);
      for (const q of allowed) {
        assert(!["connection", "love", "spicy", "dealbreakers"].includes(q.topic), `${id}: ${q.id} topic ${q.topic}`);
        assert(!COUPLE_WORDS.test(q.prompt), `${id}: ${q.id} assumes a couple: ${q.prompt}`);
      }
      // A 15-question sliders-only round on the everyday packs must still fill without repeats.
      const everyday = allowed.filter((q) => ["lifestyle", "future", "fun"].includes(q.topic));
      assert(everyday.filter((q) => q.type === "slider").length >= 15);
      assert(everyday.filter((q) => q.type === "text").length >= 15);
    }
  });

  it("lets custom questions through when their pack is allowed", () => {
    const custom = { id: "custom_1_2", topic: "fun", type: "text", prompt: "Our relationship in one word?" };
    assert.equal(ctx.profileAllowsQuestion(custom, "friends"), true);
    assert.equal(ctx.profileAllowsQuestion({ ...custom, topic: "love" }, "friends"), false);
  });

  it("falls back to everyday packs the intensity allows when every chosen pack is excluded", () => {
    assert.deepEqual([...ctx.profileTopics(["connection", "love"], null, "friends")], ["lifestyle", "future", "fun"]);
    assert.deepEqual([...ctx.profileTopics(["connection", "love"], new Set(["fun", "lifestyle"]), "roommates")], ["lifestyle", "fun"]);
    assert.deepEqual([...ctx.profileTopics(["connection", "money"], null, "collaborators")], ["money"]);
  });

  it("adapts couple-themed preset copy and hides couple-only presets", () => {
    const find = (id) => ctx.SESSION_PRESETS.find((p) => p.id === id);
    assert.equal(ctx.profilePreset(find("date-night"), "romantic").label, "Cozy Date Night");
    const hangout = ctx.profilePreset(find("date-night"), "friends");
    assert.equal(hangout.label, "Cozy Hangout");
    assert.equal(hangout.id, "date-night", "preset id (stored on rounds) is unchanged");
    assert(!hangout.topics.some((t) => ["connection", "love"].includes(t)));
    for (const id of NON_COUPLES) {
      assert.equal(ctx.profilePresetVisible(find("spicy-night"), id), false);
      assert.equal(ctx.profilePresetVisible(find("dealbreakers"), id), false);
      for (const preset of ctx.SESSION_PRESETS.filter((p) => ctx.profilePresetVisible(p, id) && p.topics)) {
        const topics = ctx.profilePreset(preset, id).topics;
        assert(topics.length && !topics.some((t) => ["connection", "love", "spicy", "dealbreakers"].includes(t)), `${id}/${preset.id}`);
      }
    }
    assert.equal(ctx.profilePresetVisible(find("spicy-night"), "romantic"), true);
  });

  it("applies the gate on every path that picks or offers questions", () => {
    const choose = functionSource("chooseRoundQuestions");
    assert.match(choose, /topics = profileTopics\(topics\);/);
    assert.match(choose, /!excludedIds\.has\(question\.id\) && profileAllowsQuestion\(question\)\n/);
    assert.match(choose, /fits\(question\) && profileAllowsQuestion\(question\)\);/, "the borrow path is gated too");
    assert.match(functionSource("allowedTopicsForIntensity"), /!profileExcludesTopic\(topic\)/);
    assert.match(html, /relationshipProfile: \(typeof RELATIONSHIP_PROFILES !== "undefined" \? RELATIONSHIP_PROFILES\.map\(\(profile\) => profile\.id\) : \["romantic", "friends", "roommates", "collaborators"\]\)\.includes\(/,
      "a backup restore keeps every profile, roommates and collaborators included");
  });
});

describe("Swap question protects a started answer (A-05)", () => {
  const start = html.indexOf('document.getElementById("skip-question")?.addEventListener("click", async () => {');
  const handler = html.slice(start, html.indexOf("\n      });\n", start));
  it("confirms before discarding work and re-checks the card afterwards", () => {
    assert(start > 0);
    assert.match(handler, /if \(hasWork\) \{\n\s+const ok = await openConfirmDialog\(\{ eyebrow: "Swap question", title: "Swap this question\?", copy: "Your answer to this one won’t be kept\.", confirmLabel: "Swap", cancelLabel: "Keep answering", safeFirst: true \}\);/);
    assert.match(handler, /state\.selectedQuestionIds\[state\.questionIndex\] !== swapId\) return;/);
    assert(handler.indexOf("No replacement question is available") < handler.indexOf("openConfirmDialog"), "no dialog when no swap is possible");
  });
  it("does not treat a slider's render-time default of 5 as work", () => {
    // renderQuestion writes 5 into state.answers for an untouched slider, so "defined" alone would prompt on every slider.
    assert.match(handler, /typedAnswer !== undefined && !answerIsRenderDefault\)/);
    assert.match(html, /answerIsRenderDefault = true;\n\s+state\.answers\[state\.activePlayer\]\[question\.id\] = savedAnswer;/);
    assert.match(html, /state\.answers\[state\.activePlayer\]\[question\.id\] = value;\n\s+answerIsRenderDefault = false;/);
  });
  it("drops the orphaned per-question data for the old card", () => {
    assert.match(handler, /\[state\.answers, state\.comments, state\.privateNotes, state\.importance, state\.notReady, state\.guesses\]\.forEach/);
    assert.match(handler, /delete maps\[swapPlayer\]\[swapId\]/);
    assert.match(handler, /profileAllowsQuestion\(item\)/, "a swap never brings in a prompt the profile excludes");
  });
});

describe("Wager tally (A-28)", () => {
  const wctx = vm.createContext({});
  vm.runInContext(`
    var state = { cardWagers: {}, notReady: [{}, {}], answers: [{}, {}] };
    function revealMatchInfo(question, a, b) {
      if (a === undefined || b === undefined) return { missing: true, isMatch: false };
      if (question.type === "text") return { unrated: true, isMatch: false };
      return { isMatch: Math.abs(a - b) <= 1 };
    }
    ${functionSource("wagerTally")}
    globalThis.wagerTally = wagerTally; globalThis.state = state;
  `, wctx);
  const qs = [
    { id: "s1", type: "slider" }, { id: "s2", type: "slider" }, { id: "s3", type: "slider" },
    { id: "t1", type: "text" }, { id: "s4", type: "slider" }, { id: "s5", type: "slider" }
  ];
  it("counts only this round's scored slider/pick bets, couple-level", () => {
    Object.assign(wctx.state.cardWagers, { s1: "match", s2: "diff", s3: "match", t1: "match", s4: "match", s5: "diff", old: "match" });
    Object.assign(wctx.state.answers[0], { s1: 5, s2: 2, s3: 1, t1: "x", s4: 4, s5: 6 });
    Object.assign(wctx.state.answers[1], { s1: 6, s2: 9, s3: 9, t1: "y", s5: 6 });
    wctx.state.notReady[1].s5 = true;
    // s1 match ✓, s2 diff ✓, s3 match ✗; t1 written, s4 missing, s5 held back, "old" not in the round.
    assert.deepEqual({ ...wctx.wagerTally(qs) }, { made: 3, hits: 2 });
    wctx.state.cardWagers.s3 = "";
    assert.deepEqual({ ...wctx.wagerTally(qs) }, { made: 2, hits: 2 });
  });
  it("hides bets on written cards and surfaces the tally on the Mind-reader highlight and reel", () => {
    assert.match(html, /const canWager = !answerHeld && question\.type !== "text" && \(state\.completedRounds\?\.length \|\| 0\) > 1;/);
    assert.match(html, /\$\{canWager \? " has-wager" : ""\}/);
    assert.match(html, /`Your bets \$\{bets\.hits\}\/\$\{bets\.made\}`/);
    assert.match(functionSource("openStoryReelModal"), /Your bets: \$\{bets\.hits\}\/\$\{bets\.made\} called/);
  });
});

describe("Wrapped reel de-duplication (A-52)", () => {
  const reel = functionSource("openStoryReelModal");
  it("has one score headline and honest similarity copy", () => {
    assert(!/duoTitle/.test(reel), "no second title scale in the reel");
    assert(!/similarity gap/.test(reel));
    assert.match(reel, /\$\{100 - surpriseHighlight\.match\.percent\}% apart/);
    assert.match(reel, /"Nearest Common Ground"/);
    // A missed guess on a matching card is the board's "Biggest misread"; the reel must not call it "0% apart".
    assert.match(reel, /misreadNote \? escapeHTML\(misreadNote\) :/);
    assert.match(html, /misread: !!guessSurprise && surpriseHighlight === guessSurprise,\n\s+surpriseNote,/);
  });
  it("shows both answers and reuses the board's picks", () => {
    assert.match(reel, /highlightAnswersMarkup\(closestHighlight\)/);
    assert.match(reel, /highlightAnswersMarkup\(surpriseHighlight\)/);
    assert.match(reel, /"closest" in picks \? picks\.closest/);
    assert.match(html, /openStoryReelModal\(questions, alignment, tally, \{\n\s+closest: closestHighlight,\n\s+surprise: surpriseHighlight,/);
    assert.match(functionSource("highlightAnswersMarkup"), /escapeHTML\(state\.names\[0\]\)/);
  });
});
