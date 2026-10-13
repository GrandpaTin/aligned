import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html"),
  resolve(process.cwd(), "Aligned-Game", "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract core WebRTC connection, queueing, and state synchronization functions from index.html
const channelOpenMatch = html.match(/function nearbyChannelOpen\(\) \{[\s\S]*?\n    \}/);
assert(channelOpenMatch, "Could not locate nearbyChannelOpen in index.html");

const outboxMatch = html.match(/function sendNearbyMessage\(payload[\s\S]*?\n    function flushNearbyOutbox\(\) \{[\s\S]*?\n    \}/);
assert(outboxMatch, "Could not locate sendNearbyMessage and flushNearbyOutbox in index.html");

const attachMatch = html.match(/function attachNearbyChannel\(channel\) \{[\s\S]*?\n    function createNearbyPeer/);
assert(attachMatch, "Could not locate attachNearbyChannel in index.html");

const channelLostMatch = html.match(/function handleNearbyChannelLost\(channel\) \{[\s\S]*?\n    \}/);
assert(channelLostMatch, "Could not locate handleNearbyChannelLost in index.html");

const remoteSyncMatch = html.match(/function noteRemoteStamp\(at\) \{[\s\S]*?\n    function mergeNearbyDailyRitual/);
assert(remoteSyncMatch, "Could not locate remote sync methods (remoteWins, acceptRemote*) in index.html");

const extractedCode = [
  channelOpenMatch[0],
  outboxMatch[0],
  attachMatch[0].replace(/\n    function createNearbyPeer$/, ""),
  channelLostMatch[0],
  remoteSyncMatch[0].replace(/\n    function mergeNearbyDailyRitual$/, "")
].join("\n\n");

function createMockChannel(initialState = "connecting") {
  const listeners = {};
  const sent = [];
  return {
    readyState: initialState,
    __lost: false,
    __manualClose: false,
    bufferedAmount: 0,
    sent,
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type;
      (listeners[type] || []).forEach((fn) => fn(event));
    },
    send(str) {
      if (this.readyState !== "open" || this.__lost) {
        throw new Error("InvalidStateError: RTCDataChannel is not open");
      }
      sent.push(JSON.parse(str));
    }
  };
}

function createReconnectionContext(role = "host") {
  const bannerUpdates = [];
  const playedSounds = [];
  const timeouts = [];
  const intervals = [];

  const state = {
    version: 2,
    playStyle: "nearby",
    nearbyRole: role,
    nearbyRoundId: "round_rec_888",
    screen: "question",
    names: ["Host Alex", "Joiner Sam"],
    selectedQuestionIds: ["q_1", "q_2", "q_3", "q_4", "q_5"],
    revealedIds: [],
    seenIds: [],
    ambientMix: { synth: 0.8, rain: 0, hearth: 0 },
    cardWagers: {},
    conversationStatus: {},
    conversationTimes: {},
    textRatings: {},
    textRatingTimes: {},
    sharedIntentions: [],
    syncSeenAt: 0,
    answers: [{ q_1: 5 }, { q_1: 8 }],
    guesses: [{}, {}],
    comments: [{}, {}],
    importance: [{}, {}],
    notReady: [{}, {}],
    completedPlayers: {}
  };

  const nearbyRuntime = {
    role,
    status: "connecting",
    partnerLeft: false,
    partnerProgress: null,
    partnerTyping: false
  };

  const ctx = {
    state,
    nearbyRuntime,
    nearbyDataChannel: null,
    nearbyOutbox: [],
    nearbyNegotiationFailures: 0,
    nearbyPeerLostTimer: 0,
    nearbyAutoStartTimer: 0,
    nearbyLastPeerMessageAt: 0,
    nearbyPeerWatchTimer: 0,
    NEARBY_PEER_SILENCE_MS: 40000,
    bannerUpdates,
    playedSounds,
    clearTimeout: (id) => {},
    clearInterval: (id) => {},
    window: {
      setTimeout: (fn, delay) => {
        timeouts.push({ fn, delay });
        return timeouts.length;
      },
      setInterval: (fn, delay) => {
        intervals.push({ fn, delay });
        return intervals.length;
      }
    },
    app: {
      querySelector: () => null
    },
    document: {
      activeElement: null
    },
    CSS: {
      escape: (s) => s
    },
    updateNearbyBanner: () => {
      bannerUpdates.push(Date.now());
    },
    setNearbyStatus: (status) => {
      nearbyRuntime.status = status;
    },
    playSound: (name) => {
      playedSounds.push(name);
    },
    sendNearbyHello: () => {},
    handleNearbyMessage: () => {},
    randomIndex: () => 1
  };

  vm.createContext(ctx);
  vm.runInContext(extractedCode, ctx);
  return ctx;
}

describe("WebRTC Reconnection Outbox & Deduplication Test Suite", () => {
  it("1.1: Queues stateful answer submissions, wager bets, reveal flips, and ambientMix when channel is disconnected or connecting", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("connecting");
    ctx.attachNearbyChannel(channel);

    assert.equal(ctx.nearbyChannelOpen(), false, "Channel in connecting state must not be reported as open");

    // Answer submission
    const answerPayload = {
      type: "player-complete",
      roundId: "round_rec_888",
      player: 0,
      answers: { q_1: 8, q_2: "Honesty and warmth" },
      guesses: { q_1: 7 },
      comments: { q_1: "Loved discussing this" },
      importance: { q_1: 2 },
      notReady: {}
    };
    const answerResult = ctx.sendNearbyMessage(answerPayload);
    assert.equal(answerResult, false, "sendNearbyMessage must return false when queueing");
    assert.equal(ctx.nearbyOutbox.length, 1);
    assert.equal(ctx.nearbyOutbox[0].key, "player-complete:");
    assert.deepEqual(ctx.nearbyOutbox[0].payload, answerPayload);

    // Wager bet
    const wagerPayload = {
      type: "wager",
      questionId: "q_1",
      wager: "match",
      roundId: "round_rec_888",
      at: 1000
    };
    const wagerResult = ctx.sendNearbyMessage(wagerPayload);
    assert.equal(wagerResult, false);
    assert.equal(ctx.nearbyOutbox.length, 2);
    assert.equal(ctx.nearbyOutbox[1].key, "wager:q_1");

    // Reveal flip
    const flipPayload = {
      type: "reveal-state",
      roundId: "round_rec_888",
      change: { id: "q_1", revealed: true }
    };
    const flipResult = ctx.sendNearbyMessage(flipPayload);
    assert.equal(flipResult, false);
    assert.equal(ctx.nearbyOutbox.length, 3);
    assert.equal(ctx.nearbyOutbox[2].key, "reveal-state:q_1");

    // AmbientMix volume
    const ambientPayload = {
      type: "ambient-mix",
      mix: { synth: 0.35, rain: 0.65, hearth: 0.2 }
    };
    const ambientResult = ctx.sendNearbyMessage(ambientPayload);
    assert.equal(ambientResult, false);
    assert.equal(ctx.nearbyOutbox.length, 4);
    assert.equal(ctx.nearbyOutbox[3].key, "ambient-mix:");

    // Follow-through status
    const followPayload = {
      type: "follow-through",
      roundId: "round_rec_888",
      questionId: "q_2",
      status: "ground",
      at: 1200
    };
    ctx.sendNearbyMessage(followPayload);
    assert.equal(ctx.nearbyOutbox.length, 5);
    assert.equal(ctx.nearbyOutbox[4].key, "follow-through:q_2");

    // Channel must not have transmitted any message yet
    assert.equal(channel.sent.length, 0);
  });

  it("1.2: Bypasses queueing for ephemeral notifications when { queue: false } is requested", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("connecting");
    ctx.attachNearbyChannel(channel);

    const typingMsg = { type: "typing", roundId: "round_rec_888", isTyping: true };
    const deliveredMsg = { type: "delivered", roundId: "round_rec_888" };

    assert.equal(ctx.sendNearbyMessage(typingMsg, { queue: false }), false);
    assert.equal(ctx.sendNearbyMessage(deliveredMsg, { queue: false }), false);
    assert.equal(ctx.nearbyOutbox.length, 0, "Ephemeral messages with queue: false must not enter outbox");
  });

  it("1.3: Queues messages safely when channel is marked lost (__lost = true)", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("open");
    ctx.attachNearbyChannel(channel);
    assert.equal(ctx.nearbyChannelOpen(), true);

    ctx.handleNearbyChannelLost(channel);
    assert.equal(channel.__lost, true);
    assert.equal(ctx.nearbyChannelOpen(), false, "Channel marked __lost must not be open");

    const result = ctx.sendNearbyMessage({ type: "ambient-mix", mix: { synth: 0.5 } });
    assert.equal(result, false);
    assert.equal(ctx.nearbyOutbox.length, 1);
  });

  it("2.1: Automatically flushes queued messages in FIFO order when channel transitions to open", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("connecting");
    ctx.attachNearbyChannel(channel);

    ctx.sendNearbyMessage({ type: "player-complete", roundId: "round_rec_888", player: 0, answers: { q_1: 9 } });
    ctx.sendNearbyMessage({ type: "wager", questionId: "q_1", wager: "match", roundId: "round_rec_888" });
    ctx.sendNearbyMessage({ type: "reveal-state", roundId: "round_rec_888", change: { id: "q_3", revealed: true } });
    ctx.sendNearbyMessage({ type: "ambient-mix", mix: { synth: 0.6, rain: 0.4, hearth: 0.1 } });

    assert.equal(ctx.nearbyOutbox.length, 4);
    assert.equal(channel.sent.length, 0);

    // Transition channel to open
    channel.readyState = "open";
    assert.equal(ctx.nearbyChannelOpen(), true);

    // Fire open event
    channel.dispatchEvent("open");

    // Outbox drained and sent via RTCDataChannel
    assert.equal(ctx.nearbyOutbox.length, 0, "Outbox must be drained completely");
    assert.equal(channel.sent.length, 4, "All 4 messages must be sent over data channel");
    assert.equal(channel.sent[0].type, "player-complete");
    assert.equal(channel.sent[1].type, "wager");
    assert.equal(channel.sent[2].type, "reveal-state");
    assert.equal(channel.sent[3].type, "ambient-mix");
    assert.equal(ctx.bannerUpdates.length > 0, true, "updateNearbyBanner must be called upon flush");
  });

  it("2.2: Idempotent flush: subsequent channel open events with empty outbox do not resend packets", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("open");
    ctx.attachNearbyChannel(channel);

    ctx.nearbyOutbox = [];
    channel.dispatchEvent("open");

    assert.equal(channel.sent.length, 0, "No packets sent when outbox was empty");
  });

  it("3.1: Deduplicates rapid ambientMix and answer submissions (Latest-Wins per key)", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("closed");
    ctx.attachNearbyChannel(channel);

    // Volume slider dragged rapidly
    ctx.sendNearbyMessage({ type: "ambient-mix", mix: { synth: 0.1, rain: 0.0, hearth: 0.0 } });
    ctx.sendNearbyMessage({ type: "ambient-mix", mix: { synth: 0.4, rain: 0.2, hearth: 0.1 } });
    ctx.sendNearbyMessage({ type: "ambient-mix", mix: { synth: 0.85, rain: 0.5, hearth: 0.25 } });

    const ambientQueue = ctx.nearbyOutbox.filter((item) => item.key === "ambient-mix:");
    assert.equal(ambientQueue.length, 1, "Only latest ambientMix volume should remain in outbox");
    assert.equal(ambientQueue[0].payload.mix.synth, 0.85);

    // Answer submissions updated
    ctx.sendNearbyMessage({ type: "player-complete", player: 0, answers: { q_1: 4 } });
    ctx.sendNearbyMessage({ type: "player-complete", player: 0, answers: { q_1: 9 } });

    const answerQueue = ctx.nearbyOutbox.filter((item) => item.key === "player-complete:");
    assert.equal(answerQueue.length, 1, "Only latest player-complete payload should remain");
    assert.equal(answerQueue[0].payload.answers.q_1, 9);
  });

  it("3.2: Deduplicates per-question wagers and card flips while preserving distinct questions", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("closed");
    ctx.attachNearbyChannel(channel);

    // Wager toggle on question 1
    ctx.sendNearbyMessage({ type: "wager", questionId: "q_1", wager: "match", at: 100 });
    ctx.sendNearbyMessage({ type: "wager", questionId: "q_1", wager: "diff", at: 200 });
    // Wager on question 2
    ctx.sendNearbyMessage({ type: "wager", questionId: "q_2", wager: "match", at: 300 });

    const q1Wager = ctx.nearbyOutbox.filter((item) => item.key === "wager:q_1");
    const q2Wager = ctx.nearbyOutbox.filter((item) => item.key === "wager:q_2");
    assert.equal(q1Wager.length, 1);
    assert.equal(q1Wager[0].payload.wager, "diff", "q_1 wager must be updated to newest bet");
    assert.equal(q2Wager.length, 1);
    assert.equal(q2Wager[0].payload.wager, "match", "q_2 wager must remain untouched");

    // Reveal single flips coalesced
    ctx.sendNearbyMessage({ type: "reveal-state", change: { id: "q_1", revealed: true } });
    ctx.sendNearbyMessage({ type: "reveal-state", change: { id: "q_1", revealed: false } });
    const q1Flips = ctx.nearbyOutbox.filter((item) => item.key === "reveal-state:q_1");
    assert.equal(q1Flips.length, 1);
    assert.equal(q1Flips[0].payload.change.revealed, false);

    // Reveal all purges individual card flips
    ctx.sendNearbyMessage({ type: "reveal-state", change: { id: "q_2", revealed: true } });
    ctx.sendNearbyMessage({ type: "reveal-state", all: true });

    assert.equal(ctx.nearbyOutbox.some((item) => item.key.startsWith("reveal-state:q_")), false, "All single card flips must be purged");
    assert.equal(ctx.nearbyOutbox.some((item) => item.key === "reveal-state:all"), true, "reveal-state:all must be queued");
  });

  it("3.3: Preserves unique instances of rapid floating reactions and nudges", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("closed");
    ctx.attachNearbyChannel(channel);

    ctx.sendNearbyMessage({ type: "reaction", emoji: "❤️" });
    ctx.sendNearbyMessage({ type: "reaction", emoji: "🔥" });
    ctx.sendNearbyMessage({ type: "reaction", emoji: "✨" });

    const reactionItems = ctx.nearbyOutbox.filter((item) => item.key.startsWith("reaction:"));
    assert.equal(reactionItems.length, 3, "Consecutive reactions must not be collapsed");
  });

  it("3.4: Bounds outbox capacity strictly to 60 items to prevent unbounded memory growth", () => {
    const ctx = createReconnectionContext("host");
    const channel = createMockChannel("closed");
    ctx.attachNearbyChannel(channel);

    for (let i = 0; i < 90; i++) {
      ctx.sendNearbyMessage({ type: "follow-through", questionId: "q_overflow_" + i, status: "talk" });
    }
    assert.equal(ctx.nearbyOutbox.length, 60, "Outbox must clamp to exactly 60 items");
    assert.equal(ctx.nearbyOutbox[59].key, "follow-through:q_overflow_89");
  });

  it("3.5: Rejection of stale monotonic timestamps and convergence via host tie-breaker (remoteWins)", () => {
    const hostCtx = createReconnectionContext("host");
    hostCtx.state.conversationStatus["q_1"] = "talk";
    hostCtx.state.conversationTimes["q_1"] = 2000;

    // Stale timestamp (1500 < 2000)
    assert.equal(hostCtx.acceptRemoteFollowThrough("q_1", "ground", 1500), false, "Stale timestamp must be rejected");
    assert.equal(hostCtx.state.conversationStatus["q_1"], "talk");

    // Newer timestamp (2500 > 2000)
    assert.equal(hostCtx.acceptRemoteFollowThrough("q_1", "revisit", 2500), true, "Newer timestamp must be accepted");
    assert.equal(hostCtx.state.conversationStatus["q_1"], "revisit");
    assert.equal(hostCtx.state.conversationTimes["q_1"], 2500);

    // Duplicate identical timestamp (2500 === 2500)
    assert.equal(hostCtx.acceptRemoteFollowThrough("q_1", "revisit", 2500), false, "Identical timestamp duplicate must be rejected");

    // Equal timestamp tie-break:
    // Host evaluating Joiner: Host wins (reject Joiner)
    hostCtx.state.conversationTimes["q_2"] = 5000;
    hostCtx.state.conversationStatus["q_2"] = "talk";
    assert.equal(hostCtx.acceptRemoteFollowThrough("q_2", "ground", 5000), false, "Host must win equal timestamp tie-break");

    // Joiner evaluating Host: Remote Host wins (accept Host)
    const joinerCtx = createReconnectionContext("join");
    joinerCtx.state.conversationTimes["q_2"] = 5000;
    joinerCtx.state.conversationStatus["q_2"] = "talk";
    assert.equal(joinerCtx.acceptRemoteFollowThrough("q_2", "ground", 5000), true, "Remote Host must win equal timestamp on joiner");
    assert.equal(joinerCtx.state.conversationStatus["q_2"], "ground");
  });

  it("3.6: Story Reel & Journal accessibility features are present in index.html", () => {
    assert.ok(html.includes('id="story-play-pause-btn"'), "Must contain #story-play-pause-btn in Story Reel");
    assert.ok(html.includes('aria-label="Pause story"'), "Must provide Pause story aria-label");
    assert.ok(html.includes('id="journal-search-status"'), "Must contain #journal-search-status polite live region");
    assert.ok(html.includes('id="journal-empty-results"'), "Must contain #journal-empty-results");
  });
});
