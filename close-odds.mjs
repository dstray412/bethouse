/*
 * BetHouse — close-odds.mjs
 * Freeze the last price seen before each game starts.
 *
 *   node close-odds.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * `odds-data.js` is a snapshot: every refresh overwrites it, so the price a
 * market closed at is gone an hour later. Closing line value — whether you
 * bet at a better number than the market settled on — is the one measure that
 * separates being good from being lucky, and it cannot be computed after the
 * fact from anything this repo keeps.
 *
 * So: on every odds refresh, write the current price for every market whose
 * game has NOT started yet. Each run overwrites the last, which means the
 * final write before first pitch is the closing line, by construction. Once
 * a game starts its entry stops being touched and is frozen for good.
 *
 * There is no cleverness here and there deliberately is not: no attempt to
 * detect "the last run before the game", no scheduling, nothing that has to
 * be right about the clock beyond "has this started". Overwrite-while-open is
 * self-correcting — a missed run costs precision, never correctness.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * Fill in the past. A game that has already started today has no closing
 * price stored and never will. Same rule as the forward records: nothing is
 * backfilled, because a price reconstructed afterwards is indistinguishable
 * from a price chosen afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./fetch-odds-espn.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "odds-close");

function load(file, global_) {
  const f = path.join(DIR, file);
  if (!fs.existsSync(f)) return null;
  const w = {};
  try {
    new Function("window", fs.readFileSync(f, "utf8"))(w);
  } catch {
    return null;
  }
  return w[global_] || null;
}

const board = load("mlb-data.js", "BETHOUSE_MLB");
const odds = load("odds-data.js", "BetHouseOdds");

if (!board || !Array.isArray(board.games)) {
  console.log("No board to match against — nothing to freeze.");
  process.exit(0);
}
if (!odds || !odds.markets || !Object.keys(odds.markets).length) {
  console.log("No prices on the feed — nothing to freeze.");
  process.exit(0);
}

/* Which game each hitter is in, and when it starts. The odds feed carries a
   player name and nothing else, so this is the only way to know whether a
   market is still open. */
const startFor = new Map();
for (const g of board.games) {
  for (const side of ["away", "home"]) {
    for (const p of g[side].lineup || []) {
      startFor.set(normalizeName(p.name), { gamePk: g.gamePk, startTime: g.startTime });
    }
  }
}

const date = board.date;
const file = path.join(OUT, `${date}.json`);
let held = { date, closed: {} };
if (fs.existsSync(file)) {
  try {
    held = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!held.closed) held.closed = {};
  } catch {
    /* A corrupt file costs today's closing prices, not the run. */
    held = { date, closed: {} };
  }
}

const now = Date.now();
let updated = 0, frozen = 0, unmatched = 0;

for (const [key, m] of Object.entries(odds.markets)) {
  const who = key.split("|")[0];
  const game = startFor.get(who);
  if (!game) {
    unmatched++;
    continue;
  }
  const t = Date.parse(game.startTime);
  if (isFinite(t) && now >= t) {
    /* Already under way: whatever is stored IS the close. Never touch it
       again — a price taken after first pitch is not a closing line. */
    if (held.closed[key]) frozen++;
    continue;
  }
  held.closed[key] = {
    name: m.name,
    market: m.market,
    line: m.line,
    over: m.over,
    under: m.under,
    noVigOver: m.noVigOver,
    hold: m.hold,
    gamePk: game.gamePk,
    startTime: game.startTime,
    capturedAt: odds.generated,
  };
  updated++;
}

fs.mkdirSync(OUT, { recursive: true });
/* Indent 1, no trailing newline: the same shape as every other generated
   record here, so the scheduled jobs and a local commit cannot disagree. */
fs.writeFileSync(file, JSON.stringify(held, null, 1));

console.log(
  `odds-close ${date}: ${updated} still open and re-priced, ${frozen} already closed, ` +
    `${Object.keys(held.closed).length} held in total`,
);
if (unmatched) {
  console.log(`  ${unmatched} priced players are not in any posted lineup — no game to match`);
}
