// Shared Playwright harness. WORK=<path to index.html> serves that file in place of the running app's page.
import { chromium, webkit } from "playwright-core";
import { readFileSync } from "node:fs";

export const BASE = process.env.BASE || "http://127.0.0.1:4174/";
const WORK = process.env.WORK;

export async function launch(engine = process.env.ENGINE || "edge") {
  // CHANNEL=msedge|chrome uses an installed browser; CHANNEL=bundled uses "npx playwright install chromium".
  const channel = process.env.CHANNEL || "msedge";
  return engine === "webkit" ? webkit.launch() : chromium.launch(channel === "bundled" ? {} : { channel });
}

export const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const SMALL_PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1366, height: 860 } };

export async function newPage(browser, name, opts, errors) {
  const isWebkit = browser.browserType().name() === "webkit";
  const ctx = await browser.newContext(isWebkit ? { ...opts, isMobile: undefined } : opts);
  if (WORK) {
    await ctx.route((url) => url.origin === new URL(BASE).origin && (url.pathname === "/" || url.pathname === "/index.html"), (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(WORK, "utf8") }));
  }
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/vibrate/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
  return page;
}

export const screenOf = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem("aligned-state-v1")).screen; } catch { return null; } });
// The tutorial opens on the next animation frame, which can lag under load; wait briefly for it.
export const dismissTutorial = async (p) => { const t = p.locator("#tutorial-finish"); await t.waitFor({ state: "visible", timeout: 1500 }).catch(() => {}); if (await t.isVisible().catch(() => false)) { await p.waitForTimeout(450); await t.click(); await t.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {}); } };

export async function answerAll(p, who, { stopAfter = 99 } = {}) {
  await p.waitForSelector("#question-form", { timeout: 4000 }).catch(() => {});
  let i = 0;
  for (; i < Math.min(40, stopAfter); i++) {
    if (!(await p.locator("#question-form").isVisible().catch(() => false))) return i;
    const ta = p.locator("textarea#answer-input");
    if (await ta.count()) await ta.fill(`${who} answer ${i}`);
    else if (await p.locator("[data-quick-pick]").count()) {
      await p.locator("[data-quick-pick]").nth(i % 2).click({ force: true });
      await p.waitForTimeout(900);
      continue;
    } else await p.locator("input#answer-input").fill(String(1 + (i * 3) % 10));
    await p.locator('#question-form button[type="submit"]').last().click({ force: true });
    await p.waitForTimeout(250);
  }
  return i;
}

export async function pair(host, join, { names = ["Avery", "Jordan"] } = {}) {
  await host.goto(BASE); await host.waitForTimeout(400); await dismissTutorial(host);
  await host.fill("#player-one", names[0]); await host.fill("#player-two", names[1]);
  await host.click('[data-play-style="nearby"]');
  await host.locator('#setup-form button[type="submit"]').click();
  await host.waitForSelector("#nearby-host", { timeout: 5000 });
  await host.click("#nearby-host");
  await host.waitForSelector(".qr-code-shell svg", { timeout: 15000 });
  const url = await host.getAttribute("#copy-join-link", "data-join-url");
  await join.goto(url); await join.waitForTimeout(300); await dismissTutorial(join);
  await host.waitForSelector("#question-form", { timeout: 40000 });
  await join.waitForSelector("#question-form", { timeout: 40000 });
  return url;
}

export const waitScreen = (p, re, timeout = 30000) => p.waitForFunction((src) => new RegExp(src).test(JSON.parse(localStorage.getItem("aligned-state-v1")).screen), re.source, { timeout });
