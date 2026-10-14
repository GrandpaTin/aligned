import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test("A-12: the tour opens at its first step on short landscape phones", () => {
  const body = extractFunction("openTutorial");
  assert.match(body, /#tutorial-finish"\)\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(body, /#tutorial-finish"\)\.focus\(\)/);
  assert.match(body, /tutorialDialog\.scrollTop = 0/);
});

test("A-11: opening the board paints the press before the board's first layout", () => {
  const body = extractFunction("renderCelebration");
  const handler = body.slice(body.indexOf("openBoardBtn.addEventListener"));
  assert.ok(handler.indexOf("Opening…") >= 0, "tap gives visible feedback");
  assert.ok(handler.indexOf("Opening…") < handler.indexOf("requestAnimationFrame"), "feedback is set before the deferral");
  assert.ok(handler.indexOf("requestAnimationFrame(() => window.setTimeout(") < handler.indexOf("render()"), "render waits for the pressed frame");
  assert.match(handler, /if \(openBoardBtn\.disabled \|\| state\.screen !== "celebration"\) return;/, "double taps are ignored");
});

test("A-11: unopened card backs skip layout until their first flip, one-way", () => {
  assert.match(html, /class="flip-card\$\{isFlipped \? " flipped" : " cold-back"\}/);
  const apply = extractFunction("applyCardState");
  assert.match(apply, /if \(shouldReveal\) card\.classList\.remove\("cold-back"\);/);
  assert.doesNotMatch(apply, /classList\.add\("cold-back"\)/);
  assert.match(html, /@supports \(content-visibility: hidden\) \{\s*\.flip-card\.cold-back:not\(\.flipped\) \.card-back \{ content-visibility: hidden; \}/);
});

test("A-13: the score unlock reads ring targets without forcing a restyle and saves outside the frame", () => {
  const body = extractFunction("celebrateScoreUnlock");
  assert.doesNotMatch(body, /getComputedStyle\(ring\)/);
  assert.match(body, /ring\.style\.getPropertyValue\("--ring-score"\)/);
  assert.match(body, /state\.revealCelebrated = roundKey;\s*\/\/[^\n]*\n\s*window\.setTimeout\(saveState, 0\);/);
  // alignmentRingMarkup must keep writing the score inline for the read above to hold.
  assert.match(extractFunction("alignmentRingMarkup"), /style="--ring-score: \$\{score\};/);
});

test("A-13: the rating rebuild runs before the snapshot save, which stays flushable", () => {
  const start = html.indexOf("            ratingRenderQueued = false;\n");
  assert.ok(start >= 0);
  const block = html.slice(start, html.indexOf("}, 0));", html.indexOf("window.scrollBy", start)));
  assert.ok(block.indexOf("window.setTimeout(() => {") < block.indexOf("render();"));
  assert.match(block, /if \(!roundSnapshotSavePending\) return;\s*roundSnapshotSavePending = false;\s*syncLatestRoundSnapshot\(\);\s*saveState\(\);/);
});

test("A-58: the offline copy drops the unusable apple-touch-icon line instead of inlining it", () => {
  const build = fs.readFileSync(path.join(root, "scripts", "build-offline.mjs"), "utf8");
  assert.doesNotMatch(build, /apple-touch-icon\.png"\)\)/, "the touch icon is no longer read or base64-encoded");
  assert.ok(build.includes(`['  <link rel="apple-touch-icon" href="apple-touch-icon.png">\\n', ""]`));
  // The build's guard throws if the line it removes ever changes; keep the hosted page's line intact.
  assert.ok(html.includes('  <link rel="apple-touch-icon" href="apple-touch-icon.png">\n'));
});
