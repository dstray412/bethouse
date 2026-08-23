# handoff

## Where things are

Three boards. The NFL one is new and uncommitted; the other two are live:

- `index.html` — baseball. Now has a **suggested parlay**.
- `golf.html` — PGA Tour make-the-cut. Shipped and deployed.
- `nfl.html` — NFL: anytime TD, receiving yards, spreads and totals. **New,
  uncommitted.**

## NFL (new)

`fetch-nfl.mjs`, `nfl.js`, `nfl.test.mjs` (39 tests), `backtest-nfl.mjs`,
`nfl.html`. Two seasons replayed a week at a time: 544 games, 10,694
player-games, 543 closing lines.

| bet | measured | verdict |
|---|---|---|
| Anytime TD | bias -0.7pp, Brier 0.1590 vs 0.1718, 39.1% vs 9.3% split | calibrated |
| Receiving yards | bias +1.0pp, Brier 0.2223 vs 0.2459 | calibrated |
| Spread | 48.1% of 480 (needs 52.4%) | no edge |
| Total | 52.5% of 478 | inside the noise |

**The game lines failed and the board says so on the page.** Two seasons is 480
bets; telling a break-even model from a coin flip needs ~1,700.

Three traps worth remembering, all in `tasks/lessons.md`:
- ESPN serves in-play odds next to closing odds for finished games. Grading
  against those is grading against the answer.
- `spread` is always home-relative even though `details` names the favourite.
  Trusting the label flips every road favourite.
- The TD model ran 11.6pp hot at the top because it fed *season-average*
  workload into a concave function. Two other hypotheses were tested and
  disproved first (the usage model is exactly linear; Poisson beats negative
  binomial). Fixed by averaging over real workload swings plus a fitted 0.75
  shrink; the top bucket is now -0.1pp.

`nfl-history.json` is **gitignored** — 1.2 MB, over the repo's own pre-commit
large-file limit. Rebuild with `node fetch-nfl.mjs --history` (~1,100 requests,
a few minutes). The board only needs `nfl-data.js` (103 KB), which is committed.

Uncommitted before this: the parlay suggester. Everything below describes it.

## Suggested parlay

**Suggest a parlay** on the baseball board fills the slip with 3, 4 or 5 legs
automatically: the best hitter from that many different games.

| File | Change |
|---|---|
| `score.js` | `suggestParlay(candidates, {legs})` — pure selection, one leg per game |
| `score.test.mjs` | 15 tests on the selection rule |
| `backtest.mjs` | `--parlay` — replays real days and validates joint outcomes |
| `index.html` | the control, candidate collection, honest warnings |
| `README.md` | rewrote the parlay section around the measurements |

### Decisions

- **One leg per game, always.** Same-game correlation has never been measured
  here, so the suggester will not build a slip that depends on it.
- **It refuses rather than shrinks.** Ask for 5 legs on a 3-game board and you
  get an explanation, not a 3-leg slip. A short slip would carry a number that
  looks like the one you asked for.
- **1+ H/R/RBI only**, per the request and because it is the prop the parlay
  backtest covers.
- **No correction applied to the printed probability.** See below — it is known
  to be a few points optimistic, and the board says so instead of fitting a
  fudge factor to three weeks of overlapping data. That is how `k = 0.55`
  happened the first time.
- **Selection stays max-probability.** The hot-top finding does *not* argue for
  picking worse hitters: an 81% leg that truly cashes 78% still beats a 74%
  leg. The rule is right; the printed number is generous.

### What the measurement said

`node backtest.mjs --days 21 --parlay`, 21 days, 4,957 hitter-games.

Multiplying across games is **sound, slightly conservative** — sampled
cross-game slips cashed 1.03–1.08x the product (8,400 slips per size). A shared
day-level scoring environment makes even different-stadium legs faintly
correlated in your favour. This retires the README's old "never validated on
joint outcomes" caveat.

The suggested slip itself **underperformed**: 3-leg expected 52.2%, cashed 8 of
21 (38.1%). Formally that is ~1.3 sd, i.e. noise. But all three sizes miss the
same way and the single-leg calibration explains it: the 75–80% bucket cashed
74.0% and the 80–85% bucket cashed 78.0%, so the top of the board is ~3 points
optimistic per leg and a suggested slip is nothing but the top. Top 2% cashed
67.7%, worse than top 10% at 74.3%.

