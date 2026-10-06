import { launch, newPage, PHONE, DESKTOP, pair, answerAll } from "./harness.mjs";
const errors = []; const b = await launch();
const host = await newPage(b, "host", DESKTOP, errors); const join = await newPage(b, "join", PHONE, errors);
try {
  await pair(host, join);
  await answerAll(join, "J");
  await join.waitForFunction(() => JSON.parse(localStorage.getItem("aligned-state-v1")).screen === "nearby-wait");
  const t0 = Date.now();
  await host.context().close(); // the host's phone dies abruptly
  await join.waitForSelector("#nearby-finish-here, #nearby-retry", { timeout: 90000 });
  const text = (await join.locator(".nearby-card").innerText()).replace(/\s+/g, " ");
  console.log(`partner noticed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, text.slice(0, 160));
  console.log(/Phones connected/.test(text) ? "RESULT FAIL host-vanish (still says connected)" : "RESULT PASS host-vanish");
} catch (e) { console.log("RESULT FAIL host-vanish", e.message.split("\n")[0]); await join.screenshot({ path: "vanish-fail.png" }); }
console.log("errors", errors.filter((e) => !/join console/.test(e) || !/WebSocket|ERR_/.test(e))); await b.close();
