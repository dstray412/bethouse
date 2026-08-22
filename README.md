# BetHouse

Ranks MLB hitters for three props, every game, every day: **1+ hits/runs/RBI**,
**total bases** (2+, 3+, 4+), and **home runs**. Ranks PGA Tour players by their
chance of **making the cut**. And prices three NFL bets: **anytime touchdown**,
**receiving yards**, and **spreads and totals**.

Open `index.html` for baseball, `golf.html` for golf, `nfl.html` for football.
No build step, no server, no API key.

---

## What it is

A daily board. For each game it shows the hitters most likely to hit the bet,
and the chance that they do. Name, number, nothing else.

Tap a player for the detail: the fair price, the plate appearances his lineup
slot buys, how much his rate was regressed, and every adjustment applied.

Click any row and it shows its work: the plate appearances the lineup slot
buys, the player's season line, how much his rate was regressed toward league
average, the opposing starter's adjustment, and the arithmetic.

Home run rankings are in there too, on a toggle.

## What it isn't

Not a pick service. The model is calibrated, which means when it says 72% it
means 72% — including the part where 72% loses more than a quarter of the time.

## Run it

```sh
node fetch-mlb.mjs      # builds mlb-data.js for today
node --test edge.test.mjs score.test.mjs golf.test.mjs nfl.test.mjs   # 202 tests
node backtest.mjs --prop tb2               # validate total bases
node backtest.mjs                          # measures whether the model works
node backtest.mjs --parlay                 # ...and whether parlays multiply
node backtest.mjs --streaks                # ...and whether hot streaks mean anything
```

That's it. `statsapi.mlb.com` is open: no key, no account, no rate tier. A full
slate costs **five requests**:

1. today's schedule, posted lineups, probable pitchers
2. the last 5 days of lineups (fallback batting order before lineups post)
3. every hitter's season line (`playerPool=ALL`, ~680 players)
4. every pitcher's season line
5. team offense, for run and RBI context

Lineups appear in the API as they post, usually 3-4 hours before first pitch.
Before that the board projects the batting order from the team's most recent
game and labels it **PROJECTED** in orange. Once real, it turns green.

---

## Does it work?

`backtest.mjs` replays completed games. For each hitter in each posted lineup
it scores him using **only what was known before that game**, then checks
whether he actually cashed.

The no-lookahead trick: a box score carries both the player's line for that
game and his season line *through* that game. Subtract one from the other and
you get his line **entering** the game. Using end-of-season stats to "predict"
a July game would inflate every number and make a broken model look great.

**Out-of-sample results** (Jul 12-25, 2,466 hitter-games, fitted on a different
week entirely):

| | |
|---|---|
| Calibration bias | **+0.01pp** |
| Brier score | 0.2188 |
| Top 20% cashed | 73.6% |
| Bottom 20% cashed | 60.0% |
| Spread | 13.6pp |

Every probability bucket landed within 1.7 points of reality. The ranking
separates: the players it likes cash 13.6 points more often than the ones it
doesn't.

### The finding that matters most

| slice | actually cashed | break-even price |
|---|---|---|
| top 2% | 75.5% | **-308** |
| top 10% | 74.4% | -290 |
| top 20% | 73.6% | -279 |
| every starter | 67.0% | -203 |

Books price this prop around **-250 to -350**. So the model's very best pick is
profitable at -250, roughly break-even at -300, and a guaranteed loser at -350.

And being pickier barely helps: top 2% and top 10% are within a point of each
other. There is a hard ceiling around 75% on this bet type, and no amount of
model quality moves it.

**The edge is in the price, not the pick.** That is what the odds half of this
project (`edge.js`, `fetch-odds.mjs`) is for, and it is why the two halves need
each other. The model tells you who; the de-vig engine tells you whether the
number on offer is good enough.

---

## The model

Three things drive this prop, in order:

1. **Plate appearances.** Leadoff gets ~4.65 trips, ninth gets ~3.81. A .260
   hitter batting first clears this more often than a .290 hitter batting
   eighth. Lineup slot matters more than talent.
2. **On-base skill**, regressed. A call-up who is 5-for-9 is not a .556 hitter,
   he is a small sample. Every rate blends toward league average weighted by
   plate appearances (`K = 180`). Without this the top of the board is always
   whoever went 2-for-3 in his debut.
3. **Context.** The opposing starter's opponent average and the offense around
   the hitter, both clamped so a six-start sample can't dominate.

### The correlation constant

The prop cashes on a hit **or** a run **or** an RBI. Treating those as
independent is wrong and optimistic: you usually score *because* you got a hit.
`score.js` exposes that as `k`:

- `k = 0` — only hits count
- `k = 1` — full independence

The first version guessed `k = 0.55` and ran **13 percentage points hot**. It
said 82% where reality was 69.5%. Betting that at -300 would have felt like
value on every line and lost steadily.

