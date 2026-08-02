/*
 * BetHouse — edge.js
 * The math core. Odds conversion, vig removal, expected value, Kelly staking.
 *
 * UMD-ish: loads as a plain <script> in the browser (sets window.BetHouseEdge)
 * and imports in Node (`import edge from './edge.js'`) so the fetchers and
 * `node --test` run the exact same code the app runs. No duplication.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseEdge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Odds conversion
   *
   * American odds are the display format; decimal is the math format
   * (decimal = total return per $1 staked, including the stake back).
   * ------------------------------------------------------------------ */

  function americanToDecimal(a) {
    a = Number(a);
    if (!isFinite(a) || a === 0) return NaN;
    return a > 0 ? a / 100 + 1 : 100 / -a + 1;
  }

  function decimalToAmerican(d) {
    d = Number(d);
    if (!isFinite(d) || d <= 1) return NaN;
    // Even money (2.0) is conventionally +100.
    return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
  }

  /** Implied probability straight off the price — still contains the vig. */
  function americanToProb(a) {
    const d = americanToDecimal(a);
    return isFinite(d) ? 1 / d : NaN;
  }

  function decimalToProb(d) {
    d = Number(d);
    return isFinite(d) && d > 1 ? 1 / d : NaN;
  }

  function probToDecimal(p) {
    p = Number(p);
    return p > 0 && p < 1 ? 1 / p : NaN;
  }

  function probToAmerican(p) {
    return decimalToAmerican(probToDecimal(p));
  }

  /** "+140" / "-110" for display. */
  function formatAmerican(a) {
    if (!isFinite(a)) return "—";
    a = Math.round(a);
    return a > 0 ? "+" + a : String(a);
  }

  /* ------------------------------------------------------------------ *
   * 2. Vig removal (de-vigging)
   *
   * A book's prices imply probabilities that sum to more than 1. The
   * excess is the hold. Removing it recovers the book's actual opinion,
   * which is the only thing worth comparing prices against.
   *
   * Which method you pick genuinely changes the answer on lopsided
   * markets — see the note on `power` below.
   * ------------------------------------------------------------------ */

  /** Total implied probability. 1.048 means the book holds 4.8%. */
  function overround(rawProbs) {
    return rawProbs.reduce((s, q) => s + q, 0);
  }

  /** Hold as a fraction of the overround: the book's theoretical margin. */
  function holdPct(rawProbs) {
    const s = overround(rawProbs);
    return s > 0 ? (s - 1) / s : NaN;
  }

  /** Scale every probability by the same factor. Fast, and the default. */
  function devigMultiplicative(q) {
    const s = overround(q);
    return q.map((x) => x / s);
  }

  /**
   * Take an equal slice of the vig off each outcome.
   * Fine on balanced two-ways, but it can push a heavy longshot negative,
   * so we clamp and renormalize rather than return nonsense.
   */
  function devigAdditive(q) {
    const excess = (overround(q) - 1) / q.length;
    const out = q.map((x) => Math.max(1e-9, x - excess));
    const s = overround(out);
    return out.map((x) => x / s);
  }

  /**
   * Power method: find k such that sum(q_i^k) === 1.
   *
   * Books don't spread vig evenly — they load more of it onto longshots
   * (the favourite-longshot bias). Raising to a power takes proportionally
   * more off the long prices, which is closer to how the book actually
   * priced it. This matters most on big fields: a 60-man PGA outright
   * board de-vigged multiplicatively will systematically overstate every
   * longshot's fair chance, and manufacture "edges" that aren't there.
   */
  function devigPower(q) {
    let lo = 1,
      hi = 10;
    // Guard: if the book is somehow underround, k drops below 1.
    if (overround(q) < 1) lo = 0.05;
    const sumAt = (k) => q.reduce((s, x) => s + Math.pow(x, k), 0);
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (sumAt(mid) > 1) lo = mid;
      else hi = mid;
    }
    const k = (lo + hi) / 2;
    const out = q.map((x) => Math.pow(x, k));
    const s = overround(out);
    return out.map((x) => x / s); // normalize away bisection residue
  }

  /**
   * Shin method: models the vig as the book protecting itself against
   * insider money, and solves for that insider proportion z.
   *
   *   p_i = ( sqrt(z^2 + 4(1-z) * q_i^2 / Q) - z ) / (2(1-z)),  Q = sum(q)
   *
   * Widely considered the best-behaved estimator on many-outcome markets,
   * which is exactly the golf outright case.
   */
  function devigShin(q) {
    const Q = overround(q);
    const probsAt = (z) => {
      const denom = 2 * (1 - z);
      return q.map((x) => {
        const inner = z * z + (4 * (1 - z) * x * x) / Q;
        return (Math.sqrt(Math.max(0, inner)) - z) / denom;
      });
    };
    let lo = 0,
      hi = 0.5;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      // Higher z pulls the sum down; find where it crosses 1.
      if (overround(probsAt(mid)) > 1) lo = mid;
      else hi = mid;
    }
    const out = probsAt((lo + hi) / 2);
    const s = overround(out);
    return out.map((x) => x / s);
  }

  const DEVIG_METHODS = {
    multiplicative: devigMultiplicative,
    additive: devigAdditive,
    power: devigPower,
    shin: devigShin,
  };

  /**
   * De-vig a complete set of American prices into fair probabilities.
   * Returns null if the set is incomplete or unpriceable — callers must
   * skip those markets rather than trust a partial de-vig.
   */
  function devigAmerican(prices, method) {
    if (!Array.isArray(prices) || prices.length < 2) return null;
    const q = prices.map(americanToProb);
    if (q.some((x) => !isFinite(x) || x <= 0 || x >= 1)) return null;
    const fn = DEVIG_METHODS[method] || devigMultiplicative;
    const p = fn(q);
    if (p.some((x) => !isFinite(x) || x <= 0 || x >= 1)) return null;
    return p;
  }

  /* ------------------------------------------------------------------ *
   * 3. Value
   * ------------------------------------------------------------------ */

  /**
   * Expected profit per $1 staked, as a fraction.
   * 0.042 means +4.2% EV: risk $100 to make $4.20 on average.
   */
  function evPct(pTrue, decOdds) {
    if (!(pTrue > 0 && pTrue < 1) || !(decOdds > 1)) return NaN;
    return pTrue * decOdds - 1;
  }

  /**
   * Kelly stake as a fraction of bankroll.
   *
   * Full Kelly is the growth-optimal bet *if your probability is exactly
   * right*. It never is, so `fraction` defaults to quarter-Kelly — the
   * standard hedge against your own model being off.
   */
  function kelly(pTrue, decOdds, fraction) {
    if (!(pTrue > 0 && pTrue < 1) || !(decOdds > 1)) return 0;
    const b = decOdds - 1;
    const f = (pTrue * decOdds - 1) / b;
    if (!(f > 0)) return 0; // no edge, no bet
    return Math.min(1, f) * (fraction == null ? 0.25 : fraction);
  }

  /** The break-even probability a price demands. */
  function breakEvenProb(american) {
    return americanToProb(american);
  }

  /**
   * Closing line value: did you beat the number the market settled on?
   * Positive CLV is the best available evidence that a bet was good,
   * independent of whether it won.
   */
  function clvPct(betAmerican, closeAmerican) {
    const pBet = americanToProb(betAmerican);
    const pClose = americanToProb(closeAmerican);
    if (!isFinite(pBet) || !isFinite(pClose) || pBet <= 0) return NaN;
    return pClose / pBet - 1;
  }

  /* ------------------------------------------------------------------ *
   * 4. Market edge — the no-model engine
   *
   * Given the same market priced by several books: de-vig each book to
   * get its true opinion, take the consensus of those opinions, then ask
   * whether anyone is offering a price that beats the consensus.
   *
   * The one detail that makes this honest: when judging a price from
   * book X, book X is EXCLUDED from the consensus. Otherwise a book is
   * partly grading its own homework and every outlier looks average.
   * ------------------------------------------------------------------ */

  function median(xs) {
    if (!xs.length) return NaN;
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * @param {Array} books  [{ book, outcomes: [{ name, price }] }]
   * @param {Object} opts  { method, minBooks, sharpBooks }
   * @returns {Array} one row per outcome, best price first by EV
   *
   * If `sharpBooks` is given, consensus comes only from those books
   * (the Pinnacle-as-reference approach). Otherwise every book votes.
   */
  function marketEdges(books, opts) {
    opts = opts || {};
    const method = opts.method || "multiplicative";
    const minBooks = opts.minBooks == null ? 3 : opts.minBooks;
    const sharp = opts.sharpBooks && opts.sharpBooks.length ? new Set(opts.sharpBooks) : null;

    // Outcome order is fixed by the first book so every row lines up.
    if (!Array.isArray(books) || !books.length) return [];
    const names = books[0].outcomes.map((o) => o.name);

    // Step 1: de-vig each book that prices the complete market.
    const opinions = []; // { book, probs: {name -> p} }
    for (const b of books) {
      if (!b || !Array.isArray(b.outcomes) || b.outcomes.length !== names.length) continue;
      const byName = new Map(b.outcomes.map((o) => [o.name, o.price]));
      if (names.some((n) => !byName.has(n))) continue;
      const fair = devigAmerican(names.map((n) => byName.get(n)), method);
      if (!fair) continue;
      const probs = {};
      names.forEach((n, i) => (probs[n] = fair[i]));
      opinions.push({ book: b.book, probs });
    }
    if (opinions.length < minBooks) return [];

    // Step 2: for each outcome, find the best price on offer.
    const rows = [];
    for (const name of names) {
      let best = null;
      for (const b of books) {
        const o = (b.outcomes || []).find((x) => x.name === name);
        if (!o || !isFinite(americanToDecimal(o.price))) continue;
        if (!best || americanToDecimal(o.price) > americanToDecimal(best.price)) {
          best = { book: b.book, price: o.price };
        }
      }
      if (!best) continue;

      // Step 3: consensus from every *other* book.
      const pool = opinions.filter(
        (op) => op.book !== best.book && (!sharp || sharp.has(op.book))
      );
      if (pool.length < Math.max(1, minBooks - 1)) continue;
      const pTrue = median(pool.map((op) => op.probs[name]));
      if (!(pTrue > 0 && pTrue < 1)) continue;

      const dec = americanToDecimal(best.price);
      rows.push({
        name,
        bestBook: best.book,
        bestPrice: best.price,
        fairProb: pTrue,
        fairPrice: probToAmerican(pTrue),
        ev: evPct(pTrue, dec),
        kelly: kelly(pTrue, dec, opts.kellyFraction),
        nBooks: pool.length,
      });
    }
    return rows.sort((a, b) => b.ev - a.ev);
  }

  /* ------------------------------------------------------------------ *
   * 5. Model edge — your projection vs the market
   * ------------------------------------------------------------------ */

  /**
   * Probability a Poisson count clears a half-point line (e.g. strikeouts).
   * Half-point lines only — no push case to handle, which is why props
   * are quoted at .5 in the first place.
   */
  function poissonOverProb(lambda, line) {
    if (!(lambda > 0)) return NaN;
    const k = Math.floor(line); // P(X > line) === P(X >= k+1)
    let cdf = 0,
      term = Math.exp(-lambda);
    for (let i = 0; i <= k; i++) {
      cdf += term;
      term *= lambda / (i + 1);
    }
    return 1 - cdf;
  }

  /** Probability a normal projection clears a line (yards, points, rebounds). */
  function normalOverProb(mean, sd, line) {
    if (!(sd > 0)) return NaN;
    return 1 - normalCdf((line - mean) / sd);
  }

  function normalCdf(z) {
    // Abramowitz & Stegun 7.1.26 via erf; plenty accurate for pricing.
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
    const p =
      d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  /**
   * Pull a model projection toward the market before pricing it.
   *
   * The market is a strong forecast. A raw model that disagrees wildly is
   * usually wrong, not brilliant. Shrinking toward the market's implied
   * probability kills most false edges; `weight` is how much you trust
   * the model (0.3 = trust the market roughly 70%).
   */
  function blendWithMarket(pModel, pMarket, weight) {
    if (!isFinite(pModel)) return pMarket;
    if (!isFinite(pMarket)) return pModel;
    const w = weight == null ? 0.3 : Math.max(0, Math.min(1, weight));
    return w * pModel + (1 - w) * pMarket;
  }

  /* ------------------------------------------------------------------ *
   * 6. Presentation helpers
   * ------------------------------------------------------------------ */

  /** Star rating for an edge. Deliberately stingy — see README. */
  function edgeStars(ev) {
    if (!isFinite(ev)) return 0;
    if (ev >= 0.05) return 3;
    if (ev >= 0.03) return 2;
    if (ev >= 0.015) return 1;
    return 0;
  }

  function formatPct(x, digits) {
    if (!isFinite(x)) return "—";
    return (x >= 0 ? "+" : "") + (x * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  return {
    americanToDecimal,
    decimalToAmerican,
    americanToProb,
    decimalToProb,
    probToDecimal,
    probToAmerican,
    formatAmerican,
    overround,
    holdPct,
    devigAmerican,
    devigMultiplicative,
    devigAdditive,
    devigPower,
    devigShin,
    DEVIG_METHODS,
    evPct,
    kelly,
    breakEvenProb,
    clvPct,
    marketEdges,
    poissonOverProb,
    normalOverProb,
    normalCdf,
    blendWithMarket,
    edgeStars,
    formatPct,
    median,
  };
});
