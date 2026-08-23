# lessons

Prevention rules, learned the hard way. Each one is here because something
shipped wrong or nearly did.

## Never trust a hand-written rules table when the data can be counted

The PGA cut-rule table was written from memory and was wrong: the signature
events (Genesis, Bay Hill, Memorial) were listed as no-cut, but 2026 shows them
cutting 21, 22 and 19 players. They cut at 50.

**Rule:** when a constant describes something the dataset already records,
derive it from the dataset or verify it against the dataset before shipping.
For cut rules that is `grep STATUS_CUT` over `pga-history.json`. A table nobody
checked is a guess wearing a lookup table's clothes.

## Two copies of the same rule will disagree

`fetch-pga.mjs` and `golf.js` both had a `cutRuleFor`. They disagreed within
the hour — the fetcher labelled an event no-cut while the model cut it at 50.

**Rule:** one table, imported. A fetcher and a model that disagree about the
rules is worse than either being wrong alone, because the board looks
internally consistent while being wrong.

## Check whether the quantity is discrete before reaching for a normal

The cut model drew 36-hole scores from a normal and ran 5.75 percentage points
cold. Golf scores are whole strokes. With continuous scores no two players ever
tie, so exactly `cutN` survive and "low 65 **and ties**" never fires — but real
fields stack fifteen players deep on each stroke near the line, and the 2026
U.S. Open sent 72 players through a low-60-and-ties cut.

The tell was in the output the whole time: the model predicted 38.5% for that
field, which is exactly 60/156, the cut rule itself. A prediction that equals
its own input parameter is a model that is not modelling anything.

This is the second time this project has made this mistake; `mixPow` was the
first, raising a rate to a fractional power when a hitter gets 4 trips or 5 and
never 4.54.

**Rule:** before assuming a continuous distribution, ask whether the underlying
quantity comes in whole units and whether ties change the payoff. If both, the
discreteness *is* the model, not a rounding detail.

## A loose test is not a test

The first version of the tie test asserted the survivor count was between 64
and 75 for a cut of 65. That passes whether ties work or not, which is why the
bug reached the backtest instead of dying at the unit-test line.

**Rule:** a test whose bounds admit the bug is documentation, not a gate. Pin
the behaviour that would break — here, "strictly more than `cutN` survive".

## Coordinate descent needs a second pass, and edge-of-range means the range is wrong

The first `--fit` swept `K` while `priorSkill` was still 0, so every unrated
player was simulated as tour-average and `K` was fitted against a field that did
not exist. It also chose values sitting at the end of the sweep, which means the
optimum was outside the range being searched.

**Rule:** two passes minimum, and print a warning when the winner is at either
end of the sweep. `backtest-pga.mjs --fit` does both now.

## Prefer a direct measurement to a fitted one when the fit is inside the noise

Fitting `priorSkill` against Brier wanted 1.6 and kept climbing. Measuring what
debutants actually do gave 1.07. The Brier difference between them was 0.0002 —
Monte Carlo noise at 4,000 sims.

**Rule:** when a constant can be measured directly, measure it, and only take a
fitted value when the fit is measuring the target question more directly than
the measurement does. State which one you used and why, in the code.

## Applying a curved function to an average is not the same as averaging it

Three times now, in three sports.

`mixPow` (baseball): raising a per-trip rate to a fractional power, when a
hitter gets four plate appearances or five and never 4.54.

Ties (golf): drawing continuous scores when a golf score is a whole number of
strokes, so "low 65 **and ties**" never fired and the model ran 5.75 points
cold.

Workload (NFL): feeding a player's *season-average* touches into
`1 - e^-lambda`. One game's workload divided by that player's own average has a
standard deviation of 0.55 — game script, injuries, blowouts — and the function
is concave, so evaluating at the mean overstated the top of the board by 4.9
points at lambda = 1 and by nothing at the bottom. The board ran 11.6 points hot
where it mattered most.

**Rule:** whenever a model computes `f(average)`, ask whether `f` is curved and
whether the thing being averaged actually varies. If both, the answer is
`average of f`, and the fix is to sample the real distribution rather than to
add a correction factor. The symptom is always the same and always looks like a
calibration problem at one end of the board only: a bias that grows with the
prediction is a shape error, not a level error.

## Diagnose before you tune

The NFL touchdown model was hot at the top. Two plausible causes were tested
and both were WRONG before the real one turned up: the usage model was assumed
non-linear (a power fit returned exponent 1.00, i.e. perfectly linear) and
touchdowns were assumed to cluster (a negative-binomial fit was worse than
Poisson). Reaching for the shrinkage dial first would have papered over a shape
error with a level correction and left the board wrong in a subtler way.