`backtest.mjs --fit` swept k against real outcomes and found **0.05**. Runs and
RBI add almost nothing beyond hits. That number is fitted, not guessed, and it
should be re-fitted when the run environment shifts.

---

## Files

| File | What it does |
|---|---|
| `index.html` | The board. Open it. |
| `score.js` | The model. Loads in both browser and Node so the app, tests and backtest run identical code. |
| `score.test.mjs` | 43 tests on model shape, clamping, regression, handedness and the total-bases distribution. |
| `fetch-mlb.mjs` | Five keyless requests to statsapi → `mlb-data.js`. |
| `backtest.mjs` | Replays real games, measures calibration, fits `k`, and tests parlays (`--parlay`) and hot streaks (`--streaks`). |
| `track.mjs` | Records each day's pregame predictions, grades them once games end, keeps the running record. |
| `edge.js` | De-vig and EV math for the odds side. 36 tests. |
| `bets.js` | Your bet log, singles and parlays. What you tracked, how it graded, and how that compares to what the model said. 46 tests. |
| `bets.html` | The history: every bet, won and lost, grouped by day, with win rate by kind of bet. Open it. |
| `fetch-odds.mjs` | The Odds API client. Needs a key; not required for the board. |
| `golf.html` | The PGA board: who makes the cut. Open it. |
| `golf.js` | The cut model. Two-way ratings solve plus a field-wide Monte Carlo. |
| `golf.test.mjs` | 41 tests on cut rules, the ratings solve, ties and the simulation. |
| `fetch-pga.mjs` | Keyless ESPN requests → `pga-data.js` and `pga-history.json`. |
| `backtest-pga.mjs` | Replays completed tournaments, measures calibration, fits the constants. |

## Sharing it

There is no secret in this project, so a public repo works: statsapi needs no
key, and `mlb-data.js` is just public baseball stats. That means free GitHub
Pages and unlimited Actions minutes.

`.github/workflows/refresh.yml` re-fetches every 30 minutes through the game
window, sanity-checks the result, runs the tests, and only commits if the board
changed and everything passed. Pages serves it, so anyone with the link always
has a current board.

Keep `.env` and `.odds-quota.json` ignored — those belong to the odds side.

---

## Total bases

Total bases needs a different kind of model. The other two props ask a yes/no
question about a rate; this one asks *how many*, so you need the distribution
of what each plate appearance produces and then the distribution of the sum.

Each trip yields 0, 1, 2, 3 or 4 bases. Convolving that across the trips a
lineup slot buys gives the exact distribution. No normal approximation, no
fudge factor.

**1+ total bases is not offered, because it is the same bet as 1+ hits** —
every hit is worth at least one base. The board starts at 2+.

That identity is also a useful tripwire, and it caught a real inconsistency.
`P(1+ total bases)` computed from the distribution disagreed with
`P(1+ hit)` computed from the rate, by 0.26pp. The cause: a hitter gets 4
trips or 5, never 4.54. The distribution model convolves over whole trips by
construction, while the older code raised to a fractional power. The mixture
is right and the power form was the approximation, so `mixPow` now handles it
everywhere and a test asserts the three models agree.

### Out-of-sample results, 2+ total bases

| | |
|---|---|
| Base rate | 35.4% |
| Calibration bias | **+1.10pp** (runs slightly hot) |
| Brier | 0.2266 |
| Top 20% cashed | 41.2% |
| Bottom 20% cashed | 27.4% |
| Break-even price, top 20% | **+143** |

That last number is the interesting one. The H+R+RBI prop needs -300 and tops
out at 75.5%, so it is unbeatable at standard juice. 2+ total bases prices
around +130 to +180, and the model's top slice needs +143. **This is a market
you can actually reach**, which the other one is not.

The board says it runs a point hot, so shade it down.

## Plate appearances were a guess, and the guess was wrong

`PA_LEADOFF` and `PA_DECAY` started as reasonable-looking numbers I made up:
4.65 trips for the leadoff hitter, losing 0.105 per slot. The total-bases
backtest exposed them, because it predicted 1.575 total bases per game against
an actual 1.432 — a 9% over-prediction.

Measured over 2,465 real starts:

| slot | actual PA | old guess | gap |
|---|---|---|---|
| 1 | 4.486 | 4.650 | −0.164 |
| 5 | 4.000 | 4.230 | −0.230 |
| 9 | 3.419 | 3.810 | **−0.391** |

Fitted: `PA_LEADOFF = 4.536`, `PA_DECAY = 0.1326`. Both guesses were wrong in
the same direction and the error compounded down the order. Real starters get
pinch-hit for, subbed out and caught by short games, so the true curve sits
below a full-game assumption and falls away faster.

Fixing it cut the total-bases bias from +3.11pp to +1.10pp, and moved the
fitted correlation constant for H+R+RBI from 0.05 to 0.10 — k had been quietly
absorbing the plate-appearance error.

---

## Handedness and home/away

Both are applied, and both are **measured from this season, never assumed**.

### The pooled number is a trap

