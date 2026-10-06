// Multiplayer resilience scenarios. Usage: node mp2.mjs [happy|reload-join|reload-host|drop-final|reveal|leave]
import { launch, newPage, PHONE, DESKTOP, pair, answerAll, screenOf, waitScreen, BASE, dismissTutorial } from "./harness.mjs";

const scenario = process.argv[2] || "happy";
const errors = [];
const b = await launch();
const host = await newPage(b, "host", DESKTOP, errors);
const join = await newPage(b, "join", PHONE, errors);
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const shot = (p, n) => p.screenshot({ path: `mp2-${scenario}-${n}.png` });
try {
  await pair(host, join);
  log("paired, both on questions");
  if (scenario === "happy") {
    await answerAll(host, "H"); await shot(host, "host-wait");
    await answerAll(join, "J");
    await waitScreen(host, /celebration|reveal/); await waitScreen(join, /celebration|reveal/);
  } else if (scenario === "reload-join") {
    await answerAll(join, "J", { stopAfter: 2 });
    await join.reload(); log("partner reloaded mid-round");
    await join.waitForSelector("#question-form", { timeout: 10000 });
    await answerAll(host, "H");
    await answerAll(join, "J");
    await waitScreen(host, /celebration|reveal/, 45000); await waitScreen(join, /celebration|reveal/, 45000);
  } else if (scenario === "reload-host") {
    await answerAll(host, "H", { stopAfter: 2 });
    await host.reload(); log("host reloaded mid-round");
    await host.waitForSelector("#question-form", { timeout: 10000 });
    await answerAll(join, "J"); await shot(join, "join-wait");
    await answerAll(host, "H");
    await waitScreen(host, /celebration|reveal/, 45000); await waitScreen(join, /celebration|reveal/, 45000);
  } else if (scenario === "reload-wait") {
    await answerAll(join, "J");
    await join.reload(); log("partner reloaded on waiting screen");
    await answerAll(host, "H");
    await waitScreen(host, /celebration|reveal/, 45000); await waitScreen(join, /celebration|reveal/, 45000);
  } else if (scenario === "drop-final") {
    await answerAll(join, "J", { stopAfter: 3 });
    await answerAll(host, "H", { stopAfter: 4 });
    await host.evaluate(() => { nearbyDataChannel.close(); }); log("host data channel closed");
    await answerAll(host, "H");
    await answerAll(join, "J");
    await waitScreen(host, /celebration|reveal/, 60000); await waitScreen(join, /celebration|reveal/, 60000);
  } else if (scenario === "reveal") {
    await answerAll(host, "H"); await answerAll(join, "J");
    await waitScreen(host, /celebration/); await waitScreen(join, /celebration/);
    await host.click("#open-reveal-board"); await host.waitForTimeout(500);
    await host.locator(".card-front").first().click(); await host.waitForTimeout(800);
    await join.click("#open-reveal-board"); await join.waitForTimeout(800);
    await join.locator(".card-front").nth(1).click(); await join.waitForTimeout(1200);
    const h = await host.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")).revealedIds.length);
    const j = await join.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")).revealedIds.length);
    log(`revealed host=${h} join=${j}`); if (h !== 2 || j !== 2) throw new Error("reveal state diverged");
    await host.click("#new-round"); await join.waitForSelector("#question-form", { timeout: 15000 }); log("second round started on both");
  } else if (scenario === "leave") {
    await host.goto(BASE); await dismissTutorial(host);
    await answerAll(join, "J"); log("partner finished");
  }
  await shot(host, "host-end"); await shot(join, "join-end");
  log(`screens host=${await screenOf(host)} join=${await screenOf(join)}`);
  console.log("RESULT PASS", scenario);
} catch (error) {
  await shot(host, "host-fail").catch(() => {}); await shot(join, "join-fail").catch(() => {});
  log(`screens host=${await screenOf(host)} join=${await screenOf(join)}`);
  console.log("RESULT FAIL", scenario, error.message.split("\n")[0]);
}
console.log("errors:", errors.length ? errors : "none");
await b.close();
