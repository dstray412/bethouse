# handoff

## What

Added a PGA Tour make-the-cut board alongside the baseball one. `golf.html`
ranks a tournament field by each player's probability of playing the weekend,
prices it, and shows its work.

## State

Working and measured. Nothing is committed — the working tree is the delivery.

- `bash scripts/local-check.sh` → **143 tests pass, 0 skipped**, gitleaks clean.
- `node backtest-pga.mjs` → −1.29pp calibration bias, Brier 0.2284 against
  0.2488 for guessing the base rate, top quintile 72.9% vs bottom 30.5%.
- `golf.html` verified in a real browser: no console errors, the no-cut banner,
  the ranked board, row expansion and the EV box all render and compute.

### New files

| File | What |
|---|---|
| `golf.js` | The model. UMD like `score.js` — page, tests and backtest run the same code. |
| `golf.test.mjs` | 41 tests. |
| `fetch-pga.mjs` | ESPN → `pga-data.js` + `pga-history.json`. Keyless. |
| `backtest-pga.mjs` | Walk-forward replay, `--fit` re-derives the constants. |
| `golf.html` | The board. |
| `pga-data.js`, `pga-history.json` | Generated. 34 events, 4,116 player-events. |

### Touched

`index.html` (link to the golf board + `.navlink` style), `README.md`,
`scripts/local-check.sh`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`,
`.github/workflows/refresh.yml`.

## Decisions

- **Monte Carlo, not a formula.** The cut is an order statistic of the field
  ("low 65 and ties"), so players' outcomes are coupled and no closed form
  exists for one man's probability. Simulate the field, find the line, count.
- **Ratings from a two-way solve**, not scoring average, so course difficulty
  and weather waves do not read as talent. Split-half reliability 0.443 → 0.684.
- **Sample the real score distribution**, not a normal. See the ties note below.
- **Constants are measured where a direct measurement exists** and fitted only
  where it does not. `priorSkill` is the observed debutant penalty (1.07), not
  the Brier optimum (1.6) — the Brier gain was 0.0002, which is Monte Carlo
  noise. `K = 6` is fitted, because there the fit *is* the direct measurement
  of the thing being asked.
- **Separate page, not a sport toggle in `index.html`.** Zero risk to a working
  board, and a weekly leaderboard is a different shape from per-game cards.
- **Three formats excluded** rather than mis-modelled: Zurich (two-man teams),
  American Express and Pebble Beach (54-hole cuts over three courses, so a
  round has three different field averages).

## Blockers / what to know

- **No live cut board until 17 September.** The three playoff events and the
  Presidents Cup have no cut. The fall swing (Biltmore → RSM, eight full-field
  events) is the first real runway. Until then `golf.html` shows the no-cut
  banner and a power ranking, which is correct behaviour, not a bug.
  Use `node fetch-pga.mjs --event <id>` to build the board for any past week.
- **The top of the board runs hot**: 83.5% predicted, 73.8% actual. The middle
  is well calibrated. Shade favourites down.
- **`refresh.yml` still pins `actions/checkout@v4` and `setup-node@v4`** while
  `ci.yml` was bumped to v7 in c921f5e. Pre-existing, not touched here, but it
  will bite when v4 is retired.
- **No make-cut odds feed.** `golf.html` prices any number you type;
  nothing fetches the market the way `fetch-odds.mjs` does for baseball.

## Next, if wanted

1. Re-run `node backtest-pga.mjs --fit` once the fall events are in — the
   constants were fitted on 23 tournaments and will move.
2. Course fit. Currently a bomber and a plotter get the same rating everywhere;
   `formSD` covers the size of that effect without knowing its direction.
3. Ratings only know 2026 PGA Tour rounds, so LIV/DP World/Korn Ferry arrivals
   read as unrated and take the debutant prior. The board labels them
   `unrated`; a cross-tour rating would fix it properly.
