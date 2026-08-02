/*
 * BetHouse — fetch-mlb.mjs
 * Pulls everything the player board needs from MLB's stats API.
 *
 *   node fetch-mlb.mjs                 today's slate
 *   node fetch-mlb.mjs --date 2026-08-02
 *   node fetch-mlb.mjs --out mlb-data.js
 *
 * NO API KEY. NO ACCOUNT. NO RATE TIER. statsapi.mlb.com is open, and the
 * whole slate costs five requests:
 *
 *   1. today's schedule + posted lineups + probable pitchers
 *   2. the last 5 days of lineups (fallback batting order before lineups post)
 *   3. every hitter's season line      (playerPool=ALL, ~680 players)
 *   4. every pitcher's season line     (playerPool=ALL)
 *   5. team offense, for run and RBI context
 *
 * That is the entire dependency. Compare with the odds side of this project,
 * which needs a paid tier to refresh often enough to be useful.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = "https://statsapi.mlb.com/api/v1";
const SEASON = 2026;

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const DATE = flag("--date", new Date().toISOString().slice(0, 10));
const OUT = path.join(DIR, flag("--out", "mlb-data.js"));

/* ---------------------------------------------------------------- *
 * Plumbing
 * ---------------------------------------------------------------- */

async function get(url, label) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

