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

test("paired: rows only one side has are counted both ways; the same key with a different outcome is not the same data and is refused", () => {
  const base = dump([["k1", 0.5, 1], ["k2", 0.5, 0], ["k3", 0.5, 1]]);
  const r = paired(base, dump([["k1", 0.6, 1], ["k4", 0.5, 0]]));
  assert.equal(r.n, 1);
  assert.equal(r.notInBase, 1, "k4 is only in the candidate");
  assert.equal(r.notInCand, 2, "k2 and k3 are only in the base");
  assert.equal(r.unmatched, 3);
  assert.throws(() => paired(base, dump([["k2", 0.4, 1]])), /different outcome/);
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
  assert.equal(r.dropped, 0);
});

test("verdict: BETTER needs Δ/SE at or below −2; a band both runs have may not move worse by more than 3pp; a band only one side reaches is reported, not charged; past 2% unpaired there is no verdict", () => {
  const mk = (delta, z, bandsB, bandsC, dropped = 0) => ({ delta, z, bandsB, bandsC, dropped });
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
  // A band the base had and the candidate left: said too, so moving mass out of a bad band is visible.
  const lost = verdict(mk(-0.001, -3, [band(0.6, 0.65, 0.64), band(0.8, 0.85, 0.70, 40)], [band(0.6, 0.65, 0.64)]));
  assert.match(lost.text, /^BETTER; 80-90 is gone from the candidate \(the base was off by 15\.0pp there, n 40\)$/);
  assert.equal(lost.lostBands.length, 1);
  // More than 2% of rows unpaired: the two runs did not grade the same exam, whatever the Brier says.
  const partial = verdict(mk(-0.01, -9, [], [], 0.05));
  assert.match(partial.text, /^NO VERDICT \[5\.0% of rows unpaired/);
  assert.equal(partial.better, false);
});

test("sameExam: a different window is refused; a counting prop is compared only between two fixed-line dumps; touchdown rows compare under either design", () => {
  const a = dump([["k", 0.5, 1]]);
  assert.throws(() => sameExam(a, dump([["k", 0.5, 1]], { window: { from: "2023", to: "2024" } })), /different windows/);
  const ownA = dump([["k", 0.5, 1]], { fixedLines: false, stats: { recyds: [["r", 0.4, 1]] } });
  const ownB = dump([["k", 0.5, 1]], { fixedLines: false, stats: { recyds: [["r", 0.5, 1]] } });
  assert.throws(() => paired(rowsOf(ownA, "recyds"), rowsOf(ownB, "recyds")), /only between two --fixed-lines dumps/, "two own-line dumps agree with each other and are still the biased design");
  assert.throws(() => paired(rowsOf(ownA, "recyds"), rowsOf(dump([["k", 0.5, 1]], { stats: { recyds: [["r", 0.5, 1]] } }), "recyds")), /only between two --fixed-lines dumps/);
  assert.doesNotThrow(() => paired(ownA, ownB), "touchdown rows have no line: either design pairs");
  assert.doesNotThrow(() => paired(rowsOf(dump([], { stats: { recyds: [["r", 0.4, 1]] } }), "recyds"), rowsOf(dump([], { stats: { recyds: [["r", 0.5, 1]] } }), "recyds")));
});

test("rowsOf: a counting prop's rows, named, and a clear error for a stat the dump does not carry", () => {
  const d = dump([["td", 0.3, 0]], { stats: { recyds: [["r", 0.4, 1]] } });
  const r = rowsOf(d, "recyds");
  assert.deepEqual(r.rows, [["r", 0.4, 1]]);
  assert.equal(r.stat, "recyds");
  assert.equal(r.n, 1, "n is the stat's row count, not the touchdown rows'");
  assert.deepEqual(rowsOf(d).rows, [["td", 0.3, 0]]);
  assert.equal(rowsOf(d).stat, undefined);
  assert.throws(() => rowsOf(d, "passyds"), /passyds/);
});
