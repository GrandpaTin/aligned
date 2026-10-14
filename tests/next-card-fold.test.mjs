import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const currentDir = dirname(fileURLToPath(import.meta.url));
const indexPath = [resolve(currentDir, "..", "index.html"), resolve(process.cwd(), "index.html")].find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

const grab = (re, label) => {
  const match = html.match(re);
  assert(match, `Could not locate ${label}`);
  return match[0];
};

const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  grab(/function closedCardHint\(seen, verb\) \{[\s\S]*?\n    \}/, "closedCardHint"),
  grab(/function shouldFoldOnNext\(\{[^}]*\}\) \{[\s\S]*?\n    \}/, "shouldFoldOnNext"),
  "this.closedCardHint = closedCardHint; this.shouldFoldOnNext = shouldFoldOnNext;"
].join("\n"), ctx);

describe("Next card folds the finished card on phones", () => {
  const ready = { singleColumn: true, flipped: true, unrated: false, recording: false, timerRunning: false };

  it("folds a finished, open card on a one-column board", () => {
    assert.equal(ctx.shouldFoldOnNext(ready), true);
  });

  it("keeps desktop side-by-side cards open", () => {
    assert.equal(ctx.shouldFoldOnNext({ ...ready, singleColumn: false }), false);
  });

  it("never folds a card with unfinished work on it", () => {
    assert.equal(ctx.shouldFoldOnNext({ ...ready, flipped: false }), false);
    assert.equal(ctx.shouldFoldOnNext({ ...ready, unrated: true }), false);
    assert.equal(ctx.shouldFoldOnNext({ ...ready, recording: true }), false);
    assert.equal(ctx.shouldFoldOnNext({ ...ready, timerRunning: true }), false);
  });

  it("labels folded cards as seen and fresh ones as unrevealed", () => {
    assert.equal(ctx.closedCardHint(true, "Tap"), "✓ Seen · tap to reopen");
    assert.equal(ctx.closedCardHint(false, "Tap"), "Tap to reveal");
    assert.equal(ctx.closedCardHint(true, "Click"), "✓ Seen · click to reopen");
  });

  it("wires the fold through the existing reveal-state path, quietly", () => {
    assert.match(html, /toggleCard\(current, \{ focus: false, scroll: false, quiet: true \}\)/);
    // Track counting must split on whitespace: /s+/ would see "300px 300px" as one column and fold desktop boards.
    assert.match(html, /gridTemplateColumns\.trim\(\)\.split\(\/\\s\+\/\)\.length === 1/);
    assert.match(html, /if \(!quiet\) playSound\(soundKind,/);
    assert.match(html, /if \(audioAllowed\(\) && !quiet\) pulseHaptic\(soundKind\);/);
  });
});
