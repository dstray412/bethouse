#!/usr/bin/env node
/**
 * digest.mjs — the slate as a short readable message.
 *
 * Same model the board runs, same context builder, no price talk: every line
 * is a name and the chance it happens. Two picks per game by default, which
 * is the shape the tool was originally asked for.
 *
 *   node digest.mjs                  # today, plain text
 *   node digest.mjs --prop tb2       # rank by 2+ total bases (default)
 *   node digest.mjs --prop hrr       # rank by 1+ hit/run/RBI
 *   node digest.mjs --per-game 3     # more names per game
 *   node digest.mjs --html           # email-ready HTML
 *   node digest.mjs --include-live   # keep games already underway
 *
 * Games already underway are dropped by default: their numbers count only the
 * plate appearances a hitter has left, which is not something you can bet.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const score = require(path.join(DIR, "score.js"));

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const has = (f) => args.includes(f);

const PROP = flag("--prop", "tb2");
const PER_GAME = Number(flag("--per-game", "2"));
const AS_HTML = has("--html");
const INCLUDE_LIVE = has("--include-live");

const TB_N = /^tb(\d+)$/.test(PROP) ? Number(PROP.slice(2)) : null;
if (!TB_N && PROP !== "hrr" && PROP !== "hr") {
  console.error(`unknown --prop "${PROP}" (expected hrr, hr, or tb<N>)`);
  process.exit(1);
}
const LABEL = TB_N ? `${TB_N}+ total bases` : PROP === "hr" ? "1+ home run" : "1+ hit, run or RBI";

/* mlb-data.js is a browser script; give it a window to attach to. */
function loadBoard() {
  const src = fs.readFileSync(path.join(DIR, "mlb-data.js"), "utf8");
  const sandbox = {};
  new Function("window", src)(sandbox);
  return sandbox.BETHOUSE_MLB;
}

/**
 * Must stay in step with index.html's ctxFor. score.js falls back silently on
 * a missing table (`ctx.leaguePlatoonHR || ctx.leaguePlatoon`), so a dropped
 * key here would quietly mail out numbers the board never showed.
 */
function ctxFor(D, g, side) {
  const L = D.league, t = g[side], faces = g[side + "Faces"];
  return {
    leagueRates: L.rates,
    leagueTB: L.tb,
    oppAvgAllowed: faces && faces.avgAllowed,
    leagueAvgAllowed: L.avgAllowed,
    teamRunsPerGame: t.runsPerGame,
    leagueRunsPerGame: L.runsPerGame,
    pitcherHr9: faces && faces.hr9,
    leagueHr9: L.hr9,
    pitchHand: faces && faces.throws,
    leaguePlatoon: L.platoon,
    leaguePlatoonHR: L.platoonHR,
    leaguePlatoonTB: L.platoonTB,
    leagueHomeAway: L.homeAway,
    leagueHomeAwayHR: L.homeAwayHR,
    isHome: side === "home",
  };
}

function scoreOne(player, ctx) {
  if (TB_N) return score.scoreTB(player, { ...ctx, threshold: TB_N });
  if (PROP === "hr") return score.scoreHR(player, ctx);
  return score.scoreHRR(player, ctx);
}

