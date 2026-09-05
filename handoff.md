# handoff

**Read this first, then verify it.** This file was wrong for two days before
anyone noticed — it still described the NFL board as "new and uncommitted"
after it had shipped, and knew nothing about the bet tracker, the
recalibration, or CLV. A handoff note is the one document a new session trusts
without checking, which makes a stale one worse than none at all.

So: `node provenance.mjs` before you believe anything below. It prints the
commit you are reading and how old the data on disk is.

---

## Where things are

**Five boards**, all live and deployed:

| page | what |
|---|---|
| `index.html` | baseball. 1+ H/R/RBI, total bases, home runs, suggested parlay |
| `nfl.html` | anytime TD, receiving yards. Spreads and totals shown with the board saying they do not beat the close |
| `cfb.html` | college football, the same three bets. Added 2026-09-05 |
| `golf.html` | PGA Tour make-the-cut |
| `bets.html` | the bet log: history, win rate by bet type, closing line value |

Zero dependencies, no build step, no server, no API key. `node --test` with
**named files** — bare discovery pulls in the backtests, which fire live API
calls. The list lives in seven places and `dom.test.mjs` checks all seven.

## College football, 2026-09-05

The NFL stack was split into shared machinery plus a league table, and
college is a second entry in the table:

- `football-leagues.mjs` — the one table: endpoints, files, weeks, model,
  what to call a team that is not in the league.
- `fetch-football.mjs`, `track-football.mjs`, `backtest-nfl.mjs --league cfb`
  — shared. `fetch-nfl.mjs`, `fetch-cfb.mjs`, `track-nfl.mjs`, `track-cfb.mjs`
  are three-line entry points.
- `cfb.js` = `nfl.js` bound to college constants (`bind()`), every one
  measured. Receptions instead of targets (college box scores have no targets).
- `football-board.js` — the page script, shared by `nfl.html` and `cfb.html`.
- `.github/workflows/refresh-cfb.yml` — daily at 12:20 UTC, like the NFL.

Verified before commit: the refactored fetcher reproduces the committed NFL
board byte for byte (bar one real fact it now records: Rams-49ers week 1 is a
neutral site), and the refactored tracker reproduces the NFL week-1 snapshot
exactly. NFL backtest numbers are unchanged for touchdowns; the yards replay
now uses the board's own pool definition and reads −1.2pp where it read +1.0pp
(README, "the yards replay depends on a choice nobody fitted").

**Two defects found in the shared path, both fixed:**
- The season default was `[year-2, year-1]`, so neither board would ever have
  ingested a 2026 game. Now `[year-2, year-1, year]`.
- Player lines were "the latest season on file". With 2026 games flowing in
  that would have emptied the board until week 4 (three-game gate). Now this
  season plus last, so week 1 is last season and the current year takes over
  as it accumulates. Unchanged for week 1.

**College results** (README has the full section): touchdowns −1.4pp, Brier
0.1743; yards −3.0pp and approximate; spread 51.7% and total 53.4% against the
close on ~1,485 games, inside the noise. The forward record started
2026-09-05 with 1,183 pregame predictions (`cfb-record/2026-08-29.json`).

## The model was wrong, and was fixed

**2026-08-22.** The MLB probabilities were over-dispersed. Found by the forward
record, not by any backtest — a backtest fits constants to the same history it
then grades, so it could not see this. Predictions under 65% ran +4.79pp cold
(z = 4.32); 65–75% ran 2.86pp hot. A second-order level error on total bases
came from centring the shrink on the model's own mean.

Fixed in `31af014` and `8de1cfb`: `CALIBRATION_SHRINK = 0.8` toward solved
per-prop centres, cross-validated on non-overlapping halves.

**The consequence nobody expected.** Everything in `history/` before
2026-08-22 19:37 PT is the OLD model's record. `track.mjs:173` snapshots the
probability at prediction time and never recomputes, so 23,040 of those graded
predictions belong to a model that no longer exists. It cannot be regenerated:
`score.js:229` records that the centres were solved on 2026-08-02..08-21, the
same window, so re-grading would be in-sample.

**The current model's forward record starts 2026-08-23.**

## What is being measured, and where

