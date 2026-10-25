import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// Pulls one top-level `function name(...) { ... }` out of the app script by brace matching.
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function loadSparks({ coarse }) {
  const window = { matchMedia: () => ({ matches: coarse }) };
  return new Function("window", `${extractFunction("sparkBudget")}
return { sparkBudget };`)(window);
}

test("spark budget scales particles down on coarse pointers without flattening streaks", () => {
  const { sparkBudget } = loadSparks({ coarse: true });
  assert.equal(sparkBudget(26), 14);
  assert.equal(sparkBudget(64), 35);
  assert.ok(sparkBudget(50) > sparkBudget(26), "a longer streak still bursts bigger");
  assert.equal(sparkBudget(4), 6);
  const fine = loadSparks({ coarse: false });
  assert.equal(fine.sparkBudget(64), 64);
});

// The effects engine runs against a fake window/document/2D context so its budget and idle rules are checked in node.
function loadFx({ coarse = false, reduced = false, enabled = true, scheme = "dark" } = {}) {
  const frames = [];
  let nextFrame = 1;
  const counts = { createElement: 0, appendChild: 0, getComputedStyle: 0, getPropertyValue: 0, cancel: 0, fillRect: 0, fill: 0, stroke: 0 };
  const fills = [];
  let transform = null, arcs = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "setTransform") return (a, b, c, d, e, f) => { if (e || f) transform = [e, f]; };
      if (key === "arc") return (x, y) => { arcs.push([x, y]); };
      if (key in counts) return () => { counts[key] += 1; };
      return () => {};
    },
    set(target, key, value) {
      if (key === "fillStyle") fills.push(value);
      target[key] = value;
      return true;
    },
  });
  const classes = new Set();
  const doc = {
    hidden: false,
    documentElement: { dataset: { theme: "midnight" }, classList: { contains: (c) => classes.has(c) } },
    body: { appendChild(node) { counts.appendChild += 1; node.isConnected = true; return node; } },
    createElement(tag) {
      counts.createElement += 1;
      return { tag, className: "", attrs: {}, style: {}, isConnected: false, width: 0, height: 0, setAttribute(k, v) { this.attrs[k] = v; }, getContext: () => ctx };
    },
  };
  const win = {
    innerWidth: 400,
    innerHeight: 800,
    devicePixelRatio: 3,
    Path2D: class {},
    requestAnimationFrame(cb) { const id = nextFrame++; frames.push({ id, cb }); return id; },
    cancelAnimationFrame(id) { counts.cancel += 1; const i = frames.findIndex((f) => f.id === id); if (i >= 0) frames.splice(i, 1); },
    getComputedStyle() {
      counts.getComputedStyle += 1;
      return { getPropertyValue: (name) => { counts.getPropertyValue += 1; return name === "color-scheme" ? scheme : `tone(${name})`; } };
    },
  };
  const M = Object.create(Math);
  M.random = () => 0.5;
  const hooks = { enabled: () => enabled, reduced: () => reduced, coarse: () => coarse };
  const fx = new Function("Math", `${extractFunction("createFx")}\nreturn createFx;`)(M)(win, doc, hooks);
  let clock = 0;
  // Runs one queued frame `gap` ms after the previous one and reports what it drew.
  const step = (gap = 16) => {
    clock += gap;
    transform = null; arcs = [];
    const before = counts.fillRect;
    const queued = frames.splice(0);
    queued.forEach((f) => f.cb(clock));
    return { ran: queued.length, transform, arcs, fillRects: counts.fillRect - before };
  };
  const canvas = () => doc.body.lastCanvas;
  const origAppend = doc.body.appendChild;
  doc.body.appendChild = (node) => { doc.body.lastCanvas = node; return origAppend.call(doc.body, node); };
  return { fx, win, doc, classes, counts, fills, frames, step, canvas, clock: () => clock };
}

test("the effects engine draws every burst on one reused, DPR-capped canvas", () => {
  const { fx, counts, canvas } = loadFx();
  assert.ok(fx.burst("sparkle", 100, 100) > 0);
  assert.ok(fx.burst("heart", 200, 200) > 0);
  assert.equal(counts.createElement, 1);
  assert.equal(counts.appendChild, 1);
  assert.equal(canvas().className, "fx-layer");
  assert.equal(canvas().attrs["aria-hidden"], "true");
  assert.equal(canvas().width, 800, "DPR 3 is capped at 2");
  assert.equal(canvas().style.width, "400px");
});

