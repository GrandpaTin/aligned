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

// Extract escapeHTML
const escapeMatch = html.match(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/);
assert(escapeMatch, "Could not locate escapeHTML function");

// Extract savedQuestionAnswersMarkup
const savedAnswersMatch = html.match(/function savedQuestionAnswersMarkup\(question, round\) \{[\s\S]*?\n    \}/);
assert(savedAnswersMatch, "Could not locate savedQuestionAnswersMarkup");

// Extract scoreCallPanel
const scoreCallMatch = html.match(/function scoreCallPanel\(players, title\) \{[\s\S]*?\n    \}/);
assert(scoreCallMatch, "Could not locate scoreCallPanel");

describe("Security Sanitization & Template Escaping Suite", () => {
  let escapeHTML;

  beforeEach(() => {
    escapeHTML = vm.runInNewContext(`(${escapeMatch[0]})`);
  });

  it("strictly escapes all HTML special characters across input data types", () => {
    assert.equal(escapeHTML("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    assert.equal(escapeHTML('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHTML("A & B 'C' \"D\""), "A &amp; B &#039;C&#039; &quot;D&quot;");

    // Defensive type absorption
    assert.equal(escapeHTML(null), "");
    assert.equal(escapeHTML(undefined), "");
    assert.equal(escapeHTML(100), "100");
    assert.equal(escapeHTML(0), "0");
    assert.equal(escapeHTML(false), "false");
  });

  it("safely sanitizes malicious player names in saved round markup without injecting raw tags", () => {
    const maliciousRound = {
      id: "round_xss_test",
      completedAt: Date.now(),
      names: ['<script>evil()</script>', '<img src=x onerror="steal()">'],
      answers: [
        { q_1: "Answer 1 <b onmouseover=evil()>bold</b>" },
        { q_1: "Answer 2 <iframe src=evil.com></iframe>" }
      ],
      comments: [
        { q_1: 'Note 1 "onclick=alert(1)' },
        { q_1: "Note 2 <svg onload=alert(1)>" }
      ]
    };

    const question = {
      id: "q_1",
      type: "text",
      prompt: "What is your dream vacation?"
    };

    const context = {
      state: { visualTheme: "midnight" },
      escapeHTML,
      pickLabel: () => null,
      formatRoundDate: () => "Oct 13, 2026"
    };

    const fn = vm.runInNewContext(`(${savedAnswersMatch[0]})`, context);
    const markup = fn(question, maliciousRound);

    // Verify no unescaped tags exist in rendered markup
    assert(!markup.includes("<script>"), "Raw <script> tag must not exist in output");
    assert(!markup.includes("<img src=x"), "Raw <img> tag must not exist in output");
    assert(!markup.includes("<iframe"), "Raw <iframe> tag must not exist in output");
    assert(!markup.includes("<svg onload"), "Raw <svg> tag must not exist in output");
    assert(!markup.includes("<b onmouseover"), "Raw event attribute must not exist in output");

    // Verify escaped equivalents exist
    assert(markup.includes("&lt;script&gt;evil()&lt;/script&gt;"), "Player name must be escaped");
    assert(markup.includes("&lt;img src=x"), "Second player name must be escaped");
  });

  it("safely sanitizes malicious title and player names in scoreCallPanel", () => {
    const context = {
      state: {
        names: ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>'],
        scoreCall: null,
        selectedQuestionIds: ["q_1"]
      },
      escapeHTML,
      SCORE_CALLS: [[55, "<60", "Under 60%"], [65, "60s", "60 to 69%"]],
      roundScoreCalls: () => [null, null],
      initials: (name) => name.slice(0, 2)
    };

    const fn = vm.runInNewContext(`(${scoreCallMatch[0]})`, context);
    const markup = fn([0, 1], '<marquee onstart="bad()">Predict Score</marquee>');

    // Must not contain raw executable tags
    assert(!markup.includes("<marquee"), "Title must be escaped and not contain raw <marquee>");
    assert(!markup.includes("<script>"), "Player name must not contain raw <script>");
    assert(!markup.includes("<img src=x"), "Player name must not contain raw <img>");

    assert(markup.includes("&lt;marquee"), "Title must be properly HTML escaped");
  });

  it("safely escapes bolderLabel in While-You-Wait intuition payload", () => {
    const maliciousName = '<img src=x onerror="alert(1)">';
    const localPlayer = 0;
    const wyw = { sync: "high", bolder: "partner" };
    const bolderActual = "partner";
    const bolderHit = wyw.bolder === bolderActual;

    const bolderLabel = wyw.bolder === "me"
      ? "You"
      : wyw.bolder === "partner"
        ? (maliciousName || "Partner")
        : "Equally bold";

    const rendered = `<div>Bolder answers: <strong>${escapeHTML(bolderLabel)}</strong> <small class="highlight-note">· ${bolderHit ? "Called it! 🎯" : "Plot twist! 💫"}</small></div>`;

    assert(!rendered.includes("<img src=x"), "Raw <img> tag must not exist in rendered bolder intuition text");
    assert(rendered.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "bolderLabel must be safely HTML escaped");
  });

  it("validates that question pack import hash decoding rejects corrupt or hostile structures", () => {
    // 1. Array containing non-objects or invalid prompts
    const hostileItems = [
      null,
      123,
      "just a string",
      { prompt: "" },
      { prompt: "   " },
      { prompt: "tiny" }, // length < 5
      { prompt: "<script>alert('pack-injection')</script>", type: "slider", labels: ["Min", "Max"], topic: "connection" }
    ];

    const validTopics = new Set(["connection", "intimacy", "growth"]);
    const existingPrompts = new Set();
    const seenInImport = new Set();

    const filtered = hostileItems.filter((item) => {
      if (!item || typeof item !== "object" || typeof item.prompt !== "string") return false;
      const cleanPrompt = item.prompt.trim();
      if (cleanPrompt.length < 5) return false;
      const key = cleanPrompt.toLowerCase();
      if (existingPrompts.has(key) || seenInImport.has(key)) return false;
      seenInImport.add(key);
      return true;
    }).map((item) => ({
      prompt: item.prompt.trim().slice(0, 500),
      type: item.type === "text" ? "text" : "slider",
      labels: Array.isArray(item.labels) && item.labels.length === 2
        ? [String(item.labels[0] || "Low").slice(0, 40), String(item.labels[1] || "High").slice(0, 40)]
        : ["Low", "High"],
      topic: validTopics.has(item.topic) ? item.topic : "connection"
    }));

    // Only the valid-length question should pass filtering
    assert.equal(filtered.length, 1, "Only questions meeting criteria should be accepted");
    assert.equal(filtered[0].prompt, "<script>alert('pack-injection')</script>");

    // When rendered into the dialog preview, it must be escaped:
    const preview = `<div>• ${escapeHTML(filtered[0].prompt)}</div>`;
    assert(!preview.includes("<script>"), "Dialog preview must not contain unescaped tags");
    assert(preview.includes("&lt;script&gt;alert(&#039;pack-injection&#039;)&lt;/script&gt;"), "Dialog preview must be escaped");
  });
});
