import { launch, newPage, PHONE, DESKTOP, pair, answerAll, waitScreen } from "./harness.mjs";
const errors = []; const b = await launch();
const host = await newPage(b, "host", DESKTOP, errors); const join = await newPage(b, "join", PHONE, errors);
const st = (p) => p.evaluate(() => { const s = JSON.parse(localStorage.getItem("aligned-state-v1")); return { screen: s.screen, round: s.nearbyRoundId, a0: Object.keys(s.answers[0]).length, a1: Object.keys(s.answers[1]).length }; });
try {
  await pair(host, join);
  await answerAll(host, "H", { stopAfter: 3 }); await answerAll(join, "J", { stopAfter: 2 });
  const before = [await st(host), await st(join)]; console.log("before", JSON.stringify(before));
  // Simulate the room being gone: both phones lose the link, then the host chooses "Pair again" and reloads.
  await join.evaluate(() => closeNearbyConnection());
  await host.evaluate(() => { closeNearbyConnection(); repairNearbyRound(); });
  await host.waitForSelector("#copy-join-link", { timeout: 20000 });
  await host.reload(); await host.waitForSelector("#copy-join-link", { timeout: 20000 });
  const url = await host.getAttribute("#copy-join-link", "data-join-url");
  await join.goto(url);
  await host.waitForSelector("#question-form", { timeout: 40000 }); await join.waitForSelector("#question-form", { timeout: 40000 });
  const after = [await st(host), await st(join)]; console.log("after ", JSON.stringify(after));
  const same = after[0].round === before[0].round && after[1].round === before[1].round && after[0].a0 >= before[0].a0 && after[1].a1 >= before[1].a1;
  await answerAll(host, "H"); await answerAll(join, "J");
  await waitScreen(host, /celebration|reveal/, 40000); await waitScreen(join, /celebration|reveal/, 40000);
  console.log(same ? "RESULT PASS repair-hostreload" : "RESULT FAIL repair-hostreload (round or answers changed)");
} catch (e) { console.log("RESULT FAIL repair-hostreload", e.message.split("\n")[0]); await host.screenshot({ path: "repair-host-fail.png" }); await join.screenshot({ path: "repair-join-fail.png" }); }
console.log("errors", errors); await b.close();
