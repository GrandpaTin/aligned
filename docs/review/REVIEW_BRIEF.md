# Aligned — recursive review brief

This file drives the multi-agent review loop. Each round, independent reviewer subagents read this brief,
test the running app, and score it; the fixes they find are applied; then the next round starts. The goal
is **every score ≥ 9.5** for both the **mobile phone** and **desktop** columns.

## The app

Aligned is a two-player compatibility conversation game: a zero-build, single-file PWA (`index.html`,
~15k lines of HTML/CSS/JS), plus:

- `sw.js` (offline cache), `manifest.webmanifest`
- `worker/src/index.js` — Cloudflare Worker for QR pairing (deployed as `are-we-compatible-signal`
  in the owner's Cloudflare account; `npm run deploy:signal` after `npx wrangler@4 login`)
- `android/` + `scripts/build-android.mjs` — offline Android WebView app (no Gradle)
- `scripts/build-offline.mjs` — single-file offline copy for computers
- `downloads/` — built `Aligned.apk` and `Aligned-offline.html` (rebuild with `npm run build`)
- `tests/production-check.mjs`, `tests/signaling-check.mjs` (`npm test`) and Playwright end-to-end
  scripts in `tests/e2e/`

Live site: <https://grandpatin.github.io/aligned/> (GitHub Pages from `main`).

## Running it for review

- `node scripts/serve.mjs --port 4174` → <http://127.0.0.1:4174/>. Port **4174** matters: the pairing
  service only accepts that local origin (plus the live site), so two-phone QR play works for real there.
- E2E harness: `npm i --no-save playwright-core`, then e.g. `node tests/e2e/mp2.mjs happy`.
  Set `CHANNEL=chrome` (or `msedge`, default) to use an installed browser, or `CHANNEL=bundled` after
  `npx playwright install chromium`. `ENGINE=webkit` (after `npx playwright install webkit`) approximates
  Safari/iPhone; WebKit on Windows has **no WebRTC** and runs animations at a few fps (use force clicks:
  `tests/e2e/harness-force.mjs`).
- `WORK=<path to an edited index.html>` serves that file in place of the app's page, so a working copy can
  be tested while reviewers use the live file.
- Useful scripts: `mp2.mjs <happy|reload-join|reload-host|reload-wait|drop-final|reveal|leave>`,
  `repair.mjs`, `third.mjs`, `vanish.mjs` (partner phone dies), `pp.mjs <m|d>` (pass-and-play round),
  `offline-file.mjs`, `android-sim.mjs`, `smalltext.mjs` (finds phone text < 12px).

## Reviewer roles (run in parallel, read-only)

1. **Mobile phone** (412×915, 360×740, touch) — mobile column.
2. **Desktop** (1366×768, 1920×1080, 1024×768, keyboard-only checks) — desktop column.
3. **Online multiplayer via QR** (two browser contexts against the live pairing service).
4. **Glitches, robustness & accessibility** (console errors, hostile storage/imports, XSS, focus, contrast).
5. **Cross-platform & offline** (iPhone/iPad via WebKit, Android shell/APK, installed PWA, file:// copy).
6. **Fun & engagement / game design** (plays as a new couple and a long-term couple).
7. **Sound design** (new — see below).

## Scoring

Score 0–10 (one decimal) for **mobile** and **desktop**:

- **Ease of use** — first-time couple from launch to finished reveal without confusion.
- **User friendliness** — clear, kind copy; good error/empty states; forgiving; accessible.
- **Usefulness** — real value: questions, reveal/insights, history, multiplayer, offline.
- **Polish** — visual precision, motion, no glitches, no console errors.
- **Fun & engagement** — anticipation and payoff, pacing, delight, conversation spark, replay value.
- **Sound design** — see the sound section below.

9.5+ = excellent production quality: you looked hard and found nothing a real user would trip over.

Rules for reviewers: report only defects you can point at (file:line and/or screenshot) and describe as a
concrete user experience; taste is not a finding; no padding. Don't modify the repo, don't deploy, don't
start/stop the server on 4174, keep your scripts/screenshots in a scratch folder, and retry a
timing-sensitive failure once before reporting it (the machine is shared by several reviewers).
Final message: scores table, findings ranked by impact (id, severity, surface, where, what the user
experiences, suggested fix), and the top 3 changes that would raise the lowest score.

## Sound design review (new dimension)

Headless browsers can't listen, so the sound reviewer analyses the synthesis code (`playSound`,
`pulseHaptic`, `ProceduralAmbient`, sound themes `cute|dreamy|arcade`, volume) and instruments the
Web Audio graph in a test page (wrap `AudioContext.prototype.createOscillator`/`createGain` etc. to log
every sound event with frequencies, envelopes, durations and gains). Judge: does every meaningful action
have fitting feedback (and nothing noisy/repetitive)? Are the reveal, match and celebration moments
satisfying? Do the three themes differ in character? Is ambient music pleasant, loopable, unobtrusive and
mixed under effects? Is there clipping, clicks/pops (no attack/release ramps), harsh frequencies, volume
jumps, or sounds firing before a user gesture? Do sound/music/volume controls, reduced motion and haptics
behave well? Recommend concrete synthesis changes (notes, envelopes, layering, panning, filters).

## Deliberate behaviour (not defects)

- Setup "Start" plays a ~0.6 s shuffle animation before the first question.
- Question Next ignores taps within 650 ms of the previous advance; clicks inside `#app` within 400 ms of a
  screen/question change are ignored; dialog buttons ignore clicks within 400 ms of the dialog opening.
- A silent partner phone is treated as disconnected after ~15 s (keepalive over the data channel); the
  waiting screen offers "Let X answer here" / "Pair again" after ~25 s more.
- In the file:// offline copy the Two-phones card is `aria-disabled` and explains why on tap.
- TURN relay is not configured yet (STUN only): phones on different restrictive networks may not link; the
  app says so and suggests the same Wi-Fi. Owner action: create a Cloudflare Realtime TURN key and run
  `npx wrangler@4 secret put TURN_KEY_ID --config worker/wrangler.jsonc` and the same for
  `TURN_KEY_API_TOKEN`.

## Score history

| Reviewer | R1 | R2 | R3 | R4 | R5 (partial) |
| --- | --- | --- | --- | --- | --- |
| Mobile | 7.0–8.2 | 8.4–9.2 | 8.6–9.3 | 8.6–9.3 | — |
| Desktop | 7.5–8.8 | 7.9–9.2 | 8.0–9.1 | 8.5–9.3 | — |
| Multiplayer/QR | 5.0–7.0 | 7.6–8.8 | 8.3–9.0 | 8.5–9.2 | — |
| QA/accessibility | 6.6–8.6 | 8.0–8.9 | 8.5–9.2 | 8.6–9.3 | — |
| Cross-platform/offline | — | 8.0–9.2 | 8.7–9.5 | 9.3–9.5 | — |
| Fun & engagement | — | — | — | — | 6.9 mobile / 7.0 desktop |
| Sound design | — | — | — | — | not yet reviewed |

Round 4 is on `main` (tested, deployed). Round 5's game-design changes are on branch
**`wip/round5-game-feel`** and are **not yet tested** — they address the Fun findings:

1. Scores hidden until every card is flipped, then count up with confetti; "0 of N revealed" dots.
2. Guess-your-partner on sliders (`state.guesses`) with a Mind-reader tally; two-card quick picks.
3. Importance / not-ready / private note folded into one "More options" menu.
4. Rounds ordered light → deep → light; Cozy excludes heavy and long-history prompts; Mixed by default.
5. Written answers are rated together instead of auto-scored by shared words.
6. Slim card backs with "Save for later" and "Next card →"; highlights show both answers and jump to cards;
   per-pack rings only for packs with ≥2 questions.
7. Partner flips announced with a toast and sound; vibe tiles on setup; 15 playful Spicy prompts;
   Spicy Night draws ≥ half from its pack; "Round N tonight" toast.

Remaining Fun ideas not yet built: take-turns flipping in two-phone mode; a "while you wait" guessing
activity on the waiting screen; a round-2 interstitial with library progress.
