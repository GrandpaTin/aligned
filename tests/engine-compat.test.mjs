import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = html.slice(0, html.indexOf("</style>"));

test("live theme / high-contrast switches re-render so WebKit restyles every node (R1-05)", () => {
  const theme = html.match(/input\[name="visual-theme"\]'\)\.forEach\(\(input\) => input\.addEventListener\("change", \(\) => \{([\s\S]*?)\}\)\);/);
  assert.ok(theme, "visual-theme change handler");
  assert.match(theme[1], /state\.visualTheme = input\.value; saveState\(\); render\(\);/);
  const hc = html.match(/getElementById\("high-contrast"\)\.addEventListener\("change", \(event\) => \{([^}]*)\}\);/);
  assert.ok(hc, "high-contrast change handler");
  assert.match(hc[1], /saveState\(\); render\(\);/);
  // render() must not be called from applyPreferences (render calls applyPreferences: infinite recursion).
  const ap = html.indexOf("function applyPreferences(");
  assert.ok(ap > 0);
  const body = html.slice(ap, html.indexOf("\n    }\n", ap));
  assert.doesNotMatch(body, /\brender\(\)/);
});

test("select controls inherit the app font (R1-26)", () => {
  assert.match(css, /\n    button,\n    input,\n    select,\n    textarea \{\n      font: inherit;\n    \}/);
});

test("topic chip and question pill keep plain bases with color-mix only under @supports (R1-27)", () => {
  const sup = "@supports (color: color-mix(in srgb, red, blue))";
  assert.match(css, /\.topic-icon \{[^}]*background: rgba\(148, 163, 184, 0\.12\);/);
  assert.match(css, /\n    \.topic-option input:checked \+ \.topic-chip \{\n      border-color: var\(--topic-color\);\n      color: var\(--text\);\n      background: rgba\(15, 23, 42, 0\.7\);/);
  assert.ok(css.includes(`${sup} { .topic-option input:checked + .topic-chip {`));
  assert.ok(css.includes(`${sup} { [data-theme="pastel"] .topic-option input:checked + .topic-chip {`));
  assert.ok(css.includes(`${sup} {\n      .question-card .category-pill {`));
  assert.ok(css.includes(`[data-theme="pastel"] .question-card .category-pill { color: #1e293b !important; }\n    ${sup} { [data-theme="pastel"] .question-card .category-pill { color: color-mix(`));
});
