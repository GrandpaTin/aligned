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
- Scores unlock once every card has been face up **and** every written answer has been rated together; the
  progress line shows "· N to rate". Reveal progress is one-way: closing a card or "Hide all" never re-locks
  the scores. The count-up starts when the dashboard is on screen (both phones get it).
- Leaving a reveal board whose scores haven't unlocked (Start your round, Play another round, Switch vibe or
  players) asks "Your scores haven't been revealed yet" first; Home mid-reveal offers "Back to your reveal board".
- A quick pick needs a side (or the "Somewhere in between?" slider) before Next; there is no silent 5.
- Browser/PWA Back closes a dialog, then returns Home, then leaves (mirrors the Android shell).
- Effects and music share one AudioContext: effects → compressor → master → limiter, music on its own bus
  ducked under each effect; the first sound after the context starts is delayed ~80 ms while it warms up.
- TURN relay is not configured yet (STUN only): phones on different restrictive networks may not link; the
  app says so and suggests the same Wi-Fi. Owner action: create a Cloudflare Realtime TURN key and run
  `npx wrangler@4 secret put TURN_KEY_ID --config worker/wrangler.jsonc` and the same for
  `TURN_KEY_API_TOKEN`.

## Score history

| Reviewer | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 | R13 | R14 | R15 | R16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | 7.0–8.2 | 8.4–9.2 | 8.6–9.3 | 8.6–9.3 | 8.3–9.2 | 8.7–9.3 | 8.4–9.3 | 8.5–9.3 | 8.8–9.3 | 9.0–9.3 | 9.2–9.4 | 9.3–9.4 | 9.3–9.4 | 9.3–9.5 | 9.3–9.5 | 9.4–9.5 |
| Desktop | 7.5–8.8 | 7.9–9.2 | 8.0–9.1 | 8.5–9.3 | 7.8–9.0 | 8.4–9.1 | 8.3–9.2 | 8.6–9.3 | 8.8–9.3 | 8.8–9.3 | 9.1–9.3 | 9.1–9.4 | 9.1–9.4 | 9.1–9.4 | 9.3–9.5 | 9.3–9.5 |
| Multiplayer/QR | 5.0–7.0 | 7.6–8.8 | 8.3–9.0 | 8.5–9.2 | 8.3–9.0 | 8.7–9.2 | 8.8–9.2 | 8.9–9.3 | 9.0–9.3 | 8.8–9.3 | 9.1–9.3 | 9.0–9.3 | 9.2–9.4 | 9.3–9.4 | 9.3–9.5 | 9.3–9.5 |
| QA/accessibility | 6.6–8.6 | 8.0–8.9 | 8.5–9.2 | 8.6–9.3 | 8.6–9.3 | 8.7–9.2 | 8.0–9.2 | 8.6–9.2 | 8.9–9.3 | — (API outage) | 9.2–9.3 | 9.1–9.4 | 9.1–9.4 | 9.2–9.4 | 9.3–9.5 | 9.2–9.5 |
| Cross-platform/offline | — | 8.0–9.2 | 8.7–9.5 | 9.3–9.5 | 8.6–9.3 | 9.2–9.5 | 8.5–9.5 | 8.9–9.5 | 9.0–9.5 | 9.2–9.5 | 9.2–9.5 | 9.2–9.5 | 9.2–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 |
| Fun & engagement | — | — | — | — | 7.6–9.1 (fun 7.6) | 8.6–9.1 (fun 8.6) | 8.9–9.3 (fun 8.9) | 8.7–9.3 (fun 9.1) | 8.8–9.3 (fun 9.1) | 9.0–9.3 (fun 9.1/9.2) | 9.2–9.3 (fun 9.3) | 9.2–9.4 (fun 9.2/9.3) | 9.1–9.4 (fun 9.1/9.2) | 9.2–9.4 (fun 9.2/9.3) | 9.1–9.5 (fun 9.1/9.1) | 9.2–9.5 (fun 9.2/9.2) |
| Sound design | — | — | — | — | 5.8 mobile / 6.0 desktop | 7.4 mobile / 7.8 desktop | 8.3 mobile / 8.6 desktop | 8.7 mobile / 8.9 desktop | 9.0 mobile / 9.2 desktop | 9.2 mobile / 9.3 desktop | 9.3 mobile / 9.4 desktop | 9.4 mobile / 9.5 desktop | 9.3 mobile / 9.4 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop |

