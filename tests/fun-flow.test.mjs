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

const sources = [
  grab(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/, "escapeHTML"),
  grab(/function isQuickPickQuestion\(question\) \{[\s\S]*?\n    \}/, "isQuickPickQuestion"),
  grab(/function guessHit\(question, playerIndex\) \{[\s\S]*?\n    \}/, "guessHit"),
  grab(/function wildcardBadgeMarkup\(question\) \{[\s\S]*?\n    \}/, "wildcardBadgeMarkup"),
  grab(/const LIGHTNING_TURN_MS = \d+;/, "LIGHTNING_TURN_MS"),
  grab(/function lightningTally\(pairs, p0Answers, p1Answers\) \{[\s\S]*?\n    \}/, "lightningTally"),
  grab(/function lightningClockLabel\(remainingMs\) \{[\s\S]*?\n    \}/, "lightningClockLabel")
];

function makeContext(extra = {}) {
  const ctx = {
    state: { names: ["Casey", "Riley"], answers: [{}, {}], guesses: [{}, {}], notReady: [{}, {}], wildcards: [null, null], ...extra }
  };
  vm.createContext(ctx);
  vm.runInContext(sources.join("\n") + "\nthis.wildcardBadgeMarkup = wildcardBadgeMarkup; this.lightningTally = lightningTally; this.lightningClockLabel = lightningClockLabel; this.LIGHTNING_TURN_MS = LIGHTNING_TURN_MS;", ctx);
  return ctx;
}

describe("Double Down resolves visibly without touching scores", () => {
  const slider = { id: "q_s", type: "slider", prompt: "Spontaneity?" };

  it("renders nothing when nobody doubled down", () => {
    const ctx = makeContext();
    assert.equal(ctx.wildcardBadgeMarkup(slider), "");
    assert.equal(ctx.wildcardBadgeMarkup(null), "");
  });

  it("shows read it! on a hit and a twist! on a miss, per player", () => {
    const ctx = makeContext({ wildcards: ["q_s", "q_s"] });
    ctx.state.guesses[0].q_s = 7; ctx.state.answers[1].q_s = 8; // Casey hit (within 1)
    ctx.state.guesses[1].q_s = 2; ctx.state.answers[0].q_s = 9; // Riley missed
    const markup = ctx.wildcardBadgeMarkup(slider);
    assert.match(markup, /Casey doubled down: read it!/);
    assert.match(markup, /Riley doubled down: a twist!/);
  });

  it("falls back to the plain badge when there is no guess, and escapes names", () => {
    const ctx = makeContext({ wildcards: ["q_t", null], names: ["<b>A</b>", "B"] });
    const markup = ctx.wildcardBadgeMarkup({ id: "q_t", type: "text", prompt: "Why?" });
    assert.match(markup, /Doubled Down!/);
    assert.doesNotMatch(markup, /<b>A<\/b>/);
  });

  it("does not feed mindReaderTally (no wildcard reference in scoring)", () => {
    const tally = grab(/function mindReaderTally\(questions\) \{[\s\S]*?\n    \}/, "mindReaderTally");
    assert.doesNotMatch(tally, /wildcard/);
  });
});

