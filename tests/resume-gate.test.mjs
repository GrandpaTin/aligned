import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const escapeSrc = extractFunction("escapeHTML");
const confirmSrc = extractFunction("confirmResumeTurn");

function runConfirm(names, activePlayer) {
  let captured = null;
  const fn = new Function("state", "openConfirmDialog", `${escapeSrc}\n${confirmSrc}\nreturn { confirmResumeTurn, escapeHTML };`);
  const api = fn({ names, activePlayer }, (opts) => { captured = opts; return Promise.resolve(true); });
  api.confirmResumeTurn();
  return { opts: captured, escapeHTML: api.escapeHTML };
}

describe("resume-turn privacy gate", () => {
  it("passes raw names so openConfirmDialog escapes exactly once", () => {
    const { opts, escapeHTML } = runConfirm(["D'Angelo", "Tom & Jo"], 0);
    assert.equal(opts.title, "Resume D'Angelo’s turn?");
    assert.equal(opts.confirmLabel, "I am D'Angelo");
    assert.match(opts.copy, /only D'Angelo is viewing/);
    assert.equal(escapeHTML(opts.confirmLabel), "I am D&#039;Angelo");
    assert.equal(opts.safeFirst, true);
    assert.equal(opts.cancelLabel, "Not now");
  });

  it("falls back to a player label for a blank name", () => {
    const { opts } = runConfirm(["Avery", ""], 1);
    assert.equal(opts.confirmLabel, "I am Player 2");
  });

  it("Continue and the boot relaunch share the same gate", () => {
    const handlerAt = html.indexOf('getElementById("resume-round")?.addEventListener');
    assert.ok(handlerAt > 0);
    assert.match(html.slice(handlerAt, handlerAt + 600), /await confirmResumeTurn\(\)/);
    const boot = html.slice(html.lastIndexOf("if (!handleNearbyJoinLaunch()) {"));
    assert.match(boot, /relaunchTurnOwner/);
    assert.match(boot, /state\.playStyle !== "nearby" && state\.screen === "question"/);
    assert.match(boot, /confirmResumeTurn\(\)\.then/);
    // A comment, private note or guess typed before any answer is just as private as the answer.
    for (const key of ["answers", "comments", "privateNotes", "guesses"]) assert.ok(boot.includes(`"${key}"`), `boot gate ignores ${key}`);
    assert.doesNotMatch(confirmSrc, /escapeHTML/);
  });

  it("loadState itself never opens the gate (cross-tab sync and import reuse it)", () => {
    assert.doesNotMatch(extractFunction("loadState"), /confirmResumeTurn/);
  });
});
