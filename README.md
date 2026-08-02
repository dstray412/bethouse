# BetHouse

Ranks MLB hitters for three props, every game, every day: **1+ hits/runs/RBI**,
**total bases** (2+, 3+, 4+), and **home runs**.

Open `index.html`. No build step, no server, no API key.

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
node --test edge.test.mjs score.test.mjs   # 87 tests
node backtest.mjs --prop tb2               # validate total bases
node backtest.mjs       # measures whether the model actually works
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
| `backtest.mjs` | Replays real games, measures calibration, fits `k`. |
| `track.mjs` | Records each day's pregame predictions, grades them once games end, keeps the running record. |
| `edge.js` | De-vig and EV math for the odds side. 36 tests. |
| `fetch-odds.mjs` | The Odds API client. Needs a key; not required for the board. |

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

## Known gaps

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
