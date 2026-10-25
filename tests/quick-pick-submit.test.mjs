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
  grab(/function quickPickSubmitWaiting\(question, playerIndex, questionIndex, totalQuestions\) \{[\s\S]*?\n    \}/, "quickPickSubmitWaiting")
];

function makeContext() {
  const ctx = { state: { answers: [{}, {}], notReady: [{}, {}] } };
  vm.createContext(ctx);
  vm.runInContext(sources.join("\n") + "\nthis.waiting = quickPickSubmitWaiting;", ctx);
  return ctx;
}

const pick = { id: "q_pick", type: "slider", labels: ["Plan", "Wing it"], quickPick: true };
const slider = { id: "q_slide", type: "slider", labels: ["Low", "High"], quickPick: false, prompt: "x" };
const text = { id: "q_text", type: "text" };

describe("Quick-pick Next button stays quiet until a side is chosen", () => {
  it("is quiet on a fresh pick question before the last card", () => {
    const ctx = makeContext();
    assert.equal(ctx.waiting(pick, 0, 0, 5), true);
  });
  it("promotes once a side (or in-between value) is answered", () => {
    const ctx = makeContext();
    ctx.state.answers[0].q_pick = 9;
    assert.equal(ctx.waiting(pick, 0, 0, 5), false);
    ctx.state.answers[0].q_pick = 5;
    assert.equal(ctx.waiting(pick, 0, 0, 5), false);
  });
  it("promotes when the player opts out with not ready", () => {
    const ctx = makeContext();
    ctx.state.notReady[0].q_pick = true;
    assert.equal(ctx.waiting(pick, 0, 0, 5), false);
  });
  it("keeps full weight on the last card (Lock my answers)", () => {
    const ctx = makeContext();
    assert.equal(ctx.waiting(pick, 0, 4, 5), false);
  });
  it("reads only the active player's answer", () => {
    const ctx = makeContext();
    ctx.state.answers[1].q_pick = 2;
    assert.equal(ctx.waiting(pick, 0, 0, 5), true);
    assert.equal(ctx.waiting(pick, 1, 0, 5), false);
  });
  it("never applies to plain sliders, text questions or a missing question", () => {
    const ctx = makeContext();
    assert.equal(ctx.waiting(text, 0, 0, 5), false);
    assert.equal(ctx.waiting(null, 0, 0, 5), false);
    if (!vm.runInContext("isQuickPickQuestion", ctx)(slider)) assert.equal(ctx.waiting(slider, 0, 0, 5), false);
  });
});

describe("Hint link opens Add context on fine pointers", () => {
  it("renders a real button and wires it to the comment details", () => {
    assert.match(html, /class="text-btn quick-pick-context-link" data-open-context>open “Add context”<\/button>/);
    assert.match(html, /querySelector\("\[data-open-context\]"\)\?\.addEventListener\("click"/);
  });
  it("falls back to plain text on coarse pointers so no sub-48px target appears", () => {
    assert.match(html, /@media \(pointer: coarse\) \{\s*\.quick-pick-hint \.quick-pick-context-link \{ display: none; \}/);
  });
});
