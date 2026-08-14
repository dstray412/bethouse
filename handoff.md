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
