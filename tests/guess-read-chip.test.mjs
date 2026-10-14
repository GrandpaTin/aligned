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

const sources = [
  grab(/function isQuickPickQuestion\(question\) \{[\s\S]*?\n    \}/, "isQuickPickQuestion"),
  grab(/function guessHit\(question, playerIndex\) \{[\s\S]*?\n    \}/, "guessHit"),
  grab(/function guessReadText\(question\) \{[\s\S]*?\n    \}/, "guessReadText")
];

function makeContext(extra = {}) {
  const ctx = { state: { names: ["Casey", "Riley"], answers: [{}, {}], guesses: [{}, {}], notReady: [{}, {}], wildcards: [null, null], ...extra } };
  vm.createContext(ctx);
  vm.runInContext(sources.join("\n") + "\nthis.guessReadText = guessReadText;", ctx);
  return ctx;
}

describe("A correct guess gets its own chip on the flip", () => {
  const slider = { id: "q_s", type: "slider", prompt: "Spontaneity?" };

  it("is silent without a hit", () => {
    const ctx = makeContext();
    assert.equal(ctx.guessReadText(slider), "");
    assert.equal(ctx.guessReadText(null), "");
    ctx.state.guesses[0].q_s = 2; ctx.state.answers[1].q_s = 9;
    assert.equal(ctx.guessReadText(slider), "");
  });

  it("names who read whom", () => {
    const ctx = makeContext();
    ctx.state.guesses[1].q_s = 6; ctx.state.answers[0].q_s = 7;
    assert.equal(ctx.guessReadText(slider), "🔮 Riley read Casey!");
    ctx.state.guesses[0].q_s = 4; ctx.state.answers[1].q_s = 4;
    assert.equal(ctx.guessReadText(slider), "🔮 Casey & Riley read each other!");
  });

  it("mentions a Double Down that paid off", () => {
    const ctx = makeContext({ wildcards: ["q_s", null] });
    ctx.state.guesses[0].q_s = 8; ctx.state.answers[1].q_s = 9;
    assert.equal(ctx.guessReadText(slider), "★ Casey read Riley! Double Down paid off");
  });

  it("skips not-ready cards and falls back on missing names", () => {
    const ctx = makeContext({ names: ["", ""] });
    ctx.state.guesses[0].q_s = 5; ctx.state.answers[1].q_s = 5;
    assert.equal(ctx.guessReadText(slider), "🔮 Player 1 read Player 2!");
    ctx.state.notReady[1].q_s = true;
    assert.equal(ctx.guessReadText(slider), "");
  });

  it("speaks the read with the reveal and keeps the chip on narrow cards", () => {
    assert.match(html, /showStreakPop\(card, 0, \{ text: readText, speak: false \}\)/);
    assert.match(html, /announce\(`\$\{qNum\} revealed: \$\{matchVerdict\}\.\$\{readSpoken\}`\)/);
    assert.match(html, /\.streak-pop\.read-pop \{ max-width: calc\(100% - 24px\); overflow: hidden; text-overflow: ellipsis; \}/);
  });
});
