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
    assert(await page.locator("#resonance-compass-table").count() > 0, "Accessible table fallback must render in Journal");

    // 9. Open Keepsake Storybook Modal from Journal
    await page.click("#open-storybook-btn");
    await page.waitForSelector(".storybook-sheet", { timeout: 5000 });
    const title = await page.locator(".storybook-header h2").textContent();
    assert.equal(title, "Casey & Riley", "Storybook header must display couple names");
    assert(await page.locator(".storybook-sheet .radar-polygon").count() > 0, "Storybook must embed Resonance Compass");
    assert(await page.locator("#storybook-print-btn").isVisible(), "Storybook must have print button");

    // 10. Close Storybook modal
    await page.evaluate(() => document.getElementById("storybook-close-btn")?.click());
    await page.waitForSelector(".storybook-modal", { state: "detached", timeout: 5000 });

    // 11. Verify state saved in localStorage
    const savedState = await page.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")));
    assert.equal(savedState.completedRounds.length, 1, "Completed round must be saved in history");
    assert(Number.isFinite(savedState.completedRounds[0].alignment.overall), "Overall alignment must be calculated");
    assert.equal(errors.length, 0, `Expected 0 page errors, found: ${errors.join("; ")}`);

    await page.close();
  });

  it("persists visual theme, sound theme, and ambient mix across page reload", async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(baseUrl);
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("aligned-state-v1") || "{}");
      state.version = 2;
      state.tutorialSeen = true;
      localStorage.setItem("aligned-state-v1", JSON.stringify(state));
      document.querySelector("#tutorial-finish")?.closest(".modal-backdrop")?.remove();
    });
    await page.waitForTimeout(300);

    // Open Settings via header #settings-button
    await page.click("#settings-button");
    await page.waitForSelector("#sound-theme", { timeout: 4000 });

    // Change sound theme to dreamy
    await page.selectOption("#sound-theme", "dreamy");

    // Adjust synth ambient slider
    const synthSlider = page.locator("#synth-volume");
    if (await synthSlider.count()) {
      await synthSlider.fill("0.4");
      await synthSlider.dispatchEvent("change");
    }

    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await page.waitForTimeout(600);

    // Verify localStorage persistence
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")));
    assert.equal(saved.soundTheme, "dreamy", "Sound theme must persist as dreamy");
    if (saved.ambientMix) {
      assert.equal(saved.ambientMix.synth, 0.4, "Ambient synth volume must persist as 0.4");
    }

    // Verify UI reflects restored preferences
    await page.click("#settings-button");
    await page.waitForSelector("#sound-theme", { timeout: 4000 });
    const selectedSound = await page.locator("#sound-theme").inputValue();
    assert.equal(selectedSound, "dreamy", "Settings UI sound theme dropdown must be restored to dreamy");

    assert.equal(errors.length, 0, `Page errors encountered: ${errors.join("; ")}`);
    await page.close();
  });

  it("launches a custom pack round when selected from Home setup", async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(baseUrl);
    await page.waitForTimeout(300);

    // Dismiss tutorial if active
    const tut = page.locator("#tutorial-finish");
    if (await tut.isVisible({ timeout: 1200 }).catch(() => false)) {
      await tut.click();
      await page.waitForTimeout(300);
    }

    // Seed state with custom pack and names directly into localStorage
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("aligned-state-v1") || "{}");
      state.version = 2;
      state.screen = "setup";
      state.tutorialSeen = true;
      state.names = ["Robin", "Terry"];
      state.customQuestions = [
        { id: "cq_test_1", prompt: "Our best memory this summer?", type: "text", topic: "fun", category: "Custom · Fun" },
        { id: "cq_test_2", prompt: "How adventurous should we be this weekend?", type: "slider", labels: ["Chill", "Wild"], topic: "lifestyle", category: "Custom · Lifestyle" },
        { id: "cq_test_3", prompt: "What makes you feel loved most?", type: "text", topic: "love", category: "Custom · Love" }
      ];
      state.customPacks = [
        {
          id: "pack_test_e2e",
          name: "Test E2E Adventure Pack",
          questionIds: ["cq_test_1", "cq_test_2", "cq_test_3"]
        }
      ];
      localStorage.setItem("aligned-state-v1", JSON.stringify(state));
    });

    await page.reload();
    await page.waitForTimeout(600);

    // Verify pack appears under "Your packs" on Home
    const packButton = page.locator('[data-start-pack="pack_test_e2e"]');
    await packButton.waitFor({ state: "visible", timeout: 4000 });
    assert(await packButton.isVisible(), "Custom pack start button must be visible under Your Packs");

    // Click to start round with the custom pack
    await packButton.click();
    await page.waitForTimeout(600);

    // Verify round launched directly into question screen
    await page.waitForSelector("#question-form", { timeout: 6000 });
    assert(await page.locator("#question-form").isVisible(), "Question form must appear for active round");

    // Verify active game state
    const roundState = await page.evaluate(() => JSON.parse(localStorage.getItem("aligned-state-v1")));
    assert.equal(roundState.sessionPreset, "pack", "Session preset must be pack");
    assert.equal(roundState.selectedQuestionIds.length, 3, "Selected questions must match custom pack questions");
    assert(roundState.selectedQuestionIds.includes("cq_test_1"), "Must include custom question 1");
    assert(roundState.selectedQuestionIds.includes("cq_test_2"), "Must include custom question 2");
    assert(roundState.selectedQuestionIds.includes("cq_test_3"), "Must include custom question 3");

    assert.equal(errors.length, 0, `Page errors encountered: ${errors.join("; ")}`);
    await page.close();
  });

  it("shifts accessibility focus to screen heading across screen transitions", async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Seed state with tutorialSeen to skip intro modal
    await page.addInitScript(() => {
      const state = { version: 2, screen: "setup", tutorialSeen: true, names: ["Alex", "Sam"] };
      localStorage.setItem("aligned-state-v1", JSON.stringify(state));
    });

    await page.goto(baseUrl);
    await page.waitForTimeout(400);

    // 1. Navigate to Settings
    await page.click("#settings-button");
    await page.waitForSelector("#settings-heading, h1, h2", { timeout: 4000 });

    const settingsFocusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    const settingsFocusedText = await page.evaluate(() => document.activeElement?.textContent?.trim());
    assert(
      ["h1", "h2"].includes(settingsFocusedTag),
      `Expected activeElement to be heading (h1 or h2), got <${settingsFocusedTag}> ("${settingsFocusedText}")`
    );

    // 2. Navigate to Library
    await page.click("#library-button");
    await page.waitForSelector("h1, h2", { timeout: 4000 });

    const libraryFocusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    assert(
      ["h1", "h2"].includes(libraryFocusedTag),
      `Expected activeElement in Library to be heading, got <${libraryFocusedTag}>`
    );

    // 3. Navigate to Results / Journal
    await page.click("#results-button");
    await page.waitForSelector("h1, h2", { timeout: 4000 });

    const resultsFocusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    assert(
      ["h1", "h2"].includes(resultsFocusedTag),
      `Expected activeElement in Results to be heading, got <${resultsFocusedTag}>`
    );

    // 4. Return to Home
    await page.click("#home-button");
    await page.waitForSelector("h1, h2", { timeout: 4000 });
    const homeFocusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    assert(
      ["h1", "h2"].includes(homeFocusedTag),
      `Expected activeElement on Home to be heading, got <${homeFocusedTag}>`
    );

    assert.equal(errors.length, 0, `Page errors: ${errors.join("; ")}`);
    await page.close();
  });

  it("activates kbd-nav mode and traps focus in modal dialogs", async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.addInitScript(() => {
      const state = { version: 2, screen: "setup", tutorialSeen: true, names: ["Alex", "Sam"] };
      localStorage.setItem("aligned-state-v1", JSON.stringify(state));
    });

    await page.goto(baseUrl);
    await page.waitForTimeout(400);

    // Press Tab key: documentElement must receive 'kbd-nav' class for focus indicator rings
    await page.keyboard.press("Tab");
    const hasKbdNav = await page.evaluate(() => document.documentElement.classList.contains("kbd-nav"));
    assert.equal(hasKbdNav, true, "Pressing Tab must add 'kbd-nav' class to documentElement");

    // Open Daily Connection Ritual modal
    const dailyCard = page.locator("#daily-ritual-card");
    if (await dailyCard.count()) {
      await dailyCard.click();
      await page.waitForSelector(".modal-backdrop", { timeout: 3000 });

      // Active element must be inside modal backdrop
      const isInsideModal = await page.evaluate(() => {
        const modal = document.querySelector(".modal-backdrop");
        return modal && modal.contains(document.activeElement);
      });
      assert.equal(isInsideModal, true, "Focus must land inside the opened modal dialog");

      // Background app container must be inert
      const appInert = await page.evaluate(() => document.getElementById("app")?.inert);
      assert.equal(appInert, true, "#app container must be inert while modal is open");

      // Close modal
      const closeBtn = page.locator('.modal-backdrop [data-modal-cancel], .modal-backdrop button');
      await closeBtn.first().click();
      await page.waitForSelector(".modal-backdrop", { state: "detached", timeout: 3000 });

      // After closing, #app must no longer be inert
      const appInertAfter = await page.evaluate(() => document.getElementById("app")?.inert);
      assert.equal(appInertAfter, false, "#app must not be inert after modal closes");
    }

    assert.equal(errors.length, 0, `Page errors: ${errors.join("; ")}`);
    await page.close();
  });
});
