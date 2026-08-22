/*
 * BetHouse — lineup-context.mjs
 * Does who bats AHEAD of a hitter explain what the model gets wrong?
 *
 *   node lineup-context.mjs
 *
 * WHY THIS QUESTION
 * -----------------
 * 1+ H/R/RBI is a forgiving prop precisely because it has three ways to
 * cash, and two of them — the run and the RBI — are not really about the
 * hitter. They are about whether anyone was on base in front of him and
 * whether anyone drove him in. The model cannot see that. It gets team
 * runs per game, which is the whole lineup averaged over a season, and
 * nothing about the three men who will actually bat before this hitter
 * tonight.
 *
 * So the hypothesis: the board should run HOT on hitters with good on-base
 * ahead of them and COLD on hitters stuck behind three automatic outs.
 *
 * WHAT IS ACTUALLY MEASURED
 * -------------------------
 * The residual — what a group beat its own prediction by — and not the raw
 * cash rate. Raw rates would only rediscover that good lineups are full of
 * good hitters, which the model already knows and the market already
 * prices. The model has team runs/game before it makes its number, so
 * anything still moving the residual is information it did not have.
 *
 * Lineups come from the committed board snapshots: `git log mlb-data.js`
 * has a few dozen per day, and the one with the most CONFIRMED lineups is
 * the real batting order rather than a projection. Outcomes come from
 * history/, which track.mjs graded at the time. Nothing here is fetched
 * and nothing can look ahead: the OBP used is the season-to-date figure
 * the board itself was holding that morning.
 *
 * THE ANSWER IS NO. See the table it prints, and the README.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HIST = path.join(DIR, "history");

/* ---------------------------------------------------------------- *
 * 1. One board snapshot per day, preferring real batting orders
 * ---------------------------------------------------------------- */

function collectLineups() {
  const log = execSync('git log --format="%H %s" --all -- mlb-data.js', {
    encoding: "utf8", maxBuffer: 1e8, cwd: DIR,
  });
  const byDate = new Map();
  for (const line of log.split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) board: (\d{4}-\d\d-\d\d)/);
    if (!m) continue;
    if (!byDate.has(m[2])) byDate.set(m[2], []);
    byDate.get(m[2]).push(m[1]);
  }

  const out = {};
  for (const [date, shas] of [...byDate].sort()) {
    let best = null;
    for (const sha of shas) {                       // newest commit first
      let src;
      try { src = execSync(`git show ${sha}:mlb-data.js`, {encoding:"utf8", maxBuffer:1e8, cwd:DIR}); }
      catch { continue; }
      const w = {};
      try { new Function("window", src)(w); } catch { continue; }
      const D = w.BETHOUSE_MLB;
      if (!D || D.date !== date) continue;
      let confirmed = 0, players = 0;
      for (const g of D.games) for (const s of ["away", "home"]) {
        const L = g[s].lineup || [];
        players += L.length;
        if (g[s].confirmed && L.length) confirmed++;
      }
      if (!best || confirmed > best.confirmed) best = { confirmed, players, D };
      if (confirmed >= 24) break;                   // enough; stop scanning this day
    }
    if (!best || !best.players) continue;

    const lineups = {};
    for (const g of best.D.games) for (const s of ["away", "home"]) {
      const L = g[s].lineup || [];
      if (!L.length) continue;
      lineups[`${g.gamePk}|${s}`] = {
        confirmed: !!g[s].confirmed,
        team: g[s].team,
        spots: L.map((p) => ({ slot: p.slot, obp: Number(p.obp), pa: p.pa })),
      };
    }
    out[date] = lineups;
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * 2. Join to graded outcomes
 * ---------------------------------------------------------------- */

function buildRows(LIN) {
  const rows = [];
  for (const f of fs.readdirSync(HIST).filter((x) => /^\d{4}-\d\d-\d\d\.json$/.test(x)).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(HIST, f), "utf8")); } catch { continue; }
    const day = LIN[d.date];
    if (!day) continue;

    for (const p of d.predictions || []) {
      if (p.prop !== "hrr" || p.actual == null || !p.slot) continue;

      let side = null;
      for (const k of Object.keys(day)) {
        if (!k.startsWith(p.gamePk + "|")) continue;
        if (day[k].team === p.team) { side = day[k]; break; }
      }
      // A projected order is a guess at the slot, which would blur exactly
      // the thing being measured. Confirmed orders only.
      if (!side || !side.confirmed) continue;

      const bySlot = new Map(side.spots.map((s) => [s.slot, s]));
      const ahead = [];
      for (let i = 1; i <= 3; i++) {
        const slot = ((p.slot - 1 - i + 9) % 9) + 1;   // slot 1 is behind 9, 8, 7
        const s = bySlot.get(slot);
        if (s && isFinite(s.obp) && s.pa >= 50) ahead.push(s.obp);
      }
      if (ahead.length < 3) continue;                  // no partial context

      rows.push({
        date: d.date,
        obpAhead: ahead.reduce((a, b) => a + b, 0) / 3,
        prob: p.prob,
        actual: p.actual,
      });
    }
  }
  return rows;
}