R5 reviewed round 5's game-feel branch (commit 0ec3741). Its fixes ship as **1.2.0**: a rebuilt audio engine
(mix bus, compressor + limiter, ducked generative F-major ambient that suspends in the background, in-key
FM-bell / pulse-glide themes, count-up ticks that land on a layered celebrate, delete/error/whoosh cues);
written answers rated before unlock; one-way reveal progress; unlock moment on both phones and only when
visible; quick picks revealed as sides with side guesses and a crowned mind reader; tone-aware, non-repeating
discussion prompts; guess-driven "Biggest surprise"; honest "Round N" toasts (joiner too); "Play another
round" through the normal round start; joiner can never become host; pastel answer boxes and contrast;
locked scores hidden from screen readers; OS reduce-motion honoured in JS; stricter import sanitising;
browser Back guard.

R6 reviewed 1.2.0 (commit 0088bab). Its fixes ship as **1.2.1**: level-matched themes, audible theme-voiced
count-up, phone-audible ambient (pad ≥ 220 Hz + octave partial), no audio while hidden, gentler ducks that only
extend, climbing flip pitches, audible delete cue, v² volume taper, closed/interrupted context recovery and a
fail-safe audio setup; unfinished reveals resumable from Home with scores hidden in Home/Journal until unlocked;
partner reveal state applied off-board; rating conflicts resolved (newest wins, ties to host) plus a reconnect
resync of seen cards and ratings; not-ready answers excluded from the mind reader; Road Trip light-only;
Cozy history filter widened; prompt pools doubled, stable per card and fresh across rounds; "Rate the next
one →"; "Saved for later" in the Journal; phone toasts at the top and non-blocking; theme selected states;
no mid-word breaks; Esc closes a card; unlock announced to screen readers; quick-pick sides in Library and
Journal; Back leaves Home in one press (`tests/e2e/back.mjs`).

R7 reviewed 1.2.1 (commit c580916). Its fixes ship as **1.2.2**: Safari/Firefox mirrored card faces fixed
(`.card-face { isolation: isolate }` + hidden inactive face); unfinished reveals survive reloads and are
guarded by a confirm on Start / Play another round / Switch vibe; hidden-round matching uses the newest
snapshot only; Lamport-stamped sync (newest wins, ties to host, rejected edits echoed) for ratings,
follow-through and intentions, all included in the reconnect resync; partner re-renders wait for the unlock
animation; selected rating chips visible in every theme; desktop toasts under the top bar; 20 light quick
picks (Road Trip freshness), whole-word light detection, flirty Spicy Night draw and follow-ups,
"Before you rate" above the rating buttons; sound: single slider tap, phone-audible dreamy/error cues,
cluster-free ambient voicing, rate/open/finale cues, default volume 0.8; Back guard reused after reload.

R8 reviewed 1.2.2 (commit 6d96f95). Its fixes ship as **1.2.3**: every round start (setup, replay, custom pack,
Play another round, Switch vibe) goes through one guard that only changes state once the round really starts;
safe choice styled primary; merged two-phone leave dialog; intention text never overwritten by an untouched
field; first-run tour suppressed for joiners and closed on screen change; backups carry the in-progress round;
gentle follow-ups for sensitive spicy prompts, bigger light/flirty pools, no empty highlight, "Tonight" line;
finale chord in the cue's own key, Dreamy an octave up, louder taps/error/open cues, cleaner ambient voicing;
focus never under the sticky bars, disclosures open into view, single-scroll Next card; card front hidden at the
90° point (Firefox/Safari) with opaque sunset/cosmic backs.

