import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const teardown = html.match(/const handleUnloadTeardown = \(\) => \{[\s\S]*?\n    \};/);
assert(teardown, "handleUnloadTeardown not found");

function runTeardown(role) {
  const calls = [];
  const ctx = {
    nearbyRuntime: { role },
    nearbyLinked: () => Boolean(role),
    stopVoiceRecording: (opts) => calls.push(["voice", opts]),
    closeNearbyConnection: (opts) => calls.push(["close", opts])
  };
  vm.runInNewContext(`${teardown[0]}\nhandleUnloadTeardown();`, ctx);
  return calls;
}

describe("unload teardown (reload must not end the two-phone round)", () => {
  it("closes silently and keeps the saved session when paired", () => {
    const close = runTeardown("join").find((c) => c[0] === "close");
    assert(close, "connection should be closed on pagehide");
    assert.equal(close[1].notifyPartner, false, "a reload must not tell the partner we left");
    assert.equal(close[1].forgetSession, false, "a reload must keep the session so it can resume");
  });
  it("cancels any voice recording and does nothing else when unpaired", () => {
    const calls = runTeardown("");
    assert.equal(JSON.stringify(calls), JSON.stringify([["voice", { cancel: true }]]));
  });
  it("is registered on pagehide only, and bfcache restore resumes the round", () => {
    assert.match(html, /addEventListener\("pagehide", handleUnloadTeardown\)/);
    assert.doesNotMatch(html, /addEventListener\("beforeunload", handleUnloadTeardown\)/);
    assert.match(html, /event\.persisted && !handleNearbyJoinLaunch\(\) && resumeNearbySession\(\)/);
  });
});
