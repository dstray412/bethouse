/*
 * BetHouse — edge.test.mjs
 * Run with:  node --test
 *
 * Every expected value here is hand-computed from the definition, not
 * captured from a previous run. A snapshot test would happily lock in a
 * wrong number, and a wrong number here means fake edges in the app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import edge from "./edge.js";

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

/* ---------------------------------------------------------------- *
 * Odds conversion
 * ---------------------------------------------------------------- */

test("american → decimal", () => {
  close(edge.americanToDecimal(150), 2.5);
  close(edge.americanToDecimal(100), 2.0);
  close(edge.americanToDecimal(-110), 1 + 100 / 110);
  close(edge.americanToDecimal(-400), 1.25);
});

test("decimal → american round-trips", () => {
  for (const a of [-500, -250, -110, 100, 145, 900]) {
    close(edge.decimalToAmerican(edge.americanToDecimal(a)), a, 0.5);
  }
});

test("decimal 2.0 is +100, the even-money boundary", () => {
  assert.equal(edge.decimalToAmerican(2.0), 100);
});

test("implied probability still carries the vig", () => {
  // -110 costs $110 to win $100 → 110/210
  close(edge.americanToProb(-110), 110 / 210);
  close(edge.americanToProb(100), 0.5);
});

test("bad input returns NaN rather than a plausible-looking number", () => {
  assert.ok(Number.isNaN(edge.americanToDecimal(0)));
  assert.ok(Number.isNaN(edge.decimalToAmerican(1)));
  assert.ok(Number.isNaN(edge.probToDecimal(0)));
  assert.ok(Number.isNaN(edge.probToDecimal(1)));
});

/* ---------------------------------------------------------------- *
 * Vig
 * ---------------------------------------------------------------- */

test("standard -110/-110 holds 4.545%", () => {
  const q = [-110, -110].map(edge.americanToProb);
  close(edge.overround(q), 2 * (110 / 210), 1e-9); // = 1.047619…
  close(edge.holdPct(q), (2 * (110 / 210) - 1) / (2 * (110 / 210)));
  close(edge.holdPct(q), 0.0454545, 1e-6);
});

test("every de-vig method returns probabilities summing to 1", () => {
  const markets = [
    [-110, -110],
    [-400, 300],
    [-150, 130],
    [250, 300, 400, 900], // four-way
    [1200, 1800, 2500, 4000, 6000, 8000], // golf-style longshot field
  ];
  for (const m of markets) {
    for (const method of Object.keys(edge.DEVIG_METHODS)) {
      const p = edge.devigAmerican(m, method);
      assert.ok(p, `${method} failed on ${m}`);
      close(edge.overround(p), 1, 1e-9);
      assert.ok(p.every((x) => x > 0 && x < 1), `${method} produced an out-of-range prob`);
    }
  }
});

test("a symmetric market de-vigs to 50/50 under every method", () => {
  for (const method of Object.keys(edge.DEVIG_METHODS)) {
    const p = edge.devigAmerican([-110, -110], method);
    close(p[0], 0.5, 1e-6);
    close(p[1], 0.5, 1e-6);
  }
});

test("multiplicative de-vig on -150/+130", () => {
  // q = 150/250 = .6 and 100/230 = .434782…, sum 1.034782…
  const p = edge.devigAmerican([-150, 130], "multiplicative");
  const q = [0.6, 100 / 230];
  const s = q[0] + q[1];
  close(p[0], q[0] / s);
  close(p[1], q[1] / s);
});

test("power de-vig takes more vig off the longshot than multiplicative", () => {
  // The whole reason the method exists: books load vig onto long prices,
  // so multiplicative overstates a longshot's true chance.
  const mult = edge.devigAmerican([-400, 300], "multiplicative");
  const pow = edge.devigAmerican([-400, 300], "power");
  assert.ok(pow[0] > mult[0], "favourite should be priced higher under power");
  assert.ok(pow[1] < mult[1], "longshot should be priced lower under power");
  close(pow[0], 0.7823, 1e-3); // solves 0.8^k + 0.25^k = 1 at k ≈ 1.1
});

test("power de-vig leaves a fair market untouched", () => {
  // Already sums to 1 → k must be 1 → probabilities unchanged.
  const p = edge.devigAmerican([100, 100], "power");
  close(p[0], 0.5, 1e-6);
});

/**
 * A realistic PGA outright board: a short ladder of contenders plus a long
 * tail of no-hopers, the way a 150-man field is actually priced.
 *
 * Building this by hand the first time produced a market whose implied
 * probabilities summed to 0.22 — i.e. no vig at all — on which every
 * de-vig method is just normalization and therefore identical. The test
 * passed nothing and proved nothing. Hence the explicit premise check:
 * a de-vig test is meaningless unless there is vig to remove.
 */
function pgaField() {
  const contenders = [550, 900, 1200, 1600, 2000, 2500, 3000, 4000, 5000, 6000];
  const tail = Array.from({ length: 60 }, () => 8000);
  return contenders.concat(tail); // sums to ≈ 1.31, a ~31% hold — normal for outrights
}

