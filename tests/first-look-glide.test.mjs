import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = html.indexOf(") {", start) + 2; i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test("first-look glide keyframes end on the element’s own position (no `to` step)", () => {
  for (const name of ["marker-land", "gap-grow", "mask-fill", "pick-drop"]) {
    const m = html.match(new RegExp(`@keyframes ${name} \{([^\n]*)\}\s*$`, "m"));
    assert.ok(m, `${name} keyframes exist`);
    assert.doesNotMatch(m[1], /\bto\b|100%\s*\{/, `${name} has no end step`);
  }
  assert.match(html, /\.flip-card\.first-look \.marker:not\(\.ghost-marker\) \{ animation: marker-land/);
});

test("first-look glide is switched off for reduced motion and ghost markers", () => {
  assert.match(html, /\.reduced-motion \.flip-card\.first-look \* \{ animation: none !important; \}/);
  // An animation: none on ghosts (or a list without magnetic-snap) would restart the snap when the class comes off.
  assert.doesNotMatch(html, /\.first-look \.ghost-marker \{ animation: none/);
  assert.match(html, /\.flip-card\.first-look \.magnetic-collision \.marker:not\(\.ghost-marker\) \{ animation: marker-land [^;]*, magnetic-snap 480ms/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ \.flip-card\.first-look \* \{ animation: none !important; \} \}/);
});

test("toggleCard adds the self-removing first-look class only on a motion-allowed first look", () => {
  const body = extractFunction("toggleCard");
  assert.match(body, /if \(firstLook && !motionReduced\(\)\) \{\s*card\.classList\.add\("first-look"\);\s*window\.setTimeout\(\(\) => card\.classList\.remove\("first-look"\), \d+\);/);
  assert.match(body, /firstLook && !motionReduced\(\) \? 760 : 450/, "spark burst waits out the glide");
});
