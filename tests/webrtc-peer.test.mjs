import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract handleNearbyMessage from index.html
const handleNearbyMatch = html.match(/function handleNearbyMessage\(message\) \{[\s\S]*?\n    function /);
assert(handleNearbyMatch, "Could not locate handleNearbyMessage");
const handleNearbyCode = handleNearbyMatch[0].replace(/\n    function $/, "");

describe("Two-Phone WebRTC Peer Simulation & Message Protocol", () => {
  let hostState;
  let joinerState;
  let hostRuntime;
  let joinerRuntime;
  let sentToJoiner;
  let sentToHost;

  const createPeerContext = (role, state, runtime, outbox) => {
    return {
      state,
      nearbyRuntime: runtime,
      nearbyMixSentThisLink: false,
      nearbyOfflineHidden: { roundId: "", ids: new Set() },
      APP_VERSION: "1.0.0",
      compareVersions: (a, b) => (a === b ? 0 : a > b ? 1 : -1),
      showToast: () => {},
      playSound: () => {},
      saveState: () => {},
      render: () => {},
      updateNearbyBanner: () => {},
      nearbyRoundFinished: () => false,
      nearbyLocalPlayer: () => (role === "host" ? 0 : 1),
      triggerFloatingReaction: () => {},
      mergeNearbyDailyRitual: () => {},
      document: { getElementById: () => null, querySelector: () => null },
      ambientSoundscape: { isPlaying: false, updateMix: () => {} },
      cardSeen: () => false,
      applyNearbyRoundInit: (payload) => {
        state.nearbyRoundId = payload.roundId;
        state.selectedQuestionIds = [...payload.selectedQuestionIds];
        state.names = [...payload.names];
        state.screen = "question";
      },
      sendNearbyMessage: (payload) => {
        outbox.push(payload);
      },
      acceptRemoteFollowThrough: () => true,
      acceptRemoteIntention: () => true,
      acceptRemoteRating: () => true,
      syncLatestRoundSnapshot: () => {},
      refreshRevealFromPartner: () => {},
      closeNearbyConnection: () => {},
      dismissConfirmDialogs: () => {},
      finishNearbyRoundIfReady: () => {}
    };
  };

  beforeEach(() => {
    hostState = {
      version: 2,
      playStyle: "nearby",
      nearbyRole: "host",
      nearbyRoundId: "round_webrtc_999",
      screen: "question",
      names: ["Host Alex", "Joiner Sam"],
      selectedQuestionIds: ["q_1", "q_2", "q_3"],
      revealedIds: [],
      seenIds: [],
      ambientMix: { synth: 0.8, rain: 0, hearth: 0 }
    };

    joinerState = {
      version: 2,
      playStyle: "nearby",
      nearbyRole: "join",
      nearbyRoundId: "round_webrtc_999",
      screen: "question",
      names: ["Host Alex", "Joiner Sam"],
      selectedQuestionIds: ["q_1", "q_2", "q_3"],
      revealedIds: [],
      seenIds: [],
      ambientMix: { synth: 0.8, rain: 0, hearth: 0 }
    };

    hostRuntime = { role: "host", partnerLeft: false, partnerProgress: null, partnerTyping: false };
    joinerRuntime = { role: "join", partnerLeft: false, partnerProgress: null, partnerTyping: false };

    sentToJoiner = [];
    sentToHost = [];
  });

  it("exchanges hello handshake and keeps connection alive", () => {
    const hostContext = createPeerContext("host", hostState, hostRuntime, sentToJoiner);
    vm.runInNewContext(handleNearbyCode, hostContext);

    const helloPayload = {
      type: "hello",
      roundId: "round_webrtc_999",
      appVersion: "1.0.0",
      dailyRitual: { streak: 4, lastDate: "2026-10-13" }
    };

    hostContext.handleNearbyMessage({ data: JSON.stringify(helloPayload) });
    assert.equal(hostRuntime.partnerLeft, false, "Hello must mark partner present");
  });

  it("synchronizes ambientMix volume updates across peers", () => {
    const joinerContext = createPeerContext("join", joinerState, joinerRuntime, sentToHost);
    vm.runInNewContext(handleNearbyCode, joinerContext);

    const ambientPayload = {
      type: "ambient-mix",
      roundId: "round_webrtc_999",
      mix: { synth: 0.2, rain: 0.7, hearth: 0.4 }
    };

    joinerContext.handleNearbyMessage({ data: JSON.stringify(ambientPayload) });

    assert.equal(joinerState.ambientMix.synth, 0.2, "Joiner synth mix must update");
    assert.equal(joinerState.ambientMix.rain, 0.7, "Joiner rain mix must update");
    assert.equal(joinerState.ambientMix.hearth, 0.4, "Joiner hearth mix must update");
  });

  it("handles partner progress, typing state, and delivery receipts", () => {
    const hostContext = createPeerContext("host", hostState, hostRuntime, sentToJoiner);
    vm.runInNewContext(handleNearbyCode, hostContext);

    hostContext.handleNearbyMessage({
      data: JSON.stringify({ type: "progress", roundId: "round_webrtc_999", answered: 2, total: 3 })
    });
    assert.equal(hostRuntime.partnerProgress.answered, 2);
    assert.equal(hostRuntime.partnerProgress.total, 3);

    hostContext.handleNearbyMessage({
      data: JSON.stringify({ type: "typing", roundId: "round_webrtc_999", isTyping: true })
    });
    assert.equal(hostRuntime.partnerTyping, true, "Host must note partner is typing");

    hostContext.handleNearbyMessage({
      data: JSON.stringify({ type: "typing", roundId: "round_webrtc_999", isTyping: false })
    });
    assert.equal(hostRuntime.partnerTyping, false, "Host must note partner stopped typing");
  });

  it("submits player-complete answers and sends back delivery confirmation", () => {
    const hostContext = createPeerContext("host", hostState, hostRuntime, sentToJoiner);
    vm.runInNewContext(handleNearbyCode, hostContext);

    const completePayload = {
      type: "player-complete",
      roundId: "round_webrtc_999",
      player: 1,
      answers: { q_1: 8, q_2: "Because you are wonderful" },
      guesses: { q_1: 7 },
      comments: { q_1: "Loved this" },
      importance: { q_1: 2 },
      notReady: {}
    };

    hostContext.handleNearbyMessage({ data: JSON.stringify(completePayload) });

    assert.notEqual(hostState.nearbyRemote, null);
    assert.equal(hostState.nearbyRemote.player, 1);
    assert.equal(hostState.nearbyRemote.answers.q_1, 8);

    const deliveredAck = sentToJoiner.find((msg) => msg.type === "delivered");
    assert(deliveredAck, "Host must reply with delivered ack message");
    assert.equal(deliveredAck.roundId, "round_webrtc_999");
  });

  it("synchronizes reveal card flip changes bidirectionally", () => {
    const joinerContext = createPeerContext("join", joinerState, joinerRuntime, sentToHost);
    joinerContext.nearbyRoundFinished = () => true;
    vm.runInNewContext(handleNearbyCode, joinerContext);

    const flipPayload = {
      type: "reveal-state",
      roundId: "round_webrtc_999",
      change: { id: "q_1", revealed: true }
    };
    joinerContext.handleNearbyMessage({ data: JSON.stringify(flipPayload) });
    assert.deepEqual(Array.from(joinerState.revealedIds), ["q_1"], "Joiner revealedIds must reflect flipped card");

    const flipPayload2 = {
      type: "reveal-state",
      roundId: "round_webrtc_999",
      change: { id: "q_2", revealed: true }
    };
    joinerContext.handleNearbyMessage({ data: JSON.stringify(flipPayload2) });
    assert.deepEqual(Array.from(joinerState.revealedIds), ["q_1", "q_2"], "Joiner revealedIds must accumulate flips");

    const revealAllPayload = {
      type: "reveal-state",
      roundId: "round_webrtc_999",
      all: true
    };
    joinerContext.handleNearbyMessage({ data: JSON.stringify(revealAllPayload) });
    assert.deepEqual(Array.from(joinerState.revealedIds), ["q_1", "q_2", "q_3"], "All cards must be revealed");
  });

  it("ignores corrupted packets or messages from mismatching round IDs", () => {
    const hostContext = createPeerContext("host", hostState, hostRuntime, sentToJoiner);
    vm.runInNewContext(handleNearbyCode, hostContext);

    assert.doesNotThrow(() => {
      hostContext.handleNearbyMessage({ data: "INVALID_JSON_CORRUPT_PAYLOAD" });
    });

    const foreignMessage = {
      type: "progress",
      roundId: "wrong_foreign_round_id",
      answered: 10,
      total: 10
    };
    hostContext.handleNearbyMessage({ data: JSON.stringify(foreignMessage) });
    assert.equal(hostRuntime.partnerProgress, null, "Progress from foreign round must be ignored");
  });
});
