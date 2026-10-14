import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");
const grab = (re, tail) => {
  const m = html.match(re);
  assert(m, `Could not locate ${re}`);
  return m[0].replace(tail, "");
};
const handleCode = grab(/function handleNearbyMessage\(message\) \{[\s\S]*?\n    function /, /\n    function $/);
const mergeCode = grab(/function mergeNearbyDailyRitual\(remote\) \{[\s\S]*?\n    function /, /\n    function $/);
const helloCode = grab(/function sendNearbyHello\(\) \{[\s\S]*?\n    function /, /\n    function $/);

function makeContext(role, overrides = {}) {
  const sent = [];
  const saves = { count: 0 };
  const state = {
    playStyle: "nearby",
    nearbyRoundId: "round_1",
    screen: "reveal",
    names: ["Avery", "Jordan"],
    selectedQuestionIds: ["q1", "q2"],
    revealedIds: [],
    seenIds: [],
    turnBasedReveal: false,
    activeTurn: 0,
    ambientMix: role === "host" ? { synth: 0.1, rain: 0.9, hearth: 0.4 } : { synth: 0.8, rain: 0, hearth: 0 },
    dailyRitual: { completedDates: [], answers: {}, streak: 0, lastDate: "" },
    notReady: [{}, {}],
    answers: [{}, {}],
    ...overrides
  };
  const banner = { textContent: "" };
  const ctx = {
    state,
    nearbyRuntime: { role, partnerLeft: false },
    nearbyMixSentThisLink: false,
    nearbyOfflineHidden: { roundId: "", ids: new Set() },
    APP_VERSION: "1.6.1",
    compareVersions: () => 0,
    showToast: () => {},
    playSound: () => {},
    saveState: () => { saves.count += 1; },
    render: () => {},
    updateNearbyBanner: () => {},
    nearbyRoundFinished: () => true,
    nearbyLocalPlayer: () => (role === "host" ? 0 : 1),
    nearbyPlayerPayload: () => ({}),
    triggerFloatingReaction: () => {},
    localDateStamp: () => "2026-10-13",
    calculateStreakFromDates: () => 1,
    document: { getElementById: () => null, querySelector: (sel) => (sel === ".turn-banner strong" ? banner : null) },
    ambientSoundscape: { isPlaying: false, updateMix: () => {} },
    cardSeen: () => false,
    goldenCardId: () => "",
    getSelectedQuestions: () => [],
    revealMatchInfo: () => null,
    replayPartnerFlips: () => {},
    noteRevealStreak: () => 0,
    showStreakPop: () => {},
    sendNearbyMessage: (payload) => { sent.push(payload); },
    refreshRevealFromPartner: () => {},
    syncLatestRoundSnapshot: () => {},
    dismissConfirmDialogs: () => {},
    finishNearbyRoundIfReady: () => {},
    closeNearbyConnection: () => {}
  };
  vm.runInNewContext(`${mergeCode}\n${helloCode}\n${handleCode}`, ctx);
  return { ctx, state, sent, banner, saves };
}

const msg = (payload) => ({ data: JSON.stringify(payload) });

describe("two-phone hello", () => {
  it("does not send daily-ritual answers or dates", () => {
    const host = makeContext("host", { screen: "setup", nearbyRoundId: "", dailyRitual: { completedDates: ["2026-10-13"], answers: { "2026-10-13": "private" } } });
    host.ctx.sendNearbyHello();
    const hello = host.sent.find((p) => p.type === "hello");
    assert(hello, "hello sent");
    assert.equal(hello.dailyRitual, undefined);
    assert(!JSON.stringify(hello).includes("private"));
  });

  it("ignores a 1.6.0 partner's ritual answers and dates", () => {
    const join = makeContext("join", { screen: "setup", nearbyRoundId: "" });
    join.ctx.handleNearbyMessage(msg({
      type: "hello",
      role: "host",
      dailyRitual: { completedDates: ["2026-10-13", "zzzz"], answers: { "2026-10-13": "I felt unheard" } }
    }));
    assert.deepEqual(join.state.dailyRitual.completedDates, []);
    assert.deepEqual(join.state.dailyRitual.answers, {});
    assert.equal(join.state.dailyRitual.lastDate, "");
  });

  it("converges on the host's ambient mix instead of swapping", () => {
    const host = makeContext("host", { screen: "setup", nearbyRoundId: "" });
    const join = makeContext("join", { screen: "setup", nearbyRoundId: "" });
    const hostMix = { ...host.state.ambientMix };
    host.ctx.sendNearbyHello();
    join.ctx.sendNearbyHello();
    const hostHello = host.sent.find((p) => p.type === "hello");
    const joinHello = join.sent.find((p) => p.type === "hello");
    host.ctx.handleNearbyMessage(msg(joinHello));
    join.ctx.handleNearbyMessage(msg(hostHello));
    assert.deepEqual({ ...host.state.ambientMix }, hostMix, "host keeps its mix");
    assert.deepEqual({ ...join.state.ambientMix }, hostMix, "join adopts the host's mix");
    // A second reconnect must not flip anything.
    host.ctx.handleNearbyMessage(msg(joinHello));
    assert.deepEqual({ ...host.state.ambientMix }, hostMix);
  });

  it("lets a joiner that flushed an offline mix change keep it instead of swapping", () => {
    const host = makeContext("host", { screen: "setup", nearbyRoundId: "" });
    const join = makeContext("join", { screen: "setup", nearbyRoundId: "", ambientMix: { synth: 0.2, rain: 0.9, hearth: 0 } });
    const joinMix = { ...join.state.ambientMix };
    host.ctx.sendNearbyHello();
    const hostHello = host.sent.find((p) => p.type === "hello");
    // flushNearbyOutbox delivered the queued ambient-mix on this link; the host adopts it via the ambient-mix handler.
    join.ctx.nearbyMixSentThisLink = true;
    host.ctx.handleNearbyMessage(msg({ type: "ambient-mix", mix: joinMix }));
    join.ctx.handleNearbyMessage(msg(hostHello));
    assert.deepEqual({ ...join.state.ambientMix }, joinMix, "join keeps its offline change");
    assert.deepEqual({ ...host.state.ambientMix }, joinMix, "host adopts the queued change");
  });

  it("keeps the joiner's mix off the wire so a 1.6.0 host cannot adopt it", () => {
    const join = makeContext("join", { screen: "setup", nearbyRoundId: "" });
    join.ctx.sendNearbyHello();
    const joinHello = JSON.parse(JSON.stringify(join.sent.find((p) => p.type === "hello")));
    assert.equal(joinHello.role, "join");
    // 1.6.0 receivers adopt any hello mix guarded only by this check.
    assert.ok(!(joinHello.ambientMix && typeof joinHello.ambientMix === "object"));
  });
});

describe("turn-based reveal sync", () => {
  it("enters turn mode from a turn-only reveal-state", () => {
    const join = makeContext("join");
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", turn: { on: true, active: 0 } }));
    assert.equal(join.state.turnBasedReveal, true);
    assert.equal(join.state.activeTurn, 0);
    assert.deepEqual([...join.state.revealedIds], []);
  });

  it("adopts the sender's post-flip turn exactly once and applies the change", () => {
    const host = makeContext("host", { turnBasedReveal: true, activeTurn: 1 });
    const payload = { type: "reveal-state", roundId: "round_1", change: { id: "q1", revealed: true }, turn: { on: true, active: 0 } };
    host.ctx.handleNearbyMessage(msg(payload));
    assert.equal(host.state.activeTurn, 0);
    assert.equal(host.banner.textContent, "Avery’s turn");
    assert.deepEqual([...host.state.revealedIds], ["q1"]);
    host.ctx.handleNearbyMessage(msg(payload));
    assert.equal(host.state.activeTurn, 0, "a duplicate delivery does not advance the turn");
  });

  it("adopts the turn carried on a reveal-all message", () => {
    const join = makeContext("join", { screen: "celebration", turnBasedReveal: true, activeTurn: 0 });
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", all: true, turn: { on: true, active: 1 } }));
    assert.equal(join.state.activeTurn, 1);
    assert.deepEqual([...join.state.revealedIds], ["q1", "q2"]);
  });

  it("sanitises a malformed turn value", () => {
    const join = makeContext("join");
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", turn: { on: "yes", active: 7 } }));
    assert.equal(join.state.turnBasedReveal, false);
    assert.equal(join.state.activeTurn, 0);
  });
});

describe("offline hides across a reconnect", () => {
  it("keeps a card hidden offline hidden when the partner's union snapshot still has it", () => {
    const join = makeContext("join", { revealedIds: ["q2"] });
    join.ctx.nearbyOfflineHidden = { roundId: "round_1", ids: new Set(["q1"]) };
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", revealedIds: ["q1", "q2"] }));
    assert.deepEqual([...join.state.revealedIds], ["q2"]);
    assert.equal(join.ctx.nearbyOfflineHidden.ids.size, 0, "the skip applies to the first snapshot only");
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", revealedIds: ["q1", "q2"] }));
    assert.deepEqual([...join.state.revealedIds].sort(), ["q1", "q2"]);
  });

  it("stops skipping a card once the partner sends a change for it", () => {
    const join = makeContext("join", { revealedIds: [] });
    join.ctx.nearbyOfflineHidden = { roundId: "round_1", ids: new Set(["q1", "q2"]) };
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", change: { id: "q1", revealed: true } }));
    assert.deepEqual([...join.ctx.nearbyOfflineHidden.ids], ["q2"]);
  });

  it("ignores the offline set for a different round", () => {
    const join = makeContext("join", { revealedIds: [] });
    join.ctx.nearbyOfflineHidden = { roundId: "round_0", ids: new Set(["q1"]) };
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", revealedIds: ["q1"] }));
    assert.deepEqual([...join.state.revealedIds], ["q1"]);
  });

  it("lets an explicit partner reveal-all win over offline hides", () => {
    const join = makeContext("join", { screen: "celebration", revealedIds: [] });
    join.ctx.nearbyOfflineHidden = { roundId: "round_1", ids: new Set(["q1"]) };
    join.ctx.handleNearbyMessage(msg({ type: "reveal-state", roundId: "round_1", all: true }));
    assert.deepEqual([...join.state.revealedIds], ["q1", "q2"]);
    assert.equal(join.ctx.nearbyOfflineHidden.ids.size, 0);
  });
});

describe("partner reactions", () => {
  const reactionCode = grab(/function triggerFloatingReaction\(emoji, originX, originY\) \{[\s\S]*?\n    function /, /\n    function $/);
  it("places a partner burst on this screen and keeps sparks with the clamped emoji", () => {
    const sparks = [];
    const span = { style: { setProperty: () => {} }, addEventListener: () => {} };
    const ctx = {
      window: { innerWidth: 412, innerHeight: 800 },
      document: { createElement: () => span, body: { appendChild: () => {} } },
      triggerSparkles: (x, y) => sparks.push([x, y]),
      state: { hapticsEnabled: false },
      navigator: {},
      Math, Number
    };
    vm.runInNewContext(reactionCode, ctx);
    ctx.triggerFloatingReaction("x", 1366 * 0.5, 768 * 0.75);
    assert.equal(span.style.left, "364px");
    assert.ok(sparks[0][0] <= 412, "sparks stay inside a narrow viewport");
    assert.equal(handleCode.includes("triggerFloatingReaction(payload.emoji, payload.x"), false, "receiver ignores the sender's pixel coordinates");
  });
});
