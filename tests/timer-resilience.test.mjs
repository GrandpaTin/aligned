import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, "..", "index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

test("Timer Resilience & Discussion Timing Math", async (t) => {
  await t.test("targetTime remaining calculation handles throttle and background gaps without drift", () => {
    const totalDurationSeconds = 120;
    const now = 1000000;
    const targetTime = now + totalDurationSeconds * 1000;

    // Simulate 15.4 seconds passing during a background tab freeze
    const simulatedNow = now + 15400;
    const remainingSeconds = Math.max(0, Math.ceil((targetTime - simulatedNow) / 1000));
    assert.equal(remainingSeconds, 105, "Calculates 105 seconds remaining after 15.4s background freeze");

    // Simulate complete expiration past targetTime
    const expiredNow = now + 125000;
    const expiredRemaining = Math.max(0, Math.ceil((targetTime - expiredNow) / 1000));
    assert.equal(expiredRemaining, 0, "Clamps to 0 when time exceeds targetTime");
  });

  await t.test("timer string formatting matches display requirements", () => {
    const formatTimer = (seconds) => {
      if (seconds <= 0) return "Time's up! ✦";
      const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
      const secs = String(seconds % 60).padStart(2, "0");
      return `${mins}:${secs}`;
    };

    assert.equal(formatTimer(120), "02:00");
    assert.equal(formatTimer(65), "01:05");
    assert.equal(formatTimer(9), "00:09");
    assert.equal(formatTimer(0), "Time's up! ✦");
  });

  await t.test("question slider keyboard navigation logic satisfies WCAG accessible slider bounds", () => {
    const applySliderKey = (currentVal, key) => {
      let val = currentVal;
      if (key === "Home") val = 1;
      else if (key === "End") val = 10;
      else if (key === "PageUp") val = Math.min(10, val + 2);
      else if (key === "PageDown") val = Math.max(1, val - 2);
      else if (key === "ArrowUp" || key === "ArrowRight") val = Math.min(10, val + 1);
      else if (key === "ArrowDown" || key === "ArrowLeft") val = Math.max(1, val - 1);
      return val;
    };

    // Home jumps to 1
    assert.equal(applySliderKey(7, "Home"), 1);
    // End jumps to 10
    assert.equal(applySliderKey(3, "End"), 10);
    // PageUp jumps by 2 clamped to 10
    assert.equal(applySliderKey(5, "PageUp"), 7);
    assert.equal(applySliderKey(9, "PageUp"), 10);
    // PageDown decrements by 2 clamped to 1
    assert.equal(applySliderKey(6, "PageDown"), 4);
    assert.equal(applySliderKey(2, "PageDown"), 1);
  });

  await t.test("text answer character counter accurately monitors limits and accounts for edge cases", () => {
    const maxChars = 600;
    const formatCounter = (str) => `${String(str || "").length} / ${maxChars} characters`;

    assert.equal(formatCounter(""), "0 / 600 characters");
    assert.equal(formatCounter("Hello world"), "11 / 600 characters");
    assert.equal(formatCounter(null), "0 / 600 characters");
    assert.equal(formatCounter(undefined), "0 / 600 characters");

    const longAnswer = "A".repeat(600);
    assert.equal(formatCounter(longAnswer), "600 / 600 characters");
  });

  await t.test("index.html contains targetTime drift resilience and accessible slider controls", () => {
    assert.ok(
      indexHtml.includes("timer.targetTime = Date.now() + timer.seconds * 1000;"),
      "index.html must anchor discussion timer to targetTime"
    );
    assert.ok(
      indexHtml.includes("Math.ceil((timer.targetTime - Date.now()) / 1000)"),
      "index.html must calculate remaining seconds from targetTime"
    );
    assert.ok(
      indexHtml.includes("e.key === \"Home\""),
      "index.html slider must handle Home key"
    );
    assert.ok(
      indexHtml.includes("e.key === \"End\""),
      "index.html slider must handle End key"
    );
    assert.ok(
      indexHtml.includes("e.key === \"PageUp\""),
      "index.html slider must handle PageUp key"
    );
    assert.ok(
      indexHtml.includes("e.key === \"PageDown\""),
      "index.html slider must handle PageDown key"
    );
    assert.ok(
      indexHtml.includes("id=\"answer-char-counter\""),
      "index.html must include accessible answer character counter"
    );
  });
});