**Rule:** when calibration fails at one end, measure which assumption is broken
before adjusting any constant. Two disproved hypotheses cost ten minutes; a
fitted fudge factor costs a season.

## A guard stricter than the thing it guards will break what it protects

`refresh.yml` fetches the golf board with `|| echo`, deliberately, under a
comment saying golf must never take the refresh down because the baseball
board is what people open every day. Three lines later a sanity check on the
same data threw an exception.

So on 2026-08-14 the FedEx St. Jude finished, the fetcher advanced to a
tournament whose entry list was not out yet, ESPN returned a real event with
zero competitors, and the check called that "empty field" and failed the run.
Baseball stopped updating because a golf tournament had not published its
field. The non-fatal fetch bought exactly nothing, because the fatal check
sat next to it.

**Rule:** when a step is deliberately non-fatal, everything downstream that
touches its output has to be non-fatal too — validation included. A `|| true`
on one line and a `throw` on the next is not a soft dependency, it is a hard
one wearing a disguise. Check the whole path, not the step you were thinking
about.

The second half of this is knowing which states are actually errors. An
unposted entry list is not a malformed board, it is Tuesday. A guard that
cannot tell "this data is broken" from "this data does not exist yet" will
eventually fire on the second one, and it will do it at the worst time,
because that is precisely when the upstream is quiet.

## Ask what the model did not already know, not what correlates

Trend sites sell hitting streaks: "hit in 10 of last 10". Measured over 7,037
player-games, hot hitters (five or more straight) cashed 72.3% against 68.3%
for cold ones — a 3.9 point gap that looks like an edge.

It is not one. The model already expected the hot group to do 2.6 points
better, because a streak and a good hitter are largely the same fact. The
residual was 1.36 points against a standard error of 1.97: zero.

The first version of this analysis compared raw cash rates and produced
z = 2.00, right on the significance line, and would have been reported as a
finding. Comparing (actual − predicted) instead of actual gave z = 0.69.

**Rule:** when testing whether some new signal helps, never compare outcomes
between groups. Compare **residuals** — how much each group beat what was
already predicted for it. Raw comparisons credit the new signal for
everything the existing model already knew, and the difference between those
two questions here was the difference between "publish it" and "discard it".

The same logic is why the NFL spread model is graded against the closing line
rather than against the base rate. A signal is only worth what it adds to the
number you would otherwise have used.

## Fit on one window, validate on another, or you have not fitted anything

The temperature investigation found a real residual gradient: two windows
sharing no games both showed home run predictions running cold in the heat
and hot in the cold, +4.63pp (z 2.84) in April and +3.32pp (z 1.68) in
August, monotone across the bands, and absent from H/R/RBI exactly as the
physics requires.

Fitting a correction on the April window gave a clean interior optimum at
slope 0.16 -- better Brier, and the cold and hot biases converging on each
other, which is the right criterion. Everything about it looked finished.

Run on the summer window, that same slope was WORSE than doing nothing, and
summer's own optimum was zero. One more command was the difference between
shipping an improvement and shipping a regression to half the season.

The cause was not the physics but the shape of the correction: it pivoted on
a fixed 72F rather than on the temperature the model was calibrated against,
so it was not mean-neutral. In a summer sample where nearly every game is
above the pivot it mostly RAISED predictions, tangling a redistribution with
a level shift.

**Rule:** a constant fitted on one sample is a hypothesis, not a constant.
Fit on one window, then test the fitted value on a window that shares no
data, and require it to help both. And when a correction is meant to
redistribute rather than to move the average, centre it on the sample mean
so it arithmetically cannot do the latter -- otherwise every fit will
silently trade one against the other.

## A wide spread is not the same as new information

Team opponent batting average runs from about .218 to .288 across a season.
That is a far bigger range than the handedness effect the board prints next to
every hitter, and it is the headline number on every "exploit favourable
defensive matchups" tool.

It is worth nothing here. Across 7,291 player-games the leakiest defences beat
their predictions by 0.23pp more than the stingiest (z = 0.16), with the
buckets in between running +1.20, +1.89, -0.90, +1.42 -- no direction at all.

The reason is that the model already has the opposing starter, who is two
thirds of the run prevention and most of the correlation. The team number is
mostly a restatement of the rotation with the bullpen and the gloves attached,
and those turned out to be small.

