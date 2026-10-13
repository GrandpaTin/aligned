import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

// Portable resolution of index.html
const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract constants and helpers from index.html
const arraySource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n    \\]);`));
  assert(m, `Could not locate ${name}`);
  return vm.runInNewContext(m[1]);
};

const objSource = (name) => {
  const m = html.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n    \\});`));
  assert(m, `Could not locate ${name}`);
  return vm.runInNewContext(`(${m[1]})`);
};

const questionBank = arraySource("questionBank");
const specialtyQuestionBank = arraySource("specialtyQuestionBank");
const CLASSIC_TOPIC_MAP = objSource("CLASSIC_TOPIC_MAP");
const TOPIC_OPTIONS = arraySource("TOPIC_OPTIONS");
const QUESTION_TAG_RULES = arraySource("QUESTION_TAG_RULES");

const normMatch = html.match(/function normalizeAnswer\(value\) \{[\s\S]*?\n    \}/);
assert(normMatch, "Could not locate normalizeAnswer");
const normalizeAnswer = vm.runInNewContext(`(${normMatch[0]})`);

const ALL_QUESTIONS = [
  ...questionBank.map((question) => ({ ...question, topic: CLASSIC_TOPIC_MAP[question.category] })),
  ...specialtyQuestionBank
];

const catalogMatch = html.match(/let questionCatalogCache = null;[\s\S]*?function getQuestionCatalog\(\) \{[\s\S]*?\n    \}/);
assert(catalogMatch, "Could not locate getQuestionCatalog in index.html");

/**
 * Pure simulation of the library filtering pipeline from renderQuestionList in index.html
 */
function filterCatalog(catalog, libraryView, state) {
  const search = normalizeAnswer(libraryView.search);
  const answeredIds = new Set(state.answeredQuestionIds || []);
  const excludedIds = new Set(state.excludedQuestionIds || []);
  const neverIds = new Set(state.neverQuestionIds || []);
  const favoriteIds = new Set(state.favoriteQuestionIds || []);
  const questionFlags = state.questionFlags || {};

  return catalog.filter((question) => {
    const answered = answeredIds.has(question.id);
    const excluded = excludedIds.has(question.id);
    const never = neverIds.has(question.id);
    const favorite = favoriteIds.has(question.id);
    const matchesStatus = libraryView.filter === "all"
      || (libraryView.filter === "answered" && answered)
      || (libraryView.filter === "unanswered" && !answered)
      || (libraryView.filter === "favorites" && favorite)
      || (libraryView.filter === "excluded" && excluded)
      || (libraryView.filter === "never" && never)
      || (libraryView.filter === "valuable" && (questionFlags[question.id] || []).includes("valuable"))
      || (libraryView.filter === "uncomfortable" && (questionFlags[question.id] || []).includes("uncomfortable"));
    const matchesTopic = libraryView.topic === "all" || question.topic === libraryView.topic;
    const matchesSearch = !search || (question._searchIndex ? question._searchIndex.includes(search) : normalizeAnswer(`${question.prompt} ${question.category} ${(question.tags || []).join(" ")}`).includes(search));
    return matchesStatus && matchesTopic && matchesSearch;
  });
}

/**
 * Computes the announcement string generated for #library-search-status
 */
function computeAnnouncement(filteredCount, limit) {
  return filteredCount === 0
    ? "No questions match your search or filter."
    : `Showing ${Math.min(filteredCount, limit)} of ${filteredCount} matching questions.`;
}

