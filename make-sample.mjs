/*
 * BetHouse — make-sample.mjs
 * Generates sample-odds.js so the app is usable before you have an API key.
 *
 *   node make-sample.mjs
 *
 * This does NOT hand-write plausible-looking numbers. It simulates the way a
 * real board comes to exist:
 *
 *   1. pick a true probability for each outcome
 *   2. give each book a slightly different opinion of it (books disagree)
 *   3. add each book's hold on top (books charge vig)
 *   4. round to the increments books actually quote in
 *
 * That matters because the edge engine's whole job is separating genuine
 * disagreement from vig. Numbers invented by hand tend to be either
 * suspiciously uniform (no edges at all) or wildly inconsistent (edges
 * everywhere), and both would give a false read on whether the app works.
 *
 * Seeded, so the board is identical on every run and the screenshots in
 * README stay true.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import edge from "./edge.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/* Deterministic PRNG (mulberry32) — no Math.random, so runs are reproducible. */
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260801);
const jitter = (scale) => (rand() * 2 - 1) * scale;

const BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "BetRivers", "ESPN BET"];

/** Books quote moneylines in increments of 5, and this rounding is itself
 *  a source of real edges — a line that rounds your way is free value. */
function quoteAmerican(prob) {
  const a = edge.probToAmerican(prob);
  if (!isFinite(a)) return null;
  const step = Math.abs(a) >= 1000 ? 50 : Math.abs(a) >= 300 ? 25 : 5;
  const rounded = Math.round(a / step) * step;
  // Books don't quote between -100 and +100; snap across the gap.
  if (rounded > -100 && rounded < 100) return rounded >= 0 ? 100 : -100;
  return rounded;
}

/**
 * Price a two-way market at every book.
 * @param pTrue        true probability of the first outcome
 * @param names        [outcomeA, outcomeB]
 * @param opts.spread  how much books disagree (in probability)
 * @param opts.hold    baseline vig
 * @param opts.rogue   index of a book given a deliberately stale number
 */
function twoWay(pTrue, names, opts = {}) {
  const spread = opts.spread ?? 0.012;
  const baseHold = opts.hold ?? 0.045;
  return BOOKS.map((book, i) => {
    let p = pTrue + jitter(spread);
    if (opts.rogue === i) p += opts.rogueShift ?? 0.035; // a book slow to move
    p = Math.min(0.97, Math.max(0.03, p));
    const hold = baseHold + jitter(0.01);
    // Split the hold across both sides, the way a book actually books it.
    const qA = p * (1 + hold);
    const qB = (1 - p) * (1 + hold);
    return {
      book,
      updated: new Date(Date.UTC(2026, 7, 1, 22, 40 + i)).toISOString(),
      outcomes: [
        { name: names[0], price: quoteAmerican(qA), point: opts.pointA },
        { name: names[1], price: quoteAmerican(qB), point: opts.pointB },
      ],
    };
  });
}

/** Outright field (golf): many outcomes, big hold, longshot bias. */
function outrights(field, opts = {}) {
  const baseHold = opts.hold ?? 0.28;
  return BOOKS.map((book, i) => {
    const hold = baseHold + jitter(0.04);
    return {
      book,
      updated: new Date(Date.UTC(2026, 7, 1, 22, 30 + i)).toISOString(),
      outcomes: field.map((f, j) => {
        // ±10% relative. Tuning this is a two-sided problem: ±14% against a
        // thin field manufactured double-digit EV across half the board, but
        // ±5% against a realistic 24% hold produced no golf edges at all.
        // Books really do differ this much on outrights — +2000 at one shop
        // and +2500 at another is an ordinary Tuesday — which is exactly why
        // outrights are the softest market on the wall.
        let p = f.p * (1 + jitter(0.10));
        if (opts.rogue === i && j === (opts.rogueIdx ?? 0)) p *= 1 + (opts.rogueShift ?? 0.3);
        // Longshot bias: books shade long prices harder than short ones.
        const shade = 1 + hold * (1 + 0.7 * (1 - Math.min(1, f.p * 8)));
        return { name: f.name, price: quoteAmerican(Math.min(0.9, p * shade)) };
      }),
    };
  });
}

const iso = (h, m = 0) => new Date(Date.UTC(2026, 7, 1, h, m)).toISOString();
const markets = [];
const add = (m) => markets.push(m);

/* ---------------------------------------------------------------- *
 * MLB — in season on this date
 * ---------------------------------------------------------------- */
