// Builds downloads/Aligned-offline.html: the whole game in one file that runs from disk (file://) with no
// network. The favicon is inlined; the web-app manifest and apple-touch-icon links are dropped because file://
// pages can't use them (no manifests on file://, no iOS home-screen install).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const icon = `data:image/png;base64,${readFileSync(join(root, "icon-192.png")).toString("base64")}`;
let html = readFileSync(join(root, "index.html"), "utf8");

const replacements = [
  ['  <link rel="manifest" href="manifest.webmanifest">\n', ""],
  ['<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">', `<link rel="icon" type="image/png" sizes="192x192" href="${icon}">`],
  ['  <link rel="apple-touch-icon" href="apple-touch-icon.png">\n', ""]
];
for (const [from, to] of replacements) {
  if (!html.includes(from)) throw new Error(`Offline build could not find: ${from.trim()}`);
  html = html.replace(from, to);
}

mkdirSync(join(root, "downloads"), { recursive: true });
writeFileSync(join(root, "downloads", "Aligned-offline.html"), html);
console.log(`Built downloads/Aligned-offline.html (${Math.round(html.length / 1024)} KB)`);
