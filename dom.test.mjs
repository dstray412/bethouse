/*
 * BetHouse — dom.test.mjs
 * The gate that would have caught this session's design bugs.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The suite had 202 tests and not one of them looked at a page. score.js,
 * edge.js, golf.js and nfl.js were covered to the decimal place while the
 * three HTML boards -- the entire thing a user actually sees -- had no
 * coverage at all. A design review then found five defects on a fully green
 * suite, including two controls that rendered on every view and did nothing.
 * The gate and the failures did not overlap anywhere.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not render anything. There is no jsdom, no headless browser, no
 * package.json, because "no build step, no server, no API key" is a real
 * property of this project and a test dependency would be the first crack
 * in it. Nor does it skip when a browser is missing: a gate that reports
 * success while quietly running nothing is worse than no gate.
 *
 * So it asserts SOURCE INVARIANTS instead -- the things that were actually
 * broken, in the form they were actually broken in. Every assertion below
 * is a regression test for a real defect, and each was checked against the
 * pre-fix source to confirm it fails there.
 *
 * Runtime behaviour (horizontal scroll, console errors, computed contrast)
 * stays in `/design-review`, which drives a real browser on demand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BOARDS = ["index.html", "golf.html", "nfl.html", "cfb.html", "bets.html"];
const src = (f) => readFileSync(resolve(DIR, f), "utf8");

/*
 * Markup only, with <script> bodies removed.
 *
 * The first version of the duplicate-id check scanned raw source and
 * reported nfl.html as defining the id `why'+i+'` three times. That is a
 * JavaScript string concatenation appearing once per view renderer, not a
 * duplicated DOM id -- the regex was reading JS as if it were HTML. Style
 * blocks are deliberately KEPT, because the CSS assertions above need them.
 */
const markup = (f) => src(f).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

/* ------------------------------------------------------------------ *
 * FINDING-001 — the hidden attribute must actually hide
 *
 * .ctl and .controls declare display:flex. An author style beats the UA
 * stylesheet's [hidden]{display:none} regardless of specificity, so
 * `el.hidden = true` silently did nothing: the Bases control sat on every
 * bet type and the NFL yardage control on two views of three, both inert.
 * ------------------------------------------------------------------ */

const SHEET = "board.css";

