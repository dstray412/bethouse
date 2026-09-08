#!/usr/bin/env node
/*
 * BetHouse — statcast.mjs
 * Last season's expected batting line for every hitter, as a prior.
 *
 *   node statcast.mjs            # writes statcast/<last season>.json
 *   node statcast.mjs 2024
 *
 * WHY
 * ---
 * The hitter model regresses a player's rate toward the LEAGUE average,
 * weighted by plate appearances (score.js, regressedPerPA). That is the
 * right shape and the wrong centre: a hitter is not a random draw from the
 * league, and by the time he has 300 PA the league average is a worse guess
 * at his true rate than his own history is. Statcast's expected batting
 * average is his history with the luck taken out -- what his batted balls
 * should have produced given how hard and at what angle he hit them -- and
 * last season's is fully known before the first pitch of this one. So it
 * can be the centre, and nothing about it can look ahead.
 *
 * The prior is per plate appearance, because the model is: hits/PA = xBA
 * times the player's own AB/PA from the same season, so a hitter who walks
 * a lot is not credited with hits on trips that ended in a walk. Three
 * more priors ride on the same join:
 *
 *   tb   total bases per PA, xSLG times AB/PA. Correlates 0.83 with the
 *        same season's actual TB/PA and matches its mean (0.368 vs 0.363).
 *   hr   home runs per PA, barrels per PA times the season's measured
 *        home runs per barrel (0.527 in 2025, ratio of sums over hitters
 *        with 200 PA; brl/PA correlates 0.84 with HR/PA).
 *   pitchers: expected batting average ALLOWED, the same luck-stripped
 *        number for the man on the mound, with his innings. It is per
 *        at-bat like the AVG allowed the model already reads, so no
 *        conversion.
 *
 * WHERE IT COMES FROM
 * -------------------
 * Baseball Savant serves the expected-statistics leaderboard as CSV with no
 * key (the same data jldbc/pybaseball wraps), keyed by the MLBAM id that
 * statsapi and the board already use. The at-bat and plate-appearance
 * counts come from statsapi's season line. Fifty PA is the floor: below
 * it Savant's number is a handful of batted balls.
 *
 * The output is small (~700 hitters) and does not change during a season,
 * so it is committed, and fetch-mlb.mjs reads it rather than fetching.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "statcast");
const MIN_PA = 50;

/** Savant's CSV: every field quoted or bare, a BOM up front, one header. */
export function parseSavantCSV(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line) => {
    const out = []; let f = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(f); f = ""; }
      else f += c;
    }
    out.push(f);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => { const v = split(l); const o = {}; header.forEach((h, i) => { o[h] = v[i] ?? ""; }); return o; });
}

/**
 * Join Savant's expected stats to statsapi's season line by MLBAM id.
 * @param savant  rows from parseSavantCSV
 * @param lines   [{id, pa, ab, ...}] from statsapi's season hitting splits
 */
export function buildPriors(savant, lines, season, batted, hrPerBarrel) {
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  const brl = new Map((batted || []).map((b) => [String(b.player_id), Number(b.brl_pa)]));
  const out = {};
  for (const r of savant) {
    const id = String(r.player_id || "");
    const line = byId.get(id);
    const pa = Number(r.pa), xba = Number(r.est_ba);
    if (!line || !(pa >= MIN_PA) || !(line.pa > 0) || !(line.ab >= 0) || !isFinite(xba)) continue;
    const abpa = line.ab / line.pa;
    const p = { season, pa, ab: line.ab, xba, hit: xba * abpa };
    if (isFinite(Number(r.est_slg))) { p.xslg = Number(r.est_slg); p.tb = p.xslg * abpa; }
    if (isFinite(Number(r.est_woba))) p.xwoba = Number(r.est_woba);
    if (isFinite(Number(r.ba))) p.ba = Number(r.ba);
    const b = brl.get(id);
    if (isFinite(b) && isFinite(hrPerBarrel)) { p.brlPa = b / 100; p.hr = (b / 100) * hrPerBarrel; }
    out[id] = p;
  }
  return out;
}

