// Browser/PWA Back: dialogs close first, then Home, then the app is left in one press. Usage: node back.mjs (ENGINE=webkit supported)
const H = process.env.ENGINE === "webkit" ? "harness-force.mjs" : "harness.mjs";
const { launch, newPage, PHONE, BASE, dismissTutorial } = await import(`./${H}`);
const wk = process.env.ENGINE === "webkit"; const T = wk ? 3 : 1; const F = { force: true };
const errors = []; const b = await launch(); 
async function fresh() { const p = await newPage(b, "p", PHONE, errors); await p.goto("data:text/html,<h1>before</h1>"); await p.goto(BASE); await p.waitForTimeout(1000*T); return p; }
const state = async (p) => p.url().startsWith(BASE) ? (await p.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")||"{}").screen)) + " modal=" + await p.locator(".modal-backdrop").count() + " tut=" + await p.locator("#tutorial-finish").isVisible().catch(()=>false) : "LEFT(" + p.url().slice(0, 30) + ")";
const back = async (p) => { await p.evaluate(() => history.back()).catch(()=>{}); await p.waitForTimeout(1000*T); return state(p); };
// 1: first run tutorial -> dismiss -> Back on Home
let p = await fresh(); console.log("1 tutorial shown", await p.locator("#tutorial-finish").isVisible());
await dismissTutorial(p); await p.waitForTimeout(500*T); console.log("1 after dismiss", await state(p), "len", await p.evaluate(() => history.length));
console.log("1 Back ->", await back(p)); console.log("1 Back again ->", await back(p));
// 2: home -> settings (nav) -> in-app Home -> Back
p = await fresh(); await dismissTutorial(p); await p.waitForTimeout(500*T);
await p.click("#settings-button", F); await p.waitForTimeout(800*T); console.log("2 on", await state(p));
await p.click("#home-button", F); await p.waitForTimeout(800*T); console.log("2 tapped Home ->", await state(p), "len", await p.evaluate(() => history.length));
console.log("2 Back ->", await back(p)); console.log("2 Back again ->", await back(p));
// 3: settings -> Back -> Back
p = await fresh(); await dismissTutorial(p); await p.waitForTimeout(500*T);
await p.click("#settings-button", F); await p.waitForTimeout(800*T);
console.log("3 Back ->", await back(p)); console.log("3 Back ->", await back(p));
// 4: dialog via tutorial replay in settings
p = await fresh(); await dismissTutorial(p); await p.waitForTimeout(500*T);
await p.click("#settings-button", F); await p.waitForTimeout(800*T); await p.click("#replay-tutorial", F); await p.waitForTimeout(1000*T);
console.log("4 dialog", await state(p)); console.log("4 Back ->", await back(p)); console.log("4 Back ->", await back(p)); console.log("4 Back ->", await back(p));
// 5: reload on Settings must not add a dead Back press
p = await fresh(); await dismissTutorial(p); await p.waitForTimeout(500*T);
await p.click("#settings-button", F); await p.waitForTimeout(800*T); await p.reload(); await p.waitForTimeout(1200*T);
console.log("5 Back ->", await back(p)); console.log("5 Back ->", await back(p));
console.log("errors", errors); await b.close();
