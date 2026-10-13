import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const html = readFileSync(resolve(root, "index.html"), "utf8");

describe("phone layout", () => {
  it("keeps the sr-only compass table inside a clipped wrapper so it cannot widen the page", () => {
    assert.ok(html.includes('<div class="sr-only"><table id="resonance-compass-table">'));
    assert.ok(!html.includes('<table class="sr-only"'), "a table ignores width/overflow, so it must not carry sr-only itself");
    const rule = html.match(/\n\s*\.sr-only \{[^}]*\}/)[0];
    assert.match(rule, /max-width: 1px/);
    assert.match(rule, /clip-path: inset\(50%\)/);
  });

  it("wraps milestones in the grid and keeps locked hints readable", () => {
    const fn = html.match(/function wildcardButtonInner\(active\) \{[\s\S]*?\n    \}/);
    assert.ok(fn, "wildcardButtonInner must exist");
    const inner = vm.runInNewContext(`(${fn[0]})`);
    assert.match(inner(false), /class="wildcard-label">Double Down</);
    assert.match(inner(true), /class="wildcard-label">Doubled Down</);
    assert.match(inner(true), /class="wildcard-short" aria-hidden="true">×2</);
    assert.ok(html.includes('return `<div class="milestones-grid">${badges.map('));
    assert.match(html, /\.milestone-desc \{[^}]*font-size: max\(12px, 0\.72rem\)/);
    assert.doesNotMatch(html.match(/\.milestone-badge \{[^}]*\}/)[0], /opacity/);
  });

  it("never shrinks score-call chips below the tap size", () => {
    assert.ok(!html.includes("min-width: 38px !important"));
    assert.match(html, /@media \(max-width: 353px\) \{\s*\.score-call \{ display: grid; grid-template-columns: repeat\(5, minmax\(var\(--tap, 48px\), 1fr\)\)/);
  });

  it("puts reveal chips and Double Down on the coarse 48px / 8px rule", () => {
    assert.match(html, /\.reaction-chip, \.wager-chip, \.wildcard-btn \{ min-height: var\(--tap\) !important; \}/);
    assert.match(html, /\.quick-guess, \.reaction-bar, \.card-wager-row\) \{ gap: 8px !important; \}/);
  });

  it("hides the sticky bar from Tab order and gates it on a finished, host-side round", () => {
    const bar = html.match(/\n    \.reveal-sticky-bar \{[^}]*\}/)[0];
    assert.match(bar, /visibility: hidden/);
    assert.match(bar, /width: max-content/);
    assert.match(html, /\.reveal-sticky-bar\.visible \{[^}]*visibility: visible/);
    assert.match(html, /const shouldShow = roundDone && !mainNewRound\.disabled && window\.scrollY > 350 && !mainVisible;/);
  });

  it("compacts the story reel in phone landscape", () => {
    assert.match(html, /@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.story-progress-bar/);
  });
});
