/*
 * BetHouse — compare-td.test.mjs
 * The paired comparison every model change is judged by. Oracle: the
 * README's "The rule for every model change": paired squared-error
 * differences, Δ/SE at or below −2 to be BETTER, no band that both runs
 * have moving worse by more than 3pp, and two dumps compared only when
 * they are the same exam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { paired, verdict, rowsOf, sameExam } from "./compare-td.mjs";

const dump = (rows, extra) => Object.assign({ overrides: {}, window: { from: "2025", to: "2026" }, fixedLines: true, n: rows.length, rows }, extra || {});
/* n rows at probability p with the actual rate a: a dump whose Brier is known by hand. */
const rowsAt = (p, a, n, tag) => Array.from({ length: n }, (_, i) => [`${tag}|${i}`, p, i < Math.round(a * n) ? 1 : 0]);

test("paired: the same key must mean the same outcome; a different outcome is counted, not silently dropped, and is not a pair", () => {
  const base = dump([["k1", 0.5, 1], ["k2", 0.5, 0], ["k3", 0.5, 1]]);
  const cand = dump([["k1", 0.6, 1], ["k2", 0.4, 1], ["k4", 0.5, 0]]);
  const r = paired(base, cand);
  assert.equal(r.n, 1);
  assert.equal(r.notInBase, 1);
  assert.equal(r.outcomeDiffers, 1, "a flipped outcome under the same key is the sign of two different lines");
  assert.equal(r.unmatched, 2);
});

test("paired Brier and its standard error, by hand", () => {
  // Base says 0.5 on 400 rows of which half hit (Brier 0.25); the candidate says 0.6 on the hits and 0.4 on the misses (Brier 0.16).
  const rows = rowsAt(0.5, 0.5, 400, "r");
  const cand = dump(rows.map((r) => [r[0], r[2] ? 0.6 : 0.4, r[2]]));
  const r = paired(dump(rows), cand);
  assert.equal(r.n, 400);
  assert.ok(Math.abs(r.brierB - 0.25) < 1e-12 && Math.abs(r.brierC - 0.16) < 1e-12);
  assert.ok(Math.abs(r.delta + 0.09) < 1e-12, "the paired delta is the mean difference in squared error");
  assert.ok(Math.abs(r.se) < 1e-12, "every row improved by the same amount: no spread, no standard error");
});

test("verdict: BETTER needs Δ/SE at or below −2; a band both runs have may not move worse by more than 3pp; a band only the candidate reaches is reported, not charged", () => {
  const mk = (delta, z, bandsB, bandsC) => ({ delta, z, bandsB, bandsC });
  const band = (lo, predicted, actual, n = 100) => ({ lo, predicted, actual, n });
  assert.equal(verdict(mk(-0.001, -2.5, [band(0.5, 0.55, 0.55)], [band(0.5, 0.55, 0.57)])).text, "BETTER");
  assert.match(verdict(mk(-0.001, -1.9, [], [])).text, /^NOISE/);
  assert.equal(verdict(mk(0.001, 2.5, [], [])).text, "WORSE");
  // The same band, 1pp off in the base and 5pp off in the candidate: moved worse by 4pp.
  const moved = verdict(mk(-0.001, -3, [band(0.6, 0.65, 0.64)], [band(0.6, 0.65, 0.60)]));
  assert.match(moved.text, /^BETTER on Brier, but a band moved worse/);
  assert.ok(Math.abs(moved.worstBand - 0.04) < 1e-12);
  // A band the base never had: 5pp off in the candidate is said beside the verdict and does not decide it.
  const fresh = verdict(mk(-0.001, -3, [band(0.6, 0.65, 0.64)], [band(0.6, 0.65, 0.64), band(0.7, 0.72, 0.77, 136)]));
  assert.match(fresh.text, /^BETTER; 70-80 is new and off by 5\.0pp \(n 136\)$/);
  assert.equal(fresh.worstBand, 0);
  assert.equal(fresh.newBands.length, 1);
  assert.ok(Math.abs(fresh.newBands[0].gap - 0.05) < 1e-12 && fresh.newBands[0].lo === 0.7 && fresh.newBands[0].n === 136);
});

test("sameExam: a different window or a different line design is refused, never quietly paired", () => {
  const a = dump([["k", 0.5, 1]]);
  assert.throws(() => sameExam(a, dump([["k", 0.5, 1]], { window: { from: "2023", to: "2024" } })), /different windows/);
  assert.throws(() => sameExam(a, dump([["k", 0.5, 1]], { fixedLines: false })), /fixed lines/);
  assert.throws(() => paired(a, dump([["k", 0.5, 1]], { fixedLines: false })));
  assert.doesNotThrow(() => sameExam(a, dump([["k", 0.5, 1]])));
});

test("rowsOf: a counting prop's rows, and a clear error for a stat the dump does not carry", () => {
  const d = dump([["td", 0.3, 0]], { stats: { recyds: [["r", 0.4, 1]] } });
  assert.deepEqual(rowsOf(d, "recyds").rows, [["r", 0.4, 1]]);
  assert.deepEqual(rowsOf(d).rows, [["td", 0.3, 0]]);
  assert.throws(() => rowsOf(d, "passyds"), /passyds/);
});