test("bursts respect the particle budget and the pool never exceeds its cap", () => {
  assert.equal(loadFx({ coarse: false }).fx.burst("confetti", 10, 10, { intensity: 1 }), 120);
  assert.equal(loadFx({ coarse: true }).fx.burst("confetti", 10, 10, { intensity: 1 }), 60);
  assert.equal(loadFx({ coarse: false }).fx.burst("confetti", 10, 10, { count: 500 }), 120);
  assert.equal(loadFx({ coarse: true }).fx.burst("confetti", 10, 10, { count: 500 }), 60);
  assert.ok(loadFx().fx.burst("sparkle", 10, 10, { intensity: 0.2 }) < loadFx().fx.burst("sparkle", 10, 10, { intensity: 0.9 }), "intensity scales the burst");
  const { fx, step } = loadFx();
  fx.burst("confetti", 200, 400, { intensity: 1 });
  fx.burst("confetti", 200, 400, { intensity: 1 });
  fx.burst("confetti", 200, 400, { intensity: 1 });
  step(); step();
  assert.equal(step().fillRects, 240, "a full pool overwrites the oldest particles instead of growing");
});

test("the engine goes fully idle once its particles die", () => {
  const { fx, step, frames, canvas, clock, counts } = loadFx();
  fx.burst("confetti", 200, 300, { intensity: 1 });
  fx.burst("ripple", 200, 300, { intensity: 1 });
  assert.equal(canvas().style.display, "block");
  assert.equal(frames.length, 1, "one loop serves overlapping bursts");
  while (frames.length && clock() < 5000) step();
  assert.ok(clock() <= 1600, `idle after ${clock()} ms (budget 1.5 s per burst)`);
  assert.equal(frames.length, 0, "no rAF left scheduled");
  assert.equal(canvas().style.display, "none", "the hidden canvas drops its layer");
  assert.ok(counts.fillRect > 0);
  assert.equal(step().ran, 0, "nothing runs while idle");
});

test("a long frame advances particles by at most 33 ms", () => {
  const { fx, step } = loadFx();
  fx.burst("sparkle", 200, 400, { count: 1 });
  let a = step().transform;
  while (!a) a = step().transform;
  const b = step().transform;
  const c = step(200).transform;
  const normal = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const long = Math.hypot(c[0] - b[0], c[1] - b[1]);
  assert.ok(normal > 0 && long > 0);
  assert.ok(long <= normal * 2.2, `a 200 ms gap moved ${long.toFixed(2)} vs ${normal.toFixed(2)} per 16 ms frame`);
});

test("effects off and reduced motion gate the engine", () => {
  const off = loadFx({ enabled: false });
  assert.equal(off.fx.burst("confetti", 10, 10, { intensity: 1 }), 0);
  assert.equal(off.counts.createElement, 0, "effects off never builds a canvas");
  assert.equal(off.frames.length, 0);
  const reduced = loadFx({ reduced: true });
  assert.equal(reduced.fx.burst("confetti", 10, 10, { intensity: 0.4 }), 0, "small moments stay still");
  assert.equal(reduced.fx.burst("confetti", 10, 10, { count: 30 }), 0, "legacy counts are small moments too");
  assert.equal(reduced.frames.length, 0);
  assert.equal(reduced.fx.burst("confetti", 100, 120, { intensity: 0.9 }), 1, "a big moment gets one glow");
  let first = reduced.step().arcs;
  while (!first.length) first = reduced.step().arcs;
  const later = reduced.step(16).arcs;
  assert.deepEqual(later, first, "the glow fades in place without moving");
  assert.equal(reduced.counts.fillRect, 0, "no confetti pieces in reduced motion");
  assert.equal(loadFx().fx.burst("nope", 1, 1), 0);
  assert.equal(loadFx().fx.burst("sparkle", NaN, 1), 0);
  assert.equal(loadFx().fx.fromElement(null, "sparkle"), 0);
});

