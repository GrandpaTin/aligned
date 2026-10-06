import { launch, newPage, PHONE, BASE, dismissTutorial, answerAll } from "./harness-force.mjs";
const errors = []; const b = await launch(); const p = await newPage(b, "m", PHONE, errors);
const found = new Map();
const scan = async (label) => {
  const items = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#app *, .modal-backdrop *")) {
      const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
      if (!text) continue;
      const cs = getComputedStyle(el); const size = parseFloat(cs.fontSize);
      if (size >= 11.95 || cs.display === "none" || cs.visibility === "hidden" || el.closest("[hidden],[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      const cls = [...el.classList].join(".");
      const parent = el.parentElement?.classList[0] || el.parentElement?.tagName.toLowerCase();
      out.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} < ${parent} @${size.toFixed(1)} "${text.slice(0, 24)}"`);
    }
    return out;
  });
  for (const i of items) { const k = i.replace(/ "[^"]*"$/, ""); if (!found.has(k)) found.set(k, `${label}: ${i}`); }
};
await p.goto(BASE); await p.waitForTimeout(500); await dismissTutorial(p); await scan("setup");
await p.fill("#player-one", "Avery"); await p.fill("#player-two", "Jordan");
await p.locator('#setup-form button[type="submit"]').click(); await p.waitForSelector("#question-form"); await scan("question");
await answerAll(p, "A"); await scan("lock"); await p.click("#unlock-turn", { force: true }); await answerAll(p, "J"); await scan("celebration");
await p.click("#open-reveal-board", { force: true }); await p.waitForTimeout(800); await p.click("#reveal-all", { force: true }); await p.waitForTimeout(800); await scan("reveal");
await p.click("#results-button", { force: true }); await p.waitForTimeout(500); await scan("results");
await p.click("#library-button", { force: true }); await p.waitForTimeout(500); await scan("library");
await p.click("#settings-button", { force: true }); await p.waitForTimeout(500); await scan("settings");
console.log([...found.values()].join("\n")); console.log("errors", errors); await b.close();
