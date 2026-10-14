import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = html.slice(0, html.indexOf("</style>"));

// iOS 15.4–16.1 WebKit has no color-mix(). Every color-mix() here also contains var(), and a declaration with
// var() is never rejected at parse time: it becomes invalid at computed-value time and the property falls to
// `unset`, discarding any plain declaration written before it in the same rule. So a fallback only works when
// the color-mix() declaration lives in its own @supports (color: color-mix(...)) block after the plain rule.
function scanRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [];
  const stack = [];
  let boundary = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const prelude = text.slice(boundary, i).trim().replace(/\s+/g, " ");
      const inSupports = stack.some((s) => s.supports);
      stack.push({ prelude, start: i + 1, supports: /^@supports\s*\(color:\s*color-mix/.test(prelude), inSupports });
      boundary = i + 1;
    } else if (ch === "}") {
      const r = stack.pop();
      if (!r.prelude.startsWith("@")) {
        const decls = [];
        let depth = 0;
        let seg = r.start;
        for (let j = r.start; j <= i; j++) {
          const c = text[j];
          if (c === "(") depth++;
          else if (c === ")") depth--;
          else if ((c === ";" && depth === 0) || j === i) {
            const d = text.slice(seg, j).trim();
            if (d.includes(":")) decls.push({ prop: d.split(":")[0].trim().toLowerCase(), value: d, line: text.slice(0, seg).split("\n").length });
            seg = j + 1;
          }
        }
        rules.push({ selector: r.prelude, inSupports: r.inSupports, decls });
      }
      boundary = i + 1;
    } else if (ch === ";") boundary = i + 1;
  }
  return rules;
}
const rules = scanRules(css);
const outside = rules.filter((r) => !r.inSupports);
const guarded = rules.filter((r) => r.inSupports);
const unguardedColorMix = outside.flatMap((r) => r.decls.filter((d) => d.value.includes("color-mix(")).map((d) => `${d.line}: ${d.value.slice(0, 90)}`));

test("no plain fallback is silently cancelled by a var()-based color-mix in the same rule", () => {
  const dead = [];
  for (const r of outside) {
    r.decls.forEach((d, k) => {
      if (!d.value.includes("color-mix(")) return;
      if (r.decls.slice(0, k).some((p) => p.prop === d.prop && !p.value.includes("color-mix("))) dead.push(`${d.line}: ${r.selector.slice(0, 60)} ${d.prop}`);
    });
  }
  assert.deepEqual(dead, [], "move these color-mix declarations into @supports (color: color-mix(in srgb, red, blue))");
});

test("high-impact selected/press states keep a plain base and a guarded color-mix layer", () => {
  for (const sel of [
    ".count-option input:checked + .count-card",
    "[data-theme] .choice-option input:checked + .choice-card",
    "[data-theme=\"pastel\"] .count-option input:checked + .count-card",
    ".topbar-band",
    "label.setting-row:active",
  ]) {
    const plain = outside.find((r) => r.selector.split(/,\s*/).includes(sel) && r.decls.some((d) => /^background(-image)?$/.test(d.prop)));
    assert.ok(plain, `${sel} needs a plain background`);
    const bg = plain.decls.filter((d) => /^background(-image)?$/.test(d.prop));
    assert.ok(bg.length && bg.every((d) => !d.value.includes("color-mix(")), `${sel} base background must not use color-mix`);
    assert.ok(guarded.some((r) => r.selector.split(/,\s*/).includes(sel) && r.decls.some((d) => d.value.includes("color-mix("))), `${sel} keeps its color-mix tint under @supports`);
  }
  assert.match(css, /\.topbar-band \{[^}]*background: var\(--midnight\);/);
});

test("unguarded color-mix declarations never grow (ratchet)", () => {
  // Remaining ones mix per-element variables (--topic-color, --question-color…) and have no plain fallback;
  // old WebKit drops them to the base tint. Lower this number as they get guarded — never raise it.
  assert.ok(unguardedColorMix.length <= 63, `unguarded color-mix grew to ${unguardedColorMix.length}:\n${unguardedColorMix.join("\n")}`);
});

