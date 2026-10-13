import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function voiceBlock() {
  const start = html.indexOf("    let voiceMediaRecorder = null;");
  const end = html.indexOf("    function playVoiceNote(");
  assert(start > 0 && end > start, "Could not locate the voice memories block");
  return html.slice(start, end);
}

function makeSandbox({ delayMs = 150, mimeType = "audio/mp4" } = {}) {
  const tracks = [];
  const toasts = [];
  const timers = new Set();
  const button = { disabled: false, isConnected: true, textContent: "", classList: { add() {}, remove() {} } };
  class FakeRecorder {
    constructor() { this.state = "inactive"; this.mimeType = mimeType; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
  }
  const sandbox = {
    state: { voiceNotes: {} },
    navigator: {
      mediaDevices: {
        getUserMedia: () => new Promise((resolve) => {
          const track = { live: true, stop() { this.live = false; } };
          tracks.push(track);
          setTimeout(() => resolve({ getTracks: () => [track] }), delayMs);
        })
      }
    },
    document: { querySelectorAll: () => [] },
    MediaRecorder: FakeRecorder,
    showToast: (text) => toasts.push(text),
    playSound() {},
    saveState() {},
    render() {},
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); clearInterval(id); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${voiceBlock()}\nthis.toggleVoiceRecording = toggleVoiceRecording; this.stopVoiceRecording = stopVoiceRecording; this.voiceBlobType = voiceBlobType;`, sandbox);
  const cleanup = () => { timers.forEach((id) => clearInterval(id)); timers.clear(); };
  return { sandbox, tracks, toasts, timers, button, cleanup };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("Voice memories", () => {
  it("a double tap while the mic prompt is pending opens only one stream", async () => {
    const { sandbox, tracks, timers, button, cleanup } = makeSandbox();
    try {
      const first = sandbox.toggleVoiceRecording("q1", button);
      assert.equal(button.disabled, true, "the button is disabled while the request is pending");
      const second = sandbox.toggleVoiceRecording("q1", button);
      await Promise.all([first, second]);
      assert.equal(tracks.length, 1, "the second tap must not request another stream");
      assert.equal(button.disabled, false);
      sandbox.stopVoiceRecording({ cancel: true });
      assert.equal(tracks.filter((t) => t.live).length, 0, "no mic track stays live after stop");
      assert.equal(timers.size, 0, "no countdown interval survives the stop");
    } finally {
      cleanup();
    }
  });

  it("a cancel during the pending request stops the late stream instead of recording", async () => {
    const { sandbox, tracks, toasts, timers, button, cleanup } = makeSandbox();
    try {
      const pending = sandbox.toggleVoiceRecording("q1", button);
      await wait(20);
      sandbox.stopVoiceRecording({ cancel: true });
      await pending;
      await wait(10);
      assert.equal(tracks.length, 1);
      assert.equal(tracks[0].live, false, "the stream that arrived after cancel is stopped");
      assert.equal(timers.size, 0, "no recording timer starts for a cancelled request");
      assert.deepEqual(toasts, []);
    } finally {
      cleanup();
    }
  });

  it("labels the blob with the recorder's real container type", () => {
    const { sandbox } = makeSandbox();
    assert.equal(sandbox.voiceBlobType("audio/mp4", ""), "audio/mp4");
    assert.equal(sandbox.voiceBlobType("audio/webm;codecs=opus", ""), "audio/webm");
    assert.equal(sandbox.voiceBlobType("", "audio/mp4"), "audio/mp4");
    assert.equal(sandbox.voiceBlobType(undefined, undefined), "audio/webm");
    assert(!/new Blob\(voiceAudioChunks, \{ type: "audio\/webm" \}\)/.test(html), "the webm label is no longer hardcoded");
  });

  it("asks before deleting a recording and has a real-sized delete target", () => {
    const fn = html.slice(html.indexOf("async function deleteVoiceNote("), html.indexOf("function voiceNoteMarkup("));
    assert.match(fn, /await openConfirmDialog\(\{[^}]*danger: true[^}]*safeFirst: true/);
    assert.match(html, /\.voice-audio-chip \.voice-delete-btn \{[^}]*min-height: 44px/);
    assert.match(html, /@media \(pointer: coarse\) \{\s*\.voice-audio-chip \.voice-delete-btn \{ min-width: 48px; min-height: 48px; \}/);
  });
});

describe("Voice memories after a re-render", () => {
  it("a render during the mic prompt records against the fresh button for the same card", async () => {
    const { sandbox, tracks, timers, button, cleanup } = makeSandbox();
    const fresh = { disabled: false, isConnected: true, textContent: "", dataset: { recordVoice: "q1" }, classList: { add() {}, remove() {} } };
    sandbox.document.querySelectorAll = (sel) => (sel.startsWith(".voice-record-btn[data-record-voice]") ? [fresh] : []);
    try {
      const pending = sandbox.toggleVoiceRecording("q1", button);
      button.isConnected = false;
      await pending;
      assert.equal(tracks.length, 1);
      assert.equal(tracks[0].live, true, "the stream is used, not thrown away");
      assert.match(fresh.textContent, /Recording/);
      sandbox.stopVoiceRecording({ cancel: true });
      assert.equal(tracks[0].live, false);
      assert.equal(timers.size, 0);
    } finally {
      cleanup();
    }
  });

  it("a render that removed the card stops the late stream", async () => {
    const { sandbox, tracks, timers, button, cleanup } = makeSandbox();
    try {
      const pending = sandbox.toggleVoiceRecording("q1", button);
      button.isConnected = false;
      await pending;
      assert.equal(tracks[0].live, false);
      assert.equal(timers.size, 0);
    } finally {
      cleanup();
    }
  });
});

describe("Sound kinds and haptics", () => {
  it("every playSound literal kind has a branch, and unknown kinds never duck the music", () => {
    const start = html.indexOf("function playSound(kind");
    const body = html.slice(start, html.indexOf("\n    }\n", start));
    const handled = new Set([...body.matchAll(/kind === "([a-z-]+)"/g)].map((m) => m[1]));
    const used = new Set([...html.matchAll(/playSound\("([a-z-]+)"/g)].map((m) => m[1]));
    const missing = [...used].filter((kind) => !handled.has(kind));
    assert.deepEqual(missing, [], `unhandled playSound kinds: ${missing.join(", ")}`);
    assert.match(body, /\} else \{\s*\/\/[^\n]*\n\s*armIdleSuspend\(\);\s*return;\s*\}\s*audioEngine\.duck\(/);
  });

  it("reactions keep the floating reaction's single gated buzz", () => {
    const calls = [...html.matchAll(/playSound\("pop"[^)]*\)/g)].map((m) => m[0]);
    assert(calls.length >= 2);
    calls.forEach((call) => assert.match(call, /hapticDone: true/));
  });

  it("the Aura Spark orb only vibrates through the gated pulseHaptic path", () => {
    const start = html.indexOf("const triggerSpark = () => {");
    assert(start > 0);
    const body = html.slice(start, html.indexOf("\n      };", start));
    assert(!/navigator\.vibrate/.test(body), "triggerSpark must not call navigator.vibrate directly");
  });
});
