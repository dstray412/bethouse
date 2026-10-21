/* home.js — the home page's arithmetic. Shared by index.html and the tests.
 *
 * The home shows one slate out of the two boards' data: which games are on
 * today (or the next day that has any), what the model says about each
 * football game, and a few numbers for the tile. Nothing here fetches
 * and nothing here is a model: the projection, favourite and pick come
 * from nfl.js exactly as the football boards' game view calls it, so
 * the home says what the board says. A number the data does not carry
 * is a card the page does not show.
 */
(function (root, factory) {
  const faces = typeof module !== "undefined" && module.exports ? require("./faces.js") : root.BetHouseFaces;
  const api = factory(faces);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseHome = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  "use strict";

  const BOARD = { NFL: "nfl.html", MLB: "baseball.html" };
  /* One football league since the college board went (2026-10-16). */
  const FOOTBALL = "NFL";
  /* One validator for a team key, faces.js's; without faces.js nothing is a key. */
  const key = (v) => (F && F.keyOf ? F.keyOf(v) : null);

  function footballGames(D, now) {
    const out = [];
    for (const g of (D && D.games) || []) {
      if (!g || !g.home || !g.away || !g.date) continue;
      const t = Date.parse(g.date);
      const state = g.completed ? "post" : isFinite(t) && t <= now ? "in" : "pre";
      out.push({
        sport: "football", league: FOOTBALL, id: "nfl:" + g.id, start: g.date,
        home: g.home, away: g.away, homeName: g.home, awayName: g.away,
        homeKey: key(g.home), awayKey: key(g.away),
        state, board: BOARD[FOOTBALL], raw: g,
        /* A football game has a preview page (2026-10-21); a baseball game opens its board. */
        preview: g.id != null && g.id !== "" ? "game.html?id=" + encodeURIComponent(String(g.id)) : undefined,
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
    const all = footballGames(d.nfl, t).concat(baseballGames(d.mlb));
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

  const LEAGUE_WORD = { NFL: "NFL", MLB: "MLB" };
  /** "2 games: 1 NFL, 1 MLB · first at 6:08 PM" */
  function sentence(s, tz) {
    if (!s || !s.games || !s.games.length) return "No games on the boards yet.";
    const n = s.games.length;
    const counts = {};
    for (const g of s.games) counts[g.league] = (counts[g.league] || 0) + 1;
    const parts = ["NFL", "MLB"].filter((l) => counts[l]).map((l) => counts[l] + " " + LEAGUE_WORD[l]);
    const first = clock(s.games[0].start, tz);
    const when = s.when === "today" ? "first at " + first : (s.label || weekday(s.day)) + " at " + first;
    return n + (n === 1 ? " game: " : " games: ") + parts.join(", ") + " · " + when;
  }

  /** ESPN's team logo, the full file, by league; null without a usable key. faces.js is the one source. */
  function logoUrl(league, k) {
    return F ? F.logoUrl(league, k, "full") : null;
  }

  /* What the football board's game view says about a game: the
     projection and the favourite from the projected margin. No pick and
     no price since 2026-10-17: the site shows chances, not odds. */
  function footballCard(model, D, g) {
    const ratings = D && D.ratings;
    if (!ratings || !model || !g) return null;
    const pr = model.projectGame(ratings, g.home, g.away, { neutral: !!(g.raw && g.raw.neutral) });
    if (!pr) return null;
    let fav = null;
    if (isFinite(pr.margin) && pr.margin !== 0) {
      const p = model.winProbability(pr.margin);
      fav = pr.margin > 0 ? { team: g.home, prob: p } : { team: g.away, prob: 1 - p };
    }
    return { homePts: Math.round(pr.homePts), awayPts: Math.round(pr.awayPts), total: pr.total, margin: pr.margin, fav };
  }

  /** Said and hit across the records' props, weighted by graded calls, in percent; null with nothing graded. The home's vocabulary strip (2026-10-21). */
  function saidHit(records) {
    let n = 0, said = 0, hit = 0;
    for (const r of records || []) {
      const props = r && r.props ? r.props : {};
      for (const k of Object.keys(props)) {
        const p = props[k];
        if (!p || !(p.n > 0) || typeof p.predicted !== "number" || typeof p.actual !== "number" || !isFinite(p.predicted) || !isFinite(p.actual)) continue;
        n += p.n; said += p.n * p.predicted; hit += p.n * p.actual;
      }
    }
    return n ? { n, said: said / n, hit: hit / n } : null;
  }

  /** The tile: games on the slate, players projected across the boards, predictions graded. */
  function counts(data, games) {
    const d = data || {};
    let players = ((d.nfl && d.nfl.players) || []).length;
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

  /* Words for the card, so the page prints nothing the number does not say. */
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

  return { normalise, localDay, slate, dayLabel, sentence, clock, logoUrl, footballCard, counts, saidHit, favLabel, pitcherLabel };
});
