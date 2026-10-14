import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const teaseSrc = html.match(/function handoffTease\(finishedIndex, finishedPlayer\) \{[\s\S]*?\n    \}/);
const escapeSrc = html.match(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/);
assert(teaseSrc && escapeSrc, "Could not locate handoffTease/escapeHTML");

function run(state, index, name) {
  const ctx = { state };
  vm.runInNewContext(`${escapeSrc[0]}\n${teaseSrc[0]}\nthis.out = handoffTease(${index}, ${JSON.stringify(name)});`, ctx);
  return ctx.out;
}

describe("Hand-off tease on the lock screen", () => {
  it("shows nothing without guesses", () => {
    assert.equal(run({ selectedQuestionIds: ["a", "b"], guesses: [{}, {}], wildcards: [null, null] }, 0, "Avery"), "");
    assert.equal(run({ selectedQuestionIds: ["a"] }, 0, "Avery"), "");
  });

  it("counts only numeric guesses on this round's questions", () => {
    const out = run({ selectedQuestionIds: ["a", "b", "c"], guesses: [{ a: 3, b: 7, z: 5, c: "x" }, {}], wildcards: [null, null] }, 0, "Avery");
    assert.match(out, /Avery made 2 guesses about you\./);
    assert.doesNotMatch(out, /doubled/);
  });

  it("uses the singular and mentions a doubled-down wildcard", () => {
    const out = run({ selectedQuestionIds: ["a", "b"], guesses: [{}, { b: 4 }], wildcards: [null, "b"] }, 1, "Sam");
    assert.match(out, /Sam made a guess about you and doubled down on one\./);
  });

  it("does not claim a double down on a card with no guess", () => {
    const out = run({ selectedQuestionIds: ["a", "b"], guesses: [{ a: 6 }, {}], wildcards: ["b", null] }, 0, "Avery");
    assert.match(out, /Avery made a guess about you\./);
    assert.doesNotMatch(out, /doubled/);
  });

  it("never leaks values or question ids, and escapes the name", () => {
    const out = run({ selectedQuestionIds: ["int_42"], guesses: [{ int_42: 9 }], wildcards: ["int_42"] }, 0, "<b>Jo</b>");
    assert.doesNotMatch(out, /int_42|<b>/);
    assert.doesNotMatch(out.replace(/<[^>]+>/g, ""), /9/);
    assert.match(out, /&lt;b&gt;Jo&lt;\/b&gt;/);
  });
});
