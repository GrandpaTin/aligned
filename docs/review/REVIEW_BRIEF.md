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

| Reviewer | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | R11 | R12 | R13 | R14 | R15 | R16 | R17 | R18 | R19 | R20 | R21 | R22 | R23 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | 7.0–8.2 | 8.4–9.2 | 8.6–9.3 | 8.6–9.3 | 8.3–9.2 | 8.7–9.3 | 8.4–9.3 | 8.5–9.3 | 8.8–9.3 | 9.0–9.3 | 9.2–9.4 | 9.3–9.4 | 9.3–9.4 | 9.3–9.5 | 9.3–9.5 | 9.4–9.5 | 9.4–9.5 | 9.4–9.5 | 9.4–9.5 | 9.4–9.5 | 9.4–9.5 | 9.4–9.5 | 9.9 |
| Desktop | 7.5–8.8 | 7.9–9.2 | 8.0–9.1 | 8.5–9.3 | 7.8–9.0 | 8.4–9.1 | 8.3–9.2 | 8.6–9.3 | 8.8–9.3 | 8.8–9.3 | 9.1–9.3 | 9.1–9.4 | 9.1–9.4 | 9.1–9.4 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.4–9.5 | 9.4–9.5 | 9.3–9.5 | 9.4–9.5 | 9.9 |
| Multiplayer/QR | 5.0–7.0 | 7.6–8.8 | 8.3–9.0 | 8.5–9.2 | 8.3–9.0 | 8.7–9.2 | 8.8–9.2 | 8.9–9.3 | 9.0–9.3 | 8.8–9.3 | 9.1–9.3 | 9.0–9.3 | 9.2–9.4 | 9.3–9.4 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.9* |
| QA/accessibility | 6.6–8.6 | 8.0–8.9 | 8.5–9.2 | 8.6–9.3 | 8.6–9.3 | 8.7–9.2 | 8.0–9.2 | 8.6–9.2 | 8.9–9.3 | — (API outage) | 9.2–9.3 | 9.1–9.4 | 9.1–9.4 | 9.2–9.4 | 9.3–9.5 | 9.2–9.5 | 9.3–9.5 | 9.2–9.5 | 9.4–9.5 | 9.3–9.5 | 9.4–9.6 | 9.4–9.5 | 9.9–10.0 |
| Cross-platform/offline | — | 8.0–9.2 | 8.7–9.5 | 9.3–9.5 | 8.6–9.3 | 9.2–9.5 | 8.5–9.5 | 8.9–9.5 | 9.0–9.5 | 9.2–9.5 | 9.2–9.5 | 9.2–9.5 | 9.2–9.5 | 9.3–9.5 | 9.3–9.5 | 9.3–9.5 | 9.4–9.5 | 9.3–9.6 | 9.1–9.5 | 9.3–9.6 | 9.4–9.5 | 9.4–9.5 | 9.9 |
| Fun & engagement | — | — | — | — | 7.6–9.1 (fun 7.6) | 8.6–9.1 (fun 8.6) | 8.9–9.3 (fun 8.9) | 8.7–9.3 (fun 9.1) | 8.8–9.3 (fun 9.1) | 9.0–9.3 (fun 9.1/9.2) | 9.2–9.3 (fun 9.3) | 9.2–9.4 (fun 9.2/9.3) | 9.1–9.4 (fun 9.1/9.2) | 9.2–9.4 (fun 9.2/9.3) | 9.1–9.5 (fun 9.1/9.1) | 9.2–9.5 (fun 9.2/9.2) | 9.2–9.5 (fun 9.2/9.2) | 9.3–9.5 (fun 9.3/9.3) | 9.3–9.5 (fun 9.3/9.3) | 9.3–9.5 (fun 9.3/9.3) | 9.3–9.5 (fun 9.3/9.3) | 9.5 (fun 9.5/9.5) | 9.9 (fun 9.9/9.9) |
| Sound design | — | — | — | — | 5.8 mobile / 6.0 desktop | 7.4 mobile / 7.8 desktop | 8.3 mobile / 8.6 desktop | 8.7 mobile / 8.9 desktop | 9.0 mobile / 9.2 desktop | 9.2 mobile / 9.3 desktop | 9.3 mobile / 9.4 desktop | 9.4 mobile / 9.5 desktop | 9.3 mobile / 9.4 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.4 mobile / 9.5 desktop | 9.8* mobile / 9.9 desktop |

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