Comparing all batters vs LHP against all batters vs RHP shows a +1.6% effect.
That number is worse than useless, because it points the wrong way for half
the league. Split by batter handedness and the real picture appears:

| batter | vs LHP | vs RHP | platoon |
|---|---|---|---|
| Right-handed | .2309 | .2201 | **+4.9%** |
| Left-handed | .2219 | .2303 | **−3.6%** |
| Switch | .2243 | .2154 | +4.1% |

Righties hit lefties better, lefties hit righties better. Switch hitters follow
the righty pattern against LHP because that is the side they bat from.

### On this prop it barely matters, and the backtest says so

The full platoon swing on 1+ H/R/RBI, facing a lefty versus a righty, is worth
**about 1.0 percentage point**. Lineup slot alone is worth ~5. So:

```
without splits:  Brier 0.21876   bias +0.01pp
with splits:     Brier 0.21884   bias +0.01pp
delta:           no measurable difference
```

They are kept because they are correct and cost nothing, not because they help.
Over a two-week window the platoon signal even **reverses** (righties cashed
68.7% vs RHP against 64.9% vs LHP) — the season-long effect is real, but it is
far smaller than the noise in any window you could validate on.

### On home runs it matters enormously

| batter | HR/PA vs LHP | vs RHP | platoon |
|---|---|---|---|
| Right-handed | .0323 | .0324 | −0.3% |
| **Left-handed** | .0282 | .0398 | **−29.1%** |

Lefty-on-lefty power suppression is roughly six times the size of the hits
effect, and it is the reason home runs get their own platoon table
(`league.platoonHR`). Using the hits ratios there would understate the one
handedness effect that genuinely moves a home run bet by more than fivefold.

### Guards

- Player-specific splits need **60 PA minimum** and are then blended at
  `PA/(PA+600)`. A hot 40-PA line was moving the final probability 0.86pp,
  nearly the size of the entire league effect. Forty plate appearances should
  not get that much say.
- An own-split multiplier outside `[0.4, 2.5]` is **refused, not clamped**. A
  units mismatch (hit counts against a home-run rate) lands near 4.4; clamping
  that produced a confident 1.35 in a matchup whose true value is 0.75, pointing
  the wrong way. Falling back to the league value is the honest failure.

---

## Games already in progress

The board used to show pregame projections all day, including for games that
had already started. On a normal afternoon that is most of the slate: at one
check, ten of fifteen games were underway and every one of them was still
being shown a pregame number.

That is not a cosmetic problem. A 44% chance of 2+ total bases assumes four or
five trips to the plate. A hitter who has had two, with nothing to show for
them, needs the same result from what is left, which is a much worse bet.

So the fetcher pulls a live box score for every game underway (one extra
keyless request each), and the model conditions on it:

- **Already cashed** shows `HIT` rather than a probability. The bet is decided.
- **No trips left and no result** shows `NO`.
- **Otherwise** the number is recomputed on remaining plate appearances only,
  and for total bases the bases already banked are subtracted from the
  threshold. A hitter with a single needs one more base, not two.

Game state appears on each card: the inning for a live game, `DELAYED`, or
`FINAL`. Settled bets are ranked below live ones so they do not consume the
top-N slots, but they stay visible so you can see how a placed bet is doing.

One caveat worth knowing: a delayed game may not resume. The board marks the
delay but cannot tell you whether those remaining plate appearances will ever
happen.

---

## The running record

`backtest.mjs` answers "does the model work on history." `track.mjs` answers a
harder question: does the board you actually look at, with the lineups posted
at the time, keep holding up going forward. That is the one test a model
cannot quietly pass by having been tuned to the data.

```sh
node track.mjs snapshot     # record today's pregame predictions
node track.mjs grade        # grade any recorded day whose games are final
node track.mjs report       # print the running record
```

The scheduled job does all three every run, so it accumulates on its own.

### Two rules that keep it honest

**First prediction wins.** Once a player is recorded for a day he is never
overwritten. Without this the every-30-minutes refresh would keep updating
him, and by the 7th inning the board would be "predicting" a bet it can
already half see the answer to. Graded that way the model would look superb
and prove nothing.

**Pregame only.** Nothing is recorded once a game is underway, and nothing is
recorded off a projected lineup. A projected lineup is a guess about who is
even playing; grading it would measure the guess rather than the model.

**Scratches are dropped, not counted.** A player in the lineup at snapshot
time with no batting line was scratched before first pitch. That is not a
model miss, so it leaves the sample instead of being scored as a loss.

### No backfilling, on purpose

It would be easy to seed months of history by replaying old dates, and it
would be worthless. Season stats today include what happened on the day being
"predicted," so every backfilled number would carry lookahead bias and the
record would look far better than the model is. The record starts empty and
only moves forward.

Each graded day lands in `history/YYYY-MM-DD.json`, and `record.js` carries
the summary the board displays. Expect it to say nothing useful for a while:
bias only means something once the sample is in the thousands.

---

## Your bets

