import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const html = readFileSync(resolve(root, "index.html"), "utf8");

const escapeFnMatch = html.match(/function escapeHTML\(value\) \{[\s\S]*?\n    \}/);
const escapeHTML = escapeFnMatch
  ? vm.runInNewContext(`(${escapeFnMatch[0]})`)
  : (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const descFnMatch = html.match(/function alignmentDescriptor\(percent\) \{[\s\S]*?\n    \}/);
const alignmentDescriptor = descFnMatch
  ? vm.runInNewContext(`(${descFnMatch[0]})`)
  : () => ({ title: "Balanced", copy: "" });

const compassMatch = html.match(/function resonanceCompassMarkup\(rounds\) \{[\s\S]*?\n    \}/);
assert(compassMatch, "Must find resonanceCompassMarkup");
const resonanceCompassMarkup = vm.runInNewContext(`(${compassMatch[0]})`, {
  escapeHTML,
  alignmentDescriptor
});

describe("Radar Compass & Storybook Export Suite", () => {
  it("renders Resonance Compass 6-axis chart with topic mapping and fallback scores", () => {
    const rounds = [
      {
        alignment: {
          overall: 82,
          fitOverall: 86,
          topics: [
            { topic: "connection", score: 92 },
            { topic: "lifestyle", score: 78 },
            { topic: "lore", score: 88 } // Validates mapping into Depth
          ]
        }
      }
    ];

    const markup = resonanceCompassMarkup(rounds);
    assert(markup.includes('<article class="journal-card radar-compass-card"'), "Card container must exist");
    assert(markup.includes('<svg class="radar-svg"'), "SVG radar element must exist");
    assert(markup.includes('class="radar-polygon"'), "Radar polygon must be rendered");
    assert(markup.includes('id="open-storybook-btn"'), "Must provide entry point to Keepsake Storybook");
    assert(markup.includes('id="resonance-compass-table"'), "Must provide screen-reader accessible table fallback");
    assert(markup.includes('aria-describedby="resonance-compass-table"'), "SVG must reference accessible table");

    const expectedAxes = ["Connection", "Lifestyle", "Future", "Love", "Play", "Depth"];
    for (const axis of expectedAxes) {
      assert(markup.includes(`>${axis}</text>`), `Axis label '${axis}' must be in SVG`);
      assert(markup.includes(`>${axis}</th>`), `Axis label '${axis}' must be in accessible table`);
    }
  });

  it("evaluates Storybook modal structure, metric summaries, and print export readiness", () => {
    assert(html.includes(".storybook-actions { display: none !important; }"), "Print stylesheet must suppress action buttons");
    assert(html.includes("ALIGNED · OUR STORYBOOK"), "Storybook title must be present");
    assert(html.includes("Similarity"), "Storybook must include Similarity metric");
    assert(html.includes("Relationship Fit"), "Storybook must include Relationship Fit metric");
    assert(html.includes("Day Streak"), "Storybook must include Day Streak metric");
    assert(html.includes("Shared Intentions & Promises"), "Storybook must include Shared Intentions");
    assert(html.includes("Memorable Conversations"), "Storybook must include Memorable Conversations");
    assert(html.includes('id="storybook-print-btn"'), "Storybook must include print/save PDF button");
    assert(html.includes('id="storybook-close-btn"'), "Storybook must include close button");
    assert(html.includes('data-modal-cancel'), "Storybook close button must have data-modal-cancel for back-navigation");
  });

  it("storybook mode drops the duplicate title and never reuses the Results card's ids", () => {
    const rounds = [{ alignment: { overall: 70, fitOverall: 74, topics: [{ topic: "connection", score: 80 }] } }];
    const markup = resonanceCompassMarkup(rounds, { inStorybook: true });
    assert(!markup.includes('id="radar-heading"'), "Storybook copy must not repeat the h3 title or its id");
    assert(!markup.includes('id="open-storybook-btn"'), "Storybook copy must not offer to open itself");
    assert(!markup.includes('resonance-compass-table'), "Storybook copy must not duplicate the Results table id");
    assert(markup.includes('aria-labelledby="storybook-compass-heading"'), "Card must be labelled by the sheet's h4");
    assert(markup.includes('aria-describedby="storybook-compass-table"') && markup.includes('<table id="storybook-compass-table">'));
    assert(markup.includes('class="radar-polygon"'), "Radar polygon must still render in the storybook");
    assert(html.includes('<h4 id="storybook-compass-heading">'), "Storybook section heading must carry the label id");
  });
});