R9 reviewed 1.2.3 (commit 3c444b1). Its fixes ship as **1.2.4**: saved custom packs playable again from Home
("Your packs"); pack, replay and setup starts all validate → comfort check → commit → start (replay now asks
the comfort check; the comfort dialog focuses "Change packs"); "Discard round" is destructive-styled and
confirmed; quick picks don't auto-advance while a note or More options is open; Tonight line counts the
round on screen and refreshes at unlock; playful spicy disagreements stay flirty, written spicy answers get
text-friendly lines, bigger gentle pool; every finale in F for phone presence, Dreamy step/reveal levelled,
louder swap/delete/disagree cues, smoother pads and crossfade-aware melody; intention clears survive
reconnects; a connected joiner starting from Home leaves the round properly; Journal refreshes live; the
leave dialog is always safe-first; both card faces switch at 90° in both directions; reduced-motion focus,
fixed question-screen anchor, toolbar tooltips on focus, focused fields clear the sticky bar.

R10 reviewed 1.2.4 (commit 4f1cb8c; the QA reviewer failed twice on API overload and is re-run in R11). Its
fixes ship as **1.2.5**: step climb spans exactly one octave per round, Dreamy step/count-up levelled, finale
duck 0.2, count-up haptic in pulseHaptic, louder swap whoosh, 1.2 s pad fade; prompts chosen same-tier
least-recently-used (no disagreement lines on matches), spicy flirty by default with an explicit sensitive
list, conversation starter only for real talking points, varied celebration headline, mind reader ranks by
hits; keyboard flip focus restored (card back visible at once), toolbar tooltips actually render, quick-pick
note shown in the hint line; pack chip errors focus the name field, pack save toast, confirm before deleting
a pack, no duplicate pack names, pastel error colour, red discard confirm; connected host can start the next
round from Home, joiner leave committed only once the new round starts (and they become Player 1), focus
never restored into text fields, expired-room host asked before leaving an unfinished reveal; reduced-motion
face switch without delay, nested-dialog Esc, sticky-bar background fallback.

R11 reviewed 1.2.5 (commit caa1078), now run **two reviewers at a time** to keep the machine responsive. Its fixes
ship as **1.2.6**: linked phones end the two-phone link properly before starting a pack or one-device round (host
packs start as shared rounds), round-inits never replace a local round and close stale leave dialogs; import
asks before replacing packs/favourites/edits; empty packs aren't offered; pack ids de-duplicated; delete toast
and focus; card back focusable at once but opaque only at 90°; round intro in the question header instead of a
toast; settings tooltip opens leftwards; pointer verbs in toasts; vibe-first non-repeating celebration
headlines, written-answer teaser and library progress, twin questions not repeated in one night, stricter light
detection; short pad crossfade, cute low cues lifted for phones, louder count-up landing with the rings, an
11-rung step ladder, slider capped at E6, idle audio suspended; edit-dialog textarea, stale errors cleared,
pack builder stays open, theme-matched Start bar, 12 px floor on desktop meta text.

R12 reviewed 1.2.6 (commit 36028be), two reviewers at a time. Its fixes ship as **1.2.7**: a stored celebration
headline is reused only if it matches a built-in template (XSS); 320 px top bar keeps 44 px buttons; empty packs are
disabled buttons that explain why; ending the link no longer asks twice about a paused round; one-device switches
while linked ask first; recent headlines persist and saved packs get their own; twins kept apart inside a round and
on one rare shared word; tone-aware written-answer prompts and more light lines; repair prompts sit at the peak and
the closer stays last; rotating teaser tails; card faces swap at the real 90° point (no close blink, no mirrored
sliver) and the front takes focus at once; audio idle suspend at 45 s, re-armed on music stop and on return; staggered
pad voices at semitone rubs with equal-power crossfades; long-round step repeats gain a third note; cute's phone lift
via its octave partial; slider taps capped at A6; 12 px floor on remaining desktop meta text.

