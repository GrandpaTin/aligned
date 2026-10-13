import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve("c:/Users/DN/Desktop/Projects/Aligned-Game");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const appScript = scripts[1];

// Extract functions under test from index.html
const keepsakeMatch = appScript.match(/function openKeepsakeModal\(questions,\s*alignment\) \{[\s\S]*?\n    \}/);
assert(keepsakeMatch, "Could not find openKeepsakeModal in index.html");

const compassMatch = appScript.match(/function resonanceCompassMarkup\(rounds\) \{[\s\S]*?\n    \}/);
assert(compassMatch, "Could not find resonanceCompassMarkup in index.html");

const escapeFnMatch = appScript.match(/function escapeHTML\(str\) \{[\s\S]*?\n    \}/);
const escapeHTML = escapeFnMatch ? vm.runInNewContext(`(${escapeFnMatch[0]})`) : (s) => String(s);

const descFnMatch = appScript.match(/function alignmentDescriptor\(percent\) \{[\s\S]*?\n    \}/);
const alignmentDescriptor = descFnMatch ? vm.runInNewContext(`(${descFnMatch[0]})`) : (p) => ({ title: `Aligned ${p}` });

// Mock HTML5 Canvas 2D Context to trace coordinate operations
class MockContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
  }
  scale(x, y) { this.calls.push({ method: "scale", args: [x, y] }); }
  createLinearGradient(x0, y0, x1, y1) {
    return { addColorStop: () => {} };
  }
  fillRect(x, y, w, h) { this.calls.push({ method: "fillRect", args: [x, y, w, h] }); }
  strokeRect(x, y, w, h) { this.calls.push({ method: "strokeRect", args: [x, y, w, h] }); }
  roundRect(x, y, w, h, r) { this.calls.push({ method: "roundRect", args: [x, y, w, h, r] }); }
  beginPath() { this.calls.push({ method: "beginPath" }); }
  arc(x, y, r, s, e) { this.calls.push({ method: "arc", args: [x, y, r, s, e] }); }
  fill() { this.calls.push({ method: "fill" }); }
  stroke() { this.calls.push({ method: "stroke" }); }
  fillText(text, x, y) { this.calls.push({ method: "fillText", args: [text, x, y] }); }
}

class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.listeners = {};
    this.style = {};
  }
  setAttribute() {}
  addEventListener(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); }
  removeEventListener(event, fn) {
    if (this.listeners[event]) this.listeners[event] = this.listeners[event].filter((l) => l !== fn);
  }
  remove() { this.removed = true; }
  querySelector(sel) {
    if (sel === "#keepsake-canvas") return this.canvas;
    if (sel === "#keepsake-close") return this.closeBtn;
    if (sel === "#keepsake-download") return this.downloadBtn;
    if (sel === "#keepsake-share") return this.shareBtn;
    return null;
  }
  getContext() {
    if (!this.ctx) this.ctx = new MockContext2D(this);
    return this.ctx;
  }
}

