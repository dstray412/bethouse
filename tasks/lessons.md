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
