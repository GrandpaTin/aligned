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
  grab(/const ROW_FILL_MAX_GAP = \d+;/, "ROW_FILL_MAX_GAP"),
  grab(/function shouldFillOpenRow\(heights, allFlipped\) \{[\s\S]*?\n    \}/, "shouldFillOpenRow"),
  grab(/function flipScrollBlock\(\{[^}]*\}\) \{[\s\S]*?\n    \}/, "flipScrollBlock"),
  "this.shouldFillOpenRow = shouldFillOpenRow; this.flipScrollBlock = flipScrollBlock;"
].join("\n"), ctx);

describe("Reveal board row fill", () => {
  it("evens out an open row whose cards are close in height", () => {
    assert.equal(ctx.shouldFillOpenRow([640, 700, 720], true), true);
  });

  it("leaves a row ragged when one card is far taller than the rest", () => {
    assert.equal(ctx.shouldFillOpenRow([655, 970], true), false);
  });

  it("never fills single cards or rows with a closed card", () => {
    assert.equal(ctx.shouldFillOpenRow([700], true), false);
    assert.equal(ctx.shouldFillOpenRow([700, 710], false), false);
  });

  it("uses the shared gap in fillOpenRow", () => {
    assert.match(html, /function fillOpenRow\(row\) \{[\s\S]*?shouldFillOpenRow\(heights,/);
  });
});

describe("Scroll after flipping a card", () => {
  const view = { viewTop: 84, viewBottom: 737 };

  it("does not scroll a card that already fits", () => {
    assert.equal(ctx.flipScrollBlock({ top: 120, bottom: 600, ...view }), null);
  });

  it("aligns a card taller than the viewport to its top", () => {
    assert.equal(ctx.flipScrollBlock({ top: 309, bottom: 1066, ...view }), "start");
  });

  it("aligns a card that fits but sits below the fold to its top", () => {
    assert.equal(ctx.flipScrollBlock({ top: 500, bottom: 900, ...view }), "start");
  });

  it("measures the target height, not the stale closed box", () => {
    assert.match(html, /const targetHeight = parseFloat\(card\.style\.height\) \|\| rect\.height;/);
    assert.match(html, /flipScrollBlock\(\{ top: rect\.top, bottom: rect\.top \+ targetHeight,/);
  });

  it("no longer scrolls flipped cards with a bare nearest", () => {
    assert.doesNotMatch(html, /card\.scrollIntoView\(\{ block: "nearest", behavior/);
  });
});