function createKeepsakeHarness(dpr = 2) {
  let appendedModal = null;
  const mockDoc = {
    createElement(tag) {
      const el = new MockElement(tag);
      if (tag === "div") {
        el.canvas = new MockElement("canvas");
        el.closeBtn = new MockElement("button");
        el.downloadBtn = new MockElement("button");
        el.shareBtn = new MockElement("button");
      }
      return el;
    },
    body: {
      appendChild(child) { appendedModal = child; }
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = {
    window: { devicePixelRatio: dpr },
    navigator: { share: () => {} },
    document: mockDoc,
    state: { names: ["Sam", "Alex"] },
    currentRelationshipProfile: () => ({ icon: "♡", label: "Dating", fitLabel: "Chemistry" }),
    formatRoundDate: () => "October 13, 2026",
    TOPIC_OPTIONS: [
      { id: "connection", label: "Connection", icon: "♡" },
      { id: "fun", label: "Fun", icon: "✺" },
      { id: "future", label: "Future", icon: "↗" }
    ],
    localDateStamp: () => "2026-10-13",
    armBackGuard: () => {},
    showToast: () => {},
    playSound: () => {}
  };

  const openKeepsakeModal = vm.runInNewContext(`(${keepsakeMatch[0]})`, context);
  return { openKeepsakeModal, getAppended: () => appendedModal, context };
}

describe("Keepsake Card & Storybook Math Suite", () => {
  it("enforces 4:5 aspect ratio and exact 800x1000 logical coordinate bounds", () => {
    const { openKeepsakeModal, getAppended } = createKeepsakeHarness(2);
    openKeepsakeModal([], {
      overall: 88,
      fitOverall: 92,
      topics: [
        { topic: "connection", score: 95 },
        { topic: "fun", score: 85 }
      ]
    });

    const modal = getAppended();
    assert(modal, "Modal overlay must be appended to document.body");
    const canvas = modal.canvas;
    const ctx = canvas.ctx;

    // Verify 4:5 aspect ratio
    assert.equal(800 / 1000, 4 / 5, "Logical dimensions must be 4:5 ratio");
    assert.equal(canvas.width / canvas.height, 4 / 5, "Physical canvas dimensions must maintain 4:5 ratio");

    // Outer card border must inset 30px symmetrically (800-60 = 740, 1000-60 = 940)
    const borderCall = ctx.calls.find((c) => c.method === "strokeRect");
    assert.deepEqual(borderCall?.args, [30, 30, 740, 940], "Card border stroke must be [30, 30, 740, 940]");

    // Verify all text elements center at x = 400
    const textCalls = ctx.calls.filter((c) => c.method === "fillText");
    const centeredTexts = textCalls.filter((c) => c.args[1] === 400);
    assert(centeredTexts.length >= 7, "Core text elements must be centered at x=400");
    assert(centeredTexts.some((c) => c.args[0] === "✦  A L I G N E D  ✦" && c.args[2] === 95));
    assert(centeredTexts.some((c) => c.args[0] === "Sam & Alex" && c.args[2] === 160));
    assert(centeredTexts.some((c) => c.args[0] === "88%" && c.args[2] === 386));
    assert(centeredTexts.some((c) => c.args[0] === "92% CHEMISTRY" && c.args[2] === 530));
    assert(centeredTexts.some((c) => c.args[0] === "TOP TOPIC ALIGNMENTS" && c.args[2] === 595));
    assert(centeredTexts.some((c) => c.args[0].startsWith("Played together on") && c.args[2] === 890));
    assert(centeredTexts.some((c) => c.args[0] === "grandpatin.github.io/aligned" && c.args[2] === 920));

    // Topic badge pills centered at x=400 (w=520, left=140: 140 + 520/2 = 400)
    const pillCalls = ctx.calls.filter((c) => c.method === "roundRect");
    assert.equal(pillCalls.length, 2, "Must render exactly 2 topic alignment pills");
    assert.deepEqual(pillCalls[0].args, [140, 616, 520, 36, 18], "Topic pill 1 must be centered with [140, 616, 520, 36, 18]");
    assert.deepEqual(pillCalls[1].args, [140, 662, 520, 36, 18], "Topic pill 2 must be offset by 46px vertically");
  });

  it("scales canvas for high-DPI displays with clamping [2, 3] and purges backing memory on close", () => {
    // 1x DPR clamped to 2x (prevents blurry canvas on standard desktop)
    const harness1 = createKeepsakeHarness(1);
    harness1.openKeepsakeModal([], { overall: 75, topics: [] });
    assert.equal(harness1.getAppended().canvas.width, 1600);
    assert.equal(harness1.getAppended().canvas.height, 2000);
    assert.deepEqual(harness1.getAppended().canvas.ctx.calls[0], { method: "scale", args: [2, 2] });

    // 2.5x DPR scales accurately
    const harness25 = createKeepsakeHarness(2.5);
    harness25.openKeepsakeModal([], { overall: 75, topics: [] });
    assert.equal(harness25.getAppended().canvas.width, 2000);
    assert.equal(harness25.getAppended().canvas.height, 2500);
    assert.deepEqual(harness25.getAppended().canvas.ctx.calls[0], { method: "scale", args: [2.5, 2.5] });

    // 4x DPR clamped to 3x (prevents memory blowout on 4K/retina mobile screens)
    const harness4 = createKeepsakeHarness(4);
    harness4.openKeepsakeModal([], { overall: 75, topics: [] });
    assert.equal(harness4.getAppended().canvas.width, 2400);
    assert.equal(harness4.getAppended().canvas.height, 3000);
    assert.deepEqual(harness4.getAppended().canvas.ctx.calls[0], { method: "scale", args: [3, 3] });

    // Verify GPU memory purge on close
    const modal = harness4.getAppended();
    assert.equal(modal.canvas.width, 2400);
    modal.closeBtn.listeners.click[0]();
    assert.equal(modal.canvas.width, 0, "Canvas width must be zeroed to free GPU memory");
    assert.equal(modal.canvas.height, 0, "Canvas height must be zeroed to free GPU memory");
    assert(modal.removed, "Modal overlay must be detached from DOM");
  });

  it("calculates accurate score ring arc angles and classifies duo titles", () => {
    const testCases = [
      { score: 95, expectedTitle: "Telepathic Duo ✦", expectedAngleFraction: 0.95 },
      { score: 85, expectedTitle: "Harmonious Sparks ★", expectedAngleFraction: 0.85 },
      { score: 72, expectedTitle: "Dynamic Duo ⚡", expectedAngleFraction: 0.72 },
      { score: 60, expectedTitle: "Complementary Opposites ⇄", expectedAngleFraction: 0.60 },
      { score: 40, expectedTitle: "Spirited Explorers ✧", expectedAngleFraction: 0.40 },
      { score: 0,  expectedTitle: "Spirited Explorers ✧", expectedAngleFraction: 0.00 },
      { score: -10, expectedTitle: "Aligned Duo", expectedAngleFraction: 0.00 }, // Fallback title, clamped to 0 rad
      { score: 110, expectedTitle: "Telepathic Duo ✦", expectedAngleFraction: 1.00 }   // Clamped high
    ];

    for (const tc of testCases) {
      const { openKeepsakeModal, getAppended } = createKeepsakeHarness(2);
      openKeepsakeModal([], { overall: tc.score, topics: [] });
      const modal = getAppended();
      const ctx = modal.canvas.ctx;

      // Check duo title in subtitle
      const subtitleCall = ctx.calls.find((c) => c.method === "fillText" && c.args[2] === 200);
      assert(
        subtitleCall.args[0].includes(tc.expectedTitle),
        `Score ${tc.score} must map to duo title "${tc.expectedTitle}", got: ${subtitleCall.args[0]}`
      );

      // Check arc geometry: ring at (400, 370) with radius 110
      const arcCalls = ctx.calls.filter((c) => c.method === "arc" && c.args[0] === 400 && c.args[1] === 370 && c.args[2] === 110);
      assert.equal(arcCalls.length, 2, "Must call background circle arc and foreground score arc");

      const scoreArc = arcCalls[1];
      const startAngle = scoreArc.args[3];
      const endAngle = scoreArc.args[4];
      assert.equal(startAngle, -Math.PI / 2, "Arc start angle must be -PI/2 (12 o'clock)");
      const expectedEnd = -Math.PI / 2 + Math.PI * 2 * tc.expectedAngleFraction;
      assert(
        Math.abs(endAngle - expectedEnd) < 1e-6,
        `Score ${tc.score} arc end angle must be ${expectedEnd}, got ${endAngle}`
      );
    }
  });

  it("normalizes SVG Resonance Compass geometry, clamps radial bounds [20, 100], and rolls up depth topics", () => {
    const resonanceCompassMarkup = vm.runInNewContext(`(${compassMatch[0]})`, {
      escapeHTML,
      alignmentDescriptor
    });

    // Case 1: Empty history uses fallback 75% across all 6 axes
    const emptyMarkup = resonanceCompassMarkup([]);
    assert(emptyMarkup.includes('<svg class="radar-svg" viewBox="0 0 220 220"'), "Radar must use 220x220 coordinate viewBox");
    assert(emptyMarkup.includes('<button class="secondary-btn" id="open-storybook-btn"'), "Stand-alone radar renders Storybook trigger button");

    // In Storybook mode: trigger button is hidden to prevent recursive modal spawning
    const storybookMarkup = resonanceCompassMarkup([], { inStorybook: true });
    assert(!storybookMarkup.includes("open-storybook-btn"), "Storybook mode must suppress #open-storybook-btn");

    // Case 2: Specialty topics ("spicy", "money", "politics", "dealbreakers", "lore") rollup into Depth axis
    const specialtyRounds = [
      {
        alignment: {
          topics: [
            { topic: "connection", score: 100 },
            { topic: "lore", score: 90 },
            { topic: "spicy", score: 85 },
            { topic: "money", score: 65 }
          ]
        }
      }
    ];
    const specMarkup = resonanceCompassMarkup(specialtyRounds);
    // Depth average: (90 + 85 + 65) / 3 = 240 / 3 = 80%
    assert(specMarkup.includes("<td>80%</td>"), "Specialty topics lore/spicy/money must average into Depth dimension (80%)");
    assert(specMarkup.includes("<td>100%</td>"), "Connection dimension must score 100%");

    // Case 3: Radial bounds clamping (min 20% floor prevents polygon collapse, max 100% ceiling)
    const clampedRounds = [
      {
        alignment: {
          topics: [
            { topic: "connection", score: 5 }, // Below 20 -> clamped to 20
            { topic: "lifestyle", score: 120 } // Above 100 -> clamped to 100
          ]
        }
      }
    ];
    const clampedMarkup = resonanceCompassMarkup(clampedRounds);
    // Connection axis is angle -PI/2 (straight up).
    // cx = 110, cy = 110, maxR = 64.
    // For 20%: r = 64 * 0.20 = 12.8 -> x = 110, y = 110 - 12.8 = 97.2
    assert(clampedMarkup.includes('cx="110.0" cy="97.2"'), "Floor clamp (20%) must locate connection vertex at (110.0, 97.2)");

    // For 100% (lifestyle: angle = -PI/2 + PI/3 = -PI/6 = -30 deg):
    // cos(-30) = sqrt(3)/2 ~= 0.866025, sin(-30) = -0.5
    // r = 64.0 -> x = 110 + 64 * 0.866025 = 165.4, y = 110 + 64 * (-0.5) = 78.0
    assert(clampedMarkup.includes('cx="165.4" cy="78.0"'), "Ceiling clamp (100%) must locate lifestyle vertex at (165.4, 78.0)");
  });
});
