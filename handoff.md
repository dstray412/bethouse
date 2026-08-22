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