/* ---------------------------------------------------------------- *
 * 3. Report
 * ---------------------------------------------------------------- */

function report(label, set) {
  if (set.length < 200) { console.log(`${label}: only ${set.length} rows, skipped\n`); return; }
  const sorted = [...set].sort((a, b) => a.obpAhead - b.obpAhead);
  const q = Math.floor(sorted.length / 4);
  const bands = [
    ["worst quarter", sorted.slice(0, q)],
    ["second       ", sorted.slice(q, 2 * q)],
    ["third        ", sorted.slice(2 * q, 3 * q)],
    ["best quarter ", sorted.slice(3 * q)],
  ];
  console.log(`${label}  (${set.length} player-games)`);
  console.log("  on-base ahead      n     OBP    model said   hit     model off by");
  const ends = [];
  for (const [name, b] of bands) {
    const obp = b.reduce((a, r) => a + r.obpAhead, 0) / b.length;
    const pred = b.reduce((a, r) => a + r.prob, 0) / b.length;
    const act = b.reduce((a, r) => a + r.actual, 0) / b.length;
    const se = Math.sqrt(b.reduce((a, r) => a + r.prob * (1 - r.prob), 0)) / b.length;
    const diff = act - pred;
    console.log(
      `  ${name}  ${String(b.length).padStart(5)}   .${(1000 * obp).toFixed(0)}   ` +
      `${(100 * pred).toFixed(1)}%      ${(100 * act).toFixed(1)}%   ` +
      `${(diff >= 0 ? "+" : "") + (100 * diff).toFixed(2)}pp  (se ${(100 * se).toFixed(2)}pp)`,
    );
    ends.push({ diff, se });
  }
  const d = ends[3].diff - ends[0].diff;
  const se = Math.sqrt(ends[0].se ** 2 + ends[3].se ** 2);
  console.log(`  best minus worst: ${(d >= 0 ? "+" : "") + (100 * d).toFixed(2)}pp   ` +
              `se ${(100 * se).toFixed(2)}pp   z = ${(d / se).toFixed(2)}`);
  console.log(`  ${Math.abs(d / se) >= 2 ? "^ clears the bar on this window" : "^ nothing here"}\n`);
}

const LIN = collectLineups();
const rows = buildRows(LIN);
const dates = [...new Set(rows.map((r) => r.date))].sort();
const mid = dates[Math.floor(dates.length / 2)];

console.log(`\n${"=".repeat(72)}`);
console.log("LINEUP CONTEXT — does on-base ahead of a hitter move the residual?");
console.log("=".repeat(72));
console.log(`${rows.length} confirmed-lineup player-games over ${dates.length} days\n`);

report("ALL DAYS   ", rows);
/* One window is a candidate, not a constant. The two halves share no games. */
report("FIRST HALF ", rows.filter((r) => r.date < mid));
report("SECOND HALF", rows.filter((r) => r.date >= mid));