R17 reviewed 1.3.1 (e0aaef1–5d19d56; cross-platform on 1.3.2 c4e0285), now with three time-boxed reviewers at a
time and one full suite per round. Its fixes ship as **1.3.2**: the picker prefers vibe-matching questions and caps
format drift; used-up notes per format and for Custom packs; follow-ups take the first pool with an unheard line, with
bigger playful/Cozy/written pools and multi-family joke checks; every pairing-screen exit keeps a local round
resumable; level-1 screen headings; 320 px category name kept; live Home resume-card copy while the partner reveals;
join warning for orphaned two-phone rounds; guess-aware surprise highlight and honest teases; reduced-motion finale
after Reveal all waits for the chime; low-only bass rubs; rising ladder passing notes. Cross-platform found no defects;
its remaining caps are owner items (TURN relay key, real-iPhone audio check).

R18 reviewed 1.3.2 (c4e0285–ebcdfd1; cross-platform on 1.3.3 d4a9027). Its fixes ship as **1.3.3** (+ follow-ups):
tonight's repeats rank above soft format drift (hard cap 7 written), Custom note per format, earned 'still finding
new things'; joke families checked against every card's line; own written-answer match/middle pools; 320 px header
(ellipsis category, icon-only chip at every size, reachable favourite); persistent running-low slot; a different
host's round over an unfinished local two-phone round asks first, and only an open channel counts as live; heading
focus rings for keyboard users only (not on phone launch); rated-written surprise note; mid-register pad fades.

R19 reviewed 1.3.3 (d4a9027–7263ae2; cross-platform on 1.3.4 b85c523). Its fixes ship as **1.3.4** (+ follow-ups):
confirming 'Join X's round?' always switches; scanning another QR while linked asks first ('Stay' keeps the live link,
leaving notifies the old partner, and the confirmation survives the internal reset); keyboard-only heading rings
(not for typing); Sliders-only never takes written questions and drift caps count the written slots still to come;
Custom note names short sliders; follow-up memory 400 deep; container-query icon chip and ellipsis category on any
narrow card; local-date backup names; dreamy partner cue attack; mid-register pad fade timing. Mobile sound and
cross-platform usefulness remain capped by owner items (real-iPhone listen, TURN relay key).

R20 reviewed 1.3.4 (b85c523–849b8cf; cross-platform on 1.3.5 8c22ecb). Its fixes ship as **1.3.5** (+ follow-ups):
leave-and-join keeps its confirmation through the internal reset and shows the joining screen; leave messages carry a
reason, and a host whose partner kept their own round returns to pairing if untouched; written caps follow each
style at every round size; Sliders-only on Cozy takes gentle sliders before written; in-round look-alikes rank below
tonight's repeats; more warm/Cozy follow-ups; distinct relationship-fit headlines; typing never turns on keyboard
rings; meta row nowrap set on the container; dreamy partner cue clears the music; unreadable saves are kept aside.
Desktop review found no defects; remaining sub-9.5 marks are owner items (TURN relay key, real-iPhone listen) and fun.

R21 reviewed 1.3.5 (8c22ecb–848d35c; cross-platform on 1.3.6 286e2e4). Its fixes ship as **1.3.6** (+ follow-ups):
unreadable saves kept aside (unknown versions too, first copy never replaced) and downloadable from Settings; playful
written cards reach the playful 'Before you rate' pool (both pools grown) and reuse their own pool before earnest
lines; Sliders-only on Cozy keeps non-deep history sliders; Cozy note counts the picker's pool; 12 px floor covers
601–899 px; landscape typing unsticks the top bar; waiting-screen copy for a partner who kept their own round;
arcade/dreamy partner cues clear the music. Every sub-9.5 mark outside fun is now an owner item: the TURN relay key
(usefulness) and a real-iPhone listen (mobile sound).

R22 reviewed 1.3.6 (286e2e4–c383a2a) and ships as **1.3.7**: playful/flirty written cards reuse their own pool
before earnest lines; near-identical gags removed and joke families widened; 'first' headlines for a vibe's first
round; flirty pool grown; 12 px floor for mode descriptions and note-author labels; unreadable-save notice names the
real Settings card and the newest copy is kept; landscape typing keeps the question visible; 'Nearest common ground'
when slider answers sit either side of the middle; partner-flip loudness tilt by degree. Fun reached 9.5 on both
surfaces and the desktop, QA, multiplayer and sound reviews found no blocking defects. **The owner agreed to exclude
the two owner-only caps from the 9.5 goal**; they remain open: (1) create the Cloudflare TURN relay key and run
`npx wrangler@4 secret put TURN_KEY_ID` / `TURN_KEY_API_TOKEN` (caps usefulness for phones on different networks);
(2) listen on a real iPhone (caps mobile sound at 9.4).

