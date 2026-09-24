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
| `nfl.html` | anytime TD; receiving, rushing, rush + rec and passing yards and receptions, each with a ladder of alternate lines; game matchups from play-by-play. Spreads and totals shown with the board saying they do not beat the close |
| `cfb.html` | college football, the same props and ladders (no matchups). Added 2026-09-05 |
| `golf.html` | PGA Tour make-the-cut |
| `bets.html` | the bet log: history, win rate by bet type, closing line value |

Zero dependencies, no build step, no server, no API key. `node --test` with
**named files** — bare discovery pulls in the backtests, which fire live API
calls. The list lives in seven places and `dom.test.mjs` checks all seven.

## Availability off the roster, and one passer per team, 2026-09-24

Two things the suggested parlay got wrong on the Thursday board, both
fixed at the source (the fetcher and the one gate) rather than in the
slip. README, "Injuries" and "One quarterback throws for a team".

**Josh Jacobs, suspended, was on the board.** The league injury report
does not list suspensions; the roster's own athlete entry did
(`injuries: [{status: "Out"}]`, status "News"). `parseRoster` now carries
`listed` and `listedAt` -- the athlete's injury entry (not one that says
Active), else his roster group (`suspended`, `injuredReserveOrOut`) --
and `notActive` in `fetch-football.mjs` merges it under the report,
dropping a dated listing he has played through. 76 of 403 week-3 board
players carry a status, 42 ruled out.

**Two quarterbacks on one team, both over their passing yards.** Every
passer with 40 attempts on file had a line. `backupPassers`
(fetch-football.mjs, tested) takes each team's quarterbacks by roster
position and `startingPasser` (nfl.js) names one: not ruled out, most
attempts over the team's last three games this season, then most on
file. The first cut used the last game alone; the review found that in
week 1 that is a week-18 finale where the backup threw (15 of 32 teams
in 2025), and that punters with a trick-play attempt were in the race.
The fetcher marks the rest `backupQB` and `statEligible` gives a backup
no passing line. Board and tracker share the gate. Limits: a mid-week
change of starter is not seen until the next daily build; a quarterback
with no game on file for his new team (Tua at Atlanta) reads as the
backup until he throws one; a Doubtful starter reads as out, as he does
everywhere on the board.

The day's record (`nfl-record/`) already carried the old rows before
kickoff and is left alone: Jacobs settles void on `played`, and the
backups' passing rows grade as the board offered them. First prediction
wins.

## Alternate lines, levelled pools and tendencies, 2026-09-21

Three things landed together; the second was found by the first.

**The ladder.** Every counting prop now carries the book's alternate
lines: `LADDERS` in `nfl.js` names the rungs (10+, 20+, 25+ … 150+ for
the yardage stats, 150+ … 400+ passing, 2+ … 10+ catches),
`ladder(stat, exp, pool)` prices them off the same pool as the projection
line, and "N+" settles as the over of N − 0.5. Rungs outside 2%–98%
(`ladderEdge`) are neither shown nor recorded. The board shows the ladder
in every counting-prop panel (`football-board.js`, `.ladder` in
`board.css`); the tracker records every shown rung on the projection-line
row as `ladder` (rung → chance) — a row per rung was tried first and one
college week came to 7.5 MB, over the 1 MB file limit — settles a rung
off the row's graded `result` with `statTotal`, and prints a per-rung
table (`ladderSummary`, `out.ladder` in the record) apart from the
projection lines; rungs are never parlay legs. `backtest-nfl.mjs --ladder` grades every rung walk-forward and
prints calibration by predicted, by rung and by projection third.

**Rush + receiving yards** is a fifth `STATS` row (`rushrec`): totals
summed (`total` is now a list on every row, `box` a list of pairs;
`statTotal` sums), touches for opportunity, prior 31 NFL / 29 college
(under the measured 35.9 / 34.3 like the others), floor 25, pool floor
**a quarter of the floor** (6.25) in the NFL — NOT rushing's rule: at the
board's floor it ran 3.1pp hot and the walk is monotone (README, "The
rush + rec pool floor") — and **25** in college, which reads the other
way (−0.1pp at 25, −1.6 at a quarter; `cfb.js`). Opponent strength 0
(0.5 read worse). Replay: NFL +0.8pp, Brier 0.2155, seasons −0.3 / +1.8;
college −0.1pp, 0.2280. College inherits the pool shares and they hold
there (receiving 0.2304 → 0.2288, rushing 0.2323 → 0.2297).

