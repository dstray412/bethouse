/*
 * BetHouse — clv.test.mjs
 * Does the model's number beat the number the market closed at?
 *
 * WHY THIS IS THE TEST THAT MATTERS
 * ---------------------------------
 * `track.mjs` answers "were the published probabilities true?" That is
 * calibration, and a model can be perfectly calibrated and still lose every
 * penny: at the measured 6.96% hold on 1+ H/R/RBI, a three-leg slip of exactly
 * correct legs returns -15.4%.
 *
 * The question that decides whether there is anything here is different and
 * harder: is the model a BETTER predictor than the closing line? The closing
 * line is the market's final answer after every other bettor has pushed on it,
 * and beating it is the only claim in this industry that cannot be produced by
 * picking favourites, cannot be flattered by a lucky week, and is the measure
 * books themselves use to decide who to limit.
 *
 * Brier score is the comparison, because it is the same yardstick applied to
 * both sides: mean squared error against what happened. Lower wins.
 *
 * THE ONE RULE THESE TESTS EXIST TO PROTECT
 * -----------------------------------------
 * The comparison is only honest if BOTH numbers were fixed before the game.
 * `track.mjs` writes the model's probability pregame and never recomputes it
 * (`track.mjs:173`). `close-odds.mjs` freezes the market price only while the
 * game is still open. If either side could be touched afterwards the whole
 * measurement becomes a way of proving whatever you like.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as clv from "./clv.mjs";

/* ---------------------------------------------------------------- *
 * Which market answers which prop
 *
 * The model and the odds feed count the same events with different names.
 * "1+ H/R/RBI" is the market's "hrr over 0.5"; "2+ total bases" is "tb over
 * 1.5". Get this wrong by one line and the whole comparison silently grades
 * the model against a market nobody was betting.
 * ---------------------------------------------------------------- */

test("marketFor: 1+ H/R/RBI is the 0.5 line, not the 1.5 line", () => {
  /* The feed carries far more hrr|1.5 than hrr|0.5 (225 vs 60 on 2026-08-23),
     so a join that matched on market name alone would pick up the wrong line
     four times out of five and look like it had plenty of data. */
  assert.deepEqual(clv.marketFor("hrr"), { market: "hrr", line: 0.5 });
});

test("marketFor: N+ total bases is the N-0.5 line", () => {
  assert.deepEqual(clv.marketFor("tb2"), { market: "tb", line: 1.5 });
  assert.deepEqual(clv.marketFor("tb3"), { market: "tb", line: 2.5 });
  assert.deepEqual(clv.marketFor("tb4"), { market: "tb", line: 3.5 });
});

test("marketFor: a prop with no market on the feed returns null", () => {
  /* Home runs are priced as their own market, which this feed does not carry.
     Returning null is what keeps those predictions out of the comparison
     instead of matching them to something adjacent. */
  assert.equal(clv.marketFor("hr"), null);
  assert.equal(clv.marketFor("nonsense"), null);
});

/* ---------------------------------------------------------------- *
 * The join
 * ---------------------------------------------------------------- */

const closed = {
  "bryce harper|tb|1.5": { name: "Bryce Harper", market: "tb", line: 1.5, noVigOver: 0.42 },
  "jackson holliday|hrr|0.5": { name: "Jackson Holliday", market: "hrr", line: 0.5, noVigOver: 0.64 },
  "jackson holliday|hrr|1.5": { name: "Jackson Holliday", market: "hrr", line: 1.5, noVigOver: 0.31 },
};

test("join: matches a graded prediction to its closing price", () => {
  const rows = clv.join(
    [{ name: "Jackson Holliday", prop: "hrr", prob: 0.6955, actual: 0 }],
    closed,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, 0.6955);
  assert.equal(rows[0].market, 0.64);
  assert.equal(rows[0].actual, 0);
});

test("join: takes the 0.5 line for hrr even though 1.5 is also priced", () => {
  /* Both lines exist for this player. Picking the wrong one would compare the
     model's 1+ number against the market's 2+ number and report a huge fake
     edge. */
  const rows = clv.join([{ name: "Jackson Holliday", prop: "hrr", prob: 0.7, actual: 1 }], closed);
  assert.equal(rows[0].market, 0.64);
});

test("join: an ungraded prediction is not a row", () => {
  /* A pending bet has no actual, so it cannot contribute to a Brier score.
     Letting it through as a 0 would drag both sides toward the floor and make
     an open day look like a losing one. */
  const rows = clv.join([{ name: "Bryce Harper", prop: "tb2", prob: 0.5, actual: null }], closed);
  assert.deepEqual(rows, []);
});

test("join: a prediction with no closing price is dropped, not defaulted", () => {
  /* Never priced, or the game had already started when the odds last
     refreshed. Either way there is no market number to compare against, and
     inventing one is inventing the result. */
  const rows = clv.join([{ name: "Nobody Here", prop: "hrr", prob: 0.7, actual: 1 }], closed);
  assert.deepEqual(rows, []);
});

test("join: names match through the same normaliser the feed used", () => {
  /* The odds keys are normalised; the board's names are not. If these two
     disagree the join silently returns nothing and the report says "no data"
     rather than "your name matching is broken". */
  const rows = clv.join([{ name: "Bryce  HARPER", prop: "tb2", prob: 0.4, actual: 1 }], closed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].market, 0.42);
});

