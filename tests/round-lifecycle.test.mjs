import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

describe("End-to-End Round Lifecycle Simulation", () => {
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const sw = readFileSync(resolve(root, "sw.js"), "utf8");
    server = createServer((req, res) => {
      if (req.url === "/sw.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
        res.end(sw);
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ channel: "msedge", headless: true });
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  it("completes a 5-question round: setup -> questions -> intermission -> reveal -> journal", async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(baseUrl);

    // 1. Dismiss tutorial if active
    const tut = page.locator("#tutorial-finish");
    if (await tut.isVisible({ timeout: 1500 }).catch(() => false)) {
      await tut.click();
      await page.waitForTimeout(300);
    }

    // 2. Setup Screen: Enter names and pick 5-question Quick Check-in preset
    await page.fill("#player-one", "Casey");
    await page.fill("#player-two", "Riley");
    await page.click("#session-select-trigger");
    await page.click('[data-session-preset="check-in"]');
    await page.locator('#setup-form button[type="submit"]').click();

    // Helper to submit answers respecting the 650 ms guard and quick-pick cards
    const answerRound = async (playerName) => {
      for (let i = 0; i < 5; i++) {
        await page.waitForSelector("#question-form", { timeout: 6000 });
        const ta = page.locator("textarea#answer-input");
        const qp = page.locator("[data-quick-pick]");
        const isTa = await ta.count();
        const isQp = await qp.count();

        if (isTa) {
          await ta.fill(`${playerName} thought ${i}`);
          await page.locator('#question-form button[type="submit"]').last().click();
          await page.waitForTimeout(750);
        } else if (isQp) {
          await qp.nth(i % 2).click();
          await page.waitForTimeout(900);
          const hint = await page.locator(".quick-pick-hint").textContent().catch(() => "");
          if (/Lock my answers/.test(hint)) {
            await page.locator('#question-form button[type="submit"]').last().click();
            await page.waitForTimeout(750);
          }
        } else {
          await page.locator("input#answer-input").fill(String(3 + i));
          await page.locator('#question-form button[type="submit"]').last().click();
          await page.waitForTimeout(750);
        }
      }
    };

    // 3. Player 1 questions
    await answerRound("Casey");

    // 4. Intermission screen hand-off
    await page.waitForSelector("#unlock-turn", { timeout: 6000 });
    await page.click("#unlock-turn");
    await page.waitForTimeout(750);

    // 5. Player 2 questions
    await answerRound("Riley");

    // 6. Celebration screen -> Reveal board
    await page.waitForSelector("#open-reveal-board", { timeout: 6000 });
    await page.click("#open-reveal-board");

    // 7. Reveal board: flip cards & rate written cards
    await page.waitForSelector(".card-front", { timeout: 6000 });
    const cards = page.locator(".card-front");
    const cardCount = await cards.count();
    assert.equal(cardCount, 5, "Must render exactly 5 cards on reveal board");
    for (let i = 0; i < cardCount; i++) {
      await cards.nth(i).click().catch(() => {});
      await page.waitForTimeout(200);
    }
    const unrated = page.locator(".rating-option");
    if (await unrated.count()) {
      await unrated.first().click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // 8. Open Journal (Results screen) and verify Resonance Compass
    await page.click('#results-button');
    await page.waitForSelector(".radar-compass-card", { timeout: 6000 });
    assert(await page.locator(".radar-polygon").count() > 0, "Resonance Compass radar polygon must render in Journal");

    // 9. Verify state saved in localStorage
    const savedState = await page.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")));
    assert.equal(savedState.completedRounds.length, 1, "Completed round must be saved in history");
    assert(Number.isFinite(savedState.completedRounds[0].alignment.overall), "Overall alignment must be calculated");
    assert.equal(errors.length, 0, `Expected 0 page errors, found: ${errors.join("; ")}`);

    await page.close();
  });
});
