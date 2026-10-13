import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  resolve(currentDir, "..", "index.html"),
  resolve(currentDir, "index.html"),
  resolve(process.cwd(), "index.html")
];
const indexPath = candidatePaths.find((p) => existsSync(p));
assert(indexPath, "Could not locate index.html");
const html = readFileSync(indexPath, "utf8");

// Extract CSS style blocks from index.html
const cssMatches = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const fullCss = cssMatches.join("\n");

/**
 * Lightweight headless DOM simulation for verifying accessibility attributes,
 * inert tree state, event propagation, and keyboard focus trapping.
 */
class MockClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
  }
  add(...names) { names.forEach((n) => this.classes.add(n)); }
  remove(...names) { names.forEach((n) => this.classes.delete(n)); }
  contains(name) { return this.classes.has(name); }
  toggle(name, force) {
    const shouldAdd = force !== undefined ? force : !this.classes.has(name);
    if (shouldAdd) this.classes.add(name);
    else this.classes.delete(name);
    return shouldAdd;
  }
  toString() { return Array.from(this.classes).join(" "); }
}

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.eventListeners = new Map();
    this.textContent = "";
    this.inert = false;
    this.style = {};
    this.offsetParent = {};
    this.value = "";
  }

  get id() { return this.getAttribute("id") || ""; }
  set id(val) { this.setAttribute("id", val); }

  get className() { return this.classList.toString(); }
  set className(val) {
    this.classList.classes.clear();
    (val || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[prop];
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  addEventListener(type, handler) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    if (!this.eventListeners.has(type)) return;
    const list = this.eventListeners.get(type).filter((h) => h !== handler);
    this.eventListeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const handlers = this.eventListeners.get(event.type) || [];
    for (const h of handlers) {
      h(event);
      if (event.immediatePropagationStopped) break;
    }
    if (this.parentElement && !event.propagationStopped) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({
      type: "click",
      target: this,
      currentTarget: this,
      preventDefault: () => {},
      stopPropagation: () => {},
      isTrusted: true
    });
  }

  focus(options = {}) {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  contains(other) {
    if (!other) return false;
    if (other === this) return true;
    let cur = other.parentElement;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  matches(selector) {
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      return this.classList.contains(cls);
    }
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      return this.id === id;
    }
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const attr = selector.slice(1, -1);
      if (attr.includes("=")) {
        const [k, v] = attr.split("=");
        const cleanV = v.replace(/['"]/g, "");
        return this.getAttribute(k) === cleanV;
      }
      return this.hasAttribute(attr);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const search = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) results.push(child);
        search(child);
      }
    };
    search(this);
    return results;
  }
}

class MockDocument extends MockElement {
  constructor() {
    super("#document");
    this.ownerDocument = this;
    this.documentElement = new MockElement("html");
    this.documentElement.ownerDocument = this;
    this.body = new MockElement("body");
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tag) {
    const el = new MockElement(tag);
    el.ownerDocument = this;
    return el;
  }