The running record above is the *model's*. This is yours, and it lives on its
own page — **`bets.html`**, linked as **Bets** from every board.

Tap the **circle** on any row before first pitch and that pick goes into a log
in your browser. Nothing is sent anywhere, there is no account, and it works on
all three bet types. Tap again to remove it.

For a parlay, build or suggest one and press **I bet this parlay** on the slip.
The slip is a calculator until you say otherwise; that button is the moment it
becomes a wager, and it is the only way a parlay enters the log.

### Bets you placed on a past day

Pick a date from **Day** and the board is redrawn as it stood then — every
player it showed, the model's number at the time, and the result. Tap circles
and build parlays exactly as you would today. There is nothing to type.

That works because `history/<date>.json` already holds all of it, written by
`track.mjs` on every refresh for as far back as the running record goes. The
day list comes from `record.js`, which is already on the page, so the feature
added no new generated file and no new request on load.

Two things are deliberately absent on a replayed day. There is no reasoning
panel, because history does not store the opposing pitcher or the handedness
split and inventing one would be worse than omitting it. And there is no
**Suggest a parlay**: "the best bet still available" is not something you can
offer for a slate that already finished. Building one by hand still works,
because that is what you did at the time.

Grades arrive on their own. `track.mjs` already writes `history/<date>.json` on
every refresh with the real outcome for every player it snapshotted, on all five
props, so a pick you tapped is already in that file and settles within about
half an hour of the game ending. The board fetches a day only while that day
still has something unsettled, so a finished day is fetched once and never
again.

**A single is a parlay with one leg.** That is the actual data model, not a
turn of phrase: one shape, one grading path, one summary. A parlay is stored
with all its legs and the combined number the slip showed you at the time —
not a recomputation from legs the model has since revised, which would compare
your decision against evidence you never had.

A parlay **dies on the first missed leg** and settles immediately. A 3.05pm leg
that missed has already decided a slip whose other legs are 10pm starts, so
holding it OPEN for another seven hours would be withholding a result the board
already knows. It pays only when every leg is in and every leg hit, and the
panel lists the legs so a MISS says which one killed it.

The panel then says the only thing it is in a position to say:

> Your picks hit 6 of 10. The model expected 6.6 from those same 10. That is
> −0.6 against a spread of 1.5 — inside the noise, which is what almost every
> honest sample this size looks like.

### The history page

`bets.html` is the whole log: every bet grouped by day, newest first, won and
lost, with each parlay's legs underneath so a loss names the leg that killed
it. Filter by result (won / lost / open) or by kind (straight / parlay).

**The record does not move when you filter.** It is summed over every bet in
the log, always. A win rate that climbs when you click "Won" is not a record,
it is a mirror.

The board keeps only what is useful while you are still betting: what is riding
right now, one line on how the record stands, and a link here. Two full copies
of the same list would be two things to keep in step.

### Win rate by kind of bet

The table under the record is the point of keeping one:

```
                          WON      RATE   MODEL SAID
Straight                  2 of 6   33%    73%   −2.4
Parlay                    0 of 1    0%    43%   −0.4
1+ H/R/RBI *              4 of 9   44%    74%   −2.7
Entered after the result  2 of 7   29%    69%   −2.8
```

`MODEL SAID` is what the board expected from those same bets, and the number
beside it is the gap. A good row is one that **beat** its expectation, not
merely one above 50% — a 73% straight book that comes in at 33% is a bad run
however healthy the raw rate might look on some other prop.

Prop rows count **legs**, not wagers, so a three-leg slip contributes three of
them and the prop rows will not add up to the straight and parlay rows above.
The table says so too.

### The spread assumes your bets do not overlap

Adding variances treats the bets as independent of each other. Bet a single on
a hitter *and* a parlay containing him and they are anything but — those two
outcomes move together, so the spread is narrower than the truth. The panel
cannot fix that honestly without modelling the joint distribution, so it counts
the shared players and says so.

### What it deliberately does not do

**There is no stake and no price.** So it cannot tell you whether you made
money, and it does not pretend to. It answers the narrower question the rest of
this board is built around: did your picks land as often as the model said they
would. Adding price would let it answer the money question and also the better
one — whether you beat the closing line — but that needs a closing-price
capture that does not exist yet.

### Three rules that keep it honest

**After-the-fact entry is marked, not forbidden.** The first version refused any
bet on a game that had started, borrowing `track.mjs`'s pregame-only rule. That
rule exists to stop the *model* grading itself on lookahead; applied to your own
log it was simply wrong, because it made writing down a bet you actually placed
impossible. Anything entered once the result was known carries a flag and gets
its own row in the breakdown — a fact about the entry, not a suspicion about
you, and the record needs it to keep meaning anything.

**First grade wins.** Once a pick has settled it is never rewritten, so
rebuilding a history file cannot turn a loss into a win.

**Expectation covers exactly the graded picks.** A pending 90% bet counts toward
neither "hit" nor "model expected". Letting it count toward one and not the
other would make every open slate look like a losing one.