function build() {
  const D = loadBoard();
  const games = [];
  let skippedLive = 0;

  for (const g of D.games) {
    const live = !score.gameIsOpen(g);
    if (live && !INCLUDE_LIVE) { skippedLive++; continue; }

    const picks = [];
    for (const side of ["away", "home"]) {
      const t = g[side];
      if (!t || !t.lineup || !t.lineup.length) continue;
      const ctx = ctxFor(D, g, side);
      for (const p of t.lineup) {
        const sp = p.splits || {};
        const vs = ctx.pitchHand === "L" ? sp.vl : ctx.pitchHand === "R" ? sp.vr : null;
        const player = {
          ...p,
          sofar: null,
          vsHand: vs ? { hits: vs.hits, pa: vs.pa } : null,
          vsHandHR: vs ? { hits: vs.hr, pa: vs.pa } : null,
          homeAway: sp.venue ? { hits: sp.venue.hits, pa: sp.venue.pa } : null,
          homeAwayHR: sp.venue ? { hits: sp.venue.hr, pa: sp.venue.pa } : null,
        };
        const r = scoreOne(player, ctx);
        if (!r || !isFinite(r.prob)) continue;
        picks.push({ name: p.name, team: t.team, prob: r.prob, confirmed: !!t.confirmed });
      }
    }
    if (!picks.length) continue;
    picks.sort((a, b) => b.prob - a.prob);
    games.push({
      title: g.away.team + " @ " + g.home.team,
      time: g.startTime || "",
      projected: picks.some((p) => !p.confirmed),
      picks: picks.slice(0, PER_GAME),
    });
  }
  return { date: D.date, games, skippedLive, total: D.games.length };
}

const pct = (x) => (x * 100).toFixed(0) + "%";

function renderText(d) {
  const out = [];
  out.push(`BetHouse — ${d.date}`);
  out.push(`Best ${LABEL}, ${PER_GAME} per game`);
  out.push("");
  if (!d.games.length) {
    out.push(d.skippedLive
      ? `All ${d.total} games are already underway or final. Nothing left to bet.`
      : "No games with lineups yet. Lineups post 3-4 hours before first pitch.");
    return out.join("\n");
  }
  for (const g of d.games) {
    out.push(g.title + (g.time ? "  " + g.time : "") + (g.projected ? "   (lineup projected, not confirmed)" : ""));
    for (const p of g.picks) out.push("   " + pct(p.prob).padStart(4) + "   " + p.name);
    out.push("");
  }
  if (d.skippedLive) out.push(`(${d.skippedLive} of ${d.total} games already underway, not shown)`);
  out.push("");
  out.push("Each number is the chance that player does it tonight.");
  return out.join("\n");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderHtml(d) {
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const p = [];
  p.push(`<div style="font-family:${F};max-width:520px;color:#1a1d24">`);
  p.push(`<h2 style="margin:0 0 2px;font-size:19px">BetHouse — ${esc(d.date)}</h2>`);
  p.push(`<div style="color:#6b7280;font-size:13px;margin-bottom:16px">Best ${esc(LABEL)}, ${PER_GAME} per game</div>`);
  if (!d.games.length) {
    p.push(`<p style="color:#6b7280">${d.skippedLive
      ? `All ${d.total} games are already underway or final. Nothing left to bet.`
      : "No games with lineups yet. Lineups post 3-4 hours before first pitch."}</p>`);
  }
  for (const g of d.games) {
    p.push(`<div style="margin-bottom:13px">`);
    p.push(`<div style="font-weight:600;font-size:14px">${esc(g.title)}`);
    if (g.time) p.push(`<span style="color:#9ca3af;font-weight:400"> · ${esc(g.time)}</span>`);
    if (g.projected) p.push(`<span style="color:#b45309;font-weight:400;font-size:12px"> · lineup projected</span>`);
    p.push(`</div>`);
    p.push(`<table style="border-collapse:collapse;margin-top:4px">`);
    for (const q of g.picks) {
      p.push(`<tr><td style="padding:2px 12px 2px 0;font-weight:700;font-variant-numeric:tabular-nums">${pct(q.prob)}</td>`
        + `<td style="padding:2px 0">${esc(q.name)}</td></tr>`);
    }
    p.push(`</table></div>`);
  }
  if (d.skippedLive) p.push(`<div style="color:#9ca3af;font-size:12px">${d.skippedLive} of ${d.total} games already underway, not shown.</div>`);
  p.push(`<div style="color:#6b7280;font-size:12px;margin-top:14px;border-top:1px solid #e5e7eb;padding-top:10px">`
    + `Each number is the chance that player does it tonight.</div>`);
  p.push(`</div>`);
  return p.join("");
}

const d = build();
console.log(AS_HTML ? renderHtml(d) : renderText(d));
