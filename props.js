/*
 * BetHouse — props.js
 * A book's player-prop lines beside the site's own numbers.
 *
 * Until 2026-11-24 the site showed chances and never a price (the
 * 2026-10-17 decision: the feed it had then went, and a chance with no
 * price beside it cannot be mistaken for a quote). This module is the
 * other half, asked for on 2026-11-24: a book's main line and both
 * prices, the chance those prices imply with the book's cut taken out,
 * the model's chance AT THAT LINE, and the gap between the two. Whether
 * the gap means anything is the record's question: every logged pick is
 * settled for money at the price it was made at and compared with the
 * price the book closed at.
 *
 * Pure, and shared by the page, the fetcher (fetch-props.mjs) and the
 * tracker (track-props.mjs), so the number on screen is the number that
 * gets logged is the number that gets graded. It makes no requests.
 *
 * The feed's shape is The Odds API's v4 (events, each with bookmakers,
 * each with markets, each with outcomes), which PropLine says it copies.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetHouseProps = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* The feed's market key for each of the board's props. */
  const MARKETS = {
    player_reception_yds: "recyds",
    player_rush_yds: "rushyds",
    player_pass_yds: "passyds",
    player_receptions: "recs",
    player_rush_reception_yds: "rushrec",
    player_anytime_td: "td",
  };
  const BOOKS = { draftkings: "DraftKings", fanduel: "FanDuel" };

  /* A gap smaller than this is inside what prices and the model both move
     by, and is shown greyed and never logged. Points of probability. */
  const MIN_GAP = 5;
  /*
   * The cut assumed in a price that has no opposite side to take it out
   * with: most books post an anytime touchdown as a Yes and nothing else.
   * AN ASSUMPTION, NOT A MEASUREMENT (2026-11-24): a two-sided yardage
   * market here holds 4 to 7 percent and a yes-only list is shaded
   * harder, so ten is a floor someone chose. cutsOf replaces it with the
   * book's own figure when the book posts enough two-sided touchdown
   * prices to measure one, and the record's touchdown row is what should
   * set it for good.
   */
  const ONE_SIDED_CUT = 0.10;
  /* A role has moved when the recent share is under three quarters of the season's or over four thirds of it. A cut somebody chose, so the record can split its losses; not a model term. */
  const ROLE_LOW = 0.75, ROLE_HIGH = 4 / 3;
  /* How old a price can be and still be shown (the page prints its time), and how old it can be and still be acted on. */
  const MAX_SHOWN_AGE = 12 * 3600e3, MAX_PICK_AGE = 90 * 60e3;
  /* A close read within this many minutes of the start is the closing line; one from further out is an early price. A choice (2026-11-24), for reading the record, not a model term. */
  const NEAR_CLOSE = 30;

  /*
   * Markets whose live record is off by more than the gap it would take
   * to log a pick (record.html, 2026-11-24: rushing-yard overs said 47.8%
   * and hit 41.1% over 701; passing-yard overs said 53.5% and hit 59.2%
   * over 282). Until the model is corrected a gap here is partly that
   * bias, so the page says so beside it. `bias` is predicted minus
   * actual for the over, in points.
   */
  const BIASED = { rushyds: 6.7, passyds: -5.7 };

  const fin = (v) => typeof v === "number" && isFinite(v);

  /** American odds as a decimal price (stake included), or null. */
  function decimal(american) {
    const a = Number(american);
    if (american == null || american === "" || !isFinite(a) || a === 0 || Math.abs(a) < 100) return null;
    return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
  }

  /** Both sides' chances with the book's cut taken out, or null when either price is missing. */
  function noVig(overPrice, underPrice) {
    const o = decimal(overPrice), u = decimal(underPrice);
    if (o == null || u == null) return null;
    const io = 1 / o, iu = 1 / u;
    return { over: io / (io + iu), under: iu / (io + iu), hold: io + iu - 1 };
  }

  /** A name as two feeds would both spell it: no case, accents, punctuation or generational suffix. */
  function normName(name) {
    return String(name == null ? "" : name)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[.'’`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * The feed's events as flat offers, one per player, market and book,
   * with the over and the under of the book's MAIN line together. Only
   * the markets and books asked for.
   *
   * An outcome comes in one of three shapes (PropLine's docs, "Player-prop
   * outcome shapes"; The Odds API only sends the first):
   *
   *   1. two-way: `name` is Over/Under or Yes/No, the player is in
   *      `description`, the line in `point` (a yes/no has none);
   *   2. a milestone rung: `name` is "100+ Receiving Yards", no point.
   *      Not a main line, and skipped;
   *   3. a yes-only list: `name` IS the player, no point. How most books
   *      send anytime touchdowns.
   *
   * A book can send several markets under one key (PropLine marks each
   * `line_type` main, alternate or milestone; only main is read), so a
   * player's prices are gathered across all of a book's markets with the
   * key before the main line is chosen: the line whose two prices are
   * nearest each other. An outcome with no usable price is dropped.
   */
  function parseEvents(events, opts) {
    const o = opts || {};
    const books = o.books || Object.keys(BOOKS), markets = o.markets || MARKETS;
    const SIDES = { over: "over", yes: "over", under: "under", no: "under" };
    const out = [];
    for (const ev of Array.isArray(events) ? events : []) {
      if (!ev || !Array.isArray(ev.bookmakers)) continue;
      for (const bk of ev.bookmakers) {
        if (!bk || books.indexOf(bk.key) < 0 || !Array.isArray(bk.markets)) continue;
        /* stat -> player -> {player, espnId, at, lines: line -> {over, under}} */
        const byStat = new Map();
        for (const m of bk.markets) {
          const stat = m && Object.prototype.hasOwnProperty.call(markets, m.key) ? markets[m.key] : null;
          if (!stat || !Array.isArray(m.outcomes)) continue;
          if (m.line_type != null && m.line_type !== "main") continue;
          if (!byStat.has(stat)) byStat.set(stat, new Map());
          const byPlayer = byStat.get(stat);
          for (const oc of m.outcomes) {
            if (!oc || decimal(oc.price) == null) continue;
            const name = String(oc.name == null ? "" : oc.name).trim(), desc = String(oc.description == null ? "" : oc.description).trim();
            const hasPoint = oc.point != null && isFinite(Number(oc.point));
            let side = SIDES[name.toLowerCase()] || null, player = desc;
            if (!side) {
              if (/^\d+(\.\d+)?\+/.test(name)) continue;            // shape 2: a milestone rung
              if (hasPoint || stat !== "td" || !name) continue;       // an unknown side on a line is not guessed at
              side = "over"; player = name;                           // shape 3: the player is the name, the bet is Yes
            }
            if (!player || (stat !== "td" && !hasPoint)) continue;
            const point = stat === "td" ? 0.5 : Number(oc.point);
            const espn = /^espn:(\d+)$/.exec(String(oc.player_id == null ? "" : oc.player_id));
            /* The feed's id when it has one, whoever issued it (ESPN's for the NFL, the league's own for the NBA): two men of one name in a game are two men. Only an ESPN id is used to find him on the board. */
            const anyId = /^\w[\w.]*:\S+$/.test(String(oc.player_id == null ? "" : oc.player_id)) ? String(oc.player_id) : null;
            const key = anyId || normName(player);
            if (!byPlayer.has(key)) byPlayer.set(key, { player, espnId: null, at: null, lines: new Map() });
            const rec = byPlayer.get(key);
            if (espn && !rec.espnId) rec.espnId = espn[1];
            /* A timestamp or nothing: the one string of the feed's that reaches the page's file. */
            const stamp = m.last_update || bk.last_update, at = typeof stamp === "string" && !isNaN(Date.parse(stamp)) && stamp.length <= 40 ? stamp : null;
            if (at && (!rec.at || at > rec.at)) rec.at = at;
            if (!rec.lines.has(point)) rec.lines.set(point, {});
            rec.lines.get(point)[side] = Number(oc.price);
          }
        }
        for (const [stat, byPlayer] of byStat) {
          for (const rec of byPlayer.values()) {
            let best = null;
            for (const [line, px] of rec.lines) {
              const two = px.over != null && px.under != null;
              const skew = two ? Math.abs(1 / decimal(px.over) - 1 / decimal(px.under)) : Infinity;
              if (!best || (two && !best.two) || (two === best.two && skew < best.skew)) best = { line, px, two, skew };
            }
            if (!best) continue;
            /* A touchdown market with no Yes price is not an offer the board can use. */
            if (stat === "td" && best.px.over == null) continue;
            /* A line with one price has no main line to choose among its rungs and no cut to take out. */
            if (stat !== "td" && !best.two) continue;
            out.push({
              eventId: String(ev.id == null ? "" : ev.id), commence: ev.commence_time || null,
              home: ev.home_team || null, away: ev.away_team || null,
              book: bk.key, stat, player: rec.player, espnId: rec.espnId,
              line: best.line, over: best.px.over != null ? best.px.over : null, under: best.px.under != null ? best.px.under : null,
              at: rec.at,
            });
          }
        }
      }
    }
    return out;
  }

  /**
   * The offers joined to the board: each to its game (the two team names
   * as the board's own "Away at Home", kickoff within a day) and its
   * player (the feed's ESPN id first, then name and team, then the
   * overrides). Returns the offers that matched, each with `gameId` and
   * `playerId`, and every one that did not with the reason, so a run can
   * print who was missed.
   */
  function matchOffers(offers, D, overrides) {
    const games = (D && D.games) || [], players = (D && D.players) || [];
    const ov = overrides || {};
    const byId = new Map(players.map((p) => [String(p.id), p]));
    const byName = new Map();
    for (const p of players) {
      const k = normName(p.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
    /* Either order: at a neutral site two feeds can disagree about who is home. */
    const pair = (a, b) => (String(a || "") + " at " + String(b || "")).toLowerCase();
    const gameFor = (o) => games.find((g) => g && (String(g.name || "").toLowerCase() === pair(o.away, o.home) || String(g.name || "").toLowerCase() === pair(o.home, o.away)) &&
      (!o.commence || !g.date || Math.abs(Date.parse(o.commence) - Date.parse(g.date)) <= 36 * 3600e3)) || null;
    const matched = [], unmatched = [];
    for (const o of offers || []) {
      const g = gameFor(o);
      if (!g) { unmatched.push({ player: o.player, stat: o.stat, book: o.book, why: "no game" }); continue; }
      const inGame = (p) => p && (p.team === g.home || p.team === g.away);
      let p = o.espnId && inGame(byId.get(String(o.espnId))) ? byId.get(String(o.espnId)) : null;
      if (!p) {
        const forced = ov[normName(o.player)];
        if (forced != null && inGame(byId.get(String(forced)))) p = byId.get(String(forced));
      }
      if (!p) {
        const named = (byName.get(normName(o.player)) || []).filter(inGame);
        if (named.length === 1) p = named[0];
        else if (named.length > 1) { unmatched.push({ player: o.player, stat: o.stat, book: o.book, why: "two players by that name in the game" }); continue; }
      }
      if (!p) { unmatched.push({ player: o.player, stat: o.stat, book: o.book, why: "no player" }); continue; }
      matched.push(Object.assign({}, o, { gameId: String(g.id), playerId: String(p.id), kickoff: g.date || o.commence }));
    }
    return { matched, unmatched };
  }

  /** What a player's row needs from the board to be priced, the same way the tracker and the page ask for it. */
  function contextFor(M, D, p, stat) {
    const tf = (D && D.teamFactors) || {};
    const vac = p.vac || {};
    if (stat === "td") {
      const f = tf[p.opp];
      return {
        teamFactor: (tf[p.team] || {}).off || 1,
        oppFactor: p.opp && f && isFinite(f.def) ? f.def : 1,
        usagePool: D && D.usagePool && D.usagePool.length ? D.usagePool : null,
        vacRec: vac.r, vacRush: vac.c,
      };
    }
    return { oppFactor: p.opp ? M.allowOf(tf, p.opp, stat) : null, vacRec: vac.r, vacRush: vac.c, home: p.home };
  }

  /**
   * The model's chances at a book's line: over, under and push. The same
   * distribution the board's Low / Projection / High buttons move along,
   * read at the book's number instead of the projection's. A whole-number
   * line can land exactly, so the under is what is left after the over
   * and the push, never one minus the over. Null when the board would not
   * show the player on this prop.
   */
  function siteChance(M, D, p, stat, line) {
    if (!M || !p) return null;
    /* The board hides a player ruled out (nfl.js availability); a price on him is compared with nothing. */
    if (typeof M.availability === "function" && M.availability(p.status) === "out") return null;
    if (stat === "td") {
      if (typeof M.scoreAnytimeTD !== "function") return null;
      const s = M.scoreAnytimeTD(p, contextFor(M, D, p, "td"));
      return s && fin(s.prob) ? { over: s.prob, under: 1 - s.prob, push: 0, exp: null } : null;
    }
    if (!M.STATS || !M.STATS[stat] || !fin(line)) return null;
    const y = M.statEligible(stat, p, null, contextFor(M, D, p, stat));
    if (!y) return null;
    const pool = D && D.pools && D.pools[stat] && M.poolSize(D.pools[stat]) > 0 ? D.pools[stat] : null;
    /* A stat is counted in whole units and the pool's values are not, so the model's own rule decides a whole-number line (nfl.js LADDERS: N+ is the over of N - 0.5): over is N+1 or more, the push is the band that rounds to N. */
    const whole = Number.isInteger(line);
    const over = M.empiricalOver(y.exp, whole ? line + 0.5 : line, pool);
    if (over == null || !isFinite(over)) return null;
    const atLeast = whole ? M.empiricalOver(y.exp, line - 0.5, pool) : over;
    return { over, under: 1 - atLeast, push: atLeast - over, exp: y.exp };
  }

  /** His recent games over a line: how many, of how many. A count, shown as context and never as the headline. */
  function recentAt(M, p, stat, line) {
    const recent = p && Array.isArray(p.recent) ? p.recent : [];
    if (!recent.length) return null;
    if (stat === "td") return { hits: M.recentTdHits(recent), n: recent.length };
    const v = M.recentValues(stat, recent);
    return { hits: v.filter((x) => x > line).length, n: v.length };
  }

  /**
   * Everything the page prints for one offer: the book's line and prices,
   * the no-vig chance, the site's chance at that line, the gap in points
   * and the expected return a unit at each price. `side` is the side the
   * gap favours and `gap` is that side's, positive; `log` is whether it
   * clears MIN_GAP. A one-sided market (a touchdown with no "No" price)
   * is compared with the raw implied chance, which still holds the book's
   * cut, and says so.
   */
  function quote(M, D, p, offer) {
    if (!offer) return null;
    const assumed = fin(offer.cut) && offer.cut >= 0 ? offer.cut : ONE_SIDED_CUT;
    const site = siteChance(M, D, p, offer.stat, offer.line);
    if (!site) return null;
    const dOver = decimal(offer.over), dUnder = decimal(offer.under);
    if (dOver == null && dUnder == null) return null;
    const nv = noVig(offer.over, offer.under);
    const oneSided = !nv;
    /* One-sided: the raw implied chance still holds the book's cut, so it is priced against an estimated one. */
    const fair = nv ? { over: nv.over, under: nv.under } : { over: dOver != null ? 1 / dOver / (1 + assumed) : null, under: dUnder != null ? 1 / dUnder / (1 + assumed) : null };
    const sides = [];
    for (const s of ["over", "under"]) {
      const d = s === "over" ? dOver : dUnder;
      if (d == null || fair[s] == null) continue;
      /* A push returns the stake: it is neither won nor lost. */
      /* The book's two chances sum to one because a push is refunded, so the site's is taken given no push. The return keeps the push as what it is: stake back. */
      const settled = site.push < 1 ? site[s] / (1 - site.push) : 0;
      sides.push({ side: s, price: s === "over" ? offer.over : offer.under, decimal: d, fair: fair[s], site: settled,
        gap: 100 * (settled - fair[s]), ev: site[s] * (d - 1) - (1 - site[s] - site.push) });
    }
    if (!sides.length) return null;
    sides.sort((a, b) => b.gap - a.gap);
    const best = sides[0];
    return {
      stat: offer.stat, book: offer.book, line: offer.line, over: offer.over, under: offer.under,
      oneSided, cut: oneSided ? assumed : null, hold: nv ? nv.hold : null, exp: site.exp, push: site.push,
      sides, side: best.side, gap: best.gap, ev: best.ev, fair: best.fair, site: best.site, price: best.price,
      log: best.gap >= MIN_GAP,
      bias: Object.prototype.hasOwnProperty.call(BIASED, offer.stat) ? BIASED[offer.stat] : null,
      recent: recentAt(M, p, offer.stat, offer.line),
    };
  }

  /**
   * Each book's cut on a yes-only touchdown price, measured off the
   * touchdown prices it does post both sides of: the median of the raw
   * Yes chance over the no-vig one, less one. Only with ten or more;
   * a book with fewer keeps the assumed ONE_SIDED_CUT.
   */
  function cutsOf(payload) {
    const by = {};
    const offers = (payload && payload.offers) || {};
    for (const pid of Object.keys(offers)) {
      const td = offers[pid] && offers[pid].td;
      if (!td) continue;
      for (const book of Object.keys(td)) {
        const nv = noVig(td[book].over, td[book].under), d = decimal(td[book].over);
        if (!nv || d == null) continue;
        (by[book] = by[book] || []).push(1 / d / nv.over - 1);
      }
    }
    const out = {};
    for (const book of Object.keys(by)) {
      if (by[book].length < 10) continue;
      const v = by[book].slice().sort((a, b) => a - b);
      out[book] = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    }
    return out;
  }

  /** Whether a role moved: the recent share against the season's. Null when there is no role to compare. */
  function roleMoved(role) {
    if (!role || !fin(role.season) || !fin(role.recent) || !(role.season > 0)) return null;
    const r = role.recent / role.season;
    return r < ROLE_LOW || r > ROLE_HIGH;
  }

  /** Which side of the book's price a pick took: the one it makes likelier than not, or the underdog. Null without a no-vig chance. */
  function priceSide(pick) { return pick && fin(pick.fair) ? (pick.fair >= 0.5 ? "favourite" : "underdog") : null; }

  /** The size of a gap, as the record groups it. */
  function gapBucket(gap) { return gap >= 20 ? "20+" : gap >= 10 ? "10-20" : "5-10"; }

  /**
   * How the book's close compares with the pick. At the same line: the
   * closing no-vig chance of the picked side minus the pick's (`prob`,
   * in points; positive means the market came to the pick). When the
   * line moved: the points it moved toward the pick (`pts`; an over gains
   * when the line goes up), counted as the spread record counts it. Null
   * without a close.
   */
  function closeMove(pick, close) {
    if (!pick || !close || !fin(close.line)) return null;
    const out = { prob: null, pts: null };
    if (close.line === pick.line) {
      /* A one-sided pick's chance still holds the book's cut, so its close is read the same way. */
      const nv = noVig(close.over, close.under), d = decimal(pick.side === "over" ? close.over : close.under);
      const closing = pick.oneSided ? (d != null ? 1 / d / (1 + (fin(pick.cut) ? pick.cut : 0)) : null) : nv ? nv[pick.side] : null;
      if (closing != null && fin(pick.fair)) out.prob = Math.round(1000 * (closing - pick.fair)) / 10;
      out.pts = 0;
    } else {
      out.pts = Math.round(100 * (pick.side === "over" ? close.line - pick.line : pick.line - close.line)) / 100;
    }
    return out;
  }

  /**
   * A pick settled the way a book would, at the line and price it was
   * made at and never the close. `value` is the player's stat from the
   * box score, or null when the box score has no line for him: the
   * site's rule for a void in version 1 (books draw that line in
   * different places; README, "Prop picks at a book's price"). A push is
   * only possible on a whole-number line. Units are per unit staked.
   */
  function grade(pick, value) {
    if (!pick) return null;
    if (value == null || !isFinite(Number(value))) return { outcome: "void", units: 0 };
    const v = Number(value), d = decimal(pick.price);
    if (v === pick.line) return { outcome: "push", units: 0 };
    const won = pick.side === "over" ? v > pick.line : v < pick.line;
    return { outcome: won ? "win" : "loss", units: won ? (d != null ? Math.round(1e4 * (d - 1)) / 1e4 : 0) : -1 };
  }

  /**
   * The picks of one market, as the record prints them: how many, how
   * often they won, what a unit on each returned with its interval, and
   * what the close did. A void is in none of it; a push counts in n and
   * the return (at zero) and not in the win rate.
   */
  function summarise(picks) {
    const r = (picks || []).filter((p) => p && p.outcome && p.outcome !== "void");
    if (!r.length) return null;
    const decided = r.filter((p) => p.outcome !== "push");
    const won = decided.filter((p) => p.outcome === "win").length;
    const u = r.map((p) => Number(p.units) || 0);
    const mean = u.reduce((a, b) => a + b, 0) / u.length;
    const sd = Math.sqrt(u.reduce((a, b) => a + (b - mean) * (b - mean), 0) / u.length);
    const se = sd / Math.sqrt(u.length);
    const r1 = (x) => Math.round(10 * x) / 10;
    const moved = r.filter((p) => p.clvPts != null && p.clvPts !== 0);
    const sameLine = r.filter((p) => p.clvProb != null);
    /* Only a close with something to compare: the line moved, or it held and both closes gave a chance. */
    const closed = r.filter((p) => p.clvPts != null && (p.clvPts !== 0 || p.clvProb != null));
    const toward = (p) => p.clvPts > 0 || (p.clvPts === 0 && p.clvProb > 0);
    const near = closed.filter((p) => fin(p.closeLead) && p.closeLead >= 0 && p.closeLead <= NEAR_CLOSE), nearSame = near.filter((p) => p.clvProb != null);
    return {
      n: r.length, won, pushes: r.length - decided.length,
      rate: decided.length ? r1((100 * won) / decided.length) : null,
      roi: r1(100 * mean), roiLo: r1(100 * (mean - 1.96 * se)), roiHi: r1(100 * (mean + 1.96 * se)),
      closed: closed.length,
      /* Toward the pick: the line moved its way, or at the same line the no-vig chance rose. */
      movedToward: closed.length ? r1((100 * closed.filter(toward).length) / closed.length) : null,
      lineMoved: moved.length,
      clvProb: sameLine.length ? r1(sameLine.reduce((a, p) => a + p.clvProb, 0) / sameLine.length) : null,
      /* How long before the start the closes were read: the median, in minutes. A "close" from hours out is an early look, not the closing line. */
      /* The same over the closes read within NEAR_CLOSE minutes of the start: the only ones to trust as closing lines. */
      nearClosed: near.length,
      nearToward: near.length ? r1((100 * near.filter(toward).length) / near.length) : null,
      nearClvProb: nearSame.length ? r1(nearSame.reduce((a, p) => a + p.clvProb, 0) / nearSame.length) : null,
      closeLead: (() => { const v = r.map((p) => p.closeLead).filter((x) => fin(x)).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; })(),
    };
  }

  /* ------------------------------------------------------------------ *
   * The page
   * ------------------------------------------------------------------ */

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const price = (a) => (fin(a) ? (a > 0 ? "+" : "−") + Math.abs(Math.round(a)) : "—");
  const pct = (v) => (fin(v) ? (100 * v).toFixed(1) + "%" : "—");
  const pts = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);

  /** The slate a board or a file of prices belongs to: a week of football, a night of basketball. Null when it names neither. */
  function slateOf(x) {
    if (!x) return null;
    if (x.slate != null) return String(x.slate);
    if (x.week != null && x.season != null) return x.season + "-w" + String(x.week).padStart(2, "0");
    return x.date != null ? String(x.date) : null;
  }

  /**
   * A player's offers on one prop, by book, when the file is this
   * board's (the same slate) and his game has not kicked off; null
   * otherwise. A price from another week sits beside a projection that
   * has since moved, and a pregame price after kickoff is nobody's.
   */
  function offersFor(payload, D, p, stat, now) {
    if (!payload || !payload.offers || !D || !p) return null;
    if (slateOf(payload) == null || slateOf(payload) !== slateOf(D)) return null;
    const mine = payload.offers[String(p.id)], byBook = mine && mine[stat];
    if (!byBook) return null;
    const t = now == null ? Date.now() : now;
    /* A price half a day old is not today's price. */
    if (!(t - Date.parse(payload.fetched) <= MAX_SHOWN_AGE)) return null;
    const out = {};
    for (const book of Object.keys(byBook)) {
      const o = byBook[book], g = ((D.games || []).find((x) => String(x.id) === String(o.g)));
      if (!o || !fin(o.line) || !g || !(Date.parse(g.date) > t)) continue;
      /* The book's measured cut on a yes-only price, when it has one (cutsOf); worked out once a file. */
      if (!payload.__cuts) Object.defineProperty(payload, "__cuts", { value: cutsOf(payload), enumerable: false });
      out[book] = fin(payload.__cuts[book]) ? Object.assign({}, o, { cut: payload.__cuts[book] }) : o;
    }
    return Object.keys(out).length ? out : null;
  }

  /** The book lines on a board row: "DK 68.5", or "DK 68.5 · FD 70.5" when the books differ. "" with none. */
  function rowTag(offers) {
    if (!offers) return "";
    const short = { draftkings: "DK", fanduel: "FD" };
    const books = Object.keys(offers), lines = books.map((b) => offers[b].line);
    const same = lines.every((l) => l === lines[0]);
    const one = (b) => esc(short[b] || b) + " " + esc(offers[b].line);
    return same ? books.map((b) => esc(short[b] || b)).join("/") + " " + esc(lines[0]) : books.map(one).join(" · ");
  }

  /**
   * The drawer's block: for each book, its line and both prices, the
   * chance those prices imply with the cut out, the site's chance at
   * that line, the gap, the return a unit expects and his recent games
   * over that line. A gap under MIN_GAP is greyed. "" without an offer
   * the board can price.
   */
  function bookHtml(M, D, p, stat, payload, now) {
    const offers = offersFor(payload, D, p, stat, now);
    if (!offers) return "";
    const td = stat === "td";
    let rows = "", any = null, cutShown = null;
    for (const book of Object.keys(offers)) {
      const q = quote(M, D, p, Object.assign({ stat, book }, offers[book]));
      if (!q) continue;
      any = q;
      if (q.oneSided && cutShown == null) cutShown = q.cut;
      const word = (side) => (td ? (side === "over" ? "to score" : "not to score") : (side === "over" ? "over " : "under ") + q.line);
      const small = q.gap < MIN_GAP;
      rows += '<tr' + (small ? ' class="dimrow"' : "") + "><td><b>" + esc(BOOKS[book] || book) + "</b></td>" +
        "<td>" + price(q.over) + (td && q.under == null ? "" : " / " + price(q.under)) + "</td>" +
        "<td>" + (td ? esc(word(q.side)) : esc(q.side) + " <b>" + esc(q.line) + "</b>") + "</td>" +
        "<td>" + pct(q.fair) + (q.oneSided ? "*" : "") + "</td>" +
        "<td><b>" + pct(q.site) + "</b></td>" +
        "<td><b>" + pts(q.gap) + "</b> <small>" + (small ? "inside the noise" : pts(100 * q.ev) + "% return") + "</small></td>" +
        "<td>" + (q.recent ? q.recent.hits + " of " + q.recent.n : "—") + "</td></tr>";
    }
    if (!any) return "";
    const oneSided = /\*<\/td>/.test(rows);
    const notes = [];
    notes.push("Site is the model's chance at the book's line, not at its own projection line. Gap is site minus the book's chance, with the return a unit at that price expects if the site is right; under " + MIN_GAP + " points is inside what prices and the model both move by.");
    if (oneSided) notes.push("* One-sided: the book posts no opposite price here, so its chance is the price's own less an estimated cut of " + Math.round(100 * (cutShown || 0)) + "%. The cut is an assumption until the record sets it.");
    if (any.bias != null) notes.push("<b>Read this gap with care.</b> The live record has this market's overs off by " + Math.abs(any.bias).toFixed(1) + " points (the model says " + (any.bias > 0 ? "more" : "less") + " than happens), which is more than the gap it takes to log a pick.");
    notes.push("Last over is his recent games " + (td ? "with a touchdown" : "over the book's line, whichever side the gap favours") + ": a count that small is context, not evidence (7 of 10 fits anything from 40% to 89%).");
    notes.push("Prices as of " + esc(String(payload.fetched || "").slice(0, 16).replace("T", " ")) + " UTC. Picks at a gap of " + MIN_GAP + "+ are logged and settled for money on the record.");
    return '<div class="bookblk"><h4 class="muhead">At the book</h4><div class="tscroll"><table class="booktbl"><thead><tr><th>Book</th><th>Over / under</th><th>Side</th><th>Book says</th><th>Site says</th><th>Gap</th><th>Last over</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>" + notes.map((x) => '<p class="note">' + x + "</p>").join("") + "</div>";
  }

  /**
   * A game's props where the site and a book are MIN_GAP points or more
   * apart, biggest gap first: the picks the record logs. "" with none.
   */
  function gameHtml(M, D, game, payload, now) {
    if (!payload || !payload.offers || !D || !game) return "";
    const rows = [];
    for (const p of D.players || []) {
      if (!p || (p.team !== game.home && p.team !== game.away)) continue;
      const stats = payload.offers[String(p.id)];
      if (!stats) continue;
      for (const stat of Object.keys(stats)) {
        const offers = offersFor(payload, D, p, stat, now);
        if (!offers) continue;
        for (const book of Object.keys(offers)) {
          if (String(offers[book].g) !== String(game.id)) continue;
          const q = quote(M, D, p, Object.assign({ stat, book }, offers[book]));
          if (q && q.log) rows.push({ p, stat, book, q });
        }
      }
    }
    if (!rows.length) return "";
    rows.sort((a, b) => b.q.gap - a.q.gap);
    const label = (stat) => (stat === "td" ? "Anytime TD" : M.STATS && M.STATS[stat] ? M.STATS[stat].label : stat);
    return '<div class="game tscroll">' +
      '<table class="booktbl"><thead><tr><th>Player</th><th>Prop</th><th>Book</th><th>Pick</th><th>Price</th><th>Book says</th><th>Site says</th><th>Gap</th></tr></thead><tbody>' +
      rows.map((r) => "<tr><td><b>" + esc(r.p.name) + "</b> <small>" + esc(r.p.team) + "</small></td><td>" + esc(label(r.stat)) + (r.q.bias != null ? " <small>record runs " + (r.q.bias > 0 ? "hot" : "cold") + "</small>" : "") + "</td><td>" + esc(BOOKS[r.book] || r.book) +
        "</td><td>" + (r.stat === "td" ? (r.q.side === "over" ? "to score" : "not to score") : esc(r.q.side) + " <b>" + esc(r.q.line) + "</b>") + "</td><td>" + price(r.q.price) + "</td><td>" + pct(r.q.fair) + (r.q.oneSided ? "*" : "") + "</td><td><b>" + pct(r.q.site) + "</b></td><td><b>" + pts(r.q.gap) + "</b></td></tr>").join("") +
      "</tbody></table></div>";
  }

  /** The record page's table: prop picks at a book's price, a row a market. "" with nothing settled. */
  function recordHtml(R) {
    if (!R || !R.all || !R.markets) return "";
    const signed = (v) => (v >= 0 ? "+" : "−") + Math.abs(v);
    const row = (label, s) => "<tr><td>" + esc(label) + "</td><td>n <b>" + esc(s.n) + "</b>" + (s.rate != null ? " · won <b>" + esc(s.rate) + "%</b>" : "") + (s.pushes ? " (" + esc(s.pushes) + " pushed)" : "") +
      " · a unit on each returned <b>" + signed(s.roi) + "%</b> of stake (" + signed(s.roiLo) + " to " + signed(s.roiHi) + ")" +
      (s.closed ? " · the close moved toward the pick <b>" + esc(s.movedToward) + "%</b> of " + esc(s.closed) + (s.clvProb != null ? ", <b>" + signed(s.clvProb) + "</b> points of no-vig chance at an unmoved line" : "") + (s.closeLead != null ? "; closes read a median <b>" + esc(s.closeLead) + "</b> minutes before the start" +
          (s.nearClosed ? "; of the <b>" + esc(s.nearClosed) + "</b> read within " + NEAR_CLOSE + " minutes of it, <b>" + esc(s.nearToward) + "%</b> moved toward the pick" + (s.nearClvProb != null ? " (<b>" + signed(s.nearClvProb) + "</b> points)" : "") : "; none read within " + NEAR_CLOSE + " minutes of it") : "") : "") + "</td></tr>";
    return "<p><b>" + esc(R.total) + "</b> prop pick" + (R.total === 1 ? "" : "s") + " settled since " + esc(R.since || "") + (R.open ? ", " + esc(R.open) + " open" : "") +
      ": every prop where the site and a book were " + esc(R.minGap) + "+ points apart, at the book's line and the price on file when it was logged.</p><table>" +
      Object.keys(R.markets).map((k) => row(R.markets[k].label, R.markets[k])).join("") + (Object.keys(R.markets).length > 1 ? row("All props", R.all) : "") + "</table>" +
      /* Where the losses come from (2026-11-24): the same picks by the size of the gap and by whether the player's role had moved. */
      (R.gaps && Object.keys(R.gaps).length ? "<p>By the size of the gap:</p><table>" + Object.keys(R.gaps).map((k) => row({ "5-10": "5 to 10 points", "10-20": "10 to 20 points", "20+": "over 20 points" }[k] || k, R.gaps[k])).join("") + "</table>" : "") +
      (R.roles && (R.roles.moved || R.roles.steady) ? "<p>By the player's role, his recent share of the work against his season's:</p><table>" +
        [["moved", "role moved by a quarter or more"], ["steady", "role steady"], ["unknown", "no role on file"]].map((x) => (R.roles[x[0]] ? row(x[1], R.roles[x[0]]) : "")).join("") + "</table>" : "") +
      (R.prices && (R.prices.underdog || R.prices.favourite) ? "<p>By the price: a big gap on the side the book makes the underdog is where the market most often knows something the model does not.</p><table>" +
        [["underdog", "the book's underdog side (under 50% with its cut out)"], ["favourite", "the book's favourite side (50% or more)"]].map((x) => (R.prices[x[0]] ? row(x[1], R.prices[x[0]]) : "")).join("") + "</table>" : "") +
      '<p class="note">The return is the test, and its interval is two standard errors either side. Only a close read within ' + NEAR_CLOSE + ' minutes of the start is a closing line; the rest are early prices. Nothing here is an edge until a market has a few hundred settled picks.</p>';
  }

  return { MARKETS, BOOKS, MIN_GAP, ONE_SIDED_CUT, MAX_SHOWN_AGE, MAX_PICK_AGE, BIASED, NEAR_CLOSE, cutsOf, roleMoved, gapBucket, priceSide, decimal, noVig, normName, parseEvents, matchOffers, contextFor, siteChance, recentAt, quote, closeMove, grade, summarise,
    slateOf, offersFor, rowTag, bookHtml, gameHtml, recordHtml };
});