### It is in your browser, so keep a copy

`Export` writes the whole log out as JSON; `Import` merges a file back in,
grades and all, and cannot overwrite an outcome you already hold. Clearing site
data clears the log, which is what Export is for.

## The parlay checker

Tap the **+** on any row to add it to a slip. The slip shows the combined
chance, the price that would be fair, and, if you type in the price you are
being offered, your edge at that price.

### Suggest a parlay

Or let it build one. **Suggest a parlay** takes 3, 4 or 5 legs and fills the
slip with the best hitter from that many *different* games.

Different games is the whole constraint. Two hitters in one game rise and fall
together, and that correlation has never been measured here, so the suggester
takes at most one hitter per game and **refuses outright** when the board does
not have enough open games to fill the slip. Handing back a two-leg slip when
you asked for three would be answering a question you did not ask.

It is offered on **1+ H/R/RBI only**. That is the prop whose single legs went
through the backtest and the only one whose parlays did.

**It ranks by chance to cash, not by value.** It cannot see a price, so it
returns the slip most likely to win, which is not the slip most likely to be
worth betting. Those come apart whenever the book prices favourites properly,
which is most of the time.

### What multiplying does and does not tell you

The product of the legs is the easy part. Being clear about what it is not is
the whole point, so the slip classifies rather than silently swallows:

| legs | correlation | what the slip says |
|---|---|---|
| Different games | slight, positive | measured: cashes 1.03-1.08x the product |
| Same game, different hitters | moderate | true chance is somewhat higher |
| Same player, different props | **severe** | the number is meaningless |

**Same player** is the trap worth naming. "1+ hit/run/RBI" and "2+ total
bases" on one hitter are close to the same bet. If he goes 0-for-4 they die
together. Independence there is not an approximation, it is wrong.

**Same game** is subtler. A slugfest lifts everyone in it and a shutout buries
them, so the true joint chance is *higher* than the product. That sounds like
free money and is not: books price same-game parlays with a correlation
adjustment that normally takes back more than the correlation is worth. How
much more has not been measured here, so the slip says so rather than guessing
at a correction.

### That used to be unmeasured. It is not any more.

`node backtest.mjs --parlay` replays real days, builds slips from pre-game
information only, and checks whether all the legs actually landed together.

**Does multiplying work?** Sampling cross-game slips from all over the board,
400 a day across 21 days:

| legs | slips | predicted | actual | actual/predicted |
|---|---|---|---|---|
| 3 | 8,400 | 29.3% | 30.3% | **1.031** |
| 4 | 8,400 | 19.5% | 21.1% | **1.084** |
| 5 | 8,400 | 12.9% | 13.8% | **1.069** |

Multiplying is sound across games, and if anything slightly **conservative** —
cross-game slips cash a few percent more often than the product says. That is
what a shared scoring environment looks like: a night when the ball is flying
lifts every game at once, so even hitters in different stadiums are faintly
correlated. Sampled slips share legs, so read the ratio as an estimate, not a
precision.

**Would the suggested slip have cashed?** This is the uncomfortable one:

| legs | slips | expected | cashed | hit rate |
|---|---|---|---|---|
| 3 | 21 | 52.2% | 8 | 38.1% |
| 4 | 21 | 41.0% | 6 | 28.6% |
| 5 | 21 | 32.0% | 5 | 23.8% |

One slip a day is 21 trials, and 8 against an expected 11 is about 1.3 standard
deviations — noise, formally. But all three sizes miss in the same direction,
and the single-leg calibration says why: **the top of the board runs hot.**

| bucket | predicted | actual | gap |
|---|---|---|---|
| 60-65% | 62.7% | 63.3% | -0.6pp |
| 70-75% | 72.3% | 71.5% | +0.8pp |
| 75-80% | 76.9% | 74.0% | **+2.9pp** |
| 80-85% | 81.1% | 78.0% | **+3.1pp** |

The model is well calibrated through the middle and about three points
optimistic at the top — and a suggested slip is made of nothing but the top.
Three legs of that compounds. The top 2% of the board cashed **67.7%**, worse
than the top 10% at 74.3%.

**No correction is applied.** Fitting one to three weeks of overlapping data is
exactly how `k = 0.55` happened. The board reports the honest arithmetic and
tells you to shade it down. Re-measure with `--parlay` when the record grows.

Note what this does *not* justify: picking worse hitters. An 81% leg that truly
cashes 78% still beats a 74% leg. The selection rule is right; it is the
printed number that is generous.

### The arithmetic is unforgiving

Three legs at 63%, 47% and 58% combine to **17.2%**, which needs +481 to break
even. Four decent legs land under 13%. The suggester will build you one of these on request, and the
arithmetic does not care that you asked nicely: the vig compounds faster than
any edge the model can find.

---

## Does a hot streak mean anything?