test("theme colours are read once per theme and light or high-contrast themes swap palettes", () => {
  const { fx, doc, classes, counts } = loadFx();
  fx.burst("sparkle", 10, 10);
  fx.burst("confetti", 10, 10);
  assert.equal(counts.getComputedStyle, 1);
  const reads = counts.getPropertyValue;
  fx.burst("sparkle", 10, 10);
  fx.burst("confetti", 10, 10, { colors: ["--sun"] });
  assert.equal(counts.getPropertyValue, reads, "a repeat burst reads no live computed style");
  doc.documentElement.dataset.theme = "pastel";
  fx.burst("sparkle", 10, 10);
  assert.equal(counts.getComputedStyle, 2);
  classes.add("high-contrast");
  fx.burst("sparkle", 10, 10);
  assert.equal(counts.getComputedStyle, 3);
  const light = loadFx({ scheme: "light" });
  light.fx.burst("golden", 100, 100, { intensity: 1, w: 80, h: 80 });
  light.step(); light.step(); light.step();
  assert.ok(light.fills.length > 0);
  assert.ok(!light.fills.includes("#fff3c4"), "pale gold is not drawn on the light theme");
  assert.ok(light.fills.every((value) => /--sun|--coral-dark/.test(value)));
  const hc = loadFx();
  hc.classes.add("high-contrast");
  hc.fx.burst("confetti", 100, 100, { intensity: 1 });
  hc.step(); hc.step(); hc.step();
  assert.ok(hc.fills.every((value) => /--text|--sun/.test(value)), "high contrast collapses to text and sun");
  const hcOwn = loadFx();
  hcOwn.classes.add("high-contrast");
  hcOwn.fx.burst("sparkle", 100, 100, { intensity: 1, colors: ["--violet", "--blue"] });
  hcOwn.step(); hcOwn.step();
  assert.ok(hcOwn.fills.length && hcOwn.fills.every((value) => /--text|--sun/.test(value)), "high contrast overrides a call site's colours");
});

test("clear() stops a burst mid-flight", () => {
  const { fx, step, frames, counts, canvas } = loadFx();
  fx.burst("confetti", 100, 100, { intensity: 1 });
  step();
  assert.equal(frames.length, 1);
  fx.clear();
  assert.equal(counts.cancel, 1);
  assert.equal(frames.length, 0);
  assert.equal(canvas().style.display, "none");
  fx.clear();
  assert.equal(frames.length, 0, "clearing twice is harmless");
});