describe("Rapid-fire warmup clock and results", () => {
  it("formats the per-turn clock", () => {
    const ctx = makeContext();
    assert.equal(ctx.LIGHTNING_TURN_MS, 60000);
    assert.equal(ctx.lightningClockLabel(60000), "1:00");
    assert.equal(ctx.lightningClockLabel(59001), "1:00");
    assert.equal(ctx.lightningClockLabel(59000), "0:59");
    assert.equal(ctx.lightningClockLabel(4200), "0:05");
    assert.equal(ctx.lightningClockLabel(-50), "0:00");
  });

  it("counts matches, splits and timed-out picks separately", () => {
    const ctx = makeContext();
    const pairs = [{ a: "Tea", b: "Coffee" }, { a: "Beach", b: "Hills" }, { a: "Cat", b: "Dog" }, { a: "Up", b: "Down" }];
    const { rows, matches } = ctx.lightningTally(pairs, ["a", "b", "a", null], ["a", "a", null, null]);
    assert.equal(matches, 1);
    assert.deepEqual(rows.map((row) => row.status), ["match", "split", "timeout", "timeout"]);
    assert.equal(rows[1].a, "b");
    assert.equal(rows[1].b, "a");
  });

  it("shows both partners' picks on split rows and stops the clock on close", () => {
    const fn = grab(/function openLightningRoundModal\(\) \{[\s\S]*?\n    \}/, "openLightningRoundModal");
    assert.match(fn, /\$\{p0Name\}: \$\{aPick\} · \$\{p1Name\}: \$\{bPick\}/);
    assert.match(fn, /const close = \(\) => \{\s*stopClock\(\);/);
    assert.match(fn, /overlay\.isConnected/);
  });
});

describe("Daily ritual sits below the start flow and needs an answer", () => {
  const card = grab(/function renderDailyRitualCard\(\) \{[\s\S]*?\n    \}/, "renderDailyRitualCard");
  const modal = grab(/function openDailyRitualModal\(\) \{[\s\S]*?\n    \}/, "openDailyRitualModal");

  it("is hidden for a brand-new couple and never shows a 0-day streak", () => {
    assert.match(card, /if \(!\(state\.completedRounds \|\| \[\]\)\.length && !\(dr\.completedDates \|\| \[\]\)\.length\) return "";/);
    assert.match(card, /streak > 0 \?/);
    assert.doesNotMatch(card, /slice\(0, 68\)/);
  });

  it("renders after the setup form, not above the name fields", () => {
    const formAt = html.indexOf('<form class="setup-card" id="setup-form"');
    const cardAt = html.indexOf("${renderDailyRitualCard()}");
    assert(formAt > 0 && cardAt > formAt, "ritual card must come after the setup form");
    assert.equal(html.split("${renderDailyRitualCard()}").length, 2, "ritual card rendered exactly once");
  });

  it("rejects empty text answers and pluralises the streak", () => {
    assert.match(modal, /if \(!isSlider && !answer\)/);
    assert.match(modal, /streakDays === 1 \? "day" : "days"/);
  });
});

describe("Round-one reveal stays uncluttered", () => {
  const reveal = grab(/function renderReveal\([\s\S]*?\n    \}\n/, "renderReveal");

  it("shows the rivalry banner only from a second round tonight", () => {
    assert.match(reveal, /const tonightRounds = roundsPlayedToday\(\);/);
    assert.match(reveal, /\$\{allRevealed && tonightRounds >= 2 && \(rivalry\.hits0 > 0 \|\| rivalry\.hits1 > 0\) \? `\s*<div class="rivalry-banner"/);
  });

  it("keeps the reaction bar to two-phone play", () => {
    assert.match(reveal, /\$\{state\.playStyle === "nearby" \? `\s*<div class="reaction-bar" aria-label="Reactions">/);
  });

  it("offers Library Progress from the second completed round", () => {
    assert.match(reveal, /\$\{\(state\.completedRounds\?\.length \|\| 0\) >= 2 \? `<button class="secondary-btn" id="open-library-journey-btn"/);
  });
});

describe("Side modals open in a usable state", () => {
  it("daily ritual is named by its prompt and focuses the answer, not submit", () => {
    const modal = grab(/function openDailyRitualModal\(\) \{[\s\S]*?\n    \}/, "openDailyRitualModal");
    assert.match(modal, /modal\.setAttribute\("aria-labelledby", "daily-ritual-title"\)/);
    assert.match(modal, /<h3 id="daily-ritual-title" tabindex="-1"/);
    // The textarea must not grab focus on touch (soft keyboard), and focus must be placed before submit could win.
    assert.match(modal, /\(!COARSE_POINTER \? modal\.querySelector\("#daily-text-input"\) : null\)/);
    assert.match(modal, /firstField\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it("storybook has a sticky top close control that print hides", () => {
    const fn = grab(/function openStorybookModal\(\) \{[\s\S]*?\n    \}/, "openStorybookModal");
    assert.match(fn, /<div class="storybook-sheet">\s*<div class="storybook-topbar"><button class="storybook-x-btn" id="storybook-x-btn" data-modal-cancel type="button" aria-label="Close storybook">/);
    assert.match(fn, /querySelector\("#storybook-x-btn"\)\.addEventListener\("click", close\)/);
    assert.match(html, /\.storybook-topbar \{ position: sticky;/);
    assert.match(html, /\.storybook-x-btn \{ width: 48px; height: 48px;/);
    assert.match(html, /\.storybook-topbar \{ display: none !important; \}/);
  });

  it("warmup opens on a ready gate and only starts Player 1's clock from it", () => {
    const fn = grab(/function openLightningRoundModal\(\) \{[\s\S]*?\n    \}\n/, "openLightningRoundModal");
    assert.match(fn, /let currentStep = "ready";/);
    assert.match(fn, /querySelector\("#start-p0-btn"\)\?\.addEventListener\("click", \(\) => \{\s*currentStep = "p0";\s*startClock\(\);/);
    const tail = fn.slice(fn.indexOf("document.body.appendChild(overlay);"));
    assert.doesNotMatch(tail, /startClock\(\)/, "opening the warmup must not start a clock");
    assert.doesNotMatch(fn, /escapeHTML\(p0Name\)/, "p0Name is already escaped");
  });
});