Every prop-trend site leads with the same thing: a player who has hit this
bet in ten straight games, a "100% cheatsheet", a hit rate against tonight's
opponent. It is the most intuitive idea in betting and it is worth exactly
one afternoon to check.

`node backtest.mjs --streaks` replays real days, and for every hitter tracks
how many games in a row he had already cashed **before** the one being
predicted. 30 days, 405 games, 7,037 player-games.

### The number they sell you

| current streak | n | actually cashed |
|---|---|---|
| 0 — missed last game | 2,570 | 66.1% |
| 5-7 straight | 557 | **72.7%** |
| 10 or more | 110 | 71.8% |

Six and a half points. Looks like free money.

### The number that survives

It is the wrong comparison. Hot players cash more *because they are better
players*, and the model already knows that — it has their season rate, their
lineup slot and their matchup. Asking whether the streak helps means asking
whether a hot player beats **what he was already expected to do**.

```
raw gap between hot and cold      +3.9pp
of which the model predicted      +2.6pp
LEFT OVER FOR THE STREAK          +1.36pp   (se 1.97pp, z = 0.69)
```

**Two thirds of a hot streak is just "good hitters hit."** What is left is
1.36 points with a standard error of 1.97 — indistinguishable from zero.
Resolving an effect that small would take about 9,000 games per group; this
has 797.

The bucket-by-bucket breakdown is the giveaway. Holding the model's
probability fixed, the hot-minus-cold edge runs **+4.7, −3.6, +5.7, −0.1,
+10.7**. No pattern, no direction, no monotonicity. That is what noise looks
like when you slice it five ways.

### Why it was never going to work

A streak is visible to everybody. A hitter on a ten-game run is priced at
−141 *because* of the run. The information is in the number before you get
there, which is the same reason the NFL spread model here cannot beat a
closing line.

There is also a selection problem baked into the cheatsheets. Searching a few
hundred hitters across several prop types and several splits — overall, versus
opponent, home, away — is thousands of combinations. At a true 70% hit rate,
**roughly a hundred of them go 10-for-10 on chance alone.** A list of players
who have hit ten in a row is partly a list of good hitters and partly a list
of coin flips that landed heads ten times.

### What this does not prove

One prop, one 30-day window, and the thing doing the controlling is this
model — a worse model would leave a bigger residual and a better one might
leave none. It says the streak adds nothing *this model has not already
priced*. That is the only version a bettor can spend.

---

## Three things that turned out not to matter

The project keeps a list of ideas that sounded good and did not survive being
measured, because knowing what to ignore is worth as much as knowing what to
use. Each was tested the same way: not "does it correlate", but **does it move
the residual** -- what a group beat its own prediction by. A signal is only
worth what it adds to the number you would otherwise have used.

| idea | test | verdict |
|---|---|---|
| Hot streaks | `--streaks` | +1.36pp, z = 0.69 |
| Wind, direction | `--weather` | z = -0.18, 0.48, -0.63 |
| Wind, strength | `--weather` | z = -1.57, -0.59 |
| Opponent team defence | `--defense` | z = 0.16, -0.28 |
| Temperature | `--weather` | real, but see below |

**Opponent defence** deserves a note because the raw spread is so tempting.
Team opponent-AVG runs from about .218 to .288 across a season, several times
wider than the handedness effect the board already shows. It adds nothing:
across 7,291 player-games the leakiest defences beat their prediction by
0.23pp more than the stingiest, z = 0.16, with no monotone pattern in between.
The opposing STARTER is already in the model, he faces the hitter for two
thirds of his trips, and team run prevention is mostly the rotation. The
bullpen and the fielders are real, and they are already priced.

**Temperature** is the one that is real and still not shipped: the residual
gradient replicates across two windows that share no games (+4.63pp, z 2.84 in
April; +3.32pp, z 1.68 in August, on home runs) and is correctly absent from
H/R/RBI, which is a contact prop. But a fitted correction helped one window
and hurt the other, so `TEMP_SLOPE` is zero. See the note in `score.js`.

---

## Golf: who makes the cut

`golf.html` is a second board, for the PGA Tour. Open it. Same deal — no build
step, no server, no API key. ESPN's golf API is as open as statsapi is.

```sh
node fetch-pga.mjs                    # builds pga-data.js + pga-history.json
node --test golf.test.mjs             # 41 tests
node backtest-pga.mjs                 # does it work?
node fetch-pga.mjs --event 401811961  # build the board for any tournament
```

### Why this model looks nothing like the baseball one

Every prop in `score.js` asks about one player alone: given his rate and his
trips to the plate, does he get a hit? Making the cut is not that question.
The cut is **low 65 and ties** — an order statistic of the entire field.
Whether a player survives depends on how the other 155 played, so the outcomes
are coupled and there is no closed form for one man's probability.

So `golf.js` simulates. Twenty thousand tournaments, all 156 players each
time, and count how often each man finished on the right side of wherever the
line happened to fall. That coupling is also what makes the bet interesting:
the same player is a different price in a Monday-qualifier field than in a
major, and the model gets that for free.

