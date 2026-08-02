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

  /* ---------------------------------------------------------------- *
   * Handedness + splits
   *
   * Two more requests. Handedness is only needed for players actually on
   * a card today (~300 people), so it batches into two calls rather than
   * looking up all 678 hitters in the league.
   * ---------------------------------------------------------------- */

  const needIds = new Set();
  for (const g of games) {
    for (const side of ["away", "home"]) {
      for (const p of g[side].lineup) needIds.add(p.id);
    }
    for (const key of ["awayFaces", "homeFaces"]) if (g[key]) needIds.add(g[key].id);
  }

  const hand = new Map(); // id -> { bats, throws }
  const idList = [...needIds];
  for (let i = 0; i < idList.length; i += 150) {
    const chunk = idList.slice(i, i + 150);
    const res = await get(`${API}/people?personIds=${chunk.join(",")}`, "people");
    for (const p of res.people || []) {
      hand.set(p.id, {
        bats: (p.batSide || {}).code || null,
        throws: (p.pitchHand || {}).code || null,
      });
    }
  }

  const splitsRaw = await get(
    `${API}/stats?stats=statSplits&sitCodes=vl,vr,h,a&group=hitting&season=${SEASON}` +
      `&sportId=1&gameType=R&playerPool=ALL&limit=4000`,
    "splits"
  );

  // id -> { vl:{hits,pa}, vr:{...}, h:{...}, a:{...} }
  const splits = new Map();
  for (const s of splitsRaw.stats?.[0]?.splits || []) {
    const code = s.split?.code;
    if (!code) continue;
    const st = s.stat || {};
    const rec = splits.get(s.player.id) || {};
    rec[code] = { hits: num(st.hits), hr: num(st.homeRuns), pa: num(st.plateAppearances) };
    splits.set(s.player.id, rec);
  }

  /* League ratios, measured. Computed per batter handedness because the
     pooled number is misleading: righties gain ~4.9% vs LHP while lefties
     LOSE ~3.6%, so the aggregate reads +1.6% and points the wrong way for
     half the league. Each ratio is relative to that group's OVERALL rate,
     which is what score.js multiplies against. */
  const agg = {};
  const bump = (bucket, key, rec) => {
    if (!rec || !(rec.pa > 0)) return;
    agg[bucket] = agg[bucket] || {};
    agg[bucket][key] = agg[bucket][key] || { hits: 0, hr: 0, pa: 0 };
    agg[bucket][key].hits += rec.hits;
    agg[bucket][key].hr += num(rec.hr);
    agg[bucket][key].pa += rec.pa;
  };
  for (const [pid, rec] of splits) {
    const h = hitStat.get(pid);
    if (!h || h.pa < 80) continue; // keep league ratios off tiny samples
    const bats = (hand.get(pid) || {}).bats || null;
    if (bats) {
      bump("bat:" + bats, "vl", rec.vl);
      bump("bat:" + bats, "vr", rec.vr);
      bump("bat:" + bats, "all", { hits: h.hits, hr: h.hr, pa: h.pa });
    }
    bump("venue", "h", rec.h);
    bump("venue", "a", rec.a);
    bump("venue", "all", { hits: h.hits, hr: h.hr, pa: h.pa });
  }
  const ratio = (b, key) => {
    const g = agg[b];
    if (!g || !g[key] || !g.all || !(g[key].pa > 0) || !(g.all.pa > 0)) return null;
    return g[key].hits / g[key].pa / (g.all.hits / g.all.pa);
  };
  const leaguePlatoon = {};
  for (const bs of ["R", "L", "S"]) {
    const L = ratio("bat:" + bs, "vl");
    const R = ratio("bat:" + bs, "vr");
    if (L && R) leaguePlatoon[bs] = { L, R };
  }
  const leagueHomeAway = { home: ratio("venue", "h") || 1, away: ratio("venue", "a") || 1 };

  /* Home runs need their OWN platoon table. The hits split is about +/-2%;
     the home-run split for left-handed batters facing left-handed pitching
     is roughly -29%. Reusing the hits ratios for power understates the one
     handedness effect that genuinely moves a home run bet. */
  const ratioHR = (b, key) => {
    const g = agg[b];
    if (!g || !g[key] || !g.all || !(g[key].pa > 0) || !(g.all.pa > 0)) return null;
    const a = g[key].hr / g[key].pa, o = g.all.hr / g.all.pa;
    return o > 0 ? a / o : null;
  };
  const leaguePlatoonHR = {};
  for (const bs of ["R", "L", "S"]) {
    const L = ratioHR("bat:" + bs, "vl"), R = ratioHR("bat:" + bs, "vr");
    if (L && R) leaguePlatoonHR[bs] = { L, R };
  }
  const leagueHomeAwayHR = { home: ratioHR("venue", "h") || 1, away: ratioHR("venue", "a") || 1 };

  // Attach per-player handedness and split samples.
  for (const g of games) {
    for (const side of ["away", "home"]) {
      const isHome = side === "home";
      g[side].isHome = isHome;
      for (const p of g[side].lineup) {
        p.batSide = (hand.get(p.id) || {}).bats || null;
        const rec = splits.get(p.id) || {};
        p.splits = {
          vl: rec.vl || null,
          vr: rec.vr || null,
          venue: (isHome ? rec.h : rec.a) || null,
        };
      }
    }
    for (const key of ["awayFaces", "homeFaces"]) {
      if (g[key]) g[key].throws = (hand.get(g[key].id) || {}).throws || null;
    }
  }

  league.platoon = leaguePlatoon;
  league.homeAway = leagueHomeAway;
  league.platoonHR = leaguePlatoonHR;
  league.homeAwayHR = leagueHomeAwayHR;

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
  const pl = payload.league.platoon;
  for (const bs of ["R", "L", "S"]) {
    if (pl[bs]) console.log(`  platoon ${bs}HB:      vs LHP x${pl[bs].L.toFixed(4)}   vs RHP x${pl[bs].R.toFixed(4)}`);
  }
  console.log(`  home/away:        home x${payload.league.homeAway.home.toFixed(4)}   away x${payload.league.homeAway.away.toFixed(4)}`);
  const ph = payload.league.platoonHR;
  for (const bs of ["R", "L", "S"]) {
    if (ph[bs]) console.log(`  HR platoon ${bs}HB:   vs LHP x${ph[bs].L.toFixed(4)}   vs RHP x${ph[bs].R.toFixed(4)}`);
  }
  const withHand = games.reduce((n,g)=>n+[...g.away.lineup,...g.home.lineup].filter(p=>p.batSide).length,0);
  console.log(`  handedness known: ${withHand}/${games.length*18} lineup slots`);
  if (missingStats) console.log(`  note: ${missingStats} lineup slots have no season line yet (callups)`);
  console.log(`Wrote ${path.basename(OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error("Fetch failed:", e.message);
  process.exit(1);
});
