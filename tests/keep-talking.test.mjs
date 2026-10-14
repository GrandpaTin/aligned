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

const source = [
  grab(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/, "escapeHTML"),
  grab(/function followThroughMarkup\(question, tools = ""\) \{[\s\S]*?\n    \}/, "followThroughMarkup")
].join("\n");

function render({ status = "", timer, voice, manual, tools = "<i data-tools></i>" } = {}) {
  const ctx = {
    state: {
      conversationStatus: status ? { q1: status } : {},
      voiceNotes: voice ? { q1: "data:audio/webm;base64,AA" } : {},
      sharedIntentions: [],
      questionFlags: {}
    },
    discussionTimers: timer ? { q1: { isOpen: true } } : {},
    keepTalkingOpen: new Set(manual ? ["q1"] : []),
    importanceMarkup: () => "<b data-importance></b>"
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nthis.out = followThroughMarkup({ id: "q1" }, ${JSON.stringify(tools)});`, ctx);
  return ctx.out;
}

describe("Keep talking drawer", () => {
  it("is renamed and lists the folded-in tools", () => {
    const out = render();
    assert.match(out, /Keep talking/);
    assert.match(out, /2-min timer · voice memory/);
    assert.doesNotMatch(out, /Save for later/);
  });

  it("puts the tools inside the drawer before the importance rating", () => {
    const out = render();
    const summaryEnd = out.indexOf("</summary>");
    const tools = out.indexOf("data-tools");
    assert(summaryEnd > 0 && tools > summaryEnd, "tools sit after the summary");
    assert(tools < out.indexOf("data-importance"), "tools come before importance");
    assert(tools < out.lastIndexOf("</details>"), "tools sit inside the drawer");
  });

  it("stays closed by default and opens for a status, an open timer or a saved memory", () => {
    const isOpen = (out) => /<details class="card-more"\s+open>/.test(out);
    assert.equal(isOpen(render()), false);
    assert.equal(isOpen(render({ status: "talk" })), true);
    assert.equal(isOpen(render({ timer: true })), true);
    assert.equal(isOpen(render({ voice: true })), true);
    assert.equal(isOpen(render({ manual: true })), true, "a drawer opened by hand stays open across re-renders");
  });

  it("remembers a hand-opened drawer through the toggle event", () => {
    assert.match(html, /const keepTalkingOpen = new Set\(\);/);
    assert.match(html, /querySelectorAll\("\.flip-card \.card-more"\)\.forEach\(\(details\) => details\.addEventListener\("toggle"/);
    assert.match(html, /if \(details\.open\) keepTalkingOpen\.add\(id\);\n\s*else keepTalkingOpen\.delete\(id\);/);
  });

  it("still works for callers that pass no tools", () => {
    const ctx = { state: { conversationStatus: {}, voiceNotes: {}, sharedIntentions: [], questionFlags: {} }, discussionTimers: {}, keepTalkingOpen: new Set(), importanceMarkup: () => "" };
    vm.createContext(ctx);
    vm.runInContext(`${source}\nthis.out = followThroughMarkup({ id: "q1" });`, ctx);
    assert.doesNotMatch(ctx.out, /undefined/);
  });

  it("moves the timer and voice memory off the bare card back", () => {
    assert.match(html, /\$\{followThroughMarkup\(question, tools\)\}\n\s*<div class="card-back-actions">/);
    assert.match(html, /const tools = `\n\s*<div class="discussion-timer-area"/);
    assert.match(html, /Open “Keep talking” on any revealed card/);
  });
});