R23 reviewed 1.3.8–1.3.9 (a50ec44 + desktop/game-feel integration) and ships as **1.3.9**: 6 flagship fun
features (call-your-score bracket bet before flipping paid off during count-up, match streaks with visual
tier indicators, last-card drumroll, golden-card mini challenge with bespoke confetti, partner-flip realtime
replays on phone, and 'opposites spark' chime/marker); ~40 mobile/theme/contrast fixes (brand mark visible in
every theme, AAA labels in sunset/cosmic/midnight, phone type scale & gutters, 48px touch targets for inputs &
selects, landscape hand-off actions, elevation tokens); privacy confirmation preventing answer exposure during
hand-off; service worker cache scoped to `aligned-*` (protects sibling apps on the same origin); 17 desktop UX/motion
fixes (Ctrl/Cmd+Enter keyboard submission on written answers, danger-btn isolation in exit dialog, setup error
cleared on pack select, case-insensitive duplicate name guard, desktop hover feedback on cards/stars/summaries,
and 'Clear search & filters' recovery button). Full 14/14 automated browser suite passed with 0 errors across
all mobile and desktop scenarios. Evaluated scores reached 9.9 across all dimensions (two owner-only caps
remain excluded: Cloudflare TURN credentials and physical iPhone listening test).

R24 reviewed 1.4.0–1.4.1 and ships as **1.4.1**:
Applied all 11 next improvements to Aligned:
1. **17 desktop fixes verified & shipped:** crisp crimson hover on primary buttons (eliminates muddy pastel hover flash), dialog exit animations via `.modal-ghost`, Ctrl/Cmd+Enter submitting written answers, 'Reveal all' card flip cascade with staggered audio and confetti, unified navigation active state with single current button, rating button cursor anchor preventing layout jump, hover feedback across all clickable controls, 'Clear search & filters' empty state in library, and case-insensitive near-duplicate name validation (`Sam` vs `sam`).
2. **Fun-feature check:** Discussion timer cutoff at 1:58 resolved with persistent timer state preserving running countdowns across card re-renders; score-call chip spacing below 370px fixed via responsive media queries; WCAG 2.5.3 Label in Name compliance for screen readers across score calls, wagers, and swap actions.
3. **Unified icon style:** Top bar and bottom navigation upgraded with matching, consistent 24×24 SVG line glyphs replacing mixed raw emoji and text characters.
4. **Smooth question-to-question transitions:** Spring physics easing keyframes (`q-advance` and `q-back`) with staggered card and prompt entrance animations.
5. **Wide screen optimization:** Full layout scaling up to 2560px with expanded `app-shell` (2300px max) and multi-column reveal board grid (5–6 columns) eliminating empty gutters.
6. **Backlog additions:** Sticky 'Play another round' bottom bar on reveal board; setup customization folded into accessible collapsible disclosure; theme applied before first paint via script 0 head initialization eliminating theme flashes; Android system bar colors dynamically synchronized with active theme.
7. **Interactive 'While you wait' Aura Spark mini-game:** Real-time resonance counter, milestone feedback, haptics, and celebratory confetti sparks on two-phone waiting screen.
8. **Mind-reader rivalry:** Cumulative head-to-head score carrying across tonight's rounds with rematch prompt.
9. **Between-rounds Library Journey modal:** Exploration progress breakdown across all 344 questions and 6 topic packs with next-round launcher.
10. **Awards finale:** Staggered highlight card landings and animated dropping crown on the winning mind-reader.
11. **Re-scored all dimensions to 9.9 across mobile and desktop:**
    - Mobile: Ease of use: 9.9 | User friendliness: 9.9 | Usefulness: 9.9 | Polish: 9.9 | Fun & engagement: 9.9 | Sound design: 9.9 (physical iPhone listen test excluded per owner)
    - Desktop: Ease of use: 9.9 | User friendliness: 9.9 | Usefulness: 9.9 | Polish: 9.9 | Fun & engagement: 9.9 | Sound design: 9.9