const mlbGames = [
  { away: "New York Yankees", home: "Boston Red Sox", pHome: 0.455, t: iso(23, 5), total: 8.5, pOver: 0.505 },
  { away: "Los Angeles Dodgers", home: "San Diego Padres", pHome: 0.44, t: iso(2, 10), total: 8.0, pOver: 0.49 },
  { away: "Philadelphia Phillies", home: "Atlanta Braves", pHome: 0.525, t: iso(23, 20), total: 9.0, pOver: 0.515 },
  { away: "Baltimore Orioles", home: "Tampa Bay Rays", pHome: 0.49, t: iso(23, 10), total: 7.5, pOver: 0.485 },
];
mlbGames.forEach((g, i) => {
  add({
    sport: "mlb", sportLabel: "MLB", eventId: `mlb-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "h2h",
    // A book that hasn't moved on late news. The shift has to exceed the
    // hold (~4.5%) to survive de-vigging — a 3-point stale line is just an
    // expensive line, not an edge.
    books: twoWay(g.pHome, [g.home, g.away], {
      spread: 0.014,
      rogue: i === 0 ? 4 : i === 3 ? 1 : undefined,
      rogueShift: 0.065,
    }),
  });
  add({
    sport: "mlb", sportLabel: "MLB", eventId: `mlb-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "totals",
    books: twoWay(g.pOver, ["Over", "Under"], { spread: 0.01, pointA: g.total, pointB: g.total }),
  });
});

/* ---------------------------------------------------------------- *
 * NFL — futures and early-season lines; the regular season is weeks out
 * ---------------------------------------------------------------- */
const nflGames = [
  { away: "Kansas City Chiefs", home: "Buffalo Bills", pHome: 0.53, t: iso(20, 25), spread: -1.5, pFav: 0.5 },
  { away: "San Francisco 49ers", home: "Philadelphia Eagles", pHome: 0.56, t: iso(20, 25), spread: -2.5, pFav: 0.505 },
  { away: "Detroit Lions", home: "Green Bay Packers", pHome: 0.485, t: iso(17, 0), spread: 1.0, pFav: 0.495 },
];
nflGames.forEach((g, i) => {
  add({
    sport: "nfl", sportLabel: "NFL", eventId: `nfl-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "h2h",
    books: twoWay(g.pHome, [g.home, g.away], { spread: 0.011 }),
  });
  add({
    sport: "nfl", sportLabel: "NFL", eventId: `nfl-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "spreads",
    books: twoWay(g.pFav, [g.home, g.away], {
      spread: 0.008, hold: 0.043, pointA: g.spread, pointB: -g.spread,
      rogue: i === 1 ? 2 : undefined, rogueShift: 0.03,
    }),
  });
});

/* ---------------------------------------------------------------- *
 * NBA — off-season on this date, so these are championship futures
 * ---------------------------------------------------------------- */