## State

- `bash scripts/local-check.sh` → **197 tests**, 0 failures, 0 skipped.
- Verified in a real browser on a live slate: 3/4/5 all build, legs always come
  from different games, switching to Total bases clears a suggested slip and
  hides the control, and the refusal path fires correctly on a board with no
  open games.

## Blockers / what to know

- **21 days is a thin sample for the suggester.** Re-run `--parlay` on a wider
  window before treating the 38.1% as a real number rather than a warning.
- **Golf: no live cut board until 17 September.** The playoffs and the
  Presidents Cup have no cut; the fall swing (Biltmore onward) is the runway.
- **`refresh.yml` still pins `actions/checkout@v4`** while `ci.yml` is on v7.
  Pre-existing, untouched.
- An untracked `Vegas Craps/` directory is sitting in the working tree. Not
  mine, not committed, left alone.

## Next, if wanted

1. Widen the parlay backtest window and see whether the suggester's shortfall
   survives a bigger sample.
2. Measure same-game correlation properly, which is the thing that would let
   the suggester use more than one hitter per game.
3. The suggester cannot see a price. Wiring `fetch-odds.mjs` in would let it
   rank by edge instead of by chance to cash, which is the version that would
   actually be worth betting.

---

# /qa — 2026-08-19

Full QA of all three boards, desktop and mobile. **Four issues found, four
fixed and verified; health 95 → 99.** Full report with repro steps and
before/after evidence: `.gstack/qa-reports/qa-report-bethouse-2026-08-19.md`.

The three boards were checked byte-for-byte against the live Pages site first,
so all four defects were live in production rather than local artefacts.

| id | severity | what | commit |
|---|---|---|---|
| 001 | High | parlay slip buildable on total bases and home runs | `a44cceb` |
| 002 | Medium | positive prices printed `++111` | `84acdf8` |
| 003 | Medium | NFL spread rows changed height with the team abbreviation | `c52efcc` |
| 004 | Low | a one-leg slip said "All 1 legs are from different games" | `ece5e76` |

## The one that matters

**The parlay scope rule was enforced on the control and not on the button.**
The section above records "switching to Total bases clears a suggested slip and
hides the control" — true, and it was the wrong thing to check. The suggester
was scoped; the per-row `+` was not. 93 live add buttons on Total bases, 60 on
Home run, each one building a slip that closed by quoting a measurement taken
only on 1+ H/R/RBI.

The rule is now `S.parlayEligible` in score.js, default-closed, asked by both
call sites instead of `state.view==='hrr'` typed out twice. Two prevention
rules went into `tasks/lessons.md`.

## State

- Suite **218 tests, 0 failures, 0 skipped**; `bash scripts/local-check.sh`
  green including gitleaks. Test count 212 → 218 (5 new regression tests, each
  confirmed failing against pre-fix source).
- Nothing deferred as unfixable. One low-severity a11y item is carried: rows
  are `role="button"` wrapping a nested `<button>`, so the row's accessible
  name absorbs the child's label. Fixing it means restructuring the row.
- The `refresh.yml` / `actions/checkout@v4` pin noted above is still open,
  untouched — outside the scope of a QA pass.

---

# Bet tracker — 2026-08-21

Tap the circle on any row before first pitch; the pick goes into a log in your
browser and grades itself. New: `bets.js` (28 tests), `bets.test.mjs`, a panel
in `index.html`, and a README section.

**It reuses the grading that already ran.** `track.mjs` has been writing
`history/<date>.json` on every refresh for 19 days, with `actual` for every
player it snapshotted on all five props. A tapped pick is already in that file.
So the tracker fetches a result, it never decides one — and a date is fetched
only while it still holds something unsettled, so a finished day is fetched
once. Pages serves those files with `max-age=600` and an ETag, which is why
there is no throttle of my own.

**No stake, no price**, so it does not claim to know whether you made money.
It reports whether your picks landed as often as the model said, with the
spread luck alone would produce, so a +0.4 gap does not read as skill.