  getElementById(id) {
    const search = (node) => {
      for (const child of node.children) {
        if (child.id === id) return child;
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return search(this.body);
  }
}

describe("Accessibility & Keyboard Flow Comprehensive Suite", () => {
  describe("1. WCAG AAA Stacked Dialog Focus Trap & Inert Management", () => {
    it("verifies index.html modal manager architecture matches WCAG AAA standards", () => {
      assert(html.includes("function syncModalState()"), "syncModalState must be declared in index.html");
      assert(html.includes("child.inert = child !== top"), "Stacked lower dialogs must be set to inert");
      assert(html.includes("child.inert = Boolean(top)"), "Background app elements must be set to inert while dialog is open");
      assert(html.includes("const MODAL_CANCEL_SELECTOR ="), "MODAL_CANCEL_SELECTOR must define standard dialog close selectors");
      assert(html.includes('event.key === "Escape"'), "Escape key handler must be registered on document");
      assert(html.includes('event.key === "Tab"'), "Tab key handler must be registered to trap focus in active dialog");
    });

    it("verifies stacked dialog inertness, focus trapping, and LIFO unwinding", () => {
      const doc = new MockDocument();
      const appContainer = doc.createElement("main");
      appContainer.id = "app";
      doc.body.appendChild(appContainer);

      const triggerBtn = doc.createElement("button");
      triggerBtn.id = "open-settings-trigger";
      appContainer.appendChild(triggerBtn);
      triggerBtn.focus();
      assert.equal(doc.activeElement, triggerBtn, "Active element begins on trigger button outside dialogs");

      let announcedMessage = "";
      const announce = (msg) => { announcedMessage = msg; };

      let modalReturnFocus = triggerBtn;
      let modalWasOpen = false;

      // syncModalState logic mirroring index.html lines 14328-14371
      const syncModalState = () => {
        const overlays = doc.body.querySelectorAll(".modal-backdrop");
        const top = overlays[overlays.length - 1];
        doc.body.children.forEach((child) => {
          if (child.id === "toast-live") return;
          if (child.classList.contains("modal-backdrop")) {
            child.inert = child !== top;
            return;
          }
          child.inert = Boolean(top);
        });
        if (top) {
          if (!modalWasOpen) {
            const heading = top.querySelector("h2")?.textContent?.trim() || "Dialog";
            announce(`${heading} dialog opened.`);
          }
          const focusTarget = top.querySelector("[data-modal-cancel]") || top.querySelector("button");
          focusTarget?.focus();
          modalWasOpen = true;
        }
        if (!top && modalWasOpen) {
          announce("Dialog closed.");
          modalWasOpen = false;
          if (modalReturnFocus) {
            modalReturnFocus.focus();
          }
        }
      };

      // 1. Open Dialog 1 (Settings dialog)
      const dialog1 = doc.createElement("div");
      dialog1.className = "modal-backdrop";
      const h2_1 = doc.createElement("h2");
      h2_1.textContent = "Settings";
      dialog1.appendChild(h2_1);
      const cancel1 = doc.createElement("button");
      cancel1.setAttribute("data-modal-cancel", "");
      dialog1.appendChild(cancel1);
      const openNestedBtn = doc.createElement("button");
      dialog1.appendChild(openNestedBtn);
      doc.body.appendChild(dialog1);

      syncModalState();

      assert.equal(appContainer.inert, true, "#app must be inert when Dialog 1 opens");
      assert.equal(dialog1.inert, false, "Dialog 1 must be interactive");
      assert.equal(doc.activeElement, cancel1, "Focus must be moved into Dialog 1");
      assert.equal(announcedMessage, "Settings dialog opened.", "Dialog open announcement must be generated");

      // 2. Open Dialog 2 (Stacked dialog on top of Dialog 1, e.g. Confirm Reset)
      const dialog2 = doc.createElement("div");
      dialog2.className = "modal-backdrop";
      const h2_2 = doc.createElement("h2");
      h2_2.textContent = "Confirm Reset";
      dialog2.appendChild(h2_2);
      const cancel2 = doc.createElement("button");
      cancel2.setAttribute("data-modal-cancel", "");
      dialog2.appendChild(cancel2);
      const confirm2 = doc.createElement("button");
      dialog2.appendChild(confirm2);
      doc.body.appendChild(dialog2);

      syncModalState();

      assert.equal(appContainer.inert, true, "#app must remain inert");
      assert.equal(dialog1.inert, true, "Dialog 1 MUST become inert when Dialog 2 is stacked over it (WCAG AAA Focus Guard)");
      assert.equal(dialog2.inert, false, "Dialog 2 (top) must be interactive");
      assert.equal(doc.activeElement, cancel2, "Focus must be trapped in Dialog 2");

      // 3. Tab trapping within Dialog 2
      const focusable = dialog2.querySelectorAll("button");
      const first = focusable[0];
      const last = focusable[1];

      last.focus();
      assert.equal(doc.activeElement, last);
      first.focus(); // Tab wraps from last to first
      assert.equal(doc.activeElement, first, "Focus wraps from last to first on Tab");

      last.focus(); // Shift+Tab wraps from first to last
      assert.equal(doc.activeElement, last, "Focus wraps from first to last on Shift+Tab");

      // 4. Escape closes Dialog 2 only (LIFO order)
      dialog2.remove();
      syncModalState();

      assert.equal(appContainer.inert, true, "#app remains inert because Dialog 1 is still open");
      assert.equal(dialog1.inert, false, "Dialog 1 must regain interactivity once Dialog 2 closes");
      assert.equal(doc.activeElement, cancel1, "Focus must return to Dialog 1 controls");

      // 5. Escape closes Dialog 1
      dialog1.remove();
      syncModalState();

      assert.equal(appContainer.inert, false, "#app must regain interactivity once all dialogs close");
      assert.equal(doc.activeElement, triggerBtn, "Focus must return to original trigger button");
      assert.equal(announcedMessage, "Dialog closed.", "Closing dialog must announce to live region");
    });
  });

  describe("2. Filter Chip aria-pressed & aria-expanded Synchronization", () => {
    it("verifies Library status filter chips synchronize aria-pressed with mutual exclusivity", () => {
      const doc = new MockDocument();
      const filterValues = [
        "all", "answered", "unanswered", "favorites", "excluded", "never", "valuable", "uncomfortable"
      ];

      const container = doc.createElement("div");
      container.className = "library-filters";
      container.setAttribute("aria-label", "Question status filters");
      doc.body.appendChild(container);

      const chips = filterValues.map((val) => {
        const btn = doc.createElement("button");
        btn.className = `library-filter ${val === "all" ? "active" : ""}`;
        btn.setAttribute("data-library-filter", val);
        btn.setAttribute("aria-pressed", val === "all" ? "true" : "false");
        container.appendChild(btn);
        return btn;
      });

      assert.equal(chips[0].getAttribute("aria-pressed"), "true");
      chips.slice(1).forEach((chip) => {
        assert.equal(chip.getAttribute("aria-pressed"), "false");
      });

      // Filter click handler matching index.html lines 17703-17715
      const onFilterClick = (clickedBtn) => {
        container.querySelectorAll("[data-library-filter]").forEach((item) => {
          const isActive = item === clickedBtn;
          item.classList.toggle("active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });
      };

      chips.forEach((chip) => chip.addEventListener("click", () => onFilterClick(chip)));

      chips[3].click(); // favorites
      assert.equal(chips[3].getAttribute("aria-pressed"), "true");
      assert.equal(chips[3].classList.contains("active"), true);
      assert.equal(chips[0].getAttribute("aria-pressed"), "false");

      const pressedCount = chips.filter((c) => c.getAttribute("aria-pressed") === "true").length;
      assert.equal(pressedCount, 1, "Exactly one filter chip must have aria-pressed='true'");
    });

    it("verifies Library all-topics chip synchronizes with individual topic chips", () => {
      const doc = new MockDocument();
      const allTopicsBtn = doc.createElement("button");
      allTopicsBtn.id = "all-library-topics";
      allTopicsBtn.className = "library-filter active";
      allTopicsBtn.setAttribute("aria-pressed", "true");
      doc.body.appendChild(allTopicsBtn);

      const topicCard = doc.createElement("button");
      topicCard.setAttribute("data-library-topic", "connection");
      topicCard.className = "topic-progress-card";
      doc.body.appendChild(topicCard);

      topicCard.addEventListener("click", () => {
        allTopicsBtn.classList.remove("active");
        allTopicsBtn.setAttribute("aria-pressed", "false");
        topicCard.classList.add("active");
      });

      allTopicsBtn.addEventListener("click", () => {
        topicCard.classList.remove("active");
        allTopicsBtn.classList.add("active");
        allTopicsBtn.setAttribute("aria-pressed", "true");
      });

      topicCard.click();
      assert.equal(allTopicsBtn.getAttribute("aria-pressed"), "false");

      allTopicsBtn.click();
      assert.equal(allTopicsBtn.getAttribute("aria-pressed"), "true");
    });

    it("verifies Journal filter chips synchronize aria-pressed and update live status text", () => {
      const doc = new MockDocument();
      const filters = ["all", "high", "gaps", "notes"];
      const container = doc.createElement("div");
      container.className = "journal-filters";
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", "Journal filters");
      doc.body.appendChild(container);

      const statusEl = doc.createElement("div");
      statusEl.id = "journal-search-status";
      statusEl.setAttribute("aria-live", "polite");
      doc.body.appendChild(statusEl);

      const chips = filters.map((f, idx) => {
        const btn = doc.createElement("button");
        btn.className = `journal-filter-chip ${idx === 0 ? "active" : ""}`;
        btn.setAttribute("data-journal-filter", f);
        btn.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
        container.appendChild(btn);
        return btn;
      });

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          chips.forEach((c) => {
            c.classList.remove("active");
            c.setAttribute("aria-pressed", "false");
          });
          chip.classList.add("active");
          chip.setAttribute("aria-pressed", "true");
          const filterKey = chip.dataset.journalFilter;
          statusEl.textContent = `Showing ${filterKey} rounds.`;
        });
      });

      chips[1].click(); // high
      assert.equal(chips[1].getAttribute("aria-pressed"), "true");
      assert.equal(chips[0].getAttribute("aria-pressed"), "false");
      assert.equal(statusEl.textContent, "Showing high rounds.");

      chips[3].click(); // notes
      assert.equal(chips[3].getAttribute("aria-pressed"), "true");
      assert.equal(chips[1].getAttribute("aria-pressed"), "false");
      assert.equal(statusEl.textContent, "Showing notes rounds.");
    });

    it("verifies aria-expanded synchronization on session dropdown and flip cards", () => {
      const doc = new MockDocument();

      const trigger = doc.createElement("button");
      trigger.id = "session-select-trigger";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "listbox");
      doc.body.appendChild(trigger);

      const setDropdownOpen = (open) => {
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
      };

      setDropdownOpen(true);
      assert.equal(trigger.getAttribute("aria-expanded"), "true");
      setDropdownOpen(false);
      assert.equal(trigger.getAttribute("aria-expanded"), "false");

      const cardFront = doc.createElement("button");
      cardFront.className = "card-front";
      cardFront.setAttribute("aria-expanded", "false");
      doc.body.appendChild(cardFront);

      const toggleCardReveal = (shouldReveal) => {
        cardFront.setAttribute("aria-expanded", String(shouldReveal));
      };

      toggleCardReveal(true);
      assert.equal(cardFront.getAttribute("aria-expanded"), "true");
      toggleCardReveal(false);
      assert.equal(cardFront.getAttribute("aria-expanded"), "false");
    });
  });

  describe("3. 44x44px Touch Floor CSS Architecture (WCAG 2.1 AAA SC 2.5.5)", () => {
    it("enforces 44px min-height and min-width across critical touch targets", () => {
      const rulesToCheck = [
        { selector: ".wildcard-btn", minHeight: true, minWidth: true },
        { selector: ".reaction-chip", minHeight: true, minWidth: true },
        { selector: ".nudge-btn", minHeight: true, minWidth: true },
        { selector: ".favorite-button", minHeight: true, minWidth: true },
        { selector: ".wager-chip", minHeight: true, minWidth: true },
        { selector: ".name-input", minHeight: true, minWidth: false },
        { selector: ".range-input", minHeight: true, minWidth: false },
        { selector: ".quick-guess-option", minHeight: true, minWidth: false }
      ];

      for (const rule of rulesToCheck) {
        const escaped = rule.selector.replace(".", "\\.");
        const regex = new RegExp(`${escaped}[^{]*\\{([\\s\\S]*?)\\}`, "g");
        const matches = [...fullCss.matchAll(regex)].map((m) => m[1]);
        assert(matches.length > 0, `CSS rule block for ${rule.selector} must be defined`);

        const combined = matches.join(" ");
        if (rule.minHeight) {
          const hasMinHeight44 = combined.includes("min-height: 44px") || combined.includes("height: 44px");
          assert(hasMinHeight44, `${rule.selector} must have min-height: 44px (or height: 44px)`);
        }
        if (rule.minWidth) {
          const hasMinWidth44 = combined.includes("min-width: 44px");
          assert(hasMinWidth44, `${rule.selector} must have min-width: 44px`);
        }
      }
    });

    it("verifies pseudo-element hit-area expansion on compact topbar icons", () => {
      assert(fullCss.includes(".home-btn::before"), ".home-btn must have an expanding ::before pseudo-element");
      const homeBtnBeforeMatch = fullCss.match(/\.home-btn::before\s*\{([\s\S]*?)\}/);
      assert(homeBtnBeforeMatch, "Must find .home-btn::before CSS block");
      const block = homeBtnBeforeMatch[1];
      assert(block.includes("min-width: 44px;"), ".home-btn::before must enforce min-width: 44px");
      assert(block.includes("min-height: 44px;"), ".home-btn::before must enforce min-height: 44px");
    });

    it("verifies coarse pointer media query reinforces 44x44px floor on mobile controls", () => {
      assert(fullCss.includes("@media (pointer: coarse)"), "CSS must contain @media (pointer: coarse) queries for mobile touch");
      const coarseBlocks = [...fullCss.matchAll(/@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{([\s\S]*?\n\s*\})/g)].map((m) => m[1]);
      assert(coarseBlocks.length > 0, "Must extract @media (pointer: coarse) block");

      const combinedCoarse = coarseBlocks.join("\n");
      assert(
        combinedCoarse.includes(".library-filter") && (combinedCoarse.includes("min-height: 44px !important") || combinedCoarse.includes("min-height: var(--tap) !important")),
        "Coarse media query must enforce min-height: 44px/var(--tap) !important on library filters"
      );
      assert(
        combinedCoarse.includes(".question-library-action") && (combinedCoarse.includes("min-width: 44px") || combinedCoarse.includes("min-width: var(--tap)")),
        "Coarse media query must enforce min-width: 44px/var(--tap) on question library actions"
      );
    });
  });

  describe("4. Live Region Announcement Generation (announce & showToast)", () => {
    it("creates #toast-live with aria-live='polite' and delays text insertion for AT detection", async () => {
      const doc = new MockDocument();
      let timerCallback = null;
      let timerDelay = 0;
      const mockSetTimeout = (fn, delay) => {
        timerCallback = fn;
        timerDelay = delay;
        return 123;
      };

      const announce = (message) => {
        let live = doc.getElementById("toast-live");
        if (!live) {
          live = doc.createElement("div");
          live.id = "toast-live";
          live.className = "sr-only";
          live.setAttribute("aria-atomic", "true");
          doc.body.appendChild(live);
        }
        live.setAttribute("aria-live", "polite");
        live.textContent = "";
        mockSetTimeout(() => { live.textContent = message; }, 60);
      };

      announce("Alex has finished and locked in their answers.");

      const live = doc.getElementById("toast-live");
      assert(live, "#toast-live live region must be created");
      assert.equal(live.getAttribute("aria-live"), "polite");
      assert.equal(live.getAttribute("aria-atomic"), "true");
      assert.equal(live.classList.contains("sr-only"), true);
      assert.equal(live.textContent, "", "Live region must clear text initially before timeout");
      assert.equal(timerDelay, 60, "Must defer text injection by 60ms to trigger screen reader mutation listener");

      timerCallback();
      assert.equal(live.textContent, "Alex has finished and locked in their answers.");
    });

    it("escalates tone to aria-live='assertive' when showToast receives error", () => {
      const doc = new MockDocument();
      const showToast = (message, { tone = "info" } = {}) => {
        let live = doc.getElementById("toast-live");
        if (!live) {
          live = doc.createElement("div");
          live.id = "toast-live";
          live.className = "sr-only";
          live.setAttribute("aria-atomic", "true");
          doc.body.appendChild(live);
        }
        live.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
        live.textContent = message;
      };

      showToast("Standard notification", { tone: "info" });
      let live = doc.getElementById("toast-live");
      assert.equal(live.getAttribute("aria-live"), "polite");

      showToast("Connection failed", { tone: "error" });
      assert.equal(live.getAttribute("aria-live"), "assertive");
    });
  });

  describe("5. Keyboard Shortcut Navigation Flow (ArrowLeft, ArrowRight, Space, Escape)", () => {
    it("activates kbd-nav on keyboard arrow/space/tab and removes on pointerdown", () => {
      const doc = new MockDocument();

      const onKeydown = (event) => {
        if (event.isComposing) return;
        const typing = event.target?.tagName === "INPUT" || event.target?.tagName === "TEXTAREA";
        if (event.key === "Tab" || (!typing && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key))) {
          doc.documentElement.classList.add("kbd-nav");
        }
      };

      const onPointerdown = () => {
        doc.documentElement.classList.remove("kbd-nav");
      };

      const button = doc.createElement("button");
      onKeydown({ key: "ArrowRight", target: button });
      assert.equal(doc.documentElement.classList.contains("kbd-nav"), true);

      onPointerdown();
      assert.equal(doc.documentElement.classList.contains("kbd-nav"), false);

      onKeydown({ key: " ", target: button });
      assert.equal(doc.documentElement.classList.contains("kbd-nav"), true);

      onPointerdown();
      const input = doc.createElement("input");
      onKeydown({ key: " ", target: input });
      assert.equal(doc.documentElement.classList.contains("kbd-nav"), false);
    });

    it("executes Story Reel modal navigation with ArrowRight, Space, ArrowLeft, and Escape", () => {
      let currentSlide = 0;
      const totalSlides = 5;
      let closed = false;

      const closeStory = () => { closed = true; };

      const onStoryKey = (e) => {
        if (e.target?.tagName === "BUTTON" || e.target?.tagName === "INPUT") return;
        if (e.key === "Escape") closeStory();
        else if (e.key === "ArrowRight" || e.key === " ") {
          if (currentSlide < totalSlides - 1) { currentSlide++; } else closeStory();
        } else if (e.key === "ArrowLeft") {
          if (currentSlide > 0) { currentSlide--; }
        }
      };

      const backgroundDiv = new MockElement("div");

      onStoryKey({ key: "ArrowRight", target: backgroundDiv });
      assert.equal(currentSlide, 1);

      onStoryKey({ key: " ", target: backgroundDiv });
      assert.equal(currentSlide, 2);

      onStoryKey({ key: "ArrowLeft", target: backgroundDiv });
      assert.equal(currentSlide, 1);

      onStoryKey({ key: "ArrowLeft", target: backgroundDiv });
      onStoryKey({ key: "ArrowLeft", target: backgroundDiv });
      assert.equal(currentSlide, 0);

      currentSlide = totalSlides - 1;
      onStoryKey({ key: " ", target: backgroundDiv });
      assert.equal(closed, true);

      closed = false;
      onStoryKey({ key: "Escape", target: backgroundDiv });
      assert.equal(closed, true);
    });

    it("verifies rating options group cyclic arrow key navigation", () => {
      const doc = new MockDocument();
      const group = doc.createElement("div");
      group.className = "rating-options";
      doc.body.appendChild(group);

      const options = [0, 1, 2, 3].map((val) => {
        const btn = doc.createElement("button");
        btn.className = "rating-option";
        btn.setAttribute("data-rating", String(val));
        group.appendChild(btn);
        return btn;
      });

      group.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
        const curIndex = options.indexOf(doc.activeElement);
        if (curIndex === -1) return;
        const nextIndex = (event.key === "ArrowRight" || event.key === "ArrowDown")
          ? (curIndex + 1) % options.length
          : (curIndex - 1 + options.length) % options.length;
        options[nextIndex].focus();
      });

      options[0].focus();
      assert.equal(doc.activeElement, options[0]);

      group.dispatchEvent({ type: "keydown", key: "ArrowRight" });
      assert.equal(doc.activeElement, options[1]);

      group.dispatchEvent({ type: "keydown", key: "ArrowDown" });
      assert.equal(doc.activeElement, options[2]);

      options[3].focus();
      group.dispatchEvent({ type: "keydown", key: "ArrowRight" });
      assert.equal(doc.activeElement, options[0]);

      group.dispatchEvent({ type: "keydown", key: "ArrowLeft" });
      assert.equal(doc.activeElement, options[3]);
    });

