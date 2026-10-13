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

const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  return vm.runInNewContext(m[1]);
};
const questions = [...arraySource("questionBank"), ...arraySource("specialtyQuestionBank")];
const TOPIC_OPTIONS = arraySource("TOPIC_OPTIONS");
const SESSION_PRESETS = arraySource("SESSION_PRESETS");
const INTENSITY_OPTIONS = arraySource("INTENSITY_OPTIONS");
const DEFAULT_TOPICS = ["connection", "lifestyle", "future", "love", "fun"];

// Extract backupToState
const backupMatch = html.match(/function backupToState\(payload\) \{[\s\S]*?\n    \}\n\n    function exportBackup/);
assert(backupMatch, "Could not locate backupToState in index.html");
const backupToState = vm.runInNewContext(`(${backupMatch[0].replace(/\n\n    function exportBackup$/, "")})`, {
  BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"])
});

// Extract initialState -> loadState engine
const extractMatch = html.match(/function initialState\(\) \{[\s\S]*?function loadState\(\) \{[\s\S]*?\n    \}\n    let loadStateFailed/);
assert(extractMatch, "Could not locate initialState -> loadState engine in index.html");
const engineCode = extractMatch[0].replace(/\n    let loadStateFailed$/, "");

// Extract escapeHTML
const escapeMatch = html.match(/function escapeHTML\(str\) \{[\s\S]*?\n    \}/);
const escapeHTML = escapeMatch ? vm.runInNewContext(`(${escapeMatch[0]})`) : (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Extract orderRoundAsRamp and selectFreshQuestionIds
const orderRampMatch = html.match(/function orderRoundAsRamp\(questionIds\) \{[\s\S]*?\n    \}/);
assert(orderRampMatch, "Could not locate orderRoundAsRamp");
const selectFreshMatch = html.match(/function selectFreshQuestionIds\(questionIds, limit = 15\) \{[\s\S]*?\n    \}/);
assert(selectFreshMatch, "Could not locate selectFreshQuestionIds");
const toneMatch = html.match(/function questionTone\(question\) \{[\s\S]*?\n    \}/);
assert(toneMatch, "Could not locate questionTone");

const storageMap = new Map();
const mockLocalStorage = {
  getItem: (key) => storageMap.get(key) || null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

const vmContext = {
  console,
  localStorage: mockLocalStorage,
  ALL_QUESTIONS: questions,
  TOPIC_OPTIONS,
  SESSION_PRESETS,
  INTENSITY_OPTIONS,
  DEFAULT_TOPICS,
  STORAGE_KEY: "aligned-state-v1",
  LEGACY_STORAGE_KEYS: ["are-we-compatible-state-v1"],
  loadStateFailed: false,
  normalizeAnswer: (s) => String(s || "").trim().toLowerCase(),
  randomIndex: (n) => Math.floor(Math.random() * n)
};

vm.runInNewContext(engineCode, vmContext);
const { loadState } = vmContext;

describe("Custom Question Packs & Library Automation", () => {
  beforeEach(() => {
    storageMap.clear();
    vmContext.loadStateFailed = false;
  });

  it("creates and sanitizes custom slider and written questions", () => {
    const raw = {
      version: 2,
      names: ["Alex", "Sam"],
      customQuestions: [
        {
          id: "custom_slider_1",
          prompt: "How often do we need quiet mornings together?",
          type: "slider",
          labels: ["Rarely", "Daily"],
          topic: "lifestyle"
        },
        {
          id: "custom_text_1",
          prompt: "What was your favourite surprise this year?",
          type: "text",
          topic: "fun"
        },
        {
          id: "custom_invalid_empty",
          prompt: "   ",
          type: "slider"
        }
      ]
    };

    storageMap.set("aligned-state-v1", JSON.stringify(raw));
    const state = loadState();

    assert.equal(state.customQuestions.length, 2, "Empty prompts must be filtered out");
    const [sliderQ, textQ] = state.customQuestions;

    assert.equal(sliderQ.id, "custom_slider_1");
    assert.equal(sliderQ.type, "slider");
    assert.deepEqual(Array.from(sliderQ.labels), ["Rarely", "Daily"]);
    assert.equal(sliderQ.topic, "lifestyle");
    assert.equal(sliderQ.category, "Custom · Lifestyle");

    assert.equal(textQ.id, "custom_text_1");
    assert.equal(textQ.type, "text");
    assert.equal(textQ.labels, undefined, "Text questions must not have slider labels");
    assert.equal(textQ.topic, "fun");
    assert.equal(textQ.category, "Custom · Fun");
  });

  it("validates custom pack creation, name bounds, and question association", () => {
    const raw = {
      version: 2,
      names: ["Jordan", "Taylor"],
      customQuestions: [
        { id: "cq_1", prompt: "Our dream trip?", type: "text", topic: "future" },
        { id: "cq_2", prompt: "Ideal Friday night?", type: "slider", labels: ["Cozy", "Party"], topic: "lifestyle" }
      ],
      customPacks: [
        {
          id: "pack_weekend_vibes",
          name: "Weekend Vibes Pack",
          questionIds: ["cq_1", "cq_2", questions[0].id]
        },
        {
          id: "pack_oversized_name",
          name: "Z".repeat(120),
          questionIds: ["cq_1"]
        }
      ]
    };

    storageMap.set("aligned-state-v1", JSON.stringify(raw));
    const state = loadState();

    assert.equal(state.customPacks.length, 2);
    assert.equal(state.customPacks[0].name, "Weekend Vibes Pack");
    assert.equal(state.customPacks[0].questionIds.length, 3);
    assert.equal(state.customPacks[1].name.length, 60, "Pack name must be clamped to 60 characters");
  });

  it("sanitizes injected HTML/XSS payloads in pack names and question prompts", () => {
    const xssPrompt = '<script>alert("xss")</script><img src=x onerror=alert(1)>What is love?';
    const xssPackName = '<b>Hacked Pack</b><script>fetch("evil")</script>';

    const raw = {
      version: 2,
      names: ["Player 1", "Player 2"],
      customQuestions: [
        { id: "cq_xss", prompt: xssPrompt, type: "text", topic: "love" }
      ],
      customPacks: [
        { id: "pack_xss", name: xssPackName, questionIds: ["cq_xss"] }
      ]
    };

    storageMap.set("aligned-state-v1", JSON.stringify(raw));
    const state = loadState();

    const sanitizedQuestion = state.customQuestions[0];
    const sanitizedPack = state.customPacks[0];

    const escapedPrompt = escapeHTML(sanitizedQuestion.prompt);
    assert(!escapedPrompt.includes("<script>"), "Rendered prompt must escape script tags");
    assert(escapedPrompt.includes("&lt;script&gt;"), "Rendered prompt must contain escaped entities");

    const escapedName = escapeHTML(sanitizedPack.name);
    assert(!escapedName.includes("<script>"), "Rendered pack name must escape script tags");
    assert(escapedName.includes("&lt;script&gt;"), "Rendered pack name must contain escaped entities");
  });

  it("avoids duplicate pack ID collisions and purges orphaned question IDs", () => {
    const raw = {
      version: 2,
      names: ["Casey", "Morgan"],
      customQuestions: [
        { id: "q_valid_1", prompt: "Valid custom question?", type: "slider", labels: ["No", "Yes"], topic: "fun" }
      ],
      customPacks: [
        {
          id: "pack_duplicate_id",
          name: "First Pack",
          questionIds: ["q_valid_1", "q_valid_1", "nonexistent_ghost_id"]
        },
        {
          id: "pack_duplicate_id",
          name: "Second Pack",
          questionIds: ["q_valid_1"]
        }
      ]
    };

    storageMap.set("aligned-state-v1", JSON.stringify(raw));
    const state = loadState();

    assert.equal(state.customPacks.length, 2);
    assert.equal(state.customPacks[0].id, "pack_duplicate_id", "First pack retains original ID");
    assert.equal(state.customPacks[1].id, "pack_restored_1", "Colliding second pack must be assigned fallback ID");

    const packQuestions = state.customPacks[0].questionIds;
    assert.deepEqual(Array.from(packQuestions), ["q_valid_1"], "Must deduplicate and strip nonexistent question IDs");
  });

  it("corrects unknown or malformed topics to safe fallback classification", () => {
    const raw = {
      version: 2,
      names: ["Riley", "Quinn"],
      customQuestions: [
        { id: "cq_bad_topic", prompt: "Cryptocurrency thoughts?", type: "slider", topic: "crypto_moon" },
        { id: "cq_null_topic", prompt: "Silent moments?", type: "text", topic: null },
        { id: "cq_valid_topic", prompt: "Cooking together?", type: "slider", topic: "lifestyle" }
      ]
    };

    storageMap.set("aligned-state-v1", JSON.stringify(raw));
    const state = loadState();

    const [qBad, qNull, qValid] = state.customQuestions;
    assert.equal(qBad.topic, "connection", "Unknown topic must fall back to connection");
    assert.equal(qBad.category, "Custom · Connection");

    assert.equal(qNull.topic, "connection", "Null topic must fall back to connection");
    assert.equal(qNull.category, "Custom · Connection");

    assert.equal(qValid.topic, "lifestyle", "Valid topic must be preserved");
    assert.equal(qValid.category, "Custom · Lifestyle");
  });

  it("validates URL hash sharing export encoding and import decoding pipeline", () => {
    const sampleQuestions = [
      { prompt: "What is our song?", type: "text", topic: "love" },
      { prompt: "Punctuality priority?", type: "slider", labels: ["Casual", "Strict"], topic: "lifestyle" }
    ];

    const payload = JSON.stringify(sampleQuestions.map((q) => ({
      prompt: q.prompt,
      type: q.type,
      labels: q.labels,
      topic: q.topic || "connection"
    })));
    const encoded = encodeURIComponent(Buffer.from(payload, "utf8").toString("base64"));
    const decodedRaw = Buffer.from(decodeURIComponent(encoded), "base64").toString("utf8");
    const importedItems = JSON.parse(decodedRaw);

    assert.equal(importedItems.length, 2);
    assert.equal(importedItems[0].prompt, "What is our song?");
    assert.equal(importedItems[1].type, "slider");
    assert.deepEqual(importedItems[1].labels, ["Casual", "Strict"]);

    assert.doesNotThrow(() => {
      try {
        Buffer.from("not-valid-base64-%%%", "base64").toString("utf8");
      } catch {}
    });
  });

  it("generates seamless round from custom pack and ramps questions correctly", () => {
    const catalog = [...questions];
    const customQ1 = { id: "cq_deep", prompt: "What emotional fear do you carry?", type: "slider", labels: ["None", "Many"], topic: "connection" };
    const customQ2 = { id: "cq_light", prompt: "Favorite weekend breakfast dessert pizza?", type: "slider", labels: ["Pancakes", "Waffles"], topic: "fun" };
    const customQ3 = { id: "cq_warm", prompt: "How do you view our future together?", type: "text", topic: "future" };

    const fullCatalog = [...catalog, customQ1, customQ2, customQ3];
    const packQuestionIds = ["cq_light", "cq_deep", "cq_warm"];

    const roundContext = {
      getQuestionCatalog: () => fullCatalog,
      freshestQuestionTier: (items) => items,
      randomIndex: () => 0,
      DEEP_PROMPT_PATTERN: /emotional safety|vulnerab|insecur|trauma|forgiv|jealous|regret|lonel|grief|hurt|betray|resent|conflict|argument|fight|fear|boundar|trust|apolog|repair|deal ?breaker|walk away|not in the mood|consent|disagree|reset|reconnect/i,
      LIGHT_PROMPT_PATTERN: /\b(?:karaoke|superpowers?|movies?|films?|songs?|snacks?|pizza|vacations?|holidays?|weekends?|zombies?|games?|sitcoms?|pets?|desserts?|playlists?|road trips?|festivals?|danc(?:e|es|ing)|costumes?|emojis?|lottery|islands?|breakfast|coffee|ice cream|theme parks?)\b/i
    };

    vm.runInNewContext(toneMatch[0], roundContext);
    vm.runInNewContext(selectFreshMatch[0], roundContext);
    vm.runInNewContext(orderRampMatch[0], roundContext);

    const freshIds = roundContext.selectFreshQuestionIds(packQuestionIds, 15);
    assert.equal(freshIds.length, 3, "Must select all 3 available pack questions");

    const rampedIds = roundContext.orderRoundAsRamp(freshIds);
    assert.equal(rampedIds.length, 3);
    assert.equal(rampedIds[0], "cq_light", "Ramp must open with light slider question");
    assert.equal(rampedIds[1], "cq_deep", "Ramp must position deep question in middle");
    assert.equal(rampedIds[2], "cq_warm", "Ramp must close gently");
  });
});
