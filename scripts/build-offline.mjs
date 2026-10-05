// Builds downloads/Aligned-offline.html: the whole game in one file that runs from disk (file://) with no
// network. Icons are inlined and the web-app manifest link is dropped because browsers refuse manifests on file://.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const icon = `data:image/png;base64,${readFileSync(join(root, "icon-192.png")).toString("base64")}`;
let html = readFileSync(join(root, "index.html"), "utf8");

const replacements = [
  ['  <link rel="manifest" href="manifest.webmanifest">\n', ""],
  ['<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">', `<link rel="icon" type="image/png" sizes="192x192" href="${icon}">`],
  ['<link rel="apple-touch-icon" href="icon-192.png">', `<link rel="apple-touch-icon" href="${icon}">`]
];
for (const [from, to] of replacements) {
  if (!html.includes(from)) throw new Error(`Offline build could not find: ${from.trim()}`);
  html = html.replace(from, to);
}

mkdirSync(join(root, "downloads"), { recursive: true });
writeFileSync(join(root, "downloads", "Aligned-offline.html"), html);
console.log(`Built downloads/Aligned-offline.html (${Math.round(html.length / 1024)} KB)`);