Three rules are in `bets.js`'s header and enforced by tests: pregame only,
first grade wins, expectation covers exactly the graded picks.

## Two things worth knowing

- The row grid flipped. `.row` now defaults to **slot | who | prob | track |
  caret**, and the parlay `+` is the variant (`.row.parlay`), because tracking
  exists on all three bet types and the parlay exists on one. The `.noadd`
  class from 2026-08-19 is gone.
- **`dom.test.mjs` now checks that every `*.test.mjs` is wired into all six
  gates.** The `node --test` file list is explicit (bare discovery would fire
  the backtests' live API calls), so it lives in six files and adding a
  seventh test file means remembering all six. Verified by un-wiring one and
  watching it fail.

## Not done

- No NFL or golf tracking. Those boards have no equivalent of `history/*.json`,
  so there is nothing to grade against yet.
- Still no CLV. It is the measure that would tell you whether you are actually
  good, and it needs a closing-price capture that does not exist.

---

# Parlay tracking — 2026-08-21

The tracker now records parlays as well as singles. Press **I bet this parlay**
on the slip; the row circles still handle singles.

**The model changed: a single is a parlay with one leg.** Every bet is now
`{legs:[...], prob, date}`. Keeping the old one-pick-per-entry shape would have
meant a second shape, a second grading path and a second summary — two of
everything, and this repo has now been bitten four times by two copies of a
rule drifting apart. Storage went `bethouse.bets.v1` → `v2` with a migration
that runs on read and on import; the v1 key is deleted after a successful move
so a later "Clear all" cannot resurrect it. Verified in a real browser.

**A parlay dies on the first missed leg** and settles then, without waiting for
the rest — an early leg that missed has already decided a slip whose other legs
are night games. It pays only when every leg is in and every leg hit. Legs
carry their own outcome even while the bet is open, so the panel shows "2 of 3
legs in" and a MISS names the leg that killed it.

**The combined probability is stored as shown, never recomputed.** Recomputing
later from legs the model has revised would compare your decision against
evidence you never had.

## The honesty problem parlays introduced

`sd` sums p(1-p), which assumes the bets are independent **of each other**. Bet
a single on a hitter and a parlay containing him and they are not. The panel
counts shared legs and says so rather than quoting a spread it cannot stand
behind. This was already latent with singles in the same game; parlays made it
sharp enough to be worth admitting.

## State

- 261 tests, `bets.test.mjs` is 36 of them. Full gate green.
- Verified in a browser: a suggested 3-leg slip logs once and the button
  disables; a seeded winner graded to HIT, a seeded loser to MISS with the
  right leg flagged; a planted v1 log migrated and the old key vanished; the
  overlap caveat fires on a single and a parlay sharing a player.

## Still not done

- No NFL or golf tracking — those boards have no `history/*.json` to grade
  against.
- Still no stake and no price, so no P&L and no CLV.

---

# Bet history page — 2026-08-22

`bets.html`, linked as **Bets** from every board. Every bet grouped by day,
won and lost, parlay legs underneath, filters by result and by kind, and the
win-rate breakdown.

**The record is summed over the whole log, never over the filtered view.** A
win rate that moves when you click "Won" is a mirror, not a record.

**The board's panel was trimmed rather than duplicated.** index.html now shows
only what is riding right now plus a one-line record and a link here; the full
list, the breakdown table, verdict(), exportBets() and importBets() moved out,
and the orphaned CSS went with them. Two copies of the same list is two things
to keep in step, which this repo has paid for four times.

**bets.html is a fourth board as far as the tests are concerned.** It was added
to `BOARDS` in dom.test.mjs, so it is held to the same contract: byte-identical
`:root` tokens, the `[hidden]` guard, a ch-capped measure, links to every
sibling with consistent labels, a tagline that names the page, every asset
present, no duplicate ids. The link test already generalised — it asserts one
nav link per sibling board — so adding the fourth required every other board to
link to it and they now do.

## State

- 271 tests green, full gate clean.
- Verified in a browser: empty state; 12 seeded bets across 3 days grading to
  5–7; filters narrow the list while the record holds at 5 won; parlay filter
  shows 3 bets and 9 legs; the retro chip renders; no console errors and no
  horizontal scroll at 375px on either page.

## Still not done

- NFL and golf bets. Those boards have no `history/*.json`, so nothing grades.
- No stake, no price, so no P&L and no CLV.

---

# The model was over-confident — 2026-08-22

Investigating a user's four-leg parlay that lost every leg. The legs turned out
to be fairly priced, but the investigation found a real defect the backtests
had never seen.

**The probabilities were spread too wide.** Measured against the board's own
4,330 shipped predictions: under 65% ran +4.79pp cold (z = 4.32), 65-75% ran
2.86pp hot (z = -2.77). Both halves of the window agree independently, on all
five props.

`backtest.mjs` could not see this because it replays history the model is then
fitted on. `calibrate.mjs` (new) measures the board against what it actually
published, graded by track.mjs at the time.

**Fix:** `CALIBRATION_SHRINK = 0.8` in score.js pulls log-odds toward a
per-prop centre. Ten independent fits (five props x two directions) landed
between 0.43 and 0.78, all saying shrink; 0.80 is the timid end on purpose.
Every prop improves on both halves on both Brier and log loss.

## Things to know

- `rawProb` is now on every scorer, so the mixture stays testable at its own
  layer and the correction is auditable from outside. One existing test moved
  to it rather than being weakened.
- `calibrate.mjs` rebuilds inputs from committed `mlb-data.js` snapshots and
  reproduces each recorded prediction to 0.003pp. That fidelity check runs
  every time and should stay above ~0.01pp; if it drifts, the re-fit is fitting
  something other than the shipped model.
- The board's on-page claims now cite the forward record (4,330 graded
  predictions) rather than the July backtest of a model that no longer exists.