function daysBefore(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** "110.1" means 110 innings and one out, not 110.1 innings. */
function parseIP(ip) {
  if (ip == null) return 0;
  const s = String(ip);
  const [whole, frac] = s.split(".");
  return (Number(whole) || 0) + (frac === "1" ? 1 / 3 : frac === "2" ? 2 / 3 : 0);
}

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/* ---------------------------------------------------------------- *
 * Fetch
 * ---------------------------------------------------------------- */

async function main() {
  console.log(`Fetching MLB slate for ${DATE} ...`);

  const [sched, recent, hitters, pitchers, teamHit] = await Promise.all([
    get(
      `${API}/schedule?sportId=1&date=${DATE}&hydrate=lineups,probablePitcher,venue,team`,
      "schedule"
    ),
    get(
      `${API}/schedule?sportId=1&startDate=${daysBefore(DATE, 5)}&endDate=${daysBefore(DATE, 1)}&hydrate=lineups`,
      "recent lineups"
    ),
    get(
      `${API}/stats?stats=season&group=hitting&season=${SEASON}&sportId=1&gameType=R&playerPool=ALL&limit=2000`,
      "hitters"
    ),
    get(
      `${API}/stats?stats=season&group=pitching&season=${SEASON}&sportId=1&gameType=R&playerPool=ALL&limit=2000`,
      "pitchers"
    ),
    get(
      `${API}/teams/stats?stats=season&group=hitting&season=${SEASON}&sportId=1&gameType=R`,
      "team offense"
    ),
  ]);

  /* ---- index the season lines ---- */

  const hitStat = new Map();
  // League per-PA rates. These are what small samples get regressed toward,
  // so they must be real totals, not an average of per-player rates (which
  // would let a 3-PA callup count as much as a full-season regular).
  let lgPA = 0, lgH = 0, lgR = 0, lgRBI = 0, lgHRb = 0;
  for (const s of hitters.stats?.[0]?.splits || []) {
    const st = s.stat || {};
    lgPA += num(st.plateAppearances);
    lgH += num(st.hits);
    lgR += num(st.runs);
    lgRBI += num(st.rbi);
    lgHRb += num(st.homeRuns);
    hitStat.set(s.player.id, {
      pa: num(st.plateAppearances),
      hits: num(st.hits),
      runs: num(st.runs),
      rbi: num(st.rbi),
      hr: num(st.homeRuns),
      avg: st.avg,
      obp: st.obp,
      ops: st.ops,
      games: num(st.gamesPlayed),
    });
  }

  const pitchStat = new Map();
  for (const s of pitchers.stats?.[0]?.splits || []) {
    const st = s.stat || {};
    const ip = parseIP(st.inningsPitched);
    pitchStat.set(s.player.id, {
      era: st.era,
      whip: st.whip,
      avgAllowed: num(st.avg),
      ip,
      hr: num(st.homeRuns),
      hr9: ip > 0 ? (num(st.homeRuns) * 9) / ip : 0,
      so: num(st.strikeOuts),
      bb: num(st.baseOnBalls),
    });
  }

  const teamRPG = new Map();
  let lgRuns = 0,
    lgGames = 0,
    lgHits = 0,
    lgAB = 0;
  for (const s of teamHit.stats?.[0]?.splits || []) {
    const st = s.stat || {};
    const g = num(st.gamesPlayed);
    if (g > 0) teamRPG.set(s.team.id, num(st.runs) / g);
    lgRuns += num(st.runs);
    lgGames += g;
    lgHits += num(st.hits);
    lgAB += num(st.atBats);
  }

  let lgHR = 0,
    lgIP = 0;
  for (const p of pitchStat.values()) {
    lgHR += p.hr;
    lgIP += p.ip;
  }

  const league = {
    runsPerGame: lgGames > 0 ? lgRuns / lgGames : 4.5,
    avgAllowed: lgAB > 0 ? lgHits / lgAB : 0.248,
    hr9: lgIP > 0 ? (lgHR * 9) / lgIP : 1.2,
    rates: {
      hit: lgPA > 0 ? lgH / lgPA : 0.222,
      run: lgPA > 0 ? lgR / lgPA : 0.118,
      rbi: lgPA > 0 ? lgRBI / lgPA : 0.113,
      hr: lgPA > 0 ? lgHRb / lgPA : 0.031,
    },
  };

  /* ---- fallback batting orders from the last 5 days ---- */

  const lastOrder = new Map(); // teamId -> {date, players:[{id,name,pos}]}
  for (const d of recent.dates || []) {
    for (const g of d.games || []) {
      const lu = g.lineups || {};
      for (const side of ["away", "home"]) {
        const pl = lu[side + "Players"];
        if (!pl || pl.length < 9) continue;
        const teamId = g.teams[side].team.id;
        const prev = lastOrder.get(teamId);
        if (!prev || prev.date < d.date) {
          lastOrder.set(teamId, {
            date: d.date,
            players: pl.slice(0, 9).map((p) => ({
              id: p.id,
              name: p.fullName,
              pos: p.primaryPosition?.abbreviation || "",
            })),
          });
        }
      }
    }
  }

  /* ---- assemble ---- */

  function buildSide(game, side) {
    const t = game.teams[side];
    const teamId = t.team.id;
    const posted = (game.lineups || {})[side + "Players"];
    let players, confirmed, asOf;

    if (posted && posted.length >= 9) {
      confirmed = true;
      asOf = null;
      players = posted.slice(0, 9).map((p) => ({
        id: p.id,
        name: p.fullName,
        pos: p.primaryPosition?.abbreviation || "",
      }));
    } else {
      const fb = lastOrder.get(teamId);
      confirmed = false;
      asOf = fb ? fb.date : null;
      players = fb ? fb.players : [];
    }

    return {
      team: t.team.name,
      teamId,
      abbrev: t.team.abbreviation || "",
      confirmed,
      projectedFrom: asOf,
      runsPerGame: teamRPG.get(teamId) || null,
      lineup: players.map((p, i) => {
        const s = hitStat.get(p.id) || {};
        return {
          id: p.id,
          name: p.name,
          pos: p.pos,
          slot: i + 1,
          pa: s.pa || 0,
          hits: s.hits || 0,
          runs: s.runs || 0,
          rbi: s.rbi || 0,
          hr: s.hr || 0,
          avg: s.avg || null,
          obp: s.obp || null,
          ops: s.ops || null,
          games: s.games || 0,
        };
      }),
    };
  }

  function buildProbable(game, side) {
    const pp = game.teams[side].probablePitcher;
    if (!pp) return null;
    const s = pitchStat.get(pp.id) || {};
    return {
      id: pp.id,
      name: pp.fullName,
      era: s.era || null,
      whip: s.whip || null,
      avgAllowed: s.avgAllowed || null,
      hr9: s.hr9 || null,
      ip: s.ip || 0,
      so: s.so || 0,
      bb: s.bb || 0,
    };
  }

  const games = [];
  for (const d of sched.dates || []) {
    for (const g of d.games || []) {
      games.push({
        gamePk: g.gamePk,
        startTime: g.gameDate,
        status: g.status?.detailedState || "",
        venue: g.venue?.name || "",
        away: buildSide(g, "away"),
        home: buildSide(g, "home"),
        // The pitcher a side FACES is the other team's probable.
        awayFaces: buildProbable(g, "home"),
        homeFaces: buildProbable(g, "away"),
      });
    }
  }

  games.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  const payload = { date: DATE, fetchedAt: new Date().toISOString(), season: SEASON, league, games };

  if (!games.length) {
    console.error("No games returned. Leaving any existing data file alone.");
    process.exit(1);
  }

  fs.writeFileSync(
    OUT,
    "/* Generated by fetch-mlb.mjs from statsapi.mlb.com (no API key). Do not edit. */\n" +
      `/* date ${DATE} | fetched ${payload.fetchedAt} */\n` +
      "window.BETHOUSE_MLB = " +
      JSON.stringify(payload) +
      ";\n"
  );

  const confirmed = games.filter((g) => g.away.confirmed || g.home.confirmed).length;
  const full = games.filter((g) => g.away.confirmed && g.home.confirmed).length;
  const missingStats = games.reduce(
    (n, g) => n + [...g.away.lineup, ...g.home.lineup].filter((p) => !p.pa).length,
    0
  );

  console.log(`  games:            ${games.length}`);
  console.log(`  lineups posted:   ${full} complete, ${confirmed - full} partial, ${games.length - confirmed} projected`);
  console.log(`  league:           ${league.runsPerGame.toFixed(2)} R/G, ${league.avgAllowed.toFixed(3)} AVG, ${league.hr9.toFixed(2)} HR/9`);
  console.log(`  hitters indexed:  ${hitStat.size}   pitchers: ${pitchStat.size}`);
  if (missingStats) console.log(`  note: ${missingStats} lineup slots have no season line yet (callups)`);
  console.log(`Wrote ${path.basename(OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error("Fetch failed:", e.message);
  process.exit(1);
});