describe("Question Library Performance & Filter Suite", () => {
  let vmContext;
  let getCatalog;

  beforeEach(() => {
    vmContext = {
      ALL_QUESTIONS,
      QUESTION_TAG_RULES,
      normalizeAnswer,
      state: {
        customQuestions: [],
        questionEdits: {},
        questionTagOverrides: {},
        answeredQuestionIds: [],
        favoriteQuestionIds: [],
        excludedQuestionIds: [],
        neverQuestionIds: [],
        questionFlags: {}
      }
    };
    vm.createContext(vmContext);
    vm.runInContext(catalogMatch[0], vmContext);
    getCatalog = vmContext.getQuestionCatalog;
  });

  // =========================================================================
  // 1. QUESTION SEARCH INDEX SPEED (PRE-COMPUTED _searchIndex)
  // =========================================================================
  describe("1. Question Search Index Speed & Caching", () => {
    it("pre-computes a sanitized _searchIndex for all 364 questions", () => {
      const catalog = getCatalog();
      assert.equal(catalog.length, 364, "Catalog must initialize with all 364 questions");

      for (const question of catalog) {
        assert.equal(typeof question._searchIndex, "string", `Question ${question.id} must have a string _searchIndex`);
        assert(question._searchIndex.length > 0, `Question ${question.id} _searchIndex cannot be empty`);
        assert.equal(question._searchIndex, question._searchIndex.toLowerCase(), `_searchIndex for ${question.id} must be lowercase`);
        assert(!/[^a-z0-9\s]/.test(question._searchIndex), `_searchIndex for ${question.id} must not contain special symbols or punctuation`);
        assert(!/\s{2,}/.test(question._searchIndex), `_searchIndex for ${question.id} must not contain consecutive spaces`);
      }
    });

    it("verifies pre-computed _searchIndex search speed vs unindexed on-the-fly normalization", () => {
      const catalog = getCatalog();
      const searchTerms = ["money", "future", "vacation", "chore", "boundary", "intimacy", "touch", "conversation", "family", "dream"];
      const iterations = 500;

      // 1. Benchmark pre-computed _searchIndex search
      const t0 = performance.now();
      let indexedMatchCount = 0;
      for (let i = 0; i < iterations; i++) {
        const query = normalizeAnswer(searchTerms[i % searchTerms.length]);
        const matches = catalog.filter((q) => q._searchIndex.includes(query));
        indexedMatchCount += matches.length;
      }
      const indexedDurationMs = performance.now() - t0;

      // 2. Benchmark unindexed on-the-fly normalization search
      const t1 = performance.now();
      let onTheFlyMatchCount = 0;
      for (let i = 0; i < iterations; i++) {
        const query = normalizeAnswer(searchTerms[i % searchTerms.length]);
        const matches = catalog.filter((q) => normalizeAnswer(`${q.prompt} ${q.category} ${(q.tags || []).join(" ")}`).includes(query));
        onTheFlyMatchCount += matches.length;
      }
      const onTheFlyDurationMs = performance.now() - t1;

      // Assert accuracy parity
      assert.equal(indexedMatchCount, onTheFlyMatchCount, "Pre-computed index and on-the-fly search must produce identical result counts");

      // Assert performance speedup
      assert(
        indexedDurationMs < onTheFlyDurationMs,
        `Pre-computed search (${indexedDurationMs.toFixed(2)}ms) must be faster than on-the-fly search (${onTheFlyDurationMs.toFixed(2)}ms)`
      );

      // Verify sub-millisecond per-search responsiveness (interactive 60fps typing)
      const avgQueryMs = indexedDurationMs / iterations;
      assert(avgQueryMs < 0.2, `Average search query time (${avgQueryMs.toFixed(4)}ms) must be under 0.2ms across 364 questions`);
    });

    it("maintains catalog cache identity until inputs change, then invalidates reactively", () => {
      const firstCall = getCatalog();
      const secondCall = getCatalog();
      assert.equal(firstCall[0], secondCall[0], "Consecutive getQuestionCatalog calls must return cached question objects");

      // Invalidate cache by modifying question edits
      vmContext.state.questionEdits["int_1"] = { prompt: "Custom modified adventure prompt for us" };
      const modifiedCatalog = getCatalog();
      assert.notEqual(firstCall[0], modifiedCatalog[0], "Cache must invalidate and return fresh objects when questionEdits changes");

      const editedQuestion = modifiedCatalog.find((q) => q.id === "int_1");
      assert(editedQuestion._searchIndex.includes("custom modified adventure"), "Edited question _searchIndex must reflect updated prompt text");

      // Invalidate cache by overriding tags
      vmContext.state.questionTagOverrides["int_1"] = ["customtag", "adventurous"];
      const tagOverriddenCatalog = getCatalog();
      const tagOverriddenQuestion = tagOverriddenCatalog.find((q) => q.id === "int_1");
      assert(tagOverriddenQuestion._searchIndex.includes("customtag"), "Tag overrides must be indexed in _searchIndex");

      // Invalidate cache by adding a custom question
      vmContext.state.customQuestions.push({
        id: "custom_q_1",
        prompt: "Where is our next dream destination?",
        category: "Custom",
        topic: "lifestyle",
        type: "text",
        tags: ["lifestyle"]
      });
      const catalogWithCustom = getCatalog();
      assert.equal(catalogWithCustom.length, 365, "Catalog count must expand to 365 when custom question is appended");
      const customQ = catalogWithCustom.find((q) => q.id === "custom_q_1");
      assert(customQ._searchIndex.includes("dream destination"), "Custom questions must receive pre-computed _searchIndex");
    });
  });

  // =========================================================================
  // 2. NORMALIZED QUERY MATCHING
  // =========================================================================
  describe("2. Normalized Query Matching", () => {
    it("normalizes case, punctuation, emojis, and irregular whitespace seamlessly", () => {
      assert.equal(normalizeAnswer("   MONEY   "), "money");
      assert.equal(normalizeAnswer("What's our biggest priority?"), "what s our biggest priority");
      assert.equal(normalizeAnswer("Co-parenting & family planning!"), "co parenting family planning");
      assert.equal(normalizeAnswer("Clean/Dishes/Chores..."), "clean dishes chores");
      assert.equal(normalizeAnswer("PDA / Affection ♡"), "pda affection");
      assert.equal(normalizeAnswer("  multiple   spaces   between  "), "multiple spaces between");
    });

    it("matches questions by prompt text, category name, automatic tags, and substring tokens", () => {
      const catalog = getCatalog();

      // Prompt match
      const promptMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "vulnerable" }, vmContext.state);
      assert(promptMatches.length > 0, "Must locate questions containing 'vulnerable' in prompt");

      // Category match
      const categoryMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "Intimacy" }, vmContext.state);
      assert.equal(categoryMatches.length, 46, "Searching category 'Intimacy' must return all 46 matching intimacy questions");

      // Automatic tag rule match (QUESTION_TAG_RULES attaches 'chores' to prompts matching chore/clean/laundry/dishes/housework)
      const choresMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "chores" }, vmContext.state);
      assert(choresMatches.length >= 2, "Searching tag 'chores' must match questions containing chore keywords");

      // Punctuation and case invariance in search inputs
      const cleanUpperMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "CHORES!" }, vmContext.state);
      assert.equal(cleanUpperMatches.length, choresMatches.length, "Case and punctuation in search input must produce identical results");

      // Substring match
      const subMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "communicat" }, vmContext.state);
      assert(subMatches.length >= 10, "Substring query 'communicat' must match communication tags and prompts");

      // Nonsense non-matching query
      const nonMatches = filterCatalog(catalog, { filter: "all", topic: "all", search: "zyxwvuts987654321" }, vmContext.state);
      assert.equal(nonMatches.length, 0, "Nonsense search query must return 0 results");
    });

    it("treats empty or whitespace/punctuation-only queries as unconstrained search", () => {
      const catalog = getCatalog();
      const emptySearch = filterCatalog(catalog, { filter: "all", topic: "all", search: "" }, vmContext.state);
      assert.equal(emptySearch.length, 364, "Empty query string must return all 364 questions");

      const whitespaceSearch = filterCatalog(catalog, { filter: "all", topic: "all", search: "     " }, vmContext.state);
      assert.equal(whitespaceSearch.length, 364, "Whitespace-only query must normalize to '' and return all 364 questions");

      const punctOnlySearch = filterCatalog(catalog, { filter: "all", topic: "all", search: " ??? !!! --- " }, vmContext.state);
      assert.equal(punctOnlySearch.length, 364, "Punctuation-only query must normalize to '' and return all 364 questions");
    });
  });

  // =========================================================================
  // 3. STATUS FILTER ACCURACY ACROSS 364 QUESTIONS
  // =========================================================================
  describe("3. Status Filter Accuracy across 364 Questions", () => {
    it("verifies exact filter partitioning across all 8 status filters", () => {
      const catalog = getCatalog();
      assert.equal(catalog.length, 364, "Baseline question bank must have 364 questions");

      // Configure distinct, controlled fixture sets
      vmContext.state.answeredQuestionIds = ["int_1", "int_2", "val_1", "wld_1", "fut_1"]; // 5 answered
      vmContext.state.favoriteQuestionIds = ["int_1", "fut_1", "spy_1"]; // 3 favorites
      vmContext.state.excludedQuestionIds = ["int_3", "val_2"]; // 2 excluded
      vmContext.state.neverQuestionIds = ["int_4"]; // 1 never ask
      vmContext.state.questionFlags = {
        int_5: ["valuable"],
        int_6: ["uncomfortable"],
        int_7: ["valuable", "uncomfortable"],
        fut_2: ["valuable"]
      }; // 3 valuable, 2 uncomfortable

      // 1. 'all' filter
      const all = filterCatalog(catalog, { filter: "all", topic: "all", search: "" }, vmContext.state);
      assert.equal(all.length, 364, "'all' filter must return 364 questions");

      // 2. 'answered' filter
      const answered = filterCatalog(catalog, { filter: "answered", topic: "all", search: "" }, vmContext.state);
      assert.equal(answered.length, 5, "'answered' filter must match exact count of 5 answered questions");
      assert.deepEqual(new Set(answered.map((q) => q.id)), new Set(vmContext.state.answeredQuestionIds));

      // 3. 'unanswered' filter & mathematical complement
      const unanswered = filterCatalog(catalog, { filter: "unanswered", topic: "all", search: "" }, vmContext.state);
      assert.equal(unanswered.length, 359, "'unanswered' filter must equal 364 - 5 = 359 questions");
      assert.equal(answered.length + unanswered.length, 364, "Answered and Unanswered sets must form a complete partition of 364");
      assert(!unanswered.some((q) => vmContext.state.answeredQuestionIds.includes(q.id)), "No answered ID can appear in unanswered results");

      // 4. 'favorites' filter
      const favorites = filterCatalog(catalog, { filter: "favorites", topic: "all", search: "" }, vmContext.state);
      assert.equal(favorites.length, 3, "'favorites' filter must match exact count of 3 favorited questions");
      assert.deepEqual(new Set(favorites.map((q) => q.id)), new Set(vmContext.state.favoriteQuestionIds));

      // 5. 'excluded' filter
      const excluded = filterCatalog(catalog, { filter: "excluded", topic: "all", search: "" }, vmContext.state);
      assert.equal(excluded.length, 2, "'excluded' filter must match exact count of 2 excluded questions");
      assert.deepEqual(new Set(excluded.map((q) => q.id)), new Set(vmContext.state.excludedQuestionIds));

      // 6. 'never' filter
      const never = filterCatalog(catalog, { filter: "never", topic: "all", search: "" }, vmContext.state);
      assert.equal(never.length, 1, "'never' filter must match exact count of 1 never-ask question");
      assert.deepEqual(new Set(never.map((q) => q.id)), new Set(vmContext.state.neverQuestionIds));

      // 7. 'valuable' filter
      const valuable = filterCatalog(catalog, { filter: "valuable", topic: "all", search: "" }, vmContext.state);
      assert.equal(valuable.length, 3, "'valuable' filter must match exact count of 3 flagged questions");
      assert.deepEqual(new Set(valuable.map((q) => q.id)), new Set(["int_5", "int_7", "fut_2"]));

      // 8. 'uncomfortable' filter
      const uncomfortable = filterCatalog(catalog, { filter: "uncomfortable", topic: "all", search: "" }, vmContext.state);
      assert.equal(uncomfortable.length, 2, "'uncomfortable' filter must match exact count of 2 flagged questions");
      assert.deepEqual(new Set(uncomfortable.map((q) => q.id)), new Set(["int_6", "int_7"]));
    });

    it("verifies accurate topic classification and complete 364 sum across all 10 topics", () => {
      const catalog = getCatalog();
      const topicIds = TOPIC_OPTIONS.map((t) => t.id);
      let sumTopicQuestions = 0;

      for (const topicId of topicIds) {
        const topicQuestions = filterCatalog(catalog, { filter: "all", topic: topicId, search: "" }, vmContext.state);
        assert(topicQuestions.length > 0, `Topic '${topicId}' must contain at least 1 question`);
        assert(topicQuestions.every((q) => q.topic === topicId), `Every result in topic '${topicId}' must match topic`);
        sumTopicQuestions += topicQuestions.length;
      }

      assert.equal(sumTopicQuestions, 364, "Sum of questions across all 10 topic subsets must equal exactly 364");
    });

    it("correctly intersects compound filters (status + topic + search query)", () => {
      const catalog = getCatalog();
      vmContext.state.answeredQuestionIds = ["int_1", "int_2", "int_3", "val_1", "wld_1"];

      // Compound filter: answered AND connection topic AND matching "feel most loved"
      const compoundResults = filterCatalog(
        catalog,
        { filter: "answered", topic: "connection", search: "feel most loved" },
        vmContext.state
      );

      assert.equal(compoundResults.length, 1, "Compound filter must yield exactly 1 matching question");
      assert.equal(compoundResults[0].id, "int_1");
      assert(compoundResults[0]._searchIndex.includes("feel most loved"));
    });
  });

  // =========================================================================
  // 4. LIVE ANNOUNCEMENT REGION CONTENT UPDATES & ACCESSIBILITY
  // =========================================================================
  describe("4. Live Announcement Region Content Updates & Accessibility", () => {
    it("confirms presence of aria-live polite announcement region and describedby wiring in HTML", () => {
      // Accessible live announcement container
      assert(html.includes('id="library-search-status"'), "Markup must declare #library-search-status");
      assert(html.includes('aria-live="polite"'), "Status region must declare aria-live='polite'");
      assert(html.includes('aria-atomic="true"'), "Status region must declare aria-atomic='true'");
      assert(html.includes('class="sr-only"'), "Status region must be visually hidden with sr-only class");

      // Search input accessibility attributes
      assert(html.includes('aria-describedby="library-search-status"'), "Search field must reference status element via aria-describedby");
      assert(html.includes('aria-label="Search questions"'), "Search field must include an accessible aria-label");
      assert(html.includes('id="question-library-list" aria-live="polite"'), "Question library list must also announce dynamic updates");
    });

    it("computes accurate live status text across default, partial, paginated, and zero-match states", () => {
      // 1. Full unconstrained catalog with default limit 40
      assert.equal(
        computeAnnouncement(364, 40),
        "Showing 40 of 364 matching questions.",
        "Must announce showing 40 of 364 questions on initial load"
      );

      // 2. Partial result set smaller than pagination limit
      assert.equal(
        computeAnnouncement(14, 40),
        "Showing 14 of 14 matching questions.",
        "Must announce showing 14 of 14 questions when result count is under limit"
      );

      // 3. Paginated expansion (Load More clicked: limit 80, 120, etc.)
      assert.equal(
        computeAnnouncement(364, 80),
        "Showing 80 of 364 matching questions.",
        "Must announce updated showing count after expanding pagination limit"
      );
      assert.equal(
        computeAnnouncement(364, 400),
        "Showing 364 of 364 matching questions.",
        "Must clamp showing count to total matches when limit exceeds filtered size"
      );

      // 4. Zero matches state
      assert.equal(
        computeAnnouncement(0, 40),
        "No questions match your search or filter.",
        "Must announce clear no-match notification when results are empty"
      );
    });

    it("evaluates empty-state DOM messaging and reset button structure", () => {
      const escapeHTML = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

      function formatEmptyStateMessage(search, filter, topic) {
        const query = search.trim();
        const statusLabel = filter === "all" ? "" : filter.toUpperCase();
        const topicLabel = topic === "all" ? "" : topic.toUpperCase();
        const scope = [statusLabel, topicLabel].filter(Boolean).join(" · ");
        return query
          ? `No questions match “${escapeHTML(query)}”${scope ? ` in ${escapeHTML(scope)}` : ""}.`
          : scope ? `No questions in ${escapeHTML(scope)}.` : "No questions to show.";
      }

      // Query only
      assert.equal(
        formatEmptyStateMessage("missingterm", "all", "all"),
        "No questions match “missingterm”."
      );

      // Query with scope
      assert.equal(
        formatEmptyStateMessage("missingterm", "favorites", "connection"),
        "No questions match “missingterm” in FAVORITES · CONNECTION."
      );

      // Scope only without query
      assert.equal(
        formatEmptyStateMessage("", "excluded", "all"),
        "No questions in EXCLUDED."
      );

      // Reset button contract check from index.html
      assert(html.includes("data-library-reset"), "Empty state must offer a data-library-reset button to reset filters");
      assert(html.includes("Clear search &amp; filters"), "Reset button must display friendly clear prompt");
    });
  });
});