- Total bases still runs ~2.5pp hot after correction, down from ~3. Said on the
  page. Worth a second look when there is more season.

## Not done

- `backtest.mjs --fit` still fits `k` against the UNCALIBRATED number. It is not
  wrong, but the two layers now interact and a future re-fit of k should be done
  with the correction in place.
- The correction is 19 August days. Re-run `node calibrate.mjs` after a wider
  window and move the constant if ten fits still say so.

---

# NFL forward record — 2026-08-22

The NFL board now records what it predicts before kickoff and grades it after.
Live before week 1 (2026-09-10), which was the deadline: a week not recorded
pregame cannot be recovered.

New: `track-core.mjs` (the sport-agnostic rules), `track-nfl.mjs`,
`track.test.mjs` (17 tests), `nfl-record/`, `nfl-record.js`, and a live-record
block in nfl.html's footer under the backtest table.

**track.mjs was refactored onto the shared core and its output is byte-identical
— report, record.js and the day file all verified unchanged.** That mattered:
the first version of `saveDay` wrote compact JSON with a trailing newline
instead of indent-1 without one, which would have put an 18,000-line
reformatting diff into every scheduled commit. Caught by diffing the day file,
not by reading the code.

## Verified

- 623 week-1 predictions recorded across 419 players.
- Grading tested end to end against a real completed game (BAL @ PIT): a
  2-TD receiver graded HIT, a 0-TD quarterback MISS, 138 yards over a 127.5
  line HIT, and an unknown player id marked "did not play" rather than scored
  as a loss.
- The empty state renders on the board; a populated record renders as a table.
- 300 tests, full gate green.

## Things to know

- `nfl-record/` is ~152KB a week and IS committed. That is the record; losing
  it loses the evidence.
- A player who does not appear in the box score is marked `scratched`, never
  graded as a miss — a bet on an inactive player is voided, not lost — and the
  flag stops `grade` re-fetching him forever.
- `nfl-record.js` is written even when empty, so the board can load it from day
  one and say "nothing graded yet" instead of omitting the section.
- Golf has no forward record. Same shape would work; `track-core.mjs` is
  already sport-agnostic.

## Next

- After week 1, run `node calibrate.mjs`-style analysis on the NFL record. It
  will not have the sample for a while — n needs to be in the thousands.
- The baseball calibration is 19 August days. Re-fit on a wider window.

---

# Golf forward record — 2026-08-22

`track-pga.mjs`. All three boards now keep a forward record against the same
three rules in `track-core.mjs`.

