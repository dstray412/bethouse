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
