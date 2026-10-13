import { launch, newPage, PHONE, DESKTOP, pair, answerAll } from "./harness.mjs";
const errors = []; const b = await launch();
const host = await newPage(b, "host", DESKTOP, errors); const join = await newPage(b, "join", PHONE, errors);
try {
  await pair(host, join);
  await answerAll(join, "J");
  await join.waitForFunction(() => JSON.parse(localStorage.getItem("aligned-state-v1")).screen === "nearby-wait");
  const t0 = Date.now();
  // Abrupt death: no pagehide teardown may run, so crash the renderer before closing the context.
  // Page.crash never answers (the renderer is gone), so it is not awaited; wait for the crash event instead.
  const bounded = (p, ms) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  try { const cdp = await host.context().newCDPSession(host); const crashed = host.waitForEvent("crash", { timeout: 5000 }); cdp.send("Page.crash").catch(() => {}); await crashed; }
  catch { await bounded(host.evaluate(() => { if (typeof handleUnloadTeardown === "function") { window.removeEventListener("pagehide", handleUnloadTeardown); window.removeEventListener("beforeunload", handleUnloadTeardown); } }), 3000); }
  await bounded(host.context().close(), 5000);
  await join.waitForFunction(() => nearbyRuntime.status === "peer-lost", null, { timeout: 75000 });
  await join.waitForSelector("#nearby-finish-here", { timeout: 5000 });
  const heading = (await join.locator("#nearby-wait-title").innerText()).replace(/\s+/g, " ");
  const text = (await join.locator(".nearby-card").innerText()).replace(/\s+/g, " ");
  const secs = (Date.now() - t0) / 1000;
  console.log(`partner noticed after ${secs.toFixed(1)}s:`, text.slice(0, 160));
  // secs >= 20 catches a graceful leave sneaking back in: that shows "left the round" at once instead of waiting for the 25 s peer-lost timer.
  const ok = /lost their connection/.test(heading) && !/Phones connected/.test(text) && secs >= 20;
  console.log(ok ? "RESULT PASS host-vanish" : "RESULT FAIL host-vanish (" + heading + ", " + secs.toFixed(1) + "s)");
} catch (e) { console.log("RESULT FAIL host-vanish", e.message.split("\n")[0]); await join.screenshot({ path: "vanish-fail.png" }); }
console.log("errors", errors.filter((e) => !/join console/.test(e) || !/WebSocket|ERR_/.test(e))); await b.close();