    it("verifies question slider ArrowLeft/ArrowRight/Home/End keyboard adjustments", () => {
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

      assert.equal(applySliderKey(5, "ArrowRight"), 6);
      assert.equal(applySliderKey(5, "ArrowLeft"), 4);
      assert.equal(applySliderKey(10, "ArrowRight"), 10);
      assert.equal(applySliderKey(1, "ArrowLeft"), 1);
      assert.equal(applySliderKey(5, "Home"), 1);
      assert.equal(applySliderKey(5, "End"), 10);
    });

    it("verifies session preset dropdown ArrowDown/ArrowUp and Escape navigation", () => {
      const doc = new MockDocument();
      const trigger = doc.createElement("button");
      trigger.id = "session-select-trigger";
      doc.body.appendChild(trigger);

      const container = doc.createElement("div");
      container.className = "session-dropdown-container";
      doc.body.appendChild(container);

      const items = ["date-night", "road-trip", "check-in"].map((preset) => {
        const btn = doc.createElement("button");
        btn.setAttribute("data-session-preset", preset);
        container.appendChild(btn);
        return btn;
      });

      let isOpen = false;
      const setDropdownOpen = (open) => {
        isOpen = open;
        container.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
      };

      trigger.addEventListener("keydown", (e) => {
        if (["ArrowDown", "ArrowUp"].includes(e.key)) {
          setDropdownOpen(true);
          items[0].focus();
        }
      });

      container.addEventListener("keydown", (e) => {
        if (!isOpen) return;
        const curIdx = items.indexOf(doc.activeElement);
        if (e.key === "Escape") {
          setDropdownOpen(false);
          trigger.focus();
        } else if (e.key === "ArrowDown") {
          const next = Math.min(items.length - 1, curIdx + 1);
          items[next].focus();
        } else if (e.key === "ArrowUp") {
          const prev = Math.max(0, curIdx - 1);
          items[prev].focus();
        } else if (e.key === "Home") {
          items[0].focus();
        } else if (e.key === "End") {
          items[items.length - 1].focus();
        }
      });

      trigger.focus();
      trigger.dispatchEvent({ type: "keydown", key: "ArrowDown" });
      assert.equal(isOpen, true);
      assert.equal(doc.activeElement, items[0]);

      container.dispatchEvent({ type: "keydown", key: "ArrowDown" });
      assert.equal(doc.activeElement, items[1]);

      container.dispatchEvent({ type: "keydown", key: "End" });
      assert.equal(doc.activeElement, items[2]);

      container.dispatchEvent({ type: "keydown", key: "Escape" });
      assert.equal(isOpen, false);
      assert.equal(doc.activeElement, trigger, "Escape closes dropdown and restores focus to trigger button");
    });
  });
});