test("the golf test fixture actually contains vig", () => {
  const q = pgaField().map(edge.americanToProb);
  const sum = edge.overround(q);
  assert.ok(sum > 1.2, `fixture must be overround to be worth de-vigging, got ${sum}`);
});

test("shin agrees with the others on two-ways but diverges on a big field", () => {
  const two = edge.devigAmerican([-150, 130], "shin");
  const mult2 = edge.devigAmerican([-150, 130], "multiplicative");
  close(two[0], mult2[0], 0.02); // same ballpark on a 2-way

  const field = pgaField();
  const last = field.length - 1;
  const shin = edge.devigAmerican(field, "shin");
  const mult = edge.devigAmerican(field, "multiplicative");
  // On a longshot-heavy board the two methods must NOT agree — if they
  // did, choosing a method would be pointless.
  assert.ok(Math.abs(shin[last] - mult[last]) > 1e-4);
  assert.ok(shin[last] < mult[last], "shin should shade the longest price down");
  assert.ok(shin[0] > mult[0], "and leave more probability with the favourite");
});

test("power also shades the golf tail below multiplicative", () => {
  const field = pgaField();
  const last = field.length - 1;
  const pow = edge.devigAmerican(field, "power");
  const mult = edge.devigAmerican(field, "multiplicative");
  assert.ok(pow[last] < mult[last]);
});

test("additive de-vig never emits a negative probability", () => {
  // Naive subtraction would push the longshot below zero here.
  const p = edge.devigAmerican([-2000, 1500, 3000], "additive");
  assert.ok(p.every((x) => x > 0));
  close(edge.overround(p), 1, 1e-9);
});

test("incomplete or unpriceable markets return null, not a guess", () => {
  assert.equal(edge.devigAmerican([-110], "multiplicative"), null);
  assert.equal(edge.devigAmerican([], "multiplicative"), null);
  assert.equal(edge.devigAmerican([-110, 0], "multiplicative"), null);
});

/* ---------------------------------------------------------------- *
 * Value
 * ---------------------------------------------------------------- */

test("EV is zero at a fair price and scales with the edge", () => {
  close(edge.evPct(0.5, 2.0), 0);
  close(edge.evPct(0.55, 2.0), 0.1);
  close(edge.evPct(0.45, 2.0), -0.1);
});

test("EV of a true 50% shot at +110", () => {
  close(edge.evPct(0.5, edge.americanToDecimal(110)), 0.05);
});

test("kelly: full stake matches (p·d − 1)/(d − 1)", () => {
  close(edge.kelly(0.55, 2.0, 1), 0.1);
  close(edge.kelly(0.6, 2.5, 1), (0.6 * 2.5 - 1) / 1.5);
});

test("kelly defaults to quarter stake", () => {
  close(edge.kelly(0.55, 2.0), 0.025);
});

test("kelly refuses to bet without an edge", () => {
  assert.equal(edge.kelly(0.5, 2.0, 1), 0);
  assert.equal(edge.kelly(0.4, 2.0, 1), 0);
});

test("break-even probability is what the price demands", () => {
  close(edge.breakEvenProb(-110), 110 / 210);
});

test("CLV is positive when you beat the close", () => {
  // Bet +100 (needs 50%), closed -110 (needs 52.38%) → you got the better number.
  close(edge.clvPct(100, -110), (110 / 210) / 0.5 - 1);
  assert.ok(edge.clvPct(100, -110) > 0);
  assert.ok(edge.clvPct(-110, 100) < 0);
  close(edge.clvPct(-110, -110), 0);
});

/* ---------------------------------------------------------------- *
 * Market edge engine
 * ---------------------------------------------------------------- */

const BOOKS = [
  { book: "A", outcomes: [{ name: "Yankees", price: -150 }, { name: "Red Sox", price: 130 }] },
  { book: "B", outcomes: [{ name: "Yankees", price: -145 }, { name: "Red Sox", price: 125 }] },
  { book: "C", outcomes: [{ name: "Yankees", price: -155 }, { name: "Red Sox", price: 135 }] },
  { book: "D", outcomes: [{ name: "Yankees", price: -150 }, { name: "Red Sox", price: 160 }] },
];

test("market edge finds the outlier price and prices it correctly", () => {
  const rows = edge.marketEdges(BOOKS, { method: "multiplicative" });
  const rs = rows.find((r) => r.name === "Red Sox");
  assert.equal(rs.bestBook, "D");
  assert.equal(rs.bestPrice, 160);
  // Consensus of A/B/C (D excluded): median of .42017, .42888, .41179 = .42017
  close(rs.fairProb, 0.42017, 1e-4);
  close(rs.ev, 0.42017 * 2.6 - 1, 1e-4); // ≈ +9.2%
  assert.ok(rs.ev > 0.09);
});