**Pools by level — the finding.** The first ladder replay, on one pool
per stat, was calibrated on average and wrong by size: the smallest
third of projections 5–10pp too confident at the middle rungs, the
largest third 7–12pp too timid, every stat. Pools now carry each game's
expectation beside its ratio (`sortedPool` → `{stat, exp, ratio}`,
sorted; `poolKeep` 6,000 most recent; the data files' `pools[stat]` are
this shape now, `stat` included) and `empiricalOver` reads the over off
the share of the pool nearest the player's projection (`poolReads`,
`poolNear`; `poolSize` is the one way to ask a pool how big it is —
`.length` on the new shape is undefined and reads as an empty board).
The share is per stat: **0.5** for receiving, rushing and rush + rec
(better in both seasons on both the line and the ladder), **0** for
passing and receptions (the seasons disagree). Sweep table in
`DEFAULTS` and README "Alternate lines". A flat pool still reads whole,
so an older data file keeps working. The projection-line numbers moved
with it (receiving −0.8 → +1.7pp, Brier 0.2224 → 0.2205; rushing
0.2215 → 0.2186); the README results table is re-read.

The parlay slip's 300-game floor on a counting-prop leg now counts the
games the over was read off (`poolReads`), not the games held; the lift
factors were measured before that and stand (the replay's pools clear 600
within weeks). Rebuild the boards after pulling: the notes above each
prop quote the re-read replay.

**Tendencies.** `nflverse.mjs` gained play-by-play (`loadPlayByPlay`,
gzipped, column-filtered `parseCSV(text, keep)`) and FTN charting
(`loadFtnCharting`, 2022–2026: play action, RPO, screens, motion,
blitzers), team codes translated to ESPN's (LA → LAR, WAS → WSH).
`tendencies.mjs` is the pure module: `profile`, `teamProfiles`, `rank`,
`matchup`, `describe`, `profilesThrough` (walk-forward, regressed toward
last season by K = 6 games, weighted in plays per metric). `node
tendencies.mjs` writes `tendencies-nfl.json` (3.9 MB walk-forward table,
gitignored) and `tendencies-data.js` (105 KB, committed, the current
profiles for the page; the NFL refresh workflow rebuilds it daily and
caches `nflverse/`). Three definitions to know: a dropback is `pass ===
1` (sacks and scrambles included); inside/outside run shares are of the
classifiable runs; any rate under 20 plays is null. College has no
tendencies (cfbfastr has play-by-play; not built).
**Does any of it predict the props?** `experiment-tendencies.mjs`
replays the counting props walk-forward (it reproduces the backtest to
four decimals) with each candidate as a multiplier on the projection at
strength 0 / 0.5 / 1: the defence's yards-per-carry and yards-per-dropback
allowed, pass success rate allowed, explosive-pass rate allowed, pass and
run share faced, plays per game (theirs and the offence's own), the
closing spread as game script, the closing total. **Nothing shipped.**
Full strength is worse than half in 105 of 105 stat–candidate pairs, and
the strength sweep's winners sit at its low edge, which is a signal
drowned in the variance it adds. The one interior optimum is
`defSuccPass` at 0.5 on receiving yards (Brier −0.0004, both seasons,
Δ/SE −2.9) and receptions (−0.0005, −3.6) — the two props that carry no
opponent factor today. That is a quarter of the opponent factor's gain
and would make the board's numbers depend on a daily play-by-play
download, so it is recorded here, not wired in. Re-run it when 2026 is
a full season; if it clears on three, put it in `allow` beside the yards.
Explosive-pass rate allowed at full strength is emphatically wrong
(+0.005 / +0.007, Δ/SE +10 / +14): a defence that has given up big plays
is not one that will. The matchup panel on the game view is descriptive
and says so on its footer.

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

**Three more counting props, 2026-09-08.** Rushing yards, passing yards
and receptions join receiving yards as one table, `STATS` in `nfl.js`:
total, opportunity, prior, gate, pool floor. `statEligible(stat, rec)` is
the one gate; `yardsEligible` is its receiving row. `fetch-football.mjs`
writes `pools` (one per stat; `yardPool` is gone), `football-board.js`
grows a view per stat from the table, `track-football.mjs` records and
settles all four (`settlePlayer`), `backtest-nfl.mjs` replays all four and
prints each season alone. Passers now enter the players file at the passing gate's own
attempts (`passMinOpportunity`, 40), which also lets them into the
touchdown view; the replay's touchdown population never had a touches
gate, so nothing new is being claimed there. Every threshold a stat's
gate reads is a `DEFAULTS` key named on its `STATS` row, so a league can
bind its own; college inherits the NFL's for the three new props, which
is what was measured.

The pool floor was the finding. Each pool began as receiving's (three
games, expectation at least a quarter of the floor). Rushing ran 6.8pp
cold in the NFL and 8.6 in college on that: under 20 expected rushing
yards the pool is quarterbacks' scrambles and end-arounds. The rushing
pool floor is now **20, the board's own floor**, in both leagues (NFL
+1.2pp, college +0.9). The same rule on passing and receptions made both
worse, so it is not a rule. College passing needed its own floor, **75,
half the board's** (a quarter read −6.1pp; college has a mop-up backup
pool). README "Three more counting props". Passing yards is the prop to
hold loosely in both leagues: too timid at both ends, and the NFL seasons
sit 4pp apart. First rows for the new props are in the record files
dated 2026-09-10 (NFL) and 2026-09-11 (college).