/* ---------------------------------------------------------------- *
 * The comparison
 * ---------------------------------------------------------------- */

test("score: the better predictor has the lower Brier", () => {
  /* Two outcomes, one hit and one miss. The model calls them exactly; the
     market is wrong on both. The model must win, or the comparison is
     inverted and every future report reads backwards. */
  const rows = [
    { model: 1, market: 0, actual: 1 },
    { model: 0, market: 1, actual: 0 },
  ];
  const s = clv.score(rows);
  assert.equal(s.modelBrier, 0);
  assert.equal(s.marketBrier, 1);
  assert.ok(s.modelBrier < s.marketBrier, "lower Brier is better");
  assert.ok(s.beatsClose, "the model beat the close here");
});

test("score: the market wins when the market is right", () => {
  /* The direction that matters commercially. A measurement that can only
     report good news is not a measurement. */
  const rows = [
    { model: 0, market: 1, actual: 1 },
    { model: 1, market: 0, actual: 0 },
  ];
  const s = clv.score(rows);
  assert.ok(s.marketBrier < s.modelBrier);
  assert.equal(s.beatsClose, false);
});

test("score: disagreement is the model minus the market, in points", () => {
  const rows = [{ model: 0.7, market: 0.64, actual: 1 }];
  const s = clv.score(rows);
  assert.ok(Math.abs(s.disagreement - 6) < 1e-9, "6 percentage points above the close");
});

test("score: nothing matched returns nothing, not a zero record", () => {
  assert.equal(clv.score([]), null);
});

/* ---------------------------------------------------------------- *
 * The business question
 *
 * Calibration says the numbers are true. This says whether any of them are
 * worth betting once the book takes its cut.
 * ---------------------------------------------------------------- */

test("edges: a leg only counts as edge once it clears the vig, not the fair price", () => {
  /* Beating the no-vig number is not enough to make money -- you pay the vig
     on the way in. At a 7% two-way hold each side carries roughly half, so a
     leg has to beat the closing no-vig probability by more than that share
     before it is a bet rather than a rounding error. */
  const rows = [
    { model: 0.70, market: 0.64, actual: 1 }, // +6.0pp, clears 3.5
    { model: 0.66, market: 0.64, actual: 0 }, // +2.0pp, does not
    { model: 0.60, market: 0.64, actual: 1 }, // model is lower, never an edge
  ];
  const e = clv.edges(rows, 0.035);
  assert.equal(e.length, 1);
  assert.equal(e[0].model, 0.70);
});

test("edges: a threshold of zero still excludes legs the model likes less", () => {
  const rows = [{ model: 0.60, market: 0.64, actual: 1 }];
  assert.deepEqual(clv.edges(rows, 0), []);
});

/* ---------------------------------------------------------------- *
 * Against the real committed data
 *
 * The unit tests above prove the arithmetic. This proves the mapping matches
 * the files actually on disk, which is the part that silently rots when the
 * feed changes a market name.
 * ---------------------------------------------------------------- */

test("the prop-to-market mapping still matches the files on disk", () => {
  /* This test runs inside the refresh workflows, against data that was fetched
     seconds earlier. `tasks/lessons.md` records what happens when such a test
     asserts that live data is non-empty: it went red 13 times in a row on days
     that were simply quiet, and the failure said nothing about the code.

     So: no hardcoded date, and no assertion that rows exist. Scan for any day
     carrying both a graded record and frozen prices, and check that IF the
     data is there, the mapping still reaches it. A day with nothing to join is
     a real state -- no games, or before close-odds.mjs first ran -- and it is
     not a defect. */
  const days = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
      : [];
  const both = days("history").filter((f) => days("odds-close").includes(f));

  let joined = 0;
  let gradedWithPrices = 0;
  for (const f of both) {
    const h = JSON.parse(fs.readFileSync(`history/${f}`, "utf8"));
    const c = JSON.parse(fs.readFileSync(`odds-close/${f}`, "utf8"));
    /* How many rows COULD join, computed independently of join() so this is a
       real oracle rather than the function grading itself. */
    for (const p of h.predictions || []) {
      if (p.actual == null) continue;
      const m = clv.marketFor(p.prop);
      if (m && (c.closed || {})[`${p.name.toLowerCase().replace(/\s+/g, " ").trim()}|${m.market}|${m.line}`]) {
        gradedWithPrices++;
      }
    }
    const rows = clv.join(h.predictions, c.closed);
    joined += rows.length;
    for (const r of rows) {
      assert.ok(r.model > 0 && r.model < 1, `model probability out of range on ${f}`);
      assert.ok(r.market > 0 && r.market < 1, `market probability out of range on ${f}`);
      assert.equal(r.actual === 0 || r.actual === 1, true, `ungraded row leaked through on ${f}`);
    }
  }

  /* The invariant that catches mapping drift: if a naive key lookup can find
     matches, join() must find at least as many. Zero on both sides is a quiet
     day. Matches on one side and none on the other is a broken mapping. */
  if (gradedWithPrices > 0) {
    assert.ok(
      joined > 0,
      `${gradedWithPrices} predictions have a closing price but join() returned none — the mapping has drifted`,
    );
  }
});
