import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

function fakeDom() {
  const body = { children: [], appendChild(node) { node.parentNode = body; node.isConnected = true; body.children.push(node); return node; } };
  const makeNode = (tag) => {
    const node = {
      tag, children: [], className: "", isConnected: false, attrs: {},
      style: { setProperty() {} },
      setAttribute(k, v) { node.attrs[k] = v; },
      appendChild(child) {
        if (child.isFragment) { child.children.forEach((c) => { c.parentNode = node; node.children.push(c); }); child.children = []; }
        else { child.parentNode = node; node.children.push(child); }
        return child;
      },
      remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node); node.parentNode = null; },
    };
    return node;
  };
  const document = {
    body,
    createElement: makeNode,
    createDocumentFragment() { const f = makeNode("#fragment"); f.isFragment = true; return f; },
  };
  return { document, body };
}

function loadSparks({ coarse, reduced = false }) {
  const { document, body } = fakeDom();
  const timers = [];
  const window = {
    matchMedia: () => ({ matches: coarse }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  const src = [
    "let sparkLayer = null;",
    extractFunction("getSparkLayer"),
    extractFunction("sparkBudget"),
    extractFunction("triggerSparkles"),
    "return { triggerSparkles, sparkBudget, getSparkLayer };",
  ].join("\n");
  const api = new Function("document", "window", "motionReduced", "randomIndex", src)(document, window, () => reduced, () => 0);
  return { ...api, body, timers };
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

test("sparks go into one reused layer and each burst removes only its own nodes", () => {
  const { triggerSparkles, body, timers } = loadSparks({ coarse: false });
  triggerSparkles(10, 10, 5);
  triggerSparkles(20, 20, 3);
  assert.equal(body.children.length, 1, "a single layer under body");
  const layer = body.children[0];
  assert.equal(layer.className, "spark-layer");
  assert.equal(layer.attrs["aria-hidden"], "true");
  assert.equal(layer.children.length, 8);
  timers[0].fn();
  assert.equal(layer.children.length, 3, "the first burst's cleanup leaves the second burst running");
  timers[1].fn();
  assert.equal(layer.children.length, 0);
  assert.equal(body.children.length, 1, "the layer itself is kept");
});

test("reduced motion still makes no sparks", () => {
  const { triggerSparkles, body } = loadSparks({ coarse: false, reduced: true });
  triggerSparkles(0, 0, 10);
  assert.equal(body.children.length, 0);
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