test("every board loads the one shared stylesheet, and none carries its own copy", () => {
  for (const f of BOARDS) {
    const s = src(f);
    assert.match(s, /<link rel="stylesheet" href="board\.css">/, `${f} does not load ${SHEET}`);
    assert.doesNotMatch(s, /:root\s*\{/, `${f} defines its own :root tokens; they live in ${SHEET}`);
    const own = (s.match(/<style>[\s\S]*?<\/style>/g) || []).join("\n");
    // A page may override a shared rule by repeating its selector (bets pads
    // its segments, baseball's rows have more columns); what it may not do
    // is carry a copy of the sheet. These are the rules that mark a copy.
    for (const shared of [".who{", ".prob{", ".note{", ".gtitle{", "header{", ".logo{", ".why{"]) {
      assert.ok(!own.includes("\n" + shared), `${f} re-declares ${shared} in its own <style>; edit ${SHEET} instead`);
    }
  }
});

test("every board neutralises the hidden-attribute override", () => {
  {
    const f = SHEET;
    const css = src(f);
    assert.match(
      css,
      /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/,
      `${f} is missing [hidden]{display:none!important} — any class that sets ` +
        `display will beat the attribute and leave dead controls on screen`,
    );
  }
});

test("nothing re-introduces a display rule that could outrank it", () => {
  // The !important above wins, but only while nothing else is !important.
  for (const f of BOARDS) {
    const bad = src(f).match(/\.(ctl|controls)[^{]*\{[^}]*display\s*:[^;}]*!important/g);
    assert.equal(
      bad, null,
      `${f} declares display !important on .ctl/.controls, which would tie with ` +
        `the [hidden] rule and reopen FINDING-001`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * FINDING-002 — prose needs a measure
 *
 * The paragraph carrying the calibration caveats ran 166 characters per
 * line against a 45-75 target. Long measure is the readability defect that
 * matters: past ~75 the eye loses the next line on the return sweep.
 * ------------------------------------------------------------------ */

test("the explanatory paragraph has a capped measure", () => {
  {
    const f = SHEET;
    const rule = src(f).match(/\.note\{[^}]*\}/);
    assert.ok(rule, `${f} has no .note rule`);
    assert.match(
      rule[0], /max-width\s*:\s*\d+ch/,
      `${f}: .note has no ch-based max-width, so it will run the full column ` +
        `width — this is how it reached 166 characters per line`,
    );
  }
});

test("the measure cap is set in ch, and low enough to mean it", () => {
  /*
   * 1ch is the advance width of "0", which is wider than average prose:
   * max-width:72ch measured 93 real characters here. Anything above ~60ch
   * is over the 75-character limit in practice regardless of what the
   * number looks like.
   */
  {
    const f = SHEET;
    const m = src(f).match(/\.note\{[^}]*max-width\s*:\s*(\d+)ch/);
    assert.ok(m, `${f}: .note max-width is not in ch`);
    const ch = Number(m[1]);
    assert.ok(
      ch <= 60,
      `${f}: .note is capped at ${ch}ch. 1ch is the width of "0" and wider than ` +
        `average prose, so ${ch}ch renders roughly ${Math.round(ch * 1.3)} characters ` +
        `— over the 75-character limit. 56ch is the measured value for 72 characters.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Copy-paste drift — the root cause behind FINDING-001 and FINDING-004
 *
 * The boards do not share a stylesheet, they share a copy of one.
 * Two separate findings this session were the copies diverging. Pin the
 * design tokens so a change to one board that should apply to all cannot
 * silently apply to one.
 * ------------------------------------------------------------------ */

test("the design tokens exist once, in the shared stylesheet", () => {
  const blocks = src(SHEET).match(/:root\{[^}]*\}/g) || [];
  assert.equal(blocks.length, 1, `${SHEET} should define :root exactly once`);
  assert.match(blocks[0], /--accent:/);
});

/* ------------------------------------------------------------------ *
 * FINDING-004 — wayfinding
 *
 * The same destination had two names depending on where you stood, and the
 * baseball board never said which board it was: the only signal of location
 * was which nav link happened to be absent.
 * ------------------------------------------------------------------ */

test("every board links to every other board, and nowhere broken", () => {
  for (const f of BOARDS) {
    const hrefs = [...src(f).matchAll(/class="navlink"\s+href="([^"]+)"/g)].map((m) => m[1]);
    const others = BOARDS.filter((b) => b !== f);
    assert.equal(
      hrefs.length, others.length,
      `${f} has ${hrefs.length} nav links, expected ${others.length} (one per sibling board)`,
    );
    for (const o of others) {
      assert.ok(hrefs.includes(o), `${f} does not link to ${o}`);
    }
    for (const h of hrefs) {
      assert.ok(existsSync(resolve(DIR, h)), `${f} links to ${h}, which does not exist`);
    }
  }
});

test("a destination has ONE name everywhere it is linked", () => {
  const names = new Map(); // href -> Set of link texts
  for (const f of BOARDS) {
    for (const m of src(f).matchAll(/class="navlink"\s+href="([^"]+)">([^<]+)</g)) {
      const href = m[1];
      const label = m[2].replace(/[→\s]+$/u, "").trim();
      if (!names.has(href)) names.set(href, new Set());
      names.get(href).add(label);
    }
  }
  for (const [href, set] of names) {
    assert.equal(
      set.size, 1,
      `${href} is called ${[...set].map((s) => `"${s}"`).join(" and ")} depending on which ` +
        `board you are standing on. A section that renames itself stops users building a ` +
        `map of the site.`,
    );
  }
});

test("every board states which board it is", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const hasStatic = /class="tagline"[^>]*>[^<]*\S[^<]*</.test(s);
    const hasDynamic = /tagline'\)\.textContent\s*=\s*'[A-Z]/.test(s);
    assert.ok(
      hasStatic || hasDynamic,
      `${f} has an empty tagline — the page never names itself, so the only clue to ` +
        `where you are is which nav link is missing (the trunk test failing)`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Assets — a board that cannot load its own model is a blank page
 * ------------------------------------------------------------------ */

test("every script and stylesheet a board loads actually exists", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const refs = [
      ...[...s.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ].filter((r) => !/^https?:/.test(r));
    assert.ok(refs.length, `${f} loads no local assets, which cannot be right`);
    for (const r of refs) {
      assert.ok(existsSync(resolve(DIR, r)), `${f} loads ${r}, which does not exist in the repo`);
    }
  }
});

test("no board defines the same id twice", () => {
  for (const f of BOARDS) {
    const ids = [...markup(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(
      [...new Set(dupes)], [],
      `${f} defines duplicate ids, so getElementById silently returns whichever came first`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The parlay may only be built on the prop it was measured on
 *
 * index.html hid the SUGGEST control on total bases and home runs, which
 * looked like the scope rule was enforced. It was not: every row still
 * rendered a live + button, so a total-bases slip was two clicks away and
 * arrived carrying "cross-game slips cashed 1.03-1.08x as often as the
 * product predicts" — a measurement taken on 1+ H/R/RBI and nowhere else.
 *
 * A gate on the control alone cannot catch that, so this checks the thing
 * that was actually wrong: the button itself must sit INSIDE the guard.
 * ------------------------------------------------------------------ */

/* The body of the first `if (<needle>) { ... }` in `js`, brace-matched.
   Braces inside strings, template literals, regex literals and comments
   would break a naive counter; the render code has none inside this block,
   and the assertion below fails loudly rather than silently passing if
   that ever stops being true. */
function guardedRanges(js, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = js.indexOf(needle, from);
    if (at < 0) return out;
    /* The needle ends with its own `{`; scanning from `at` finds that brace
       and not the next one down. Getting this wrong once already cost a
       confusing failure, which is the good outcome — the assertions below
       are written so a broken scan reports "outside the guard" rather than
       quietly passing. */
    const open = js.indexOf("{", at);
    if (open < 0) return out;
    let depth = 0;
    let close = -1;
    for (let i = open; i < js.length; i++) {
      if (js[i] === "{") depth++;
      else if (js[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) return out;
    out.push([open, close]);
    from = close;
  }
}

test("every add-to-parlay button is built inside the eligibility guard", () => {
  const js = src("index.html");
  assert.ok(
    js.includes("S.parlayEligible("),
    "index.html must ask score.js which views may build a parlay, not re-derive it",
  );

  const guards = guardedRanges(js, "if(S.parlayEligible(state.view)){");
  assert.ok(guards.length, "no `if(S.parlayEligible(state.view)){` block found in index.html");

  /* There is one row renderer for today and one for a replayed day, and both
     build a + button. Counting call sites would have to be edited every time
     a renderer is added; what actually matters is that NONE of them sits
     outside a guard. */
  const sites = [];
  for (let i = js.indexOf("'addleg'"); i >= 0; i = js.indexOf("'addleg'", i + 1)) sites.push(i);
  assert.ok(sites.length, "index.html no longer builds an addleg button");

  for (const at of sites) {
    const inside = guards.some(([open, close]) => at > open && at < close);
    assert.ok(
      inside,
      `an addleg button at index ${at} is built OUTSIDE the eligibility guard — ` +
        "that is how it became reachable on total bases and home runs",
    );
  }

  /* And the suggestion candidates, which only the live board collects. */
  const push = js.indexOf("state.candidates.push");
  assert.ok(push > 0, "the live board no longer collects suggestion candidates");
  assert.ok(
    guards.some(([open, close]) => push > open && push < close),
    "suggestion candidates are collected outside the eligibility guard",
  );
});

/* ------------------------------------------------------------------ *
 * A price that already carries its sign must not be given a second one
 *
 * fetch-odds-espn.mjs stores American prices as SIGNED STRINGS: "+111",
 * "-103". index.html rendered them as `(mkt.over>0?'+':'')+mkt.over`, and
 * "+111" > 0 coerces to 111 > 0, which is true — so every positively
 * priced row on total bases showed `++111`, in the chip and again in the
 * detail panel's "Market: ++111 over 1.5". Negative prices looked fine,
 * which is why it survived: half the rows were correct.
 *
 * index.html already has amer() for exactly this. Math.round("+111") is
 * 111, so it takes the string or a number and emits one sign either way.
 * ------------------------------------------------------------------ */

/* The prices that break the contract. An empty market set yields none, which
   is the entire point: see the note below. */
const unsignedPrices = (markets) =>
  Object.values(markets)
    .flatMap((m) => [m.over, m.under])
    .filter((p) => !/^[+-]\d+$/.test(String(p)));

/*
 * An empty slate is a legitimate state and must never fail a run.
 *
 * The first version of the test below asserted `prices.length > 0`. That is
 * a claim about the live feed, and this file runs inside all three refresh
 * workflows against data they have just fetched. At 13:51 UTC on 2026-08-20
 * no MLB props were posted yet, refresh-odds.yml printed its own "no
 * scheduled games — nothing priced" and exited 0 as designed, then handed
 * the same empty file to `node --test` and this assertion failed the run.
 * Thirteen consecutive refreshes died on it and the board sat past its
 * six-hour cutoff showing no prices at all.
 *
 * The rule was already written, three lines above the call site: "An empty
 * slate is legitimate (no games scheduled); a malformed file is not. Only
 * the second one should fail the run."
 *
 * So: nothing in this file may assert that live data is non-empty. Check the
 * shape of what is there; say how much that was.
 */

test("an empty slate is not a contract violation", () => {
  assert.deepEqual(unsignedPrices({}), [], "an empty market set must pass");
  assert.deepEqual(
    unsignedPrices({ a: { over: "+108", under: "-144" } }),
    [],
    "signed strings are the contract",
  );
  assert.deepEqual(
    unsignedPrices({ a: { over: 108, under: "-144" } }),
    [108],
    "a bare number is a violation — it is what made index.html print ++108",
  );
});

test("the odds feed stores prices with their sign attached", (t) => {
  const file = resolve(DIR, "odds-data.js");
  assert.ok(existsSync(file), "odds-data.js is missing");

  const win = {};
  new Function("window", readFileSync(file, "utf8"))(win);
  const markets = (win.BetHouseOdds || {}).markets;
  assert.ok(markets && typeof markets === "object", "odds-data.js defines no markets object");

  assert.deepEqual(
    unsignedPrices(markets),
    [],
    "a price is not a signed American string — the render path assumes it is",
  );

  /* Vacuous on an empty slate, by design. Reported so that a file which is
     empty forever is visible in the run output rather than silently green. */
  t.diagnostic(
    `${Object.keys(markets).length} markets, ${Object.values(markets).length * 2} prices checked`,
  );
});

test("no board hand-prefixes a sign onto a market price", () => {
  /* The bug in the form it was written in: a truthiness test on a value
     that is already signed, used to decide whether to add a sign. */
  for (const f of BOARDS) {
    const js = src(f);
    const offenders = js.match(/\.(over|under)\s*>\s*0\s*\?\s*'\+'/g) || [];
    assert.deepEqual(
      offenders,
      [],
      `${f} prefixes '+' onto an already-signed market price — use amer()`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A fixed-width cell must not let its content decide the row height
 *
 * nfl.html's spread board put "SEA -7.2" inside .prob, a 74px grid column
 * styled for one 21px number. Fifteen of sixteen rows wrapped to two lines
 * and "TB -0.7" did not, so row heights alternated 63px and 32px on
 * nothing but the length of a team abbreviation. The board read as ragged
 * for a reason carrying no information.
 *
 * The file already had the answer in .be: number, then a <small> block
 * label under it ("43.3 / total"). The invariant is that a sublabel inside
 * one of these cells is a block, never inline text that can wrap.
 * ------------------------------------------------------------------ */

test("a sublabel inside a fixed-width row cell is a block, not wrappable text", () => {
  const css = src(SHEET);
  const rule = css.match(/^([^\n{]*\bsmall\b[^\n{]*)\{([^}]*display:\s*block[^}]*)\}/m);
  assert.ok(rule, `${SHEET} has no display:block rule for row sublabels`);

  const selectors = rule[1].split(",").map((s) => s.trim());
  for (const cell of [".be", ".prob"]) {
    assert.ok(
      selectors.includes(`${cell} small`),
      `${cell} small is not blocked — content can wrap and set the row height`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * One age computation, not two
 *
 * index.html used to compute the feed's age twice: once inside the ODDS
 * gate to decide whether to show prices, and again into an ODDS_AGE_H
 * that nothing ever read. Two copies of the same arithmetic, one of them
 * dead — which is why the board could withhold prices without being able
 * to say it was withholding them.
 * ------------------------------------------------------------------ */

test("the board asks edge.js how old the odds are, and asks once", () => {
  const js = src("index.html");
  assert.ok(
    js.includes("E.oddsFreshness("),
    "index.html must get odds age from edge.js, not re-derive it",
  );
  const inlined = js.match(/Date\.parse\([^)]*generated[^)]*\)/g) || [];
  assert.deepEqual(
    inlined,
    [],
    "index.html re-derives the feed's age inline; that is the duplication oddsFreshness replaced",
  );
});

/* ------------------------------------------------------------------ *
 * Every test file is actually wired into every gate
 *
 * `node --test` is invoked with an explicit file list, not bare discovery,
 * because discovery would fire the backtest scripts and their live API
 * calls. The cost of that is the list existing in SEVEN places, and adding a
 * seventh test file means remembering all seven. Miss one and the gap is
 * silent: the suite still passes, just without the new file.
 *
 * This is the same duplication that put the parlay scope rule in two places
 * and let them disagree. Here it cannot be deduplicated away — the CI files
 * are YAML and the hook config is its own format — so it gets checked
 * instead.
 * ------------------------------------------------------------------ */

test("every test file runs in every gate that runs tests", () => {
  const GATES = [
    "scripts/local-check.sh",
    ".pre-commit-config.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/refresh.yml",
    ".github/workflows/refresh-nfl.yml",
    ".github/workflows/refresh-cfb.yml",
    ".github/workflows/refresh-odds.yml",
  ];

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  assert.ok(files.length >= 6, `expected the suite's test files, found ${files.join(", ")}`);

  for (const gate of GATES) {
    const path = resolve(DIR, gate);
    assert.ok(existsSync(path), `${gate} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(/node --test/.test(text), `${gate} no longer runs the suite`);
    for (const f of files) {
      assert.ok(text.includes(f), `${gate} does not run ${f}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Two copies of the name matcher, and they have to agree
 *
 * The odds feed keys every market by a normalised player name. That
 * normalisation exists twice: `normalizeName` in fetch-odds-espn.mjs, which
 * writes the keys, and `normName` in index.html, which reads them. The
 * board cannot import an .mjs without becoming a module, so the duplication
 * is structural rather than careless.
 *
 * If they ever disagree, no price matches any player: the chips vanish, and
 * closing line value silently reports nothing for every bet rather than
 * failing loudly. So compare them on the names that actually break this
 * sort of function.
 * ------------------------------------------------------------------ */

test("the board and the odds fetcher normalise names identically", async () => {
  const { normalizeName } = await import("./fetch-odds-espn.mjs");

  const js = src("index.html");
  const at = js.indexOf("function normName(s){");
  assert.ok(at > 0, "index.html no longer defines normName");
  const end = js.indexOf("\n}", at) + 2;
  // eslint-disable-next-line no-new-func
  const boardVersion = new Function(js.slice(at, end) + "; return normName;")();

  const NAMES = [
    "Luis García Jr.",          // accent AND a suffix
    "José Ramírez",
    "Ronald Acuña Jr.",
    "Ken Griffey Sr.",
    "Vladimir Guerrero Jr.",
    "J.T. Realmuto",            // periods inside initials
    "A.J. Pollock",
    "Jackson Merrill III",
    "Michael A. Taylor",
    "Shohei Ohtani",
    "O'Neil Cruz",              // apostrophe
    "Jean-Carlos Rodríguez",    // hyphen
    "  Extra   Spaces  ",
    "",
  ];
  for (const n of NAMES) {
    assert.equal(
      boardVersion(n),
      normalizeName(n),
      `"${n}" normalises differently in index.html than in fetch-odds-espn.mjs — ` +
        `every market key for a name like this would fail to match, and CLV would ` +
        `quietly report nothing`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * The opponent reaches every projection, or none
 *
 * The board, the tracker, the board's pools and the replay must all
 * compute the same opponent-adjusted expectation, or the record grades a
 * bet the board never offered. The functions are tested in nfl.test.mjs;
 * this is the wiring, which no unit test can see.
 * ------------------------------------------------------------------ */
test("every statEligible call outside the model passes the opponent, and every pool divides by projectedStat", () => {
  const callers = ["football-board.js", "track-football.mjs", "backtest-nfl.mjs"];
  for (const f of callers) {
    const js = src(f);
    const calls = js.match(/statEligible\([^;\n]*/g) || [];
    assert.ok(calls.length, `${f} no longer calls statEligible`);
    for (const c of calls) assert.match(c, /oppFactor/, `${f}: ${c} does not pass the opponent`);
  }
  for (const f of ["fetch-football.mjs", "backtest-nfl.mjs"]) {
    const js = src(f);
    assert.match(js, /projectedStat\(stat, (r|rec), null, \{ oppFactor: [^}]*\}\)/, `${f}: the pool divisor is not the model's projectedStat`);
    assert.doesNotMatch(js, /expectedStat\([^)]*\)\s*\*\s*[A-Za-z.]*statOppFactor/, `${f}: the pool divisor is re-derived by hand`);
    assert.doesNotMatch(js, /p\.team === g\.home\.team \? g\.away\.team : g\.home\.team/, `${f}: a two-way opponent lookup gives the home team to a player on neither side; use opponentIn`);
  }
});

/* ------------------------------------------------------------------ *
 * A stat the model gains is a view the page gains — copy included
 *
 * The board builds one view per row of the model's stat table, so adding
 * "Rush + rec yards" to nfl.js put a fifth view on both football boards
 * without either page being touched. What does NOT arrive on its own is
 * the sentence above the rows: `copy.noteStat` is keyed by stat, and a
 * missing key renders the word `undefined` across the top of the board.
 * ------------------------------------------------------------------ */

test("the views are built from the model's stat table, not a list typed on the page", () => {
  const js = src("football-board.js");
  assert.match(
    js, /Object\.keys\(N\.STATS\)/,
    "football-board.js no longer builds its views from the model's stat table; a " +
      "second copy of the list is how a stat the model has stops being a view the page has",
  );
});

test("every counting prop the model has has a note on both football boards", async () => {
  const nfl = (await import("./nfl.js")).default;
  const stats = Object.keys(nfl.STATS);
  assert.ok(stats.length >= 5, `expected the model's counting props, found ${stats.join(", ")}`);
  for (const f of ["nfl.html", "cfb.html"]) {
    const js = src(f);
    const at = js.indexOf("noteStat:");
    assert.ok(at > 0, `${f} defines no noteStat table`);
    const end = js.indexOf("noteGames:", at);
    assert.ok(end > at, `${f}: noteStat is no longer followed by noteGames; this slice is wrong`);
    const block = js.slice(at, end);
    for (const s of stats) {
      assert.match(
        block, new RegExp("\\b" + s + ":"),
        `${f}: noteStat has no entry for "${s}", so that view renders "undefined" above its rows`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The panel reads the model, it does not re-derive it
 *
 * A stat's season total is a LIST of record fields now (rush + rec sums
 * two), so `r.p[ST.total]` — which worked while every row named one
 * field — silently became `undefined`, and the panel said the player
 * averages NaN a game.
 * ------------------------------------------------------------------ */

test("the panel reads a season total through the model, never off the record by key", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.statTotal\(/, "football-board.js no longer asks the model for a season total");
  assert.doesNotMatch(
    js, /\[ST\.total\]/,
    "football-board.js indexes a record by ST.total, which is a LIST of fields — " +
      "that is undefined for every stat and NaN in the panel",
  );
});

/* ------------------------------------------------------------------ *
 * The ladder: the alternate lines, priced, inside the panel
 *
 * Every rung comes from the model (`ladder`, `fairPrice`) so the page and
 * the tracker offer the same rungs, and the strip wraps or scrolls in its
 * own box — thirteen rungs must not make the body scroll sideways on a
 * 390px phone.
 * ------------------------------------------------------------------ */

test("the expanded counting-prop panel prices every rung off the model's ladder", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.ladder\(/, "the panel does not ask the model for the alternate lines");
  assert.match(js, /class="rungs"/, "the panel renders no ladder strip");
  assert.doesNotMatch(
    js, /LADDERS\s*[=:]/,
    "football-board.js carries its own copy of the rungs; they live in nfl.js",
  );
});

test("the ladder wraps inside its own box, so the page never scrolls sideways", () => {
  const css = src(SHEET);
  const rule = css.match(/\.rungs\{[^}]*\}/);
  assert.ok(rule, `${SHEET} has no .rungs rule — the ladder strip is unstyled`);
  assert.match(
    rule[0], /repeat\(auto-fill|repeat\(auto-fit|overflow-x:\s*auto/,
    `${SHEET}: .rungs neither wraps into columns nor scrolls in its own container, ` +
      `so thirteen rungs push the body sideways on a phone`,
  );
});

/* ------------------------------------------------------------------ *
 * A leg is only parlayed on a prop the replay measured
 *
 * The candidate loop runs over every stat the model has, so a stat the
 * model gains would become a parlay leg the replay never graded unless
 * the eligibility gate is inside the loop.
 * ------------------------------------------------------------------ */

test("every counting-prop parlay leg is built inside the parlay-eligibility gate", () => {
  const js = src("football-board.js");
  assert.match(js, /eligible\s*=\s*N\.DEFAULTS\.parlayProps/, "the board no longer reads parlayProps from the model");
  const loops = guardedRanges(js, "STAT_IDS.forEach(function(stat){");
  assert.ok(loops.length, "no per-stat candidate loop found in football-board.js");
  for (const [open, close] of loops) {
    const body = js.slice(open, close);
    if (!body.includes("out.push(")) continue;
    const gate = body.indexOf("on(stat)");
    assert.ok(gate >= 0, "the per-stat candidate loop does not ask whether the prop is parlay-eligible");
    assert.ok(
      gate < body.indexOf("out.push("),
      "a counting-prop leg is pushed before the eligibility gate runs — that is how a " +
        "prop the replay never measured becomes a leg",
    );
  }
});

/* ------------------------------------------------------------------ *
 * The stale-model guard has to know every function it is guarding
 *
 * The page, the board script and the model are three separately cached
 * files, so a browser can hold a new page and an old model. The board
 * checks the model has what it needs and says "reload" instead of failing
 * silently — which only works while the list is the whole list.
 * ------------------------------------------------------------------ */

test("every model function the board calls is named in its stale-model check", () => {
  const js = src("football-board.js");
  const m = js.match(/var NEEDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "football-board.js no longer declares NEEDS");
  const needs = new Set(m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")));
  const called = new Set([...js.matchAll(/\bN\.([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]));
  for (const fn of called) {
    assert.ok(
      needs.has(fn),
      `football-board.js calls N.${fn}() but NEEDS does not list it — against a cached ` +
        `older model that is a silent failure, which is exactly what NEEDS exists to prevent`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A strip that scrolls sideways must be the thing that scrolls
 *
 * The football boards let the bet types scroll rather than stack, with
 * `overflow-x:auto` on the segment strip. It never engaged: a flex item's
 * default minimum size is its content, so the .ctl around it simply grew
 * to the full width of the buttons and the BODY scrolled sideways instead.
 * Measured on nfl.html at 390px: 322px of body overflow with four counting
 * props, 458 with five, 0 once the item is allowed to shrink.
 * ------------------------------------------------------------------ */

test("a scrolling control strip sits in a box that is allowed to shrink", () => {
  for (const f of ["nfl.html", "cfb.html"]) {
    const own = (src(f).match(/<style>[\s\S]*?<\/style>/g) || []).join("\n");
    if (!/\.seg\{[^}]*overflow-x\s*:\s*auto/.test(own)) continue;
    assert.match(
      own, /\.ctl\{[^}]*min-width\s*:\s*0/,
      `${f} scrolls its segment strip with overflow-x but never lets the flex item ` +
        `around it shrink (min-width:0), so the page scrolls sideways instead of the strip`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * How big a pool is, is the model's question
 *
 * A pool is a flat list of ratios in an older data file and {exp, ratio}
 * sorted by expectation in a newer one — the levelling that stopped a
 * 20-yard projection being priced off a 90-yard one's shape. `pool.length`
 * is `undefined` on the second shape, which silently drops every row (the
 * gate reads `< 300`) and prints "read off undefined real games".
 * ------------------------------------------------------------------ */

test("the board asks the model how many games a pool holds, never .length", () => {
  const js = src("football-board.js");
  assert.match(js, /N\.poolSize\(/, "football-board.js no longer asks the model for a pool's size");
  assert.doesNotMatch(
    js, /\bpool\s*\.\s*length/,
    "football-board.js takes .length of a pool, which is undefined once the pool " +
      "is {exp, ratio} — use N.poolSize(pool)",
  );
  assert.doesNotMatch(
    js, /pool\s*\.\s*(ratio|exp)\b/,
    "football-board.js reaches inside a pool's shape; nfl.js owns that (poolSize, poolNear)",
  );
});

/* ------------------------------------------------------------------ *
 * The matchup panel — the first test in this file that RENDERS
 *
 * Everything above asserts source invariants, for the reason at the top:
 * no jsdom, no browser, no package.json. This one still honours that —
 * the stub below is thirty lines of plain objects, not a dependency — but
 * it runs the real board script and calls the real detail builder, because
 * "the section is there for a game in the file and absent for a game that
 * is not" is a claim about output, and a regex over the source would pass
 * on markup that never renders.
 * ------------------------------------------------------------------ */

/* Enough of an element for football-board.js: it sets innerHTML, appends
   created children, registers listeners, and reads back textContent. */
function stubEl(tag) {
  return {
    tag, children: [], handlers: {}, attrs: {},
    innerHTML: "", textContent: "", value: "", className: "", hidden: false,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {},
  };
}

function stubDoc() {
  const byId = new Map();
  return {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stubEl(id));
      return byId.get(id);
    },
    createElement(tag) { return stubEl(tag); },
    addEventListener() {},
    activeElement: { tagName: "BODY" },
  };
}

/** Mount the real board against the stub and return its game-view panel builder. */
async function mountBoard({ tendencies, games, ratings }) {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const win = {};
  if (tendencies !== undefined) win.BetHouseTendencies = tendencies;
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src("football-board.js"))(win, doc);

  win.BetHouseFootballBoard.mount({
    model: nfl,
    data: {
      season: 2026, week: 2, statsSeasons: [2025, 2026], generated: "2026-09-21T00:00", gamesCached: 2,
      games, ratings, teamFactors: {}, players: [], pools: {}, usagePool: [],
    },
    record: null,
    league: "NFL",
    fetcher: "fetch-nfl.mjs",
    copy: {
      noteTD: "n", noteStat: Object.fromEntries(Object.keys(nfl.STATS).map((k) => [k, "n"])),
      noteGames: "n", gameBanner: "<p>n</p>", mlVerdict: "n", gameHonestly: "n", footer: "<p>n</p>",
    },
  });

  // The game view is a segment button; click it the way a user would.
  const seg = doc.getElementById("view");
  const button = seg.children.find((b) => b.textContent === "Spread & total");
  assert.ok(button, "the board no longer offers a Spread & total view");
  button.handlers.click[0]();

  const app = doc.getElementById("app");
  assert.ok(app.__rows && app.__rows.length, "the game view rendered no rows");
  return { app, panelFor: (i) => app.__detail(app.__rows[i]) };
}

/* Two teams in the tendencies file, two that are not. Every field the
   panel reads is here; the values are invented and the shape is the one
   tendencies.mjs writes. */
const PROFILE = {
  plays: 140, games: 2, playsPerGame: 70, passRate: 0.64, rushRate: 0.36, proe: 3.75,
  deepRate: 0.12, shortRate: 0.88, insideRunShare: 0.81, outsideRunShare: 0.19,
  epaPerPlay: 0.08, epaPerPass: 0.1, epaPerRush: 0.04,
  deepEpa: 0.31, shortEpa: 0.15, insideRunEpa: -0.03, outsideRunEpa: 0.34,
  playActionRate: 0.17, motionRate: 0.5, blitzRate: 0.27, paEpa: -0.07, blitzEpa: 0.0,
};
const tweak = (over) => Object.assign({}, PROFILE, over);
const TENDENCIES = {
  generated: "2026-09-21T00:00:00.000Z", seasons: [2025, 2026], K: 6,
  through: { season: 2026, week: 2 },
  current: {
    off: { KC: tweak({ deepRate: 0.19 }), LAC: tweak({ deepRate: 0.05 }) },
    def: { KC: tweak({ deepEpa: 0.9 }), LAC: tweak({ deepEpa: -0.4, insideRunEpa: 0.2 }) },
    league: tweak({}),
  },
};
const GAMES = [
  { id: "g1", home: "LAC", away: "KC", date: "2030-01-01T00:00Z", completed: false },
  { id: "g2", home: "BBB", away: "AAA", date: "2030-01-02T00:00Z", completed: false },
];
const RATINGS = { off: { KC: 2, LAC: 1, AAA: 0, BBB: 0 }, def: { KC: -1, LAC: 0, AAA: 0, BBB: 0 } };

test("the matchup section renders for a game whose teams are in the tendencies file", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: TENDENCIES, games: GAMES, ratings: RATINGS });
  const i = app.__rows.findIndex((r) => r.g.id === "g1");
  const html = panelFor(i);
  assert.match(html, /class="mu"/, "no matchup section on a game both of whose teams are profiled");
  // Both directions, not just the home one.
  assert.match(html, /KC offence vs LAC defence/);
  assert.match(html, /LAC offence vs KC defence/);
  // Every family the panel promises.
  for (const f of ["deep pass", "short pass", "inside run", "outside run", "play action", "vs blitz"]) {
    assert.ok(html.includes(f), `the matchup table has no "${f}" row`);
  }
  // The tags, on the fixture built to trigger them.
  assert.match(html, /class="tag soft"/, "a defence 0.39 EPA worse than league is not tagged soft");
  assert.match(html, /class="tag tough"/, "a defence 0.71 EPA better than league is not tagged stout");
  assert.match(html, /leans in|avoids/, "an offence 7 points off the league share is not tagged");
  // The caveat that keeps this descriptive.
  assert.match(html, /nothing here is in a price yet/i);
  assert.match(html, /week 2/, "the footer does not say which week the play-by-play runs through");
});

test("a game whose teams are not in the tendencies file shows no matchup section", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: TENDENCIES, games: GAMES, ratings: RATINGS });
  const i = app.__rows.findIndex((r) => r.g.id === "g2");
  const html = panelFor(i);
  assert.doesNotMatch(html, /class="mu"/, "a game of two unprofiled teams still rendered a matchup section");
  assert.ok(html.includes("projection"), "the rest of the panel disappeared with it");
});

test("a board with no tendencies file loaded renders every game without one", async () => {
  const { app, panelFor } = await mountBoard({ tendencies: undefined, games: GAMES, ratings: RATINGS });
  for (let i = 0; i < app.__rows.length; i++) {
    assert.doesNotMatch(
      panelFor(i), /class="mu"/,
      "the matchup section rendered with no tendencies file loaded — cfb.html loads none",
    );
  }
});

test("the page and tendencies.mjs agree on the thresholds and the families", async () => {
  /* tendencies.mjs is an ES module and the board is a plain script, so the
     two tag thresholds and the family table are re-typed there rather than
     imported. That is the duplication tasks/lessons.md warns about, so it
     gets checked instead of trusted. */
  const t = await import("./tendencies.mjs");
  const js = src("football-board.js");

  const lean = js.match(/LEAN_SHARE\s*=\s*([\d.]+)/);
  const soft = js.match(/SOFT_EPA\s*=\s*([\d.]+)/);
  assert.ok(lean && soft, "football-board.js no longer names the two thresholds");
  assert.equal(Number(lean[1]), t.LEAN_SHARE, "the board's lean threshold has drifted from tendencies.mjs");
  assert.equal(Number(soft[1]), t.SOFT_EPA, "the board's soft/stout threshold has drifted from tendencies.mjs");

  /* The family table: same families, same metric keys, same order of
     definition. Read off the module's source because FAMILIES is private. */
  const modFams = [...src("tendencies.mjs").matchAll(/\{\s*family:\s*"([^"]+)",\s*share:\s*"(\w+)",\s*epa:\s*"(\w+)"/g)];
  assert.ok(modFams.length >= 6, "tendencies.mjs no longer declares a FAMILIES table in the expected shape");
  const boardFams = [...js.matchAll(/\{family:'([^']+)',\s*share:'(\w+)',\s*epa:'(\w+)'/g)];
  assert.deepEqual(
    boardFams.map((m) => [m[1], m[2], m[3]]),
    modFams.map((m) => [m[1], m[2], m[3]]),
    "football-board.js and tendencies.mjs disagree about the play families or their metric keys",
  );
  for (const [, , share, epa] of boardFams) {
    assert.ok(t.METRICS.includes(share), `${share} is not a metric tendencies.mjs computes`);
    assert.ok(t.METRICS.includes(epa), `${epa} is not a metric tendencies.mjs computes`);
  }
});

test("the matchup table fits a 390px phone without widening the page", () => {
  const css = src(SHEET);
  const rule = css.match(/\.mfam\{[^}]*\}/);
  assert.ok(rule, `${SHEET} has no .mfam rule — the matchup table is unstyled`);
  const cols = rule[0].match(/grid-template-columns\s*:\s*([^;}]+)/);
  assert.ok(cols, `${SHEET}: .mfam declares no columns`);
  assert.match(cols[1], /^\s*1fr\b/, ".mfam's first column is not flexible, so long family names widen the page");
  const fixed = [...cols[1].matchAll(/(\d+)px/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.ok(
    fixed <= 220,
    `.mfam reserves ${fixed}px of fixed columns; a 390px phone leaves about 338px inside the panel, ` +
      `so anything over ~220 squeezes the family name to nothing`,
  );
});

test("the tendencies file is loaded by the board that has play-by-play, and only that one", () => {
  assert.match(src("nfl.html"), /<script src="tendencies-data\.js"><\/script>/, "nfl.html does not load tendencies-data.js");
  assert.doesNotMatch(src("cfb.html"), /tendencies-data/, "cfb.html loads a play-by-play file college has none of");
});