### Rating players

You cannot use scoring average. It cannot tell "this player is good" from
"this player drew the easy course in the calm wave". So solve both at once:

    score(player, round) = roundDifficulty(round) + skill(player)

Alternating least squares, with the player step ridged by `K` — the same
regress-toward-average idea as `K = 180` on the baseball side. A man who shot
64 once is not a −6 talent, he is a small sample.

Splitting difficulty out is worth a lot. By split-half reliability across 2026:

| rating method | r |
|---|---|
| raw differential vs the field, R1–R2 | 0.443 |
| this solve, R1–R2 | 0.581 |
| this solve, all four rounds | **0.684** |

Rounds 3 and 4 are included even though only players who made the cut have
them. A raw differential over the weekend is biased — the field left standing
is better, so the average to beat is tougher — but the round-difficulty term
absorbs exactly that, because it is fitted from whoever actually teed off.

### What the variance splits into

| | strokes per round | |
|---|---|---|
| true skill | 0.52 | who the player is |
| form and course fit | 1.03 | this week, shared across his rounds |
| noise | 2.71 | the part nobody can predict |

Those imply a 36-hole spread of 4.35 strokes against an observed 4.48. The
decomposition reproduces reality, which is the only reason to trust it.

Note the ratio. Over 36 holes the best player in a field is about two strokes
better than the median while the noise is nearly four. **Golf is mostly
noise**, which is why make-cut markets sit near even money and why nothing
here will ever print a 95% pick for a normal player.

### The bug that mattered: ties

The first version drew scores from a normal distribution and ran **5.75
percentage points cold**. The tell was the U.S. Open: it predicted 38.5% for
that field, which is exactly 60/156, the cut rule itself.

Golf scores are whole numbers of strokes. With continuous scores no two
players ever tie, so exactly `cutN` survive and "and ties" never fires. In
reality the field stacks up about fifteen players deep on each stroke near the
line, so whoever is sitting on the number brings a dozen friends to the
weekend. That U.S. Open sent **72** players through a low-60-and-ties cut.

Rounding the simulated score fixed most of it. The rest was shape: real
36-hole totals are right-skewed (+0.48) and more peaked than a bell (+0.69
excess kurtosis), and both pile players into the middle, which is where the
cut falls. So the model samples from the **real distribution** of 36-hole
scores rather than a normal — the same instinct as convolving the actual total
bases distribution instead of reaching for a normal approximation.

This is the golf version of the `mixPow` story: a continuous approximation
standing in for something that is discrete by construction.

### Debutants are not average

A player making his first start of the season played **1.07 strokes per round
worse** than the field and made the cut 37.7% of the time, against 57.4% for
everyone else. Monday qualifiers and sponsor exemptions are not average tour
players, and starting them at average was quietly handing free probability to
the weakest man in the field.

### Out-of-sample results

23 tournaments, 3,046 player-events, each predicted using only tournaments
that had already finished. Ratings, scoring shape and all:

| | |
|---|---|
| Base rate | 53.5% |
| Calibration bias | **−1.29pp** (runs slightly cold) |
| Brier score | 0.2284 |
| Brier, guessing the base rate | 0.2488 |
| Top 20% cashed | 72.9% |
| Bottom 20% cashed | 30.5% |
| Spread | **42.4pp** |

Every bucket from 20% to 80% lands within about 2 points of reality, except
one: **the very top of the board runs hot**. The players it likes most were
priced at 83.5% and cashed 73.8%. Trust the middle of this board more than the
top of it — the same "there is a ceiling on this bet type" finding the
baseball model ran into, showing up again.

### Cut rules

The tour standard is low 65 and ties; majors and signature events set their
own; playoff and limited-field events do not cut at all. The table in
`golf.js` was **wrong on first writing and the data caught it** — the
signature events were assumed to have no cut, but 2026 shows Genesis, Bay Hill
and the Memorial cutting 21, 22 and 19 players. They cut at 50. Check any
change the same way, by counting `STATUS_CUT` in `pga-history.json`.

