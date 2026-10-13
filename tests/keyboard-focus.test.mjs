import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} not found`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${name} is unterminated`);
}

class Item {
  constructor(group, pressed) {
    this.group = group;
    this.attrs = new Map([["aria-pressed", String(pressed)]]);
    this.classList = { contains: (name) => name === "active" && pressed };
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  closest() { return this; }
  focus() { this.group.doc.activeElement = this; }
}

function makeGroup(count, pressedIndex) {
  const doc = { activeElement: null };
  const listeners = {};
  const group = {
    doc,
    items: [],
    querySelectorAll: () => group.items,
    contains: (node) => group.items.includes(node),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: (type, event) => listeners[type](event),
  };
  for (let i = 0; i < count; i++) group.items.push(new Item(group, i === pressedIndex));
  return { group, doc };
}

const bindRovingGroup = (doc) => new Function("document", `${extractFunction("bindRovingGroup")}; return bindRovingGroup;`)(doc);

describe("roving pick-one groups (A-46)", () => {
  it("gives the group one Tab stop on the pressed item", () => {
    const { group, doc } = makeGroup(4, 2);
    bindRovingGroup(doc)(group, "button");
    assert.deepEqual(group.items.map((item) => item.getAttribute("tabindex")), ["-1", "-1", "0", "-1"]);
  });

  it("falls back to the first item when nothing is pressed", () => {
    const { group, doc } = makeGroup(3, -1);
    bindRovingGroup(doc)(group, "button");
    assert.equal(group.items[0].getAttribute("tabindex"), "0");
  });

  it("moves focus with arrows, wraps, supports Home/End, and never clicks", () => {
    const { group, doc } = makeGroup(3, 0);
    bindRovingGroup(doc)(group, "button");
    group.items[0].focus();
    let prevented = 0;
    const press = (key) => group.fire("keydown", { key, preventDefault: () => prevented++ });
    press("ArrowRight");
    assert.equal(doc.activeElement, group.items[1]);
    press("ArrowLeft"); press("ArrowLeft");
    assert.equal(doc.activeElement, group.items[2], "ArrowLeft wraps to the end");
    press("Home");
    assert.equal(doc.activeElement, group.items[0]);
    press("End");
    assert.equal(doc.activeElement, group.items[2]);
    press("Enter");
    assert.equal(prevented, 5, "Enter is left to the native button");
    group.fire("focusin", { target: group.items[1] });
    assert.deepEqual(group.items.map((item) => item.getAttribute("tabindex")), ["-1", "0", "-1"]);
  });

  it("is wired to the setup grids and score-call rows", () => {
    assert.match(html, /\.relationship-profile-grid, \.play-style-grid, \.vibe-tiles"\)\.forEach\(\(group\) => bindRovingGroup\(group, "button"\)\)/);
    assert.match(html, /querySelectorAll\("\.score-call"\)\.forEach\(\(row\) => bindRovingGroup\(row, "\[data-score-call\]"\)\)/);
    assert.match(html, /class="play-style-grid" role="group"/);
  });
});

describe("Story Reel keys (A-08)", () => {
  it("Esc/Back cancel targets the close button, not play/pause", () => {
    const line = html.match(/const MODAL_CANCEL_SELECTOR = "([^"]+)"/);
    assert(line);
    assert(!line[1].split(",").map((s) => s.trim()).includes(".story-close-btn"), "the class also matches the pause button, which precedes ✕");
    assert(line[1].includes("#story-close-btn"));
  });

  it("arrows pass through a focused header button", () => {
    const start = html.indexOf("const onStoryKey = (e) => {");
    const body = html.slice(start, html.indexOf("document.addEventListener(\"keydown\", onStoryKey)", start));
    assert(!/closest\("button, \[role='button'\], input, textarea"\)\) return;/.test(body));
    assert.match(body, /e\.key !== "ArrowLeft" && e\.key !== "ArrowRight"/);
  });

  it("ellipsizes the title through its own label span", () => {
    assert.match(html, /<span class="story-header-label">Aligned Wrapped<\/span>/);
  });
});

describe("Wager chips (A-36)", () => {
  it("are real buttons with aria-pressed outside the card-front button", () => {
    const start = html.indexOf('class="card-face card-front"');
    const end = html.indexOf("</button>", start);
    const front = html.slice(start, end);
    assert(!front.includes("wager-chip"), "no interactive chips nested in the front button");
    assert(!front.includes("card-wager-row"));
    assert.match(html, /<button type="button" class="wager-chip[^>]*aria-pressed="\$\{state\.cardWagers\?\.\[question\.id\] === 'match'\}"/);
    assert(!/role="button" tabindex="0" class="wager-chip/.test(html));
    assert.match(html, /const PRESSABLE_SELECTOR = "\.wager-chip, /);
  });

  it("hides with the front face at the 89 ms swap, instantly under reduced motion", () => {
    assert.match(html, /\.flip-card\.flipped \.card-wager-row \{ opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0s linear 0\.089s, visibility 0s linear 0\.089s; \}/);
    assert.match(html, /\.reduced-motion \.flip-card \.card-wager-row \{ transition: none !important; \}/);
  });
});

describe("Setup name errors (A-49)", () => {
  it("link both inputs to #name-error and write the message only there", () => {
    assert.match(html, /id="player-one" aria-describedby="name-error"/);
    assert.match(html, /id="player-two" aria-describedby="name-error"/);
    assert(!html.includes('error.textContent = "Add both names to begin."'));
    assert(!html.includes('error.textContent = "Use two different names'));
    assert.match(html, /\.setup-card \.error:not\(:empty\) \+ \.setup-section-title \{ margin-top: 14px; \}/);
  });
});

describe("Ctrl/Cmd+Enter hint (A-48)", () => {
  it("is exposed via aria-keyshortcuts and a fine-pointer-only hint outside the live counter", () => {
    assert.equal((html.match(/aria-keyshortcuts="Control\+Enter Meta\+Enter"/g) || []).length, 2);
    assert.match(html, /<span class="kbd-hint" aria-hidden="true"><kbd>\$\{kbdMod\}<\/kbd>\+<kbd>Enter<\/kbd> to continue<\/span><div class="char-counter" id="answer-char-counter"/);
    assert.match(html, /@media \(hover: hover\) and \(pointer: fine\) \{ \.kbd-hint \{ display: inline; \} \}/);
  });
});