test("every theme defines a placeholder token dimmer than text", () => {
  for (const sel of [":root {", '[data-theme="midnight"] {', '[data-theme="sunset"] {', '[data-theme="cosmic"] {', '[data-theme="pastel"] {', '[data-theme="pastel"].high-contrast {']) {
    const at = css.indexOf(`    ${sel}`);
    assert.ok(at >= 0, sel);
    assert.match(css.slice(at, css.indexOf("}", at)), /--placeholder: #[0-9a-f]{6};/, sel);
  }
  assert.ok(!css.includes("color: #8993a6;"), "pastel placeholder must use the token");
  assert.match(css, /\.journal-search, \.private-note-input\)::placeholder \{\n\s*color: var\(--placeholder, #94a3b8\);\n\s*opacity: 1;/);
  assert.match(css, /\[data-theme="pastel"\] :is\([^)]*\.journal-search[^)]*\) \{\n\s*border-color: rgba\(79, 91, 120, 0\.19\);/, "pastel journal search gets the paper input surface");
});

test("pastel repaints dark-slate feature surfaces and pale-ink pills", () => {
  assert.match(css, /\[data-theme="pastel"\] :is\(\.profile-card, \.lightning-btn, \.journal-filter-chip, \.milestone-badge, \.lightning-results\) \{/);
  assert.match(css, /\[data-theme="pastel"\] \.wildcard-btn:not\(\.active\) \{ color: #78350f;/);
  assert.match(css, /\[data-theme="pastel"\] \.voice-record-btn:not\(\.recording\) \{ color: #7f1d1d;/);
  assert.match(css, /\[data-theme="pastel"\] \.storybook-sheet \{ background: var\(--card\);/);
  assert.match(css, /\.journal-filter-chip\.active \{\n\s*background: var\(--coral\);\n\s*color: #1f0a12;/);
  assert.ok(html.includes('class="lightning-results"'), "warmup results list needs its class");
  assert.ok(!html.includes("background:rgba(15,23,42,0.6);border-radius:12px;border:1px solid var(--line);font-size:0.8rem"), "inline slate fill must move to the class");
  assert.ok(html.includes('<div class="modal-card exit-dialog" style="text-align:center">'), "daily ritual uses the shared dialog surface");
  assert.ok(!html.includes('margin:6px 0 0;color:#fff">${escapeHTML(String(savedAnswer'), "saved ritual answer must use theme text");
});

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("pastel alignment score colours pass AA on paper for every score, and High Contrast steps them darker", () => {
  const src = html.match(/function alignmentColor\(percent\) \{[\s\S]*?\n    \}/);
  assert.ok(src, "alignmentColor must stay findable");
  const make = (state) => new Function("state", `${src[0]}; return alignmentColor;`)(state);
  const tile = [228, 239, 236];
  for (const highContrast of [false, true]) {
    const color = make({ visualTheme: "pastel", highContrast });
    let worst = Infinity;
    for (let score = 0; score <= 100; score++) {
      const m = color(score).match(/^hsl\((\d+) 85% (\d+)%\)$/);
      assert.ok(m, `unexpected pastel colour ${color(score)}`);
      worst = Math.min(worst, ratio(hslToRgb(+m[1], 85, +m[2]), tile));
    }
    assert.ok(worst >= (highContrast ? 6 : 4.5), `pastel${highContrast ? " HC" : ""} worst score contrast ${worst.toFixed(2)}`);
  }
  assert.equal(make({ visualTheme: "midnight", highContrast: true })(90), "var(--green)", "dark themes keep the token branch");
});

test("contrast-tokens cluster: pastel disclosure, HC accent text, unavailable card and small badges", () => {
  assert.match(css, /\[data-theme="pastel"\] \.setup-customization-disclosure \{ background: var\(--card-light\);/);
  assert.match(css, /\[data-theme="pastel"\] \.customization-summary-tag \{ background: rgba\(79, 91, 120, 0\.08\); color: var\(--text-2\); \}/);
  assert.match(css, /\.customization-summary-tag \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.high-contrast :is\(\.topic-progress-top strong, \.library-overall strong, \.storybook-section h4, \.saved-answer-name\) \{ color: var\(--text\); \}/);
  assert.ok(css.indexOf(".high-contrast :is(.topic-progress-top strong") > css.indexOf('[data-theme="pastel"] .storybook-section h4'), "HC rule must win on source order");
  assert.match(css, /\[data-theme="pastel"\]\.high-contrast \.discussion-card p \{ color: var\(--text\); \}/);
  assert.ok(!/\.play-style-card\.unavailable \{ opacity/.test(css), "the unavailable explanation must not be faded with the card");
  assert.match(css, /\.play-style-card\.unavailable strong \{ opacity: \.62; \}/);
  assert.match(css, /\[data-theme="sunset"\] \.type-chip \{ color: #dbeafe; \}/);
  assert.ok(!css.includes("#62548e"), "pastel discussion prompt uses the AAA ink");
});
