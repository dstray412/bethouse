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

**Game picks, 2026-09-06.** Both football boards now carry a live line on
every unplayed game and show the side the model likes on spread, total and
moneyline, with EV at the price. `pickGame` in `nfl.js` is the one function
that decides the side. The replay's calibration slope of the cover
probability is ~0 in both leagues (−0.25 NFL, 0.07 college), so
`spreadShrink = 0`: spread picks print at 50% and −4.5% EV. Totals keep
0.31 (NFL) and 0.10 (college, timid end of a 0.44/0.10 split). The
moneyline loses money at the close in both leagues and the page says not to
bet it; the row never ranks by moneyline EV. Picks are recorded pregame and
settled like a book, with closing line value in points; first rows are in
`nfl-record/2026-09-10.json` (48) and `cfb-record/2026-08-29.json` (12).
The pick rows were re-recorded once, within the hour, after the shrink was
measured and before anything was published or graded.

**Reconfiguring the game model, 2026-09-06.** "If the model is losing,
reconfigure it." Nine rating schemes and a bias scan of the closing line,
each season separately (`experiment-lines.mjs`, README "Reconfiguring the
model"). No spread scheme clears a slope of 0.1 on both seasons in either
league; efficiency ratings (yards per play, turnovers) are worse than points
in the NFL and inside the noise in college. The constraint is information,
not configuration: the close already contains everything a box score does.
Nothing shipped from it except the experiment, the team-efficiency lines in
both history caches (`side.stats`), and this paragraph. Next attempts need
data the box score lacks: injuries and QB status before the market moves,
weather, line movement.

**Line movement, 2026-09-06.** ESPN carries open/current/close on every
odds object; both caches now hold the opening line (`game.open`, backfilled
with `--lines`), every pick row records `open`, and the board prints open →
current. Measured over two seasons: the side a line moved toward covers ~50%
at the close in both leagues and 60% at the open for moves of 3+ points; the
model does not predict the move (50%). Real information, spent before it can
be bet. README "Line movement". Nothing in the model changed.

**Injuries, 2026-09-06.** The NFL board reads ESPN's injury report
(`injuriesUrl` in the league table; college's endpoint is empty). Out /
IR / doubtful / suspended players are hidden from the props views and
skipped by the tracker; Questionable is flagged `Q` (59% play); each game's
detail lists hurt skill players. `availability` in `nfl.js` is the one
rule. No game-line change: injury news moves lines within minutes and
there is no report history to test against. The week-1 NFL snapshot,
taken before this, carries rows for players now out; they void at grading.

**nflverse, 2026-09-08.** `nflverse.mjs` + `experiment-nflverse.mjs`: 27
NFL seasons with closing lines and weather, injuries and depth charts since
2009, cached under `nflverse/` (gitignored, 116 MB, `node nflverse.mjs`
fills it). Three findings: the spread model has no information beyond the
line in any era (slope 0.02 over 6,895 games); the totals slope is 0.04
over 27 seasons, so the two-season 0.33 was a window and NFL `totalShrink`
went 0.31 → 0.04 (total picks recorded before 2026-09-08 carry the old
probability; first prediction wins, so they stand as recorded); and
**unders at 15+ mph wind hit 56% in every era since 1999**, points − total
−1.4 at 15–20 mph against +1.3 in calm games. The one bettable bias found
all week. It needs a wind forecast per game, which nothing fetches yet
(Open-Meteo is keyless; stadium coordinates are the missing table). A
missing starting QB moves the line about a point too little (opponent
covers 53.3%, n=345): watch, not bet.

**Touchdown model over 25 seasons, 2026-09-08.** nflverse weekly stats
(`loadWeeklyStats`): constants within a few percent of the shipped ones in
every era, model calibrated within a point everywhere, top decile within
a point. Confirmed, nothing changed. The players file maps nflverse ids
to ESPN ids (418 of 419 board players match), so a last-season
opportunity prior is possible but the two-season line window already
carries last season, so it was not built.

**College over twenty seasons, 2026-09-08.** `cfbfastr.mjs` +
`experiment-cfbfastr.mjs` (cache under `cfbfastr/`, gitignored, 143 MB):
spread slope −0.04 with no era above 0.01, total slope 0.08 (0.11–0.17
recent, matching the shipped 0.1), under at 56+ 52.1% on 5,917 games.
Nothing bettable, nothing changed; cfb.html's copy updated to say so.

**College results** (README has the full section): touchdowns −1.4pp, Brier
0.1743; yards −3.0pp and approximate; spread 51.7% and total 53.4% against the
close on ~1,485 games, inside the noise. The forward record started
2026-09-05 with 1,183 pregame predictions (`cfb-record/2026-08-29.json`).

## Statcast prior, 2026-09-08

The hitter model's regression centre is now `league + 0.75 × (last season's
Statcast xBA per PA − league)` for the hit rate (`PRIOR_WEIGHT` in score.js;
`statcast/2025.json`, committed; `node statcast.mjs 2025` rebuilds it, and
in 2027 run it for 2026 and the fetcher picks it up by season). Validated
on the forward record via `experiment-statcast.mjs`: better on both halves,
both ways, raw and calibrated, monotone; fits chose 1.0 and 0.75, timid end
ships. Later the same day, same bar: the **pitcher's average allowed is now
regressed by innings** (`PITCHER_K_IP = 80`) toward league + 0.5 × (his xBA
allowed − league), the biggest single gain the model has had (held-out log
loss on hrr 0.6340 → 0.6319); the **TB centre** moves 0.25 of the way to
xSLG per PA; the barrels HR prior did not validate and stays at 0. Runs and
RBI still regress to the league. `statcast/2025.json` holds all of it;
`node statcast.mjs 2026` next winter. Predictions before 2026-09-08 stand
as recorded; the calibration centres were solved on the old raw
distribution and should be re-checked with `node calibrate.mjs` once a few
weeks of the new model's record exist.

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
- Football game lines now have CLV via the tracker. Player props in football and golf still have no odds feed, so no CLV there.
- The college yards replay is three points cold and sensitive to the pool
  definition. Not fitted, on purpose; the forward record decides.
- A receiver with no catches is voided rather than graded under in both
  football records; the hole is bigger in college, where he has no box-score
  line at all.
- The design doc at `docs/designs/bethouse-play-plus-receipt.md` carries one
  open decision: what the page says about the record spanning a model change.