/** Home runs per barrel for a season: ratio of sums over hitters with 200 PA. */
export function measureHRPerBarrel(batted, lines) {
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  let hr = 0, barrels = 0;
  for (const b of batted || []) {
    const line = byId.get(String(b.player_id));
    if (!line || !(line.pa >= 200) || !isFinite(Number(b.barrels))) continue;
    hr += Number(line.hr) || 0; barrels += Number(b.barrels);
  }
  return barrels > 0 ? hr / barrels : null;
}

/** Pitchers: expected batting average allowed, keyed by MLBAM id. */
export function buildPitcherPriors(savantPitchers, season) {
  const out = {};
  for (const r of savantPitchers || []) {
    const id = String(r.player_id || ""), pa = Number(r.pa), xba = Number(r.est_ba);
    if (!id || !(pa >= MIN_PA) || !isFinite(xba)) continue;
    out[id] = { season, bf: pa, xbaAllowed: xba };
    if (isFinite(Number(r.est_woba))) out[id].xwobaAllowed = Number(r.est_woba);
  }
  return out;
}

/** The committed priors for a season, or an empty object if none. */
export function loadPriors(season) {
  return loadFile(season).priors || {};
}
/** The committed pitcher priors for a season, or an empty object. */
export function loadPitcherPriors(season) {
  return loadFile(season).pitchers || {};
}
function loadFile(season) {
  const f = path.join(OUT, `${season}.json`);
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
}

async function main() {
  const season = Number(process.argv[2]) || new Date().getUTCFullYear() - 1;
  const savant = (type, board = "expected_statistics") =>
    `https://baseballsavant.mlb.com/leaderboard/${board}?type=${type}&year=${season}&position=&team=&min=${MIN_PA}&csv=true`;
  const apiUrl = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${season}&sportId=1&gameType=R&playerPool=ALL&limit=2000`;
  const text = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); });
  const [csv, batCsv, pitCsv, api] = await Promise.all([
    text(savant("batter")), text(savant("batter", "statcast")), text(savant("pitcher")),
    fetch(apiUrl).then((r) => { if (!r.ok) throw new Error(`statsapi HTTP ${r.status}`); return r.json(); }),
  ]);
  const lines = (api.stats?.[0]?.splits || []).map((s) => ({
    id: s.player.id, name: s.player.fullName, pa: Number(s.stat.plateAppearances), ab: Number(s.stat.atBats),
    hits: Number(s.stat.hits), hr: Number(s.stat.homeRuns), tb: Number(s.stat.totalBases),
  }));
  const batted = parseSavantCSV(batCsv);
  const hrPerBarrel = measureHRPerBarrel(batted, lines);
  const priors = buildPriors(parseSavantCSV(csv), lines, season, batted, hrPerBarrel);
  const pitchers = buildPitcherPriors(parseSavantCSV(pitCsv), season);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${season}.json`),
    JSON.stringify({ season, fetchedAt: new Date().toISOString(), minPA: MIN_PA, hrPerBarrel, priors, pitchers }, null, 0) + "\n");
  const n = Object.keys(priors).length, vals = Object.values(priors);
  const mean = (k) => { const a = vals.filter((p) => p[k] != null).map((p) => p[k]); return a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(4) : "n/a"; };
  console.log(`wrote statcast/${season}.json: ${n} hitters with a prior (of ${lines.length} with a season line): ` +
    `hit/PA ${mean("hit")}, TB/PA ${mean("tb")}, HR/PA ${mean("hr")} (${vals.filter((p) => p.hr != null).length} with barrels; ` +
    `${hrPerBarrel?.toFixed(3)} HR per barrel); ${Object.keys(pitchers).length} pitchers`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
