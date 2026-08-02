# BetHouse

Ranks MLB hitters for the **1+ hits / runs / RBI** prop, every game, every day.

Open `index.html`. No build step, no server, no API key.

---

## What it is

A daily board. For each game it shows the hitters most likely to record at
least one hit, run or RBI, with the model's probability, the price that would
be fair, and whether the price you're actually offered beats it.

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
node --test             # 66 tests
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
| `score.test.mjs` | 30 tests on model shape, clamping and regression behaviour. |
| `fetch-mlb.mjs` | Five keyless requests to statsapi → `mlb-data.js`. |
| `backtest.mjs` | Replays real games, measures calibration, fits `k`. |
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

## Known gaps

- **Home run rankings are not calibrated.** Only the H+R+RBI model has been
  through the backtest. The HR ordering is a starting point; its percentages
  are unproven.
- **No park factors.** The HR model accepts a `parkFactor` but nothing supplies
  one yet.
- **No handedness splits.** A lefty facing a lefty is treated like anyone else,
  which is the single largest missing input.
- **Bullpen ignored.** Only the starting pitcher enters the model, though a
  hitter faces relievers for a third of his trips.
- **Projected lineups are a guess.** Before lineups post, the board uses the
  team's last batting order. Rest days, especially catchers on getaway
  Sundays, will break it.

---

Positive expected value is a long-run statement, and the long run is longer
than it sounds. Bet only what you can afford to lose.