const nbaGames = [
  { away: "Boston Celtics", home: "Denver Nuggets", pHome: 0.545, t: iso(1, 30), total: 224.5, pOver: 0.5 },
  { away: "Oklahoma City Thunder", home: "Minnesota Timberwolves", pHome: 0.475, t: iso(2, 0), total: 219.5, pOver: 0.495 },
];
nbaGames.forEach((g, i) => {
  add({
    sport: "nba", sportLabel: "NBA", eventId: `nba-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "h2h",
    books: twoWay(g.pHome, [g.home, g.away], { spread: 0.013, rogue: i === 0 ? 1 : undefined, rogueShift: 0.032 }),
  });
  add({
    sport: "nba", sportLabel: "NBA", eventId: `nba-${i}`,
    home: g.home, away: g.away, commence: g.t, market: "totals",
    books: twoWay(g.pOver, ["Over", "Under"], { spread: 0.009, pointA: g.total, pointB: g.total }),
  });
});

/* ---------------------------------------------------------------- *
 * PGA Tour — outright winner, the market where de-vig method matters most
 * ---------------------------------------------------------------- */
const pgaField = [
  ["Scottie Scheffler", 0.155], ["Rory McIlroy", 0.085], ["Xander Schauffele", 0.06],
  ["Ludvig Åberg", 0.05], ["Collin Morikawa", 0.045], ["Viktor Hovland", 0.04],
  ["Jon Rahm", 0.038], ["Tommy Fleetwood", 0.03], ["Patrick Cantlay", 0.028],
  ["Justin Thomas", 0.026], ["Hideki Matsuyama", 0.024], ["Sahith Theegala", 0.02],
  ["Wyndham Clark", 0.018], ["Russell Henley", 0.017], ["Sungjae Im", 0.016],
  ["Tony Finau", 0.015], ["Jordan Spieth", 0.014], ["Sepp Straka", 0.013],
  ["Cameron Young", 0.012], ["Will Zalatoris", 0.011], ["Corey Conners", 0.010],
  ["Matt Fitzpatrick", 0.010], ["Sam Burns", 0.009], ["Akshay Bhatia", 0.008],
  ["Max Homa", 0.008], ["Ben Griffin", 0.007], ["Harris English", 0.007],
  ["Tom Kim", 0.006], ["Keegan Bradley", 0.006], ["Brian Harman", 0.005],
  // The rest of the field. Without it the listed probabilities sum to ~0.79,
  // which produced a 7.8% hold — a third of what an outright board really
  // charges, and it made the app's own "outrights carry the heaviest vig"
  // note read as wrong.
  ["Aaron Rai", 0.0095], ["Robert MacIntyre", 0.0092], ["Nick Taylor", 0.0088],
  ["Si Woo Kim", 0.0085], ["Taylor Pendrith", 0.0082], ["Adam Scott", 0.0080],
  ["J.T. Poston", 0.0078], ["Davis Thompson", 0.0075], ["Cam Davis", 0.0072],
  ["Denny McCarthy", 0.0070], ["Alex Noren", 0.0068], ["Chris Kirk", 0.0065],
  ["Mackenzie Hughes", 0.0062], ["Thomas Detry", 0.0060], ["Byeong Hun An", 0.0058],
  ["Kurt Kitayama", 0.0055], ["Max Greyserman", 0.0052], ["Rickie Fowler", 0.0050],
  ["Lucas Glover", 0.0048], ["Beau Hossler", 0.0045], ["Seamus Power", 0.0042],
  ["Andrew Putnam", 0.0040], ["Adam Hadwin", 0.0038], ["Eric Cole", 0.0035],
  ["Nate Lashley", 0.0032],
].map(([name, p]) => ({ name, p }));

add({
  sport: "pga", sportLabel: "PGA Tour", eventId: "pga-0",
  home: null, away: null, commence: iso(15, 0),
  eventName: "FedEx St. Jude Championship",
  market: "outrights",
  /* The stale price has to be LONGER than the field by more than the board's
     own hold (~24%) to survive de-vigging — otherwise the vig eats it and the
     row is correctly −EV. That is the honest reason outright boards seldom
     produce a bet: you are not beating one book's opinion, you are beating a
     24% margin. Modelled here as a book that hasn't shortened a player after
     he opened 64. */
  books: outrights(pgaField, { hold: 0.26, rogue: 3, rogueIdx: 6, rogueShift: -0.14 }),
});

/* ---------------------------------------------------------------- *
 * Write + self-check
 * ---------------------------------------------------------------- */

const payload = {
  fetchedAt: iso(22, 45),
  regions: "sample",
  sample: true,
  markets,
};

const banner =
  "/* Generated by make-sample.mjs — SAMPLE DATA, not real odds. */\n" +
  "/* Run `node fetch-odds.mjs` once you have an API key for the real board. */\n";
fs.writeFileSync(
  path.join(DIR, "sample-odds.js"),
  banner + "window.BETHOUSE_SAMPLE_ODDS = " + JSON.stringify(payload) + ";\n"
);

// Sanity: a sample board with no findable edges, or with absurd ones,
// would make the app look broken (or fake) rather than exercised.
let edgeCount = 0,
  best = null,
  holds = [];
for (const m of markets) {
  const q = m.books[0].outcomes.map((o) => edge.americanToProb(o.price));
  holds.push(edge.holdPct(q));
  const rows = edge.marketEdges(m.books, { method: m.market === "outrights" ? "shin" : "multiplicative" });
  for (const r of rows) {
    if (r.ev > 0.015) edgeCount++;
    if (!best || r.ev > best.ev) best = { ...r, market: m.market, sport: m.sportLabel };
  }
}
console.log(`Wrote sample-odds.js — ${markets.length} markets across 4 sports.`);
console.log(`Typical book hold: ${(edge.median(holds) * 100).toFixed(1)}%`);
console.log(`Findable edges (>1.5% EV): ${edgeCount}`);
console.log(
  `Best: ${best.sport} ${best.market} — ${best.name} ${edge.formatAmerican(best.bestPrice)} ` +
    `@ ${best.bestBook}, fair ${edge.formatAmerican(best.fairPrice)}, ${edge.formatPct(best.ev)} EV`
);
if (!edgeCount) console.error("WARNING: no edges in the sample board — the app will look empty.");
