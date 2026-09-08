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
 * a lot is not credited with hits on trips that ended in a walk.
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
export function buildPriors(savant, lines, season) {
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  const out = {};
  for (const r of savant) {
    const id = String(r.player_id || "");
    const line = byId.get(id);
    const pa = Number(r.pa), xba = Number(r.est_ba);
    if (!line || !(pa >= MIN_PA) || !(line.pa > 0) || !(line.ab >= 0) || !isFinite(xba)) continue;
    const p = { season, pa, ab: line.ab, xba, hit: xba * line.ab / line.pa };
    if (isFinite(Number(r.est_slg))) p.xslg = Number(r.est_slg);
    if (isFinite(Number(r.est_woba))) p.xwoba = Number(r.est_woba);
    if (isFinite(Number(r.ba))) p.ba = Number(r.ba);
    out[id] = p;
  }
  return out;
}

/** The committed priors for a season, or an empty object if none. */
export function loadPriors(season) {
  const f = path.join(OUT, `${season}.json`);
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")).priors || {}; } catch { return {}; }
}

async function main() {
  const season = Number(process.argv[2]) || new Date().getUTCFullYear() - 1;
  const savantUrl = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=${MIN_PA}&csv=true`;
  const apiUrl = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=${season}&sportId=1&gameType=R&playerPool=ALL&limit=2000`;
  const [csv, api] = await Promise.all([
    fetch(savantUrl).then((r) => { if (!r.ok) throw new Error(`savant HTTP ${r.status}`); return r.text(); }),
    fetch(apiUrl).then((r) => { if (!r.ok) throw new Error(`statsapi HTTP ${r.status}`); return r.json(); }),
  ]);
  const lines = (api.stats?.[0]?.splits || []).map((s) => ({
    id: s.player.id, name: s.player.fullName, pa: Number(s.stat.plateAppearances), ab: Number(s.stat.atBats), hits: Number(s.stat.hits),
  }));
  const priors = buildPriors(parseSavantCSV(csv), lines, season);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${season}.json`), JSON.stringify({ season, fetchedAt: new Date().toISOString(), minPA: MIN_PA, priors }, null, 0) + "\n");
  const n = Object.keys(priors).length;
  const hits = Object.values(priors).map((p) => p.hit);
  console.log(`wrote statcast/${season}.json: ${n} hitters with a prior (of ${lines.length} with a season line), ` +
    `hit/PA prior mean ${(hits.reduce((a, b) => a + b, 0) / n).toFixed(4)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
