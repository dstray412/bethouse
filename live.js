/* live.js — the live tracker's arithmetic. Shared by live.html and the tests.
 *
 * A tracked prop is a player, a prop and a target in one game. The page
 * polls the two public feeds the boards are built from (ESPN's game
 * summary, MLB's live feed) and hands each response here; this module
 * reads the player's line out of it, counts what the prop counts, and
 * says where it stands: scheduled, in play, one away, reached, and once
 * the game is final, cashed, missed or void. Nothing here is a
 * prediction, and a game that is not final settles nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BetHouseLive = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const num = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };
  const ESPN = { NFL: "nfl", "College football": "college-football" };

  /* Football reads ESPN's box-score feed on its cdn host, which allows a
     browser to read it across origins. The site API the fetchers use
     (site.api.espn.com) serves the same shape but answers 403 to any real
     browser user agent (probed 2026-09-29), so a page cannot use it. */
  function feedUrl(t) {
    if (!t) return null;
    if (t.sport === "football") {
      const path = ESPN[t.league];
      return path ? "https://cdn.espn.com/core/" + path + "/boxscore?xhr=1&gameId=" + encodeURIComponent(t.gameId) : null;
    }
    if (t.sport === "baseball") return "https://statsapi.mlb.com/api/v1.1/game/" + encodeURIComponent(t.gameId) + "/feed/live";
    return null;
  }

  /* The cdn feed wraps the game package; the site API's summary is the package itself. */
  const pkg = (x) => (x && x.gamepackageJSON) || x;

  /** A player's live line from an ESPN box score, in the model's box shape; null when he is not in the box. */
  function footballLine(summary, playerId) {
    const g = pkg(summary);
    const teams = g && g.boxscore && g.boxscore.players;
    if (!Array.isArray(teams)) return null;
    const id = String(playerId);
    const line = { pass: { yds: 0, td: 0 }, rush: { yds: 0, td: 0 }, rec: { rec: 0, yds: 0, td: 0 }, tds: 0 };
    let found = false;
    for (const t of teams) {
      for (const s of (t.statistics || [])) {
        const keys = s.keys || [];
        for (const a of (s.athletes || [])) {
          if (!a.athlete || String(a.athlete.id) !== id) continue;
          found = true;
          const get = (k) => { const i = keys.indexOf(k); return i < 0 ? 0 : num(a.stats && a.stats[i]); };
          if (s.name === "passing") { line.pass.yds = get("passingYards"); line.pass.td = get("passingTouchdowns"); }
          else if (s.name === "rushing") { line.rush.yds = get("rushingYards"); line.rush.td = get("rushingTouchdowns"); }
          else if (s.name === "receiving") { line.rec.rec = get("receptions"); line.rec.yds = get("receivingYards"); line.rec.td = get("receivingTouchdowns"); }
        }
      }
    }
    if (!found) return null;
    line.tds = line.rush.td + line.rec.td;
    return line;
  }

  function footballState(summary) {
    const g = pkg(summary);
    const c = g && g.header && g.header.competitions && g.header.competitions[0];
    const st = c && c.status;
    if (!st) return { state: "pre", detail: "" };
    const type = st.type || {};
    /* "post" covers postponed and cancelled as well as final; only a
       completed game settles anything. The rest read as not started. */
    const state = type.state === "in" ? "in" : type.state === "post" && type.completed === true ? "post" : "pre";
    return { state, detail: type.detail || "" };
  }

  /** A batter's line from MLB's live feed; null when he has no batting line. */
  function mlbLine(feed, playerId) {
    const teams = feed && feed.liveData && feed.liveData.boxscore && feed.liveData.boxscore.teams;
    if (!teams) return null;
    for (const side of ["away", "home"]) {
      const p = teams[side] && teams[side].players && teams[side].players["ID" + String(playerId)];
      const b = p && p.stats && p.stats.batting;
      if (b && Object.keys(b).length) return { hits: num(b.hits), runs: num(b.runs), rbi: num(b.rbi), totalBases: num(b.totalBases), homeRuns: num(b.homeRuns), pa: num(b.plateAppearances) };
    }
    return null;
  }

  function mlbState(feed) {
    const st = feed && feed.gameData && feed.gameData.status;
    const abs = (st && st.abstractGameState) || "";
    const off = /postponed|cancel|suspended/i.test((st && st.detailedState) || "");
    const state = abs === "Live" ? "in" : abs === "Final" && !off ? "post" : "pre";
    const ls = feed && feed.liveData && feed.liveData.linescore;
    const detail = state === "in" && ls && ls.currentInning ? (ls.inningHalf || "") + " " + ls.currentInning : (st && st.detailedState) || "";
    return { state, detail: detail.trim() };
  }

  /** What a tracked prop counts toward. */
  function target(t) {
    if (t.prop === "td" || t.prop === "hrr" || t.prop === "hr") return 1;
    const tb = /^tb(\d+)$/.exec(String(t.prop));
    if (tb) return Number(tb[1]);
    return num(t.rung);
  }

  /** What the prop counts so far, off the line; null without a line. `model` is nfl.js, for the counting props. */
  function current(t, line, model) {
    if (!line) return null;
    if (t.sport === "baseball") {
      if (t.prop === "hrr") return line.hits + line.runs + line.rbi;
      if (t.prop === "hr") return line.homeRuns;
      if (/^tb\d+$/.test(String(t.prop))) return line.totalBases;
      return null;
    }
    if (t.prop === "td") return num(line.tds);
    /* Only a stat the model knows; a stored prop it does not is no count, not a throw. */
    const known = model && model.STATS && Object.prototype.hasOwnProperty.call(model.STATS, t.prop);
    return known && typeof model.gameValue === "function" ? model.gameValue(t.prop, line) : null;
  }

  /* One away means one more of the countable thing: a touchdown, a catch,
     a base, a hit; for a yards prop, within ten yards. */
  function margin(t) {
    return /yds|rushrec/.test(String(t.prop)) ? 10 : 1;
  }

  function progress(t, cur, state) {
    const tgt = target(t);
    /* No line, or nothing to count toward (a rung of 0, a prop unknown to the model): never reached. */
    if (cur == null || !(tgt > 0)) return { current: cur == null ? null : cur, target: tgt, status: state === "post" ? "void" : state === "in" ? "in play" : "scheduled", remaining: null };
    const remaining = Math.max(0, tgt - cur);
    let status;
    if (cur >= tgt) status = state === "post" ? "cashed" : "reached";
    else if (state === "post") status = "missed";
    else if (state === "pre") status = "scheduled";
    else status = remaining <= margin(t) ? "one away" : "in play";
    return { current: cur, target: tgt, status, remaining };
  }

  function summarise(items) {
    const out = { all: 0, inPlay: 0, oneAway: 0, reached: 0 };
    for (const it of items || []) {
      out.all++;
      if (it.status === "in play" || it.status === "one away") out.inPlay++;
      if (it.status === "one away") out.oneAway++;
      if (it.status === "reached" || it.status === "cashed") out.reached++;
    }
    return out;
  }

  /** How long until the next poll: twenty seconds with a game live, five minutes before any starts, never once all are final. */
  function pollInterval(states) {
    const s = states || [];
    if (s.indexOf("in") >= 0) return 20000;
    if (s.indexOf("pre") >= 0) return 300000;
    return 0;
  }

  return { feedUrl, footballLine, footballState, mlbLine, mlbState, target, current, progress, summarise, pollInterval };
});
