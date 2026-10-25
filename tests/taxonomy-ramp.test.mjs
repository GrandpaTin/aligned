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

// Extract data structures from index.html
const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  assert(m, `Could not locate array ${name}`);
  return vm.runInNewContext(m[1]);
};

const qBank = arraySource("questionBank");
const sBank = arraySource("specialtyQuestionBank");
const classicMapMatch = html.match(/const CLASSIC_TOPIC_MAP = (\{[\s\S]*?\n    \});/);
assert(classicMapMatch, "Could not locate CLASSIC_TOPIC_MAP");
const classicMap = vm.runInNewContext(`(${classicMapMatch[1]})`);

const TOPIC_OPTIONS = arraySource("TOPIC_OPTIONS");
const SESSION_PRESETS = arraySource("SESSION_PRESETS");
const INTENSITY_OPTIONS = arraySource("INTENSITY_OPTIONS");
const validTopicIds = new Set(TOPIC_OPTIONS.map((t) => t.id));

const allQuestions = [
  ...qBank.map((q) => ({ ...q, topic: classicMap[q.category] })),
  ...sBank
];

// Extract tone and ramping functions
const toneMatch = html.match(/function questionTone\(question\) \{[\s\S]*?\n    \}/);
assert(toneMatch, "Could not locate questionTone");
const deepPatternMatch = html.match(/const DEEP_PROMPT_PATTERN = (\/[^\n]+\/i);/);
assert(deepPatternMatch, "Could not locate DEEP_PROMPT_PATTERN in index.html");
const DEEP_PROMPT_PATTERN = vm.runInNewContext(deepPatternMatch[1]);

const lightPatternMatch = html.match(/const LIGHT_PROMPT_PATTERN = (\/[^\n]+\/i);/);
assert(lightPatternMatch, "Could not locate LIGHT_PROMPT_PATTERN in index.html");
const LIGHT_PROMPT_PATTERN = vm.runInNewContext(lightPatternMatch[1]);
const questionTone = vm.runInNewContext(`(${toneMatch[0]})`, {
  DEEP_PROMPT_PATTERN,
  LIGHT_PROMPT_PATTERN
});

const orderRampMatch = html.match(/function orderRoundAsRamp\(questionIds\) \{[\s\S]*?\n    \}/);
assert(orderRampMatch, "Could not locate orderRoundAsRamp");
const orderRoundAsRamp = vm.runInNewContext(`(${orderRampMatch[0]})`, {
  getQuestionCatalog: () => allQuestions,
  questionTone
});

// Extract promptsAreTwins and helpers
const twinsMatch = html.match(/function promptsAreTwins\(question, other\) \{[\s\S]*?\n    \}/);
const promptWordsMatch = html.match(/function promptWords\(text\) \{[\s\S]*?\n    \}/);
const promptPairsMatch = html.match(/function promptPairs\(text\) \{[\s\S]*?\n    \}/);
const promptWordFreqMatch = html.match(/function promptWordFrequency\(word\) \{[\s\S]*?\n    \}/);

const twinsContext = {
  getQuestionCatalog: () => allQuestions,
  promptWordCache: new Map(),
  promptPairCache: new Map(),
  promptWordCounts: null
};
vm.runInNewContext(promptWordsMatch[0], twinsContext);
vm.runInNewContext(promptPairsMatch[0], twinsContext);
vm.runInNewContext(promptWordFreqMatch[0], twinsContext);
vm.runInNewContext(twinsMatch[0], twinsContext);
const { promptsAreTwins } = twinsContext;