| tool | question |
|---|---|
| `track.mjs`, `track-football.mjs`, `track-pga.mjs` | were the published probabilities true? (calibration) |
| `clv.mjs` | does the model predict better than the closing line? (edge) |
| `close-odds.mjs` | freezes the last price before each game starts |
| `backtest*.mjs` | replays history. Fits constants to it, so it cannot grade itself |

`clv.mjs` is the one that decides whether there is a business here.
`track.mjs` says whether the numbers are true; a perfectly true number still
loses money at these prices.

## The arithmetic that constrains everything

Measured hold on 1+ H/R/RBI: **6.96%** (n=180). A correct 66.6% leg into that
gives a per-leg multiplier of 0.9304, so:

- a 3-leg slip of perfectly calibrated legs returns **−15.4%**
- **a hit rate can therefore never be the product.** Anyone can produce one

But parlay EV is `m^n`, and that exponent is leverage. At a 5% per-leg edge the
same 3-leg slip returns **+22%**. Parlays are right if and only if the legs
carry real edge.

**Break-even needs `m >= 0.9839` against today's `0.9304` — a 5.7% relative
improvement over the book's price, per leg.** That is the number the whole
thing rests on, and `clv.mjs` measures it.

**First reading, 2026-08-23, n=170:** model Brier 0.2441, close 0.2399. Paired
t = 0.76, which is noise. The feed prices ~170 comparable legs a day, so an
answer is roughly twelve days out. Do not act before then.

## Watch, do not touch

The recalibrated model ran **cold** on its first day: hrr predicted 66.6%
against 70.8% actual (−4.30pp, n=271), and `clv.mjs` independently showed
44.2% predicted against 47.6% actual. Both are inside noise at this n. Cold is
what over-correction looks like, and the shrink was deliberately shipped at the
timid end. Let n reach the thousands before changing a constant.

The same applies to college: cold on the replay, deliberately left alone.

## Traps this repo has already paid for

All in `tasks/lessons.md`, which is the real list. The ones that bite hardest:

- **A stale checkout reads exactly like a current one.** A session ran 77
  commits behind and reported the odds feed broken, CLV empty, and the new
  model unrecorded. All three were false. `provenance.mjs` exists because of
  this; every analysis tool prints its provenance first.
- **A test wired into a refresher must not assert live data is non-empty.**
  Went red 13 times on quiet days.
- **Every test file must run in all seven gates.** `dom.test.mjs` enforces
  it: `local-check.sh`, `.pre-commit-config.yaml`, `ci.yml`, and the four
  refresh workflows.
- **ESPN serves in-play odds beside closing odds for finished games.** Grading
  against those grades against the answer. College does it too.
- **NFL `spread` is always home-relative** even though `details` names the
  favourite. Trusting the label flips every road favourite.
- **The constants have to describe the population they are applied to.**
  College ran 1.8pp cold until the touchdown coefficients were measured on
  regulars rather than every player-game.

## Housekeeping

- `nfl-history.json`, `cfb-history.json` and `.espn-athletes.json` are
  gitignored (size). Rebuild with `node fetch-nfl.mjs --history` (~1,100
  requests) and `node fetch-cfb.mjs --history` (~3,500).
- `.env` and `.odds-quota.json` stay gitignored.
- Git identity is repo-local: `Dustin Strayer <dstray@dstray.local>`.
- `bash scripts/local-check.sh` mirrors CI exactly. It now runs a freshness
  check first.
- CI does **not** gate main via branch protection; the refresh workflows commit
  straight to it and Pages serves the branch.
- One college game per fetch fails with a warning (`WARNING: 1 games failed to
  fetch`). It has not been identified; it is one game in 1,790.

## What is not done

- **No parlay forward record.** `track.mjs` records single legs only, so the
  number the business would sell has never been measured at scale.
- `backtest.mjs --fit` still fits `k` against the uncalibrated probability; the
  two layers now interact.
- The parlay suggester cannot say whether it picked 3 from 14 games or 3 from 3.
- No stake is recorded anywhere, so there is no profit and loss.
- NFL, college and golf have no odds feed, so no CLV there.
- The college yards replay is three points cold and sensitive to the pool
  definition. Not fitted, on purpose; the forward record decides.
- A receiver with no catches is voided rather than graded under in both
  football records; the hole is bigger in college, where he has no box-score
  line at all.
- The design doc at `docs/designs/bethouse-play-plus-receipt.md` carries one
  open decision: what the page says about the record spanning a model change.