Three formats are excluded rather than mis-modelled: the Zurich Classic (two-man
teams), the American Express and Pebble Beach (54-hole cuts across three
courses, so a round's "field average" is three different field averages).

On a no-cut week the board says so and shows the power ranking instead. A
column of 100%s is not a board, it is a trap.

---

## NFL

`nfl.html`. Three bets, and they did not all survive contact with the data.

```sh
node fetch-nfl.mjs --history   # 2 seasons of box scores + closing lines
node fetch-nfl.mjs             # ...then this week's board
node --test nfl.test.mjs       # 44 tests
node backtest-nfl.mjs          # does any of it work?
node backtest-nfl.mjs --fit    # re-derive the shrinkage constant
```

Two seasons replayed a week at a time: 544 games, 10,694 player-games, 543
closing lines. Everything predicting week W comes from weeks already played.

### The results, including the one that failed

| bet | measured | verdict |
|---|---|---|
| Anytime touchdown | bias **&minus;0.7pp**, Brier 0.1590 vs 0.1718 | calibrated |
| Receiving yards | bias **+1.0pp**, Brier 0.2223 vs 0.2459 | calibrated |
| Spread vs closing line | **48.1%** of 480, needs 52.4% | **no edge** |
| Total vs closing line | **52.5%** of 478, needs 52.4% | **inside the noise** |

The touchdown model separates hard: top 20% scored 39.1%, bottom 20% scored
9.3%.

**The game lines are the honest failure.** The NFL closing number is very good
— across 543 games the home side covered 49.7% and the line's average error was
0.37 points. The spread model lost to it and the total model landed a tenth of
a point over break-even, which is not a result: the 95% interval runs from 48.0%
to 57.0%. Separating a break-even model from a coin flip needs about **1,700**
bets and two seasons is 480. The board says so on the page rather than printing
a projection and letting you assume.

### Three bugs the data caught

**Live odds are lookahead.** ESPN's odds endpoint serves the closing line *and*
an in-play line for finished games. Eagles-Cowboys closed at PHI -7.5 with a
total of 47.5; the live entry says -4.5 and 44.5, because by then the game had
happened. Grading against that is grading against the answer.

**The spread's sign does not follow its own label.** `details` says "KC -3.5"
for a road favourite, but `spread` comes back **+3.5**, because it is always
home-relative. Reading the sign off the label would have flipped every road
favourite — about half the dataset — and produced a backtest that looked like
noise instead of like a bug.

**Averaging the input is not averaging the output.** The touchdown model ran
11.6 points hot at the top of the board. Not the usage model, which is
dead-on linear (a power fit converges to exponent 1.00), and not the Poisson
assumption, which matches within 3 points. It was feeding *season-average*
workload into a curved function: one game's workload divided by that player's
own average has a standard deviation of **0.55**, and `1 - e^-lambda` is
concave, so evaluating at the mean overstates by 4.9 points at lambda = 1 and
nothing at all at the bottom. Averaging over real workload swings fixed most of
it; a fitted 0.75 shrink toward the league average fixed the rest, and the top
bucket went from +11.6pp to -0.1pp.

That is the third time this project has made the same shape of mistake —
`mixPow` on the baseball side, continuous scores on the golf side. It is in
`tasks/lessons.md` now.

### Team codes come from the data

The board resolves each week's matchups from the scoreboard's own
`team.abbreviation`. It used to recover them by searching each abbreviation
inside the full team name, which is wrong in both directions and shipped that
way: **six of sixteen** week-1 games silently vanished because "San Francisco
49ers" contains no "SF", and two more were projected against the wrong
franchise because "Arizona Cardinals" contains "CAR" and "Kansas City Chiefs"
contains "CHI".

Fixing it also wired up the opponent term the touchdown model always accepted
and the backtest always supplied. Defences ranged from **1.32** touchdowns
allowed against league average to **0.76** last season, which moves 283 of the
419 players on the board by more than half a point, and the worst matchup by
almost eight.

### Why the NFL cache is not committed

Two seasons of box scores is 1.2 MB and the repo's own pre-commit hook rejects
anything over 1 MB. `nfl-history.json` is gitignored and rebuildable;
`nfl-data.js` (103 KB) is what the board actually loads.

---

## Known gaps

- **The NFL game lines have no edge and the board says so.** They are shown
  because the projections are interesting, not because they are bettable.
- **Golf ratings only know 2026 PGA Tour rounds.** A player arriving from LIV,
  the DP World Tour or the Korn Ferry Tour reads as unrated and gets the
  debutant prior, which will underrate a genuinely good player. The board
  labels these `unrated` so you can see it happening.
- **No course fit.** A bomber at a short, tight track and a plotter at a wide
  one get the same rating. `formSD` covers the average size of that effect
  without knowing which way it points for whom.
- **Golf has no odds feed.** `golf.html` will price any number you type, but
  nothing fetches make-cut markets automatically the way `fetch-odds.mjs` does
  for baseball.
- **The top of the golf board is overconfident.** See above: 83.5% predicted,
  73.8% actual. Shade the favourites down.
- **Home run rankings are not calibrated.** Only the H+R+RBI model has been
  through the backtest. The HR ordering is a starting point; its percentages
  are unproven.
- **No park factors.** The HR model accepts a `parkFactor` but nothing supplies
  one yet.
- **The HR platoon table is measured but the HR model is still uncalibrated.**
  Knowing lefty-on-lefty costs 29% of home run rate does not tell you whether
  the resulting percentages are right. Only a backtest can.
- **Bullpen ignored.** Only the starting pitcher enters the model, though a
  hitter faces relievers for a third of his trips.
- **Projected lineups are a guess.** Before lineups post, the board uses the
  team's last batting order. Rest days, especially catchers on getaway
  Sundays, will break it.

---

Positive expected value is a long-run statement, and the long run is longer
than it sounds. Bet only what you can afford to lose.