describe("Question Bank Taxonomy, Preset Pools & Intensity Ramp Suite", () => {
  it("enforces complete catalog taxonomy, ID format, prompt lengths, and endpoint boundaries", () => {
    assert.equal(allQuestions.length, 364, "Catalog must contain exactly 364 questions");
    const sliderCount = allQuestions.filter((q) => q.type === "slider").length;
    const textCount = allQuestions.filter((q) => q.type === "text").length;
    assert.equal(sliderCount, 185, "Expected exactly 185 sliders");
    assert.equal(textCount, 179, "Expected exactly 179 text questions");

    const idSet = new Set();
    for (const q of allQuestions) {
      assert.match(q.id, /^[a-z]{3,4}_\d+$/, `Question ID must use valid prefix_number: ${q.id}`);
      assert(!idSet.has(q.id), `Question ID must be unique: ${q.id}`);
      idSet.add(q.id);

      assert(validTopicIds.has(q.topic), `Question ${q.id} topic '${q.topic}' must exist in TOPIC_OPTIONS`);
      assert(typeof q.prompt === "string" && q.prompt.trim().length >= 12, `Prompt too short: ${q.id}`);
      assert(q.prompt.trim().length <= 250, `Prompt exceeds 250 characters: ${q.id}`);
      assert(/[?.!…:]$/.test(q.prompt.trim()), `Prompt must end with terminal punctuation: ${q.id}`);

      if (q.type === "slider") {
        assert(Array.isArray(q.labels) && q.labels.length === 2, `Slider must have exactly 2 labels: ${q.id}`);
        assert(q.labels[0].trim() && q.labels[1].trim(), `Slider labels must be non-empty: ${q.id}`);
        assert.notEqual(q.labels[0].trim(), q.labels[1].trim(), `Slider labels must be distinct: ${q.id}`);
        assert(q.labels[0].length <= 40 && q.labels[1].length <= 40, `Slider labels must be <= 40 chars: ${q.id}`);
      } else {
        assert.equal(q.labels, undefined, `Text question must not define labels: ${q.id}`);
      }
    }
  });

  it("verifies session presets configure valid intensities and have sufficient catalog pools", () => {
    const validIntensityIds = new Set(INTENSITY_OPTIONS.map((i) => i.id));
    const activePresets = SESSION_PRESETS.filter((p) => p.id !== "custom");

    for (const preset of activePresets) {
      assert(validIntensityIds.has(preset.intensity), `Preset ${preset.id} uses unknown intensity: ${preset.intensity}`);
      assert(Array.isArray(preset.topics) && preset.topics.length > 0, `Preset ${preset.id} must define topics`);
      preset.topics.forEach((t) => assert(validTopicIds.has(t), `Preset ${preset.id} topic '${t}' invalid`));

      const pool = allQuestions.filter((q) => preset.topics.includes(q.topic));
      assert(
        pool.length >= preset.count * 2,
        `Preset ${preset.id} (needs ${preset.count}) has insufficient catalog pool: ${pool.length}`
      );
    }
  });

  it("classifies question tones into light, warm, and deep without unclassified leaks", () => {
    const toneDist = { light: 0, warm: 0, deep: 0 };
    for (const q of allQuestions) {
      const tone = questionTone(q);
      assert(["light", "warm", "deep"].includes(tone), `Invalid tone '${tone}' on ${q.id}`);
      toneDist[tone]++;
    }

    assert(toneDist.deep >= 70, `Expected at least 70 deep questions; found ${toneDist.deep}`);
    assert(toneDist.light >= 70, `Expected at least 70 light questions; found ${toneDist.light}`);
    assert(toneDist.warm >= 200, `Expected at least 200 warm questions; found ${toneDist.warm}`);

    // Dealbreakers, politics, and money must always be deep
    allQuestions
      .filter((q) => ["dealbreakers", "politics", "money"].includes(q.topic))
      .forEach((q) => assert.equal(questionTone(q), "deep", `Sensitive topic must be deep: ${q.id}`));

    // Fun topic must always be light
    allQuestions
      .filter((q) => q.topic === "fun")
      .forEach((q) => assert.equal(questionTone(q), "light", `Fun topic must be light: ${q.id}`));
  });

  it("enforces orderRoundAsRamp pacing invariants across standard and edge-case rounds", () => {
    // 1. Boundary cases
    assert.deepEqual(orderRoundAsRamp([]), [], "Empty array preserves empty output");
    assert.deepEqual(orderRoundAsRamp(["int_1"]), ["int_1"], "1-question round returns untouched");
    assert.deepEqual(orderRoundAsRamp(["int_1", "int_2"]), ["int_1", "int_2"], "2-question round returns untouched");

    const byId = new Map(allQuestions.map((q) => [q.id, q]));

    // 2. Multi-size ramp testing (5, 10, 15 questions) using deterministic slices
    for (const count of [5, 10, 15]) {
      // Pick a representative mix of questions (sliders, text, light, warm, deep)
      const inputQuestions = allQuestions.slice(0, count);
      const inputIds = inputQuestions.map((q) => q.id);
      const rampedIds = orderRoundAsRamp(inputIds);

      // Invariant: Conservation of questions
      assert.equal(rampedIds.length, count, `Ramp must preserve count ${count}`);
      assert.equal(new Set(rampedIds).size, count, "Ramp must not introduce duplicate IDs");
      assert.deepEqual(new Set(rampedIds), new Set(inputIds), "Ramp must contain identical question set");

      // Invariant: Opener is non-deep slider if available
      const opener = byId.get(rampedIds[0]);
      if (inputQuestions.some((q) => q.type === "slider" && questionTone(q) !== "deep")) {
        assert.equal(opener.type, "slider", "Opener must be a slider question");
        assert.notEqual(questionTone(opener), "deep", "Opener must not be deep");
      }

      // Invariant: Closer is non-deep if available
      const closer = byId.get(rampedIds[rampedIds.length - 1]);
      if (inputQuestions.some((q) => questionTone(q) !== "deep")) {
        assert.notEqual(questionTone(closer), "deep", "Closer must finish gently (not deep)");
      }

      // Invariant: Peak depth lands around 66% index
      const deepQuestions = rampedIds.map((id) => byId.get(id)).filter((q) => questionTone(q) === "deep");
      if (deepQuestions.length === 1) {
        const peakIdx = rampedIds.findIndex((id) => questionTone(byId.get(id)) === "deep");
        const expectedPeak = Math.max(1, Math.round(count * 0.66) - 1);
        assert(Math.abs(peakIdx - expectedPeak) <= 2, `Deepest question should land near 66% peak (${expectedPeak}), got ${peakIdx}`);
      }
    }

    // 3. Consecutive type run-smoothing: when given clustered alternating types of same tone
    const lightSliders = allQuestions.filter((q) => q.type === "slider" && questionTone(q) === "light").slice(0, 3);
    const lightTexts = allQuestions.filter((q) => q.type === "text" && questionTone(q) === "light").slice(0, 3);
    if (lightSliders.length === 3 && lightTexts.length === 3) {
      const clusteredIds = [...lightSliders, ...lightTexts].map((q) => q.id);
      const smoothedIds = orderRoundAsRamp(clusteredIds);
      for (let i = 2; i < smoothedIds.length - 1; i++) {
        const t0 = byId.get(smoothedIds[i - 2]).type;
        const t1 = byId.get(smoothedIds[i - 1]).type;
        const t2 = byId.get(smoothedIds[i]).type;
        assert(!(t0 === t1 && t1 === t2), `Run-smoothing should prevent 3 consecutive ${t0} questions at index ${i}`);
      }
    }
  });

  it("opens on a Fun slider when the round has one and never closes on a Fun prompt that could come early", () => {
    const byId = new Map(allQuestions.map((q) => [q.id, q]));
    const topicsInOrder = [...new Set(allQuestions.map((q) => q.topic))].filter((t) => t !== "fun");
    const funSliders = allQuestions.filter((q) => q.topic === "fun" && q.type === "slider");
    const funTexts = allQuestions.filter((q) => q.topic === "fun" && q.type === "text");
    const others = topicsInOrder.map((t) => allQuestions.filter((q) => q.topic === t));
    assert(funTexts.length > 0, "Catalog needs Fun text prompts");
    let checked = 0;
    // Deterministic sweep: Fun question placed LAST in selection order so selection order cannot rescue it.
    for (let seed = 0; seed < 60; seed += 1) {
      const filler = [];
      for (let k = 0; k < 4; k += 1) {
        const pool = others[(seed + k) % others.length];
        if (pool.length) filler.push(pool[(seed * 7 + k * 3) % pool.length]);
      }
      if (filler.length < 4) continue;
      const fun = seed % 2 === 0 && funSliders.length ? funSliders[seed % funSliders.length] : funTexts[seed % funTexts.length];
      const ids = [...filler.map((q) => q.id), fun.id];
      const ramped = orderRoundAsRamp(ids);
      assert.deepEqual(new Set(ramped), new Set(ids));
      const funIndex = ramped.indexOf(fun.id);
      // With two or more other gentle prompts, one can open and one can close, so Fun text belongs up front.
      const hasNonFunGentle = filler.filter((q) => questionTone(q) !== "deep").length >= 2;
      if (fun.type === "slider") {
        assert.equal(funIndex, 0, `Fun slider ${fun.id} should open the round, got index ${funIndex}`);
      } else if (hasNonFunGentle) {
        assert.notEqual(funIndex, ramped.length - 1, `Fun text ${fun.id} should not be the closer`);
        assert(funIndex <= 1, `Fun text ${fun.id} should land near the start, got index ${funIndex}`);
      }
      const closer = byId.get(ramped[ramped.length - 1]);
      // The opener takes one gentle prompt; a second one is needed for a gentle closer.
      if (ids.filter((id) => questionTone(byId.get(id)) !== "deep").length >= 2) assert.notEqual(questionTone(closer), "deep");
      checked += 1;
    }
    assert(checked > 20, "Sweep should cover a meaningful number of rounds");
  });

  it("detects semantic prompt twins to prevent duplicate-feeling questions in a round", () => {
    const qTwin1 = { id: "mock_1", prompt: "How much do you value physical affection when out in public?" };
    const qTwin2 = { id: "mock_2", prompt: "How comfortable are you with public affection?" };
    const qDistinct = { id: "mock_3", prompt: "Where do you see us living in five years?" };

    assert.equal(promptsAreTwins(qTwin1, qTwin2), true, "Public affection prompts must be recognized as twins");
    assert.equal(promptsAreTwins(qTwin1, qDistinct), false, "Distinct topics must not be twins");
    assert.equal(promptsAreTwins(qTwin1, qTwin1), false, "Identical ID should not twin with itself");
  });
});
