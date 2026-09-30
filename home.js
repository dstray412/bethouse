/* home.js — the home page's arithmetic. Shared by index.html and the tests.
 *
 * The home shows one slate out of three boards' data: which games are on
 * today (or the next day that has any), what the model says about each
 * football game, and a few numbers for the tile. Nothing here fetches
 * and nothing here is a model: the projection, favourite and pick come
 * from nfl.js exactly as the football boards' game view calls it, so
 * the home says what the board says. A number the data does not carry
 * is a card the page does not show.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseHome = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LOGO = { NFL: "nfl", MLB: "mlb", "College football": "ncaa" };
  const BOARD = { NFL: "nfl.html", MLB: "baseball.html", "College football": "cfb.html" };
  const key = (v) => {
    const k = String(v == null ? "" : v).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(k) ? k : null;
  };

  function footballGames(D, league, now) {
    const out = [];
    for (const g of (D && D.games) || []) {
      if (!g || !g.home || !g.away || !g.date) continue;
      const t = Date.parse(g.date);
      const state = g.completed ? "post" : isFinite(t) && t <= now ? "in" : "pre";
      const college = league === "College football";
      out.push({
        sport: "football", league, id: (college ? "cfb:" : "nfl:") + g.id, start: g.date,
        home: g.home, away: g.away, homeName: g.home, awayName: g.away,
        homeKey: college ? key(g.homeId) : key(g.home), awayKey: college ? key(g.awayId) : key(g.away),
        state, board: BOARD[league], raw: g,
      });
    }
    return out;
  }

  function baseballGames(D) {
    const out = [];
    for (const g of (D && D.games) || []) {
      if (!g || !g.home || !g.away || !g.startTime) continue;
      const state = g.live || g.abstract === "Live" ? "in" : g.abstract === "Final" ? "post" : "pre";
      out.push({
        sport: "baseball", league: "MLB", id: "mlb:" + g.gamePk, start: g.startTime,
        home: g.home.abbrev || "", away: g.away.abbrev || "", homeName: g.home.team || "", awayName: g.away.team || "",
        homeKey: key(g.home.abbrev), awayKey: key(g.away.abbrev),
        state, board: BOARD.MLB, raw: g,
      });
    }
    return out;
  }

  /** One list of games across the boards that loaded, in start order. */
  function normalise(data, now) {
    const d = data || {};
    const t = isFinite(now) ? now : Date.now();
    const all = footballGames(d.nfl, "NFL", t).concat(footballGames(d.cfb, "College football", t), baseballGames(d.mlb));
    all.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return all;
  }

  /** The calendar day of an instant where the reader is (or in `tz`), as YYYY-MM-DD. */
  function localDay(iso, tz) {
    const d = typeof iso === "number" ? new Date(iso) : new Date(String(iso));
    if (isNaN(d)) return null;
    const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat("en-CA", opts).format(d);
  }
  const dayAfter = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  const weekday = (day) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  function clock(iso, tz) {
    const opts = { hour: "numeric", minute: "2-digit" };
    if (tz) opts.timeZone = tz;
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(String(iso)));
  }

  /** Today's games if there are any, else the next day that has games; never a past day. */
  function slate(games, now, tz) {
    const t = isFinite(now) ? now : Date.now();
    const today = localDay(t, tz);
    const byDay = {};
    for (const g of games || []) {
      const day = localDay(g.start, tz);
      if (!day || day < today) continue;
      (byDay[day] = byDay[day] || []).push(g);
    }
    const days = Object.keys(byDay).sort();
    if (!days.length) return { when: "none", day: null, games: [] };
    const day = byDay[today] ? today : days[0];
    const list = byDay[day].slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return { when: day === today ? "today" : "next", day, games: list, label: dayLabel(day, t, tz) };
  }

  function dayLabel(day, now, tz) {
    const today = localDay(isFinite(now) ? now : Date.now(), tz);
    if (day === today) return "Today";
    if (day === dayAfter(today)) return "Tomorrow";
    return weekday(day);
  }

  const LEAGUE_WORD = { NFL: "NFL", "College football": "college", MLB: "MLB" };
  /** "3 games: 1 NFL, 1 college, 1 MLB · first at 6:08 PM" */
  function sentence(s, tz) {
    if (!s || !s.games || !s.games.length) return "No games on the boards yet.";
    const n = s.games.length;
    const counts = {};
    for (const g of s.games) counts[g.league] = (counts[g.league] || 0) + 1;
    const parts = ["NFL", "College football", "MLB"].filter((l) => counts[l]).map((l) => counts[l] + " " + LEAGUE_WORD[l]);
    const first = clock(s.games[0].start, tz);
    const when = s.when === "today" ? "first at " + first : (s.label || weekday(s.day)) + " at " + first;
    return n + (n === 1 ? " game: " : " games: ") + parts.join(", ") + " · " + when;
  }

  /** ESPN's team logo, by league; null without a usable key. */
  function logoUrl(league, k) {
    const path = LOGO[league];
    const kk = key(k);
    return path && kk ? "https://a.espncdn.com/i/teamlogos/" + path + "/500/" + kk + ".png" : null;
  }

  /* What the football board's game view says about a game: the
     projection, the favourite from the projected margin, and the better
     of the spread and total picks by EV. The moneyline is deliberately
     not a candidate, for the reason football-board.js gives: the replay
     says the model's win probabilities are worse than the market's. */
  function footballCard(model, E, D, g) {
    const ratings = D && D.ratings;
    if (!ratings || !model || !g) return null;
    const pr = model.projectGame(ratings, g.home, g.away, { neutral: !!(g.raw && g.raw.neutral) });
    if (!pr) return null;
    let fav = null;
    if (isFinite(pr.margin) && pr.margin !== 0) {
      const p = model.winProbability(pr.margin);
      fav = pr.margin > 0 ? { team: g.home, prob: p } : { team: g.away, prob: 1 - p };
    }
    let pick = null;
    const line = g.raw && g.raw.line;
    const pk = line ? model.pickGame(pr, line) : null;
    if (pk && E) {
      for (const prop of ["spread", "total"]) {
        const k = pk[prop]; if (!k) continue;
        const ev = E.evPct(k.prob, E.americanToDecimal(k.price));
        if (!pick || (isFinite(ev) && ev > pick.ev)) pick = { prop, side: k.side, line: k.line, prob: k.prob, price: k.price, ev, text: sideName(g, k, prop) };
      }
    }
    return { homePts: Math.round(pr.homePts), awayPts: Math.round(pr.awayPts), total: pr.total, margin: pr.margin, fav, pick };
  }
  function sideName(g, k, prop) {
    if (prop === "total") return (k.side === "over" ? "o" : "u") + k.line;
    const team = k.side === "home" ? g.home : g.away;
    const pts = k.side === "home" ? k.line : -k.line;
    return team + " " + (pts > 0 ? "+" : "") + pts;
  }

  /** The best anytime-touchdown chance among players in the slate's open football games. */
  function topTD(model, data, games) {
    if (!model || typeof model.scoreAnytimeTD !== "function") return null;
    let best = null;
    for (const g of games || []) {
      if (g.sport !== "football" || g.state !== "pre") continue;
      const D = g.league === "NFL" ? data && data.nfl : data && data.cfb;
      if (!D || !D.players) continue;
      const pool = D.usagePool && D.usagePool.length ? D.usagePool : null;
      const tf = D.teamFactors || {};
      for (const p of D.players) {
        if (p.team !== g.home && p.team !== g.away) continue;
        if (typeof model.availability === "function" && model.availability(p.status) === "out") continue;
        const opp = p.opp || (p.team === g.home ? g.away : g.home);
        const s = model.scoreAnytimeTD(p, { teamFactor: (tf[p.team] || {}).off || 1, oppFactor: (tf[opp] && isFinite(tf[opp].def)) ? tf[opp].def : 1, usagePool: pool });
        if (!s || !isFinite(s.prob)) continue;
        if (!best || s.prob > best.prob) best = { name: p.name, team: p.team, opp, prob: s.prob, league: g.league, board: g.board, gameId: g.id };
      }
    }
    return best;
  }

  /** The pick with the most model EV among games not yet started, or null. A pick that loses
      money at its price is not one, and neither is anything under `floor` (default 1%): the
      replay found the lines do not beat the close, so a rounding error must not headline. */
  function topEdge(cards, floor) {
    const min = isFinite(floor) ? floor : 0.01;
    let best = null;
    for (const c of cards || []) {
      const pick = c && c.card && c.card.pick;
      if (!c.game || c.game.state !== "pre") continue;
      if (!pick || !isFinite(pick.ev) || pick.ev <= 0 || pick.ev < min) continue;
      if (!best || pick.ev > best.card.pick.ev) best = c;
    }
    return best;
  }

  /** The tile: games on the slate, players priced across the boards, predictions graded. */
  function counts(data, games) {
    const d = data || {};
    let players = ((d.nfl && d.nfl.players) || []).length + ((d.cfb && d.cfb.players) || []).length;
    for (const g of (d.mlb && d.mlb.games) || []) {
      for (const side of ["away", "home"]) {
        const s = g && g[side];
        if (s && s.confirmed && Array.isArray(s.lineup)) players += s.lineup.length;
      }
    }
    let graded = 0;
    for (const r of d.records || []) if (r && isFinite(r.total)) graded += Number(r.total);
    return { games: isFinite(games) ? games : 0, players, graded };
  }

  /** One line about the golf event: under way, or starting within the week. */
  function golfLine(P, now, tz) {
    const ev = P && P.event;
    if (!ev || !ev.name) return null;
    const field = (P.field || []).length;
    const tail = field ? " · " + field + " in the field" : "";
    if (ev.state === "in") return ev.name + " is under way" + tail;
    if (ev.state === "post" || !ev.date) return null;
    const t = isFinite(now) ? now : Date.now();
    const start = Date.parse(ev.date);
    if (!isFinite(start) || start - t > 7 * 86400000 || start < t - 86400000) return null;
    /* The tour's dates are Eastern: ESPN gives midnight Eastern, which is
       the evening before out west. The day is read in New York. */
    const day = localDay(ev.date, "America/New_York");
    let label = dayLabel(day, t, tz);
    if (label === "Today" || label === "Tomorrow") label = label.toLowerCase();
    return ev.name + " starts " + label + tail;
  }

  /* Words for the card, so the page prints nothing the number does not say. */
  /** "+3.1% EV", "−2.9% EV", or "" when it rounds to nothing either way. */
  function evLabel(ev) {
    if (!isFinite(ev)) return "";
    const r = Math.round(1000 * ev) / 10;
    if (r === 0) return "";
    return (r > 0 ? "+" : "−") + Math.abs(r).toFixed(1) + "% EV";
  }
  /** "BUF 73%", or "pick 'em" when the margin does not clear a coin flip. */
  function favLabel(fav) {
    if (!fav || !isFinite(fav.prob)) return null;
    if (fav.prob < 0.505) return "pick 'em";
    return fav.team + " " + (100 * fav.prob).toFixed(0) + "%";
  }
  /** "Sale 2.16" from a probable pitcher: the surname, not a suffix, and the ERA when there is one. */
  function pitcherLabel(f) {
    if (!f || !f.name) return "TBD";
    const parts = String(f.name).trim().split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w));
    const last = parts.length ? parts[parts.length - 1] : String(f.name);
    return last + (f.era ? " " + f.era : "");
  }

  return { normalise, localDay, slate, dayLabel, sentence, clock, logoUrl, footballCard, topTD, topEdge, counts, golfLine, evLabel, favLabel, pitcherLabel };
});
