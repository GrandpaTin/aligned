import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const html = readFileSync(resolve(root, "index.html"), "utf8");

const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  return vm.runInNewContext(m[1]);
};
const questions = [...arraySource("questionBank"), ...arraySource("specialtyQuestionBank")];

const dailyQuestionFnMatch = html.match(/function dailyQuestionForDate\(dateStr\) \{[\s\S]*?\n    \}/);
const dailyQuestionForDate = vm.runInNewContext(`(${dailyQuestionFnMatch[0]})`, { ALL_QUESTIONS: questions });

const streakFnMatch = html.match(/function calculateStreakFromDates\(completedDates = \[\], referenceDate = localDateStamp\(\)\) \{[\s\S]*?\n    \}/);
const localDateStamp = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const calculateStreakFromDates = vm.runInNewContext(`(${streakFnMatch[0]})`, { localDateStamp });

const createBackupFnMatch = html.match(/function createBackupPayload\(\) \{[\s\S]*?\n    \}\n\n    function backupToState/);
const backupToStateMatch = html.match(/function backupToState\(payload\) \{[\s\S]*?\n    \}\n\n    function exportBackup/);

describe("Daily Connection Ritual Lifecycle", () => {
  it("selects deterministic daily questions for dates", () => {
    const q1 = dailyQuestionForDate("2026-10-13");
    const q1Repeat = dailyQuestionForDate("2026-10-13");
    const q2 = dailyQuestionForDate("2026-10-14");
    assert.equal(q1.id, q1Repeat.id, "Same date must return identical question");
    assert(q1.prompt && q1.prompt.length >= 10, "Question must have valid prompt");
    assert(q2.prompt && q2.prompt.length >= 10, "Next day question must have valid prompt");
  });

  it("calculates contiguous streaks correctly across timezones and gaps", () => {
    // Day 1 completion
    assert.equal(calculateStreakFromDates(["2026-10-13"], "2026-10-13"), 1);

    // Day 2 consecutive completion
    assert.equal(calculateStreakFromDates(["2026-10-12", "2026-10-13"], "2026-10-13"), 2);

    // Day 3 not yet done today, but yesterday was done: active streak remains 2
    assert.equal(calculateStreakFromDates(["2026-10-12", "2026-10-13"], "2026-10-14"), 2);

    // Day 4 gap of 2 days: streak resets to 0
    assert.equal(calculateStreakFromDates(["2026-10-10", "2026-10-11"], "2026-10-14"), 0);

    // Leap day rollover: Feb 28 -> Feb 29 -> March 1 in 2028
    assert.equal(calculateStreakFromDates(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01"), 3);
  });

  it("exports and restores dailyRitual in backup round-trip", () => {
    const dummyState = {
      names: ["Alex", "Jordan"],
      questionMode: "mixed",
      sessionPreset: "custom",
      playStyle: "pass-and-play",
      questionCount: 5,
      questionIntensity: "curious",
      selectedTopics: ["connection"],
      soundEnabled: true,
      soundTheme: "cute",
      soundVolume: 0.8,
      ambientMusicEnabled: false,
      hapticsEnabled: true,
      visualTheme: "midnight",
      textSize: "normal",
      highContrast: false,
      reducedMotion: false,
      privatePinHash: "",
      tutorialSeen: true,
      answeredQuestionIds: [],
      excludedQuestionIds: [],
      neverQuestionIds: [],
      favoriteQuestionIds: [],
      questionEdits: {},
      questionFlags: {},
      questionTagOverrides: {},
      customQuestions: [],
      customPacks: [],
      completedRounds: [],
      screen: "setup",
      selectedQuestionIds: [],
      activePlayer: 0,
      questionIndex: 0,
      answers: [{}, {}],
      comments: [{}, {}],
      privateNotes: [{}, {}],
      importance: [{}, {}],
      notReady: [{}, {}],
      textRatings: {},
      conversationStatus: {},
      sharedIntentions: [],
      resumeScreen: null,
      revealedIds: [],
      completedPlayers: [false, false],
      guesses: [{}, {}],
      seenIds: [],
      revealCelebrated: "",
      textRatingTimes: {},
      conversationTimes: {},
      cardPrompts: {},
      dailyRitual: {
        streak: 5,
        lastDate: "2026-10-13",
        answers: { "2026-10-13": 9, "2026-10-12": 8 },
        completedDates: ["2026-10-12", "2026-10-13"]
      }
    };

    const createBackupPayload = vm.runInNewContext(`(${createBackupFnMatch[0].replace(/\n\n    function backupToState$/, "")})`, {
      state: dummyState
    });
    const backupPayload = createBackupPayload();
    assert(backupPayload.history.dailyRitual, "Backup payload must include history.dailyRitual");
    assert.equal(backupPayload.history.dailyRitual.streak, 5, "Backup payload must preserve streak");

    const backupToState = vm.runInNewContext(`(${backupToStateMatch[0].replace(/\n\n    function exportBackup$/, "")})`, {
      BACKUP_APP_NAMES: new Set(["Aligned", "Are We Compatible?"])
    });
    const restored = backupToState(backupPayload);
    assert(restored.dailyRitual, "Restored state must include dailyRitual");
    assert.equal(restored.dailyRitual.streak, 5, "Restored state must preserve streak count");
    assert.equal(restored.dailyRitual.answers["2026-10-13"], 9, "Restored state must preserve saved answer");
    assert.deepEqual(Array.from(restored.dailyRitual.completedDates), ["2026-10-12", "2026-10-13"], "Restored state must preserve completedDates");
  });
});