test("the best-priced book is excluded from its own consensus", () => {
  // If D voted on itself the consensus would drag toward D's own number
  // and the edge would shrink. Confirm the reported consensus is exactly
  // the median of the other three.
  const rows = edge.marketEdges(BOOKS, { method: "multiplicative" });
  const rs = rows.find((r) => r.name === "Red Sox");
  assert.equal(rs.nBooks, 3);

  const others = BOOKS.filter((b) => b.book !== "D").map((b) => {
    const p = edge.devigAmerican(b.outcomes.map((o) => o.price), "multiplicative");
    return p[1];
  });
  close(rs.fairProb, edge.median(others), 1e-9);
});

test("a market where every book agrees yields no meaningful edge", () => {
  const flat = ["A", "B", "C", "D"].map((book) => ({
    book,
    outcomes: [{ name: "Home", price: -110 }, { name: "Away", price: -110 }],
  }));
  const rows = edge.marketEdges(flat, { method: "multiplicative" });
  for (const r of rows) {
    // Fair is 50%, best price is -110 → you pay the full vig.
    close(r.ev, 0.5 * edge.americanToDecimal(-110) - 1, 1e-9);
    assert.ok(r.ev < 0, "paying vig into a flat market must be −EV");
  }
});

test("market edge refuses to opine with too few books", () => {
  assert.deepEqual(edge.marketEdges(BOOKS.slice(0, 2), { minBooks: 3 }), []);
  assert.deepEqual(edge.marketEdges([], {}), []);
});

test("books that don't price the whole market are skipped, not half-used", () => {
  const withPartial = BOOKS.concat([
    { book: "E", outcomes: [{ name: "Yankees", price: -101 }] }, // no Red Sox price
  ]);
  const rows = edge.marketEdges(withPartial, { method: "multiplicative" });
  const yanks = rows.find((r) => r.name === "Yankees");
  // E offers the best Yankees price but can't be de-vigged, so it must not
  // become the reference — and it must not silently vanish from `bestBook`
  // either, since the price is real and available.
  assert.equal(yanks.bestBook, "E");
  assert.ok(yanks.nBooks >= 3, "consensus still drawn from complete books");
});

test("rows come back sorted by EV, best first", () => {
  const rows = edge.marketEdges(BOOKS, {});
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ev >= rows[i].ev);
});

/* ---------------------------------------------------------------- *
 * Model pricing
 * ---------------------------------------------------------------- */

test("poisson over-probability for a strikeout prop", () => {
  // λ = 6.5, line 5.5 → P(X ≥ 6) = 1 − P(X ≤ 5)
  let cdf = 0,
    term = Math.exp(-6.5);
  for (let i = 0; i <= 5; i++) {
    cdf += term;
    term *= 6.5 / (i + 1);
  }
  close(edge.poissonOverProb(6.5, 5.5), 1 - cdf, 1e-12);
  close(edge.poissonOverProb(6.5, 5.5), 0.63096, 1e-4);
});

test("poisson over-probability falls as the line rises", () => {
  const a = edge.poissonOverProb(6.5, 4.5);
  const b = edge.poissonOverProb(6.5, 6.5);
  const c = edge.poissonOverProb(6.5, 9.5);
  assert.ok(a > b && b > c);
});

test("normal over-probability is 50% at the mean", () => {
  close(edge.normalOverProb(250, 50, 250), 0.5, 1e-6);
  assert.ok(edge.normalOverProb(250, 50, 300) < 0.5);
  assert.ok(edge.normalOverProb(250, 50, 200) > 0.5);
});

test("normal cdf hits its known landmarks", () => {
  close(edge.normalCdf(0), 0.5, 1e-6);
  close(edge.normalCdf(1.96), 0.975, 1e-4);
  close(edge.normalCdf(-1.96), 0.025, 1e-4);
});

test("blending shrinks a bold model toward the market", () => {
  const blended = edge.blendWithMarket(0.7, 0.5, 0.3);
  close(blended, 0.56);
  assert.ok(blended < 0.7, "must move toward the market, not away");
  close(edge.blendWithMarket(0.7, 0.5, 0), 0.5); // zero trust = pure market
  close(edge.blendWithMarket(0.7, 0.5, 1), 0.7); // full trust = pure model
});

/* ---------------------------------------------------------------- *
 * Presentation
 * ---------------------------------------------------------------- */

test("star thresholds are stingy", () => {
  assert.equal(edge.edgeStars(0.06), 3);
  assert.equal(edge.edgeStars(0.035), 2);
  assert.equal(edge.edgeStars(0.02), 1);
  assert.equal(edge.edgeStars(0.01), 0);
  assert.equal(edge.edgeStars(-0.05), 0);
});

test("formatting", () => {
  assert.equal(edge.formatAmerican(150), "+150");
  assert.equal(edge.formatAmerican(-110), "-110");
  assert.equal(edge.formatPct(0.042), "+4.2%");
  assert.equal(edge.formatPct(-0.018), "-1.8%");
});