test("the frame loop allocates nothing and old DOM particles are gone", () => {
  const frame = extractFunction("fxFrame");
  assert.doesNotMatch(frame, /\bnew\b|=>|\[\s*\]|\{\s*\}|\.map\(|\.forEach\(|`/);
  assert.doesNotMatch(html, /className = "celebration-spark"/);
  assert.doesNotMatch(html, /\.celebration-spark \{/);
  assert.doesNotMatch(html, /function triggerSparkles\(/);
  assert.doesNotMatch(html, /triggerSparkles\(x, y, 8, 35\)/, "taps are not celebrations");
  for (const call of html.match(/fx\.(burst|fromElement)\([^;]*/g) || []) assert.doesNotMatch(call, /var\(--/, call);
  const pulse = html.slice(html.indexOf("@keyframes aura-pulse"), html.indexOf("}\n    }", html.indexOf("@keyframes aura-pulse")));
  assert.doesNotMatch(pulse, /box-shadow/);
  assert.match(html, /\.fx-layer \{[^}]*pointer-events: none/);
  assert.match(html, /\.fx-layer \{[^}]*z-index: 250/);
});

test("the Effects switch is a saved, backed-up preference that defaults on", () => {
  assert.match(html, /\n        effectsEnabled: true,\n/);
  assert.match(html, /restored\.effectsEnabled = restored\.effectsEnabled !== false;/);
  assert.match(html, /effectsEnabled: rawSettings\.effectsEnabled !== false/);
  assert.match(html, /id="settings-effects" type="checkbox" role="switch"/);
  const backup = extractFunction("createBackupPayload");
  assert.match(backup, /effectsEnabled: state\.effectsEnabled !== false/);
});

test("a scheduled save is flushed when the page hides, and only once", () => {
  let saves = 0;
  const pending = new Map();
  let nextId = 1;
  const listeners = {};
  const window = {
    setTimeout: (fn) => { const id = nextId++; pending.set(id, fn); return id; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const document = { visibilityState: "visible", addEventListener: (type, fn) => { listeners[`doc:${type}`] = fn; } };
  const block = html.slice(html.indexOf("let saveStateTimer = 0;"), html.indexOf("const tabSyncChannel"));
  assert.match(block, /function flushScheduledSave/);
  let snapshots = 0;
  const api = new Function("window", "document", "saveState", "clearTimeout", "syncLatestRoundSnapshot",
    `${block}\nreturn { scheduleSaveState, flushScheduledSave, markRating: () => { roundSnapshotSavePending = true; } };`)(
    window, document, () => { saves += 1; }, (id) => pending.delete(id), () => { snapshots += 1; },
  );
  api.scheduleSaveState();
  api.scheduleSaveState();
  assert.equal(pending.size, 1, "rescheduling coalesces");
  document.visibilityState = "hidden";
  listeners["doc:visibilitychange"]();
  assert.equal(saves, 1, "hiding the page writes the pending save");
  assert.equal(pending.size, 0);
  listeners.pagehide();
  assert.equal(saves, 1, "nothing pending means no extra write");
  api.scheduleSaveState();
  [...pending.values()][0]();
  listeners.pagehide();
  assert.equal(saves, 2, "a timer that already fired is not saved again");
  assert.equal(snapshots, 0, "no rating pending means no snapshot");
  api.markRating();
  listeners.pagehide();
  assert.equal(snapshots, 1, "a rating tap whose frame never ran is snapshotted before the flush save");
  assert.equal(saves, 3);
  listeners.pagehide();
  assert.equal(saves, 3, "the pending rating save is flushed once");
});

test("motion loops on the reveal board are bounded and the old body-append path is gone", () => {
  assert.match(html, /animation: match-lift 1\.8s ease-in-out 3;/);
  assert.doesNotMatch(html, /golden-sheen [^;]*infinite/);
  assert.doesNotMatch(html, /document\.body\.appendChild\(spark\)/);
  assert.doesNotMatch(html, /\.wager-chip[^}]*transition: all/);
});

test("cascaded partner-flip haptics are spaced at least 60 ms apart and respect the haptics toggle", () => {
  const calls = [];
  let clock = 1000;
  const sandbox = { state: { hapticsEnabled: true }, navigator: { vibrate: (p) => calls.push([clock, p]) }, performance: { now: () => clock } };
  vm.runInNewContext(`let lastPartnerFlipHapticAt = 0;
${extractFunction("pulseHaptic")}; this.pulseHaptic = pulseHaptic;`, sandbox);
  sandbox.pulseHaptic("partner-flip");
  clock += 3; sandbox.pulseHaptic("partner-flip");
  clock += 70; sandbox.pulseHaptic("partner-flip");
  clock += 1; sandbox.pulseHaptic("tap");
  assert.deepEqual(calls.map((c) => c[1]), [10, 10, 14], "the 3 ms follow-up is dropped; other kinds are not gated");
  sandbox.state.hapticsEnabled = false;
  clock += 500; sandbox.pulseHaptic("partner-flip");
  assert.equal(calls.length, 3, "haptics off stays silent");
});

test("ambient rest pauses the last-card beckon and the golden sheen runs one delayed pass", () => {
  const rest = html.slice(html.indexOf("html.ambient-rest :is("), html.indexOf("animation-play-state: paused !important"));
  for (const sel of [".flip-card.final-card .final-glow", ".flip-card.final-card .card-pair span", ".reveal-dot.final"]) {
    assert.ok(rest.includes(sel), `${sel} rests with the other decorative loops`);
  }
  assert.match(html, /\.flip-card\.golden:not\(\.flipped\) \.card-front::before \{ animation: golden-sheen 6s ease-in-out 1\.5s 1; \}/);
  assert.match(html, /\.flip-card:not\(\.flipped\):active \.flip-card-inner \{ transform: scale\(0\.985\); transition-duration: var\(--dur-press\); \}/);
});

test("burstConfetti accepts a rect read earlier as well as an element", () => {
  const src = extractFunction("burstConfetti");
  assert.match(src, /typeof element\.getBoundingClientRect === "function" \? element\.getBoundingClientRect\(\) : element/);
});