**Rule:** the size of a variable's spread says nothing about whether it adds
information. What matters is its spread AFTER conditioning on what the model
already uses. Before building a feature, ask what it is correlated with that is
already in there -- and if the answer is "the biggest term in the model",
expect nothing and test cheaply.

## Verifying a re-rendering UI needs a fresh query, not a held reference

The odds board was shipped with a "KNOWN DEFECT" in its commit message
saying the detail panel never rendered the market comparison. The panel
rendered it correctly the whole time. There was no defect.

The fault was the test. Clicking a row makes the app re-render, which
replaces the DOM nodes; the reference held from before the click points at
a detached element. Reading `aria-expanded` off it returns the old value,
and searching `document.body.innerText` at that moment finds nothing because
the click never registered against the live tree.

The evidence looked conclusive -- three separate checks all said the line
was missing -- and all three shared the same broken assumption.

**Rule:** after any action that causes a re-render, re-query the document
for what you want to inspect. Never assert against a node reference captured
before the action. And when several checks agree that something is broken,
confirm they are not all downstream of one shared assumption before writing
the finding down as fact.

The wider version: a defect claim is a claim like any other and deserves the
same standard of proof as a fix. Recording a bug that does not exist costs
the next person real time, and it went into a commit message on main where
it cannot be edited.

## A green suite that never looks at the page is not covering the product

The suite had 202 tests and not one rendered a board. score.js, edge.js,
golf.js and nfl.js were covered to the decimal place; the three HTML pages,
which are the entire thing a user sees, had nothing. A design review then
found five defects on a fully green suite, two of them controls that showed
on every view and did nothing when clicked.

The gate and the failures did not overlap anywhere.

`dom.test.mjs` closes it without a dependency: no jsdom, no headless
browser, no package.json, because "no build step, no server, no API key" is
a property worth keeping and a test dependency is the first crack in it. It
asserts SOURCE INVARIANTS drawn from the actual defects -- the [hidden]
override guard is present, prose has a ch-capped measure, the :root tokens
are byte-identical across the three copied stylesheets, every nav link
resolves and every destination has one name, every script and stylesheet a
page loads exists.

Two rules out of building it.

**Prove a regression test fails on the broken code before believing it.**
All ten passed on first run against fixed source, which says nothing. Run
against the pre-fix commit, eight of them failed -- that is what made them
regression tests rather than decoration.

**A test that scans source needs to know what it is scanning.** The
duplicate-id check reported nfl.html defining `why'+i+'` three times. That
is a JavaScript string concatenation inside a script block, not a repeated
DOM id: the regex was reading JS as if it were HTML. Strip script bodies
before scanning markup, keep style bodies because the CSS assertions need
them. The test was wrong, not the code, and it took a false positive on run
one to notice.

---

## Hiding the control is not removing the capability

`/qa`, 2026-08-19.

The parlay is 1+ H/R/RBI only, and index.html said so in a comment: the
cross-game measurement it quotes was taken on that prop and nowhere else, so
offering it elsewhere would be "extending a measurement to somewhere it was
never taken". The enforcement was one line — hide the SUGGEST control on the
other two views.

Every row still rendered a live `+` button. A total-bases slip was two clicks
away, and it arrived carrying the same closing reassurance: cross-game slips
"cashed 1.03-1.08x as often as the product predicts". About a number that
measurement had never seen.

**Scope the action, not the menu.** A hidden control removes the suggestion;
it does not remove the capability. Ask which affordances reach the feature and
gate every one of them.

**And make the rule one named thing.** The scope lived as `state.view==='hrr'`
typed out at each site, so the two sites could disagree — and did. It is
`S.parlayEligible` now, default-closed, for the same reason `cutRuleFor` is one
table: two copies of a rule stay in sync until they don't.

## A value that already carries its sign still passes `> 0`

The odds feed stores American prices as signed strings: `"+111"`, `"-103"`.
index.html rendered them as `(mkt.over>0?'+':'')+mkt.over`. `"+111" > 0`
coerces to `111 > 0`, which is true, so the board printed `++111`.

Negative prices came out right, so half the rows looked fine and it shipped.

**Do not re-derive formatting the source already applied.** `amer()` existed
for exactly this and rounds first, so it takes the string or a bare number and
emits one sign either way. When a feed hands you a formatted value, either
route it through the one formatter or store it unformatted — never both.

## A test wired into a refresher must not assert that live data is non-empty

`/qa` follow-up, 2026-08-20. My own defect, introduced the day before.

`dom.test.mjs` runs inside all three refresh workflows, against data those
workflows have just fetched. A test I added to pin the odds contract asserted
`prices.length > 0` — a claim about the live feed, not about the code.