R13 reviewed 1.2.7 (commits 529283a–285d8be, reviewers in pairs; fixes landed between pairs). Its fixes ship
as **1.2.8** (+ cross-platform follow-ups): OS reduced-motion flips keep focus and swap in one frame; sticky pack
preset cleared; pack chips not toggles; Compact text-size floor (selector never matched) and 15 px root; 12 px floors on
desktop meta and the guess label; phone-landscape question layout; hover states for every clickable in all themes
(selected look kept on hover); forced-colors selected outlines and hidden decorative rings; row-aligned face-down
cards that stay put during a flip; Back closes an open card first; partner-made-moot dialogs close (reveal guard,
joiner leave); End link label; partner-left banner; former joiner becomes Player 1; slider octave per slider;
pitch-based pad detune; ladder repeats lift a step; idle re-armed on silent clicks; headline recency by template;
pack restores setup; unseen allowed topics before repeats; stronger twin detection; playful far prompts for light
written answers; tonight scoped to the couple; peak format variety; per-round mind-reader copy.

R14 reviewed 1.2.8 (commits fb6fde7–94a45ff, then 1.2.9 eba0b51 for cross-platform). Its fixes ship as
**1.2.9** (+ cross-platform follow-ups): pre-pack vibe restored and shown while a pack is paused; twins only as a last
resort; pack rounds ramp-ordered; couple-scoped explored/fresh counts; one gag family per round; forced-colors
switches, theme, setup radio cards and decorations; closed card backs clipped; relative text sizes; Compact floor
enforced on what renders (measured with transitions off); every :hover gated on hover-capable pointers; Back closes
the last-opened card; app-made dialog dismissals bypass the open guard; toggle End link keeps an unfinished reveal;
joiner gets the host's vibe and headline history; soft partner-flip cue; ladder lift capped; pad octave detune;
overlapped rub stagger; idle re-armed on every click; neighbours keep their height while a card is open.

R15 reviewed 1.2.9 (98c832e–ed7f1d3; cross-platform on 1.3.0 187959b). Its fixes ship as **1.3.0** (+ a
cross-platform follow-up): the question picker ranks candidates (tonight's repeats last, format mix kept, couple-unseen
first, twins after; ~18 ms per round); pack reloads keep the couple's round length; visible, accurate 'not enough
questions' error; unreadable imports leave data untouched; round-init ids de-duplicated/capped; Back closes
hand-opened cards newest first; a joiner whose host left becomes Player 1; soft match-aware partner Reveal-all cue;
pitch-class pad detune and equal-power rub curves; quick-pick sides stack when narrow and never split words (manual
hyphens); readable pastel category pill; larger per-pack rings; focus to the score heading at unlock.

R16 reviewed 1.3.0 (9df938e–b4644f1; cross-platform on 1.3.1 6e33cd2). Its fixes ship as **1.3.1** (+ a
cross-platform follow-up): follow-ups stay in the card's own tier (unused lines first, 120 remembered), more light
and soft Cozy lines, playful lines on every other soft-night match, song/swap/high-five/snack families; the picker
borrows unseen same-format questions after the vibe filters, only from checked packs in Custom/pack rounds and never
from sensitive packs; Home notes a used-up playful vibe with a switch button; both phones show identical prompts
(joiner takes the host's prompt history); join links ask before replacing a local round and keep it resumable until
the host's round arrives; phone landscape keeps the guess first in a compact row; blur band outside the top bar;
live Compact floor; reduced-motion finale waits for the match chime; ladder passing notes; bass whole-step rubs.

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

Remaining Fun ideas not yet built (R5 fun review: lower value than the R5 fixes): take-turns flipping in two-phone mode; a "while you wait" guessing
activity on the waiting screen; a round-2 interstitial with library progress.