New: `track-pga.mjs`, `pga-record/`, `pga-record.js`, a live-record block in
golf.html's footer, and golf wired into `refresh.yml` beside the baseball
tracker.

## Verified end to end

Replayed a real completed event (Wyndham, cut low 65, 147 players) by posing it
as a pre-tournament board: 147 snapshotted, 147 graded, report produced. **That
run's −5.71pp bias is meaningless** — the fixture used today's skill ratings for
a past field — and the synthetic record was deleted afterwards. `pga-record/` is
empty and correct.

Also verified the three skip paths on the live board: no-cut week, event already
under way, and grade-with-nothing-recorded.

## Things to know

- Snapshot skips a week when `event.cut == null`. Ten of 36 cached events this
  season were no-cut, so this is common rather than exceptional.
- Pre-tournament is checked twice: ESPN's `state` leaving "pre", and the
  earliest tee time against the clock. Same belt-and-braces as baseball, and
  for the same reason — a status string is someone else's vocabulary.
- Grading reads `pga-history.json` and makes no requests.
- Only a real boolean `madeCut` grades. Anything else is marked `scratched`
  with the reason recorded.
- The next event with a cut is Biltmore Championship on 2026-09-17. The board
  flips to it once the Tour Championship finishes, and the 30-minute refresh
  will record it as soon as the field posts.

## Still open

- Whether the golf model needs a calibration constant like baseball's. The
  same rebuild-and-measure technique would answer it from `pga-history.json`,
  but it should wait for the forward record rather than reuse the backtest.
- `backtest.mjs --fit` still fits `k` against the uncalibrated baseball number.
- No CLV on any board.

---

# Total bases: the known 2.5pp defect is fixed — 2026-08-22

The calibration shipped earlier today corrected the SPREAD but centred on each
prop's own mean prediction, which leaves a LEVEL error untouched. Total bases
had one: 35.7% predicted against 33.1% reality, so pulling toward 35.7% kept
all 2.6 points. That is why the board carried "runs ~2.5 points hot".

The centre is now **solved** — the value that makes the corrected average land
on what actually happened. Not the base rate, not the model's mean, and it
overshoots past the base rate on the far side from the model's error.

| prop | model said | really was | solved centre |
|---|---|---|---|
| hrr | 65.8% | 66.5% | 69.3% (corrects up) |
| tb2 | 35.7% | 33.1% | 23.8% (corrects down) |
| tb3 | 20.5% | 19.9% | 17.9% |
| tb4 | 14.5% | 13.6% | 10.7% |
| hr | 12.0% | 11.1% | 8.4% |

Cross-validated: fit on either half, applied to the other, every prop improves
on Brier, log loss AND bias. Bias on all five is now zero to within a tenth of
a point.

## Things to know

- The centres look wrong at a glance — hrr centres at 69.3% when the base rate
  is 66.5%. That is the fix, not a bug: the shrink only moves part of the way,
  so the target must overshoot. `score.test.mjs` asserts the direction per prop
  so nobody "corrects" them back.
- `calibrate.mjs` now re-solves the centres and prints them beside the shipped
  values, flagging drift over 1pp.
- Board copy updated: the "2.5 points hot" and "half a point hot" warnings are
  gone because they are no longer true.
- CAL.tbBias / CAL.hrBias removed from index.html — they existed only to carry
  those warnings.

---

# NFL calibration checked — 2026-08-22

Ran the band-by-band test on both NFL props before the season, looking for the
over-dispersion that caught baseball. **It is not there.**

- Anytime TD: gaps +0.2, −0.7, −0.1, −3.0, −1.4, −0.3, +2.8, −0.1pp across
  eight buckets. No direction.
- Receiving yards: +1.0, +2.5, +1.6, −0.4, +0.8pp. A mild uniform hot bias,
  which is a level error rather than a spread one.

**Nothing corrected, deliberately.** It is backtest evidence, and a point of
level bias is not worth a constant fitted to the same data the model's
constants came from. The forward record starting week 1 is the test that
counts.

Also verified every week-1 game gets a pregame snapshot: the daily 12:20 UTC
run lands 12–36 hours ahead of all sixteen kickoffs, Thursday through Monday.