At 13:51 UTC no MLB props were posted yet. `refresh-odds.yml` printed its own
`no scheduled games — nothing priced` and exited 0 exactly as designed, then
handed the same empty file to `node --test` and my assertion failed the run.
**Thirteen consecutive refreshes died on it**, and because index.html hides
odds older than `ODDS_MAX_AGE_H = 6`, the board quietly stopped showing prices
altogether. A green suite locally, a dead feature in production.

The rule was already written three lines above the call site:

> An empty slate is legitimate (no games scheduled); a malformed file is not.
> Only the second one should fail the run.

**Nothing in a file a refresher runs may require live data to be present.**
Check the shape of what is there; report how much that was, so a permanently
empty file is visible rather than silently green.

**And put a content-bearing check where content is guaranteed.** The
signed-price assertion now also runs in `refresh-odds.yml`'s sanity step,
inside the `n > 0` branch, where an empty slate has already exited. Same rule,
two places, each able to be strict about exactly what it can see.

**Reproduce before fixing.** The empty file was written locally and the test
watched to fail the same way CI failed, then watched to pass, then watched to
still catch a bare number. Reading the log and inferring the cause would have
got the diagnosis right and the fix untested.

---

## A shape change is not done until the callers are re-tested

`/qa` follow-up, 2026-08-22. My own defect, live for a day.

Adding parlays meant every bet became `{legs:[...]}`. `add()` started requiring
`legs` and **silently returned the list unchanged** for anything else. The
board's row button still passed a flat pick, so tapping a player did nothing at
all: no error, no console message, an empty log. The feature the user had asked
for first was dead in production.

The suite stayed green because every test built through `single()`. **The board
does not call `single()`.** So the tests exercised the module's front door while
the product used a side door I had just bricked up.

**Re-test the call sites, not the module.** A green unit suite after a shape
change says the shape is self-consistent, not that anything still calls it
correctly. Grep the callers.

**A silent no-op is the bug behind the bug.** `add()` swallowing an
unrecognised argument is what let it ship. The fix was not to correct one call
site — it was to make a bare pick a legitimate input, since a single IS a
one-leg bet and `migrate()` already accepted both shapes. A shape the module
understands everywhere else must not be a silent failure in one place.

**And I claimed browser verification I had not done.** The commit said the
parlay path was checked in a browser, which was true, and left the impression
the single path was too, which was false. Verify each path you changed, or say
which one you did not.

## A save that triggers a grade that triggers a save

Same session, caught before it shipped. Making a historical bet settle
immediately meant `saveBets()` calling `gradeBets()`. But grading writes too,
so a bet that cannot settle yet — an open game — went save → grade → find
nothing → save → grade, forever, synchronously, freezing the page.

**Split the leaf from the loop.** `persist()` writes and calls nothing;
`saveBets()` is persist-plus-grade; grading calls `persist()` only, and only
when a grade actually landed. Any write path that can re-enter itself needs one
function that is provably terminal.

---

## Measure the model against what it actually published

2026-08-22. A user's four-leg parlay lost, every leg. Investigating it found
the legs had been fairly priced — but the investigation kept going and found
something two months of backtesting had missed.

`backtest.mjs` replays history and fits constants to it. It said the model was
calibrated. **It was measuring the model against the same data that shaped it.**

Measuring the board against its OWN SHIPPED PREDICTIONS — 4,330 numbers it had
published, graded by `track.mjs` at the time — showed textbook over-dispersion:
predictions under 65% ran +4.79pp cold (z = 4.32), 65-75% ran 2.86pp hot. On
all five props. In both halves of the window, independently.

**A backtest and a forward record are different questions.** The first asks
whether the shape is right; the second asks whether the published numbers were
true. Only the second is un-gameable, and it needs no new data collection —
`track.mjs` had been recording it for three weeks.

**Rebuild the inputs, do not just read the outputs.** `history/` stores the
probability but not the season line behind it, so the model could not be re-run
from it. The committed board snapshots could: `git log mlb-data.js` keeps every
half hour, and the earliest one holding a player reproduces the recorded
pregame number to 0.003pp. That fidelity check came first — a re-fit on inputs
that do not reproduce the original outputs is fitting something else.

**Ship the timid end of a validated range.** Ten independent fits landed
between 0.43 and 0.78, all saying shrink. Shipped 0.80. The single held-out
failure among the ten was the most aggressive fit, and the asymmetry is real:
under-correcting costs accuracy, over-correcting costs money.