The session before this one was cut off with the code written, the
comment claiming the floors were "chosen on the replay", and the replay
not yet run at those floors (`tasks/lessons.md`, "A comment is not a
measurement").

**The opponent's defence, 2026-09-08, later.** Every counting-prop
projection now carries the opponent: `teamFactors[team].allow[stat]`
from `seasonLines`, applied by `statOppFactor` at a per-stat strength
(`rushOppShrink`, `passOppShrink` 0.5; `yardOppShrink`, `recsOppShrink`
0) inside `statEligible`, which takes a `ctx.oppFactor` and returns
`{exp, base, oppFactor}`. The gate is `base`, the player's own season.
Replay table in `nfl.js` and README "The opponent's defence": rushing and
passing gain a thousandth of Brier at half strength in both leagues,
receiving and receptions nothing or worse. The rows recorded earlier
today for this week carry the pre-opponent projection; first prediction
wins.

**Review fixes on the opponent factor, 2026-09-08, late.** One
`opponentIn(game, player)` (null for a team code on neither side; the
old two-way lookup handed such a player the home defence), one
`allowOf(teamFactors, team, stat)`, and one `projectedStat` that
`statEligible` returns and both pools divide by. Pool membership is the
player's own level again; college's 0.5 column moved to 0.2321 / 0.1779.
`yardsEligible` forwards `ctx`. `dom.test.mjs` now asserts every
`statEligible` caller passes the opponent and both pools divide by
`projectedStat`. The board's own `allowFor` still exists; swap it for
`N.allowOf` when next in that file.

**Design review of the NFL board, 2026-09-08, late.** `/design-review`
(gstack) on nfl.html: fourteen findings, twelve fixed in one commit each
(`style(design): FINDING-NNN`), all CSS or board-script only, shared by
cfb.html. Twenty rows then "Show N more"; board links under the brand,
bet types scroll on phones; caret kept on phones; 44px controls on
touch; the honesty numbers behind a "How it was checked" disclosure; the
odds column dims at the Projection line where every player prices the
same; game rows lead with the side; Q is a tag; badge colours on tokens;
`color-scheme: dark`; prose sizes up a step. Deferred: the five pages'
stylesheets have drifted (golf/baseball/bets forked the boilerplate) and
want one shared board.css, and system-ui as the body face is a taste
call. Report and before/after shots:
`~/.gstack/projects/BetHouse/designs/design-audit-20260908/`. Baseline
design score B−, AI-slop A.

**Parlays on every leg, 2026-09-09, later.** The slip draws on every
kind of leg (touchdowns, the counting props at the line setting, spread
and total), with a "Legs" toggle per kind. `--parlay` replays every leg
the boards offer; the first two measurements were wrong (a "same team"
population that mixed all-one-team with some-share; early-week pools of
a dozen entries reading as 91% overs) and the README table is the third.
Classes in `parlay.js`: none / game / mixed / team / player. Shipped
lifts: NFL `{game:1, mixed:1, team:0.85, player:1.3}`, college
`{1,1,1,1.3}`; `parlayProps` is all seven. Recorded slips carry a `tag`
("td" for the first week's touchdown-only slips, "all" after) in their
key, so both are rows. The slate's top picks cashed 0.55-0.72x on 32
weeks: the top of the board runs hot; no correction fitted.

**Suggested parlays, 2026-09-09.** `parlay.js` (shared, tested:
`combineLegs`, `suggestParlay` with a slate or one-game scope and a
measured lift) and controls on the football boards' touchdown view: 3/4/5
legs, "All games" (one leg per game) or "One game" (a game picker). The
replay (`backtest-nfl.mjs --parlay`, README "Suggested parlays") found
same-TEAM touchdown slips cash ~0.80× the product in the NFL, the
opposite of baseball's same-game intuition; cross-game and mixed-team
about 1. Shipped `parlayLift: {game:1, team:0.85}` in nfl.js, `{1,1}` in
cfb.js; only `td` is parlay-eligible (`parlayProps`). The tracker records
the slips the board would suggest (`day.parlays`, first wins), settles
them from their legs (`gradeParlays`), and the footer shows the parlay
record when there is one. First rows: NFL 2026-09-10, college 2026-09-11.
Not done: manual add-to-slip on football rows, "I bet this parlay" into
the bet log (bets.js legs are keyed for baseball's record), baseball
switching to the shared module.

**Search, 2026-09-09.** A "Find" box on the football boards (`#q` in
nfl.html / cfb.html) filters the touchdown and counting-prop views by
player, team or opponent — `playerMatches` in `nfl.js`, tested: words in
any order, case, dots and accents ignored. A search shows every match,
not the first twenty; the game view hides the box; "/" focuses it. The
baseball board has its own page script and no search yet.

**Rosters, 2026-09-09.** A.J. Brown was on the Eagles' board in week 1
after joining the Patriots: a player's team was the team of his last box
score, which is last season's team until he plays a game. Now every
board build fetches every team's roster (`teamsUrl` / `rosterUrl` in the
league table; college uses its membership ids), `parseRoster` /
`applyRosters` in `nfl.js` put each player where the roster says and
drop anyone on no roster (retired, released, unsigned, graduated).
First build: NFL 137 moved, 93 dropped (430 → 386 board players);
college 344 moved, 2,824 dropped (1,836 → 1,026). A partial roster fetch
moves nobody rather than dropping a failed team's players. The panel
says "now NE — every number here is from his PHI games". The week-1
rows recorded before this under the old teams stay as recorded and will
void at grading (the player is not in that game's box score); the moved
players were re-recorded in their real games the same day.

**One stylesheet, 2026-09-08, late (FINDING-014).** `board.css` holds
what the five pages used to copy; each page keeps only its own rules in
a short `<style>` after the link (baseball 173 lines, bets 84, golf 15,
football 8). Drift reconciled to the football values: title 16px, big
figure 22px, meta 13, note 15, name 15, panel prose 14, segments 14,
golf's row grid 30/74. Proved by diffing computed styles on every page
before and after: only those properties moved. `dom.test.mjs` now reads
the sheet, asserts every page links it and none re-declares its core
rules or `:root`. To change a shared rule, edit `board.css`; to override
one on a page, repeat the selector in that page's block.

**Design review, second pass (baseball, golf, bets), 2026-09-08, late.**
Four cross-page fixes, one commit each (FINDING-015..018): board links
under the brand on every page, 44px touch targets everywhere (the
baseball row's ○ and + were 28px), `color-scheme: dark`, and the caret
kept on phones (baseball's three mobile row grids gained a fifth
column). Baseball's expanded panel is the model the football panels now
follow. Still deferred: one shared board.css.

**Readability pass on the counting props, 2026-09-08, late.** The prop
rows lead with the projection (yards or catches), then the over chance
and fair price; the line sits beside the matchup. A `soft D` / `tough D`
badge shows only where the opponent is applied and the allowance is 7%+
either side of average. The panel is two paragraphs: the decision (over
X hits Y%, fair Z, bet only if the book beats it) and the arithmetic in
plain words (averages, regressed to, opponent adds/takes off, projects
to). No constants on the page; nfl.js and the README carry them. Shot
at 1200 and 390 wide, `.playwright-mcp/` (gitignored). The touchdown and
game views are untouched; the same treatment is owed to them.

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

- **No parlay forward record on the baseball board.** The football trackers
  record the suggested slips since 2026-09-09; `track.mjs` still records
  single legs only.
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
