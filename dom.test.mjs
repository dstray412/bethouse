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
const BOARDS = ["index.html", "baseball.html", "golf.html", "nfl.html", "cfb.html", "bets.html", "live.html", "record.html", "teams.html"];
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
  const js = src("baseball.html");
  assert.ok(
    js.includes("S.parlayEligible("),
    "baseball.html must ask score.js which views may build a parlay, not re-derive it",
  );

  const guards = guardedRanges(js, "if(S.parlayEligible(state.view)){");
  assert.ok(guards.length, "no `if(S.parlayEligible(state.view)){` block found in baseball.html");

  /* There is one row renderer for today and one for a replayed day, and both
     build a + button. Counting call sites would have to be edited every time
     a renderer is added; what actually matters is that NONE of them sits
     outside a guard. */
  const sites = [];
  for (let i = js.indexOf("'addleg'"); i >= 0; i = js.indexOf("'addleg'", i + 1)) sites.push(i);
  assert.ok(sites.length, "baseball.html no longer builds an addleg button");

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
  for (const cell of [".be", ".prob", ".px"]) {
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
  const js = src("baseball.html");
  assert.ok(
    js.includes("E.oddsFreshness("),
    "baseball.html must get odds age from edge.js, not re-derive it",
  );
  const inlined = js.match(/Date\.parse\([^)]*generated[^)]*\)/g) || [];
  assert.deepEqual(
    inlined,
    [],
    "baseball.html re-derives the feed's age inline; that is the duplication oddsFreshness replaced",
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

  const js = src("baseball.html");
  const at = js.indexOf("function normName(s){");
  assert.ok(at > 0, "baseball.html no longer defines normName");
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
      `"${n}" normalises differently in baseball.html than in fetch-odds-espn.mjs — ` +
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
  // The pair used to live in the football pages' own <style>; it is shared now.
  const css = src(SHEET);
  assert.match(css, /\.seg\{[^}]*overflow-x:\s*auto/, "board.css: .seg does not scroll inside itself");
  assert.match(css, /\.ctl\{[^}]*min-width:\s*0/, "board.css: .ctl can widen the page (no min-width:0)");
  for (const page of ["nfl.html", "cfb.html"]) {
    assert.doesNotMatch(src(page), /<style>/, `${page} carries its own <style> again`);
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
    tag, children: [], handlers: {}, attrs: {}, _html: "",
    /* seg() empties a host with innerHTML = "" before rebuilding its
       buttons; the stub drops the old children too, so a test that reads
       children[0] after a re-render sees the live button, not a stale one. */
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    textContent: "", value: "", className: "", hidden: false,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() { this.focused = true; },
  };
}

/* The two football pages ship some elements `hidden` (the controls row,
   the parlay strip, the drawer); an element the stub mints takes that
   from nfl.html's markup, so a script that forgets to show one fails
   here the way it would in a browser (the controls row did, B0 review). */
const SHIPPED_HIDDEN = new Set([...markup("nfl.html").matchAll(/<[^>]*\sid="([^"]+)"[^>]*\shidden[\s>]/g)].map((m) => m[1]));
function stubDoc() {
  const byId = new Map();
  return {
    getElementById(id) {
      if (!byId.has(id)) { const e = stubEl(id); e.hidden = SHIPPED_HIDDEN.has(id); byId.set(id, e); }
      return byId.get(id);
    },
    createElement(tag) { return stubEl(tag); },
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    activeElement: { tagName: "BODY" },
  };
}

/** Mount the real board against the stub and return its game-view panel builder. */
async function mountBoard({ tendencies, games, ratings }) {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const win = { BetHouseTendencyCore: (await import("./tendencies-core.js")).default };
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
  { id: "g1", home: "LAC", away: "KC", date: "2030-01-01T00:00Z", completed: false, venue: "SoFi Stadium" },
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

test("the board re-types none of tendencies.mjs: the thresholds, the families and the ranks come from tendencies-core.js, which the page loads", async () => {
  /* The two tag thresholds and the family table used to be copied into
     the board because tendencies.mjs is an ES module, with a test for
     drift. The copy is gone: tendencies-core.js is the one copy, loaded by
     nfl.html, imported by tendencies.mjs, and read by the board. */
  const t = await import("./tendencies.mjs");
  const core = (await import("./tendencies-core.js")).default;
  assert.equal(t.LEAN_SHARE, core.LEAN_SHARE); assert.equal(t.SOFT_EPA, core.SOFT_EPA);
  assert.equal(t.matchup, core.matchup, "tendencies.mjs does not re-export the core's matchup");
  assert.equal(t.rank, core.rank);
  const js = src("football-board.js");
  assert.doesNotMatch(js, /LEAN_SHARE\s*=\s*[\d.]|SOFT_EPA\s*=\s*[\d.]|\{family:'/, "football-board.js re-types a threshold or the family table");
  assert.doesNotMatch(js, /TODO\(simplify\): tendencies/, "the TODO this retires is still there");
  assert.match(js, /BetHouseTendencyCore/, "the board does not read the core");
  assert.match(js, /TCORE\.matchup\(off,def,lg\)/, "the matchup rows are not the core's");
  assert.match(js, /TCORE\.rank\(/, "the ranks are not the core's");
  assert.match(src("nfl.html"), /<script src="tendencies-data\.js"><\/script>\s*<script src="tendencies-core\.js"><\/script>/, "nfl.html does not load the core after the data");
  for (const f of core.FAMILIES) { assert.ok(t.METRICS.includes(f.share), f.share + " is not a metric"); assert.ok(t.METRICS.includes(f.epa), f.epa + " is not a metric"); }
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

/* ------------------------------------------------------------------ *
 * A typed price, filters and sorts on the football boards (2026-09-29)
 *
 * The rows take the price the book offers and show the edge at once,
 * remembered in the browser. The arithmetic is edge.js's, the key is
 * watchlist.js's, and the rows are narrowed by team and position and
 * re-ordered by projection, edge or boost. Source contracts first, then
 * the real script mounted against the stub.
 * ------------------------------------------------------------------ */

test("both football boards load watchlist.js before the board script", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    const w = html.indexOf('src="watchlist.js"'), b = html.indexOf('src="football-board.js"');
    assert.ok(w >= 0, `${page} does not load watchlist.js`);
    assert.ok(w < b, `${page} loads watchlist.js after the board`);
  }
});

test("the board keys a typed price through watchlist.js and prices it through edge.js, never by hand", () => {
  const js = src("football-board.js");
  assert.match(js, /W\.priceKey\(/, "no W.priceKey( call: the key would be built by hand");
  // The price map is only ever indexed by a key variable, never by a string the board glued together.
  assert.doesNotMatch(js, /state\.prices\[['"]|state\.prices\[[^\]]*\+/, "a hand-built price key");
  const priced = js.match(/function priceEdge[\s\S]*?\n    }/);
  assert.ok(priced, "no priceEdge helper");
  assert.match(priced[0], /E\.evPct\(/, "the edge is not edge.js's");
});

/* Enough players for every filter and sort to have something to do. */
const PLAYERS = [
  { id: "a", name: "Alpha Wide", team: "KC", pos: "WR", games: 10, tds: 8, carries: 0, targets: 80, recYds: 900, rushYds: 0, recs: 60, passAtt: 0, passYds: 0, opp: "LAC",
    recent: [["260928", "DEN", 110, 8, 0, 0, 1], ["260921", "NYG", 40, 3, 0, 0, 0], ["250914", "LV", 75, 6, 0, 0, 2]] },
  { id: "b", name: "Bravo Back", team: "LAC", pos: "RB", games: 10, tds: 2, carries: 150, targets: 20, recYds: 100, rushYds: 700, recs: 15, passAtt: 0, passYds: 0, opp: "KC" },
  { id: "c", name: "Charlie End", team: "KC", pos: "TE", games: 10, tds: 0, carries: 0, targets: 60, recYds: 500, rushYds: 0, recs: 45, passAtt: 0, passYds: 0, opp: "LAC" },
  // On a bye this week: no game, no opponent, still on the board.
  { id: "d", name: "Delta Bye", team: "ZZZ", pos: "RB", games: 10, tds: 3, carries: 120, targets: 10, recYds: 60, rushYds: 500, recs: 8, passAtt: 0, passYds: 0, opp: null },
  // A defensive listing with a trick-play record: not a position the board files under.
  { id: "e", name: "Echo Safety", team: "LAC", pos: "S", games: 10, tds: 1, carries: 12, targets: 0, recYds: 0, rushYds: 40, recs: 0, passAtt: 0, passYds: 0, opp: "KC" },
  // In the other game, so a slip from stars can carry two legs.
  { id: "f", name: "Foxtrot Back", team: "AAA", pos: "RB", games: 10, tds: 4, carries: 140, targets: 20, recYds: 120, rushYds: 600, recs: 15, passAtt: 0, passYds: 0, opp: "BBB" },
];

/** Mount the real board on the TD view with players, edge.js and watchlist.js present. */
async function mountPlayers({ players, storage, storageThrows, noWatchlist, search, pools, games, record, teamFactors, noChips, model }) {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const store = new Map(Object.entries(storage || {}));
  const win = { BetHouseEdge: (await import("./edge.js")).default, BetHouseParlay: (await import("./parlay.js")).default, BetHouseFaces: (await import("./faces.js")).default, pushed: [], listeners: {} };
  win.location = { search: search || "", pathname: "/nfl.html" };
  win.history = { pushState(_s, _t, url) { win.pushed.push(url); }, replaceState(_s, _t, url) { win.pushed.push(url); } };
  win.addEventListener = (type, fn) => { (win.listeners[type] = win.listeners[type] || []).push(fn); };
  if (!noWatchlist) win.BetHouseWatchlist = (await import("./watchlist.js")).default;
  if (!noChips) win.BetHouseChips = (await import("./chips.js")).default;
  if (storageThrows) Object.defineProperty(win, "localStorage", { get() { throw new Error("SecurityError: storage is disabled"); } });
  else win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src("football-board.js"))(win, doc);
  win.BetHouseFootballBoard.mount({
    model: nfl,
    data: {
      season: 2026, week: 2, statsSeasons: [2025, 2026], generated: "2026-09-21T00:00", gamesCached: 2,
      games: games || GAMES, ratings: RATINGS, teamFactors: teamFactors || {}, players, pools: pools || {}, usagePool: [],
      ...(model ? { model } : {}),
    },
    record: record || null, league: "NFL", fetcher: "fetch-nfl.mjs",
    copy: {
      noteTD: "n", noteStat: Object.fromEntries(Object.keys(nfl.STATS).map((k) => [k, "n"])),
      noteGames: "n", gameBanner: "<p>n</p>", mlVerdict: "n", gameHonestly: "n", footer: "<p>n</p>",
    },
  });
  const app = doc.getElementById("app");
  assert.ok(app.__rows && app.__rows.length, "the touchdown view rendered no rows");
  const press = (id, label) => {
    const b = doc.getElementById(id).children.find((x) => x.textContent === label);
    assert.ok(b, `no "${label}" button in #${id}`);
    b.handlers.click[0]();
  };
  return { app, doc, win, store, press };
}

test("team and position filters narrow the rows, a bye team is still a team, roster noise is not a position", async () => {
  const { app, doc, press } = await mountPlayers({ players: PLAYERS });
  assert.equal(app.__rows.length, 6);
  press("posseg", "WR");
  assert.deepEqual(app.__rows.map((r) => r.p.id), ["a"]);
  press("posseg", "All");
  // The stub's innerHTML setter keeps old children, so read the distinct labels.
  const labels = [...new Set(doc.getElementById("posseg").children.map((b) => b.textContent))];
  assert.deepEqual(labels, ["All", "QB", "RB", "WR", "TE"].filter((l) => l === "All" || PLAYERS.some((p) => p.pos === l)), "only the positions the board files under, in depth-chart order");
  assert.ok(!labels.includes("S"), "a safety with a trick-play record is not a filter button");
  const sel = doc.getElementById("teamsel");
  const teams = sel.children.map((o) => o.value);
  assert.ok(teams.includes("ZZZ"), "a team on a bye is still on the board, so it is still a choice");
  sel.value = "KC"; sel.onchange();
  assert.deepEqual(app.__rows.map((r) => r.p.id).sort(), ["a", "c"]);
  sel.value = ""; sel.onchange();
  assert.equal(app.__rows.length, 6);
});

test("a browser that refuses storage still gets a board, and a page without watchlist.js gets rows with no price cell", async () => {
  const { app } = await mountPlayers({ players: PLAYERS, storageThrows: true });
  assert.equal(app.__rows.length, 6, "the board did not render");
  const bare = await mountPlayers({ players: PLAYERS, noWatchlist: true });
  assert.ok(!bare.app.innerHTML.includes('class="px"'), "a price cell with nothing behind it");
  assert.ok(!bare.app.__detail(bare.app.__rows[0]).includes("pxin"), "a price input with nothing behind it");
});

test("with Sort by edge on, a price committed in the panel re-orders the rows; a keystroke does not", async () => {
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS });
  const W = win.BetHouseWatchlist;
  press("sortseg", "Edge");
  const i = app.__rows.length - 1, last = app.__rows[i];
  const key = W.priceKey({ league: "NFL", slate: "2026-2", playerId: last.p.id, prop: "td" });
  const input = stubEl("input"); input.setAttribute("data-pk", key); input.setAttribute("data-i", String(i)); input.value = "+400";
  app.handlers.input[0]({ target: input });
  assert.equal(app.__rows[i].p.id, last.p.id, "typing must not re-order under the cursor");
  app.handlers.change[0]({ target: input });
  assert.equal(app.__rows[0].p.id, last.p.id, "committing the price put the priced row first");
});

test("sort by boost orders rows by projection over his own rate, with no rate last; sort by edge puts priced rows first", async () => {
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS, storage: { [ (await import("./watchlist.js")).default.PRICE_KEY ]: JSON.stringify({ "NFL|2026-2|c|td": "+400", "NFL|2026-1|a|td": "-500" }) } });
  press("sortseg", "Boost");
  const ratio = (r) => r.s.observedRate > 0 ? r.s.lambda / r.s.observedRate : -Infinity;
  const got = app.__rows.map(ratio);
  for (let i = 1; i < got.length; i++) assert.ok(got[i - 1] >= got[i], `boost not descending at ${i}: ${got}`);
  assert.equal(app.__rows[app.__rows.length - 1].p.id, "c", "no touchdowns yet: no baseline, so last");
  press("sortseg", "Edge");
  assert.equal(app.__rows[0].p.id, "c", "the one priced row comes first");
  assert.ok(!app.__rows.find((r) => r.p.id === "a").pe, "last week's price is not this week's edge");
  const E = win.BetHouseEdge;
  const ev = E.evPct(app.__rows[0].s.prob, E.americanToDecimal(400));
  assert.ok(app.innerHTML.includes(E.formatPct(ev)), "the row does not show the edge at the stored price");
});

test("typing a price in the panel prices the row at once, through edge.js, and is remembered", async () => {
  const { app, doc, win, store } = await mountPlayers({ players: PLAYERS });
  const W = win.BetHouseWatchlist, E = win.BetHouseEdge;
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const panel = app.__over(app.__rows[i]);
  const key = W.priceKey({ league: "NFL", slate: "2026-2", playerId: "a", prop: "td" });
  assert.ok(panel.includes(`data-pk="${key}"`), "the overview has no price input for this row");
  const input = stubEl("input"); input.setAttribute("data-pk", key); input.setAttribute("data-i", String(i)); input.value = "-120";
  app.handlers.input[0]({ target: input });
  const ev = E.evPct(app.__rows[i].s.prob, E.americanToDecimal(-120));
  assert.ok(doc.getElementById("px" + i).innerHTML.includes(E.formatPct(ev)), "the row cell did not update");
  assert.deepEqual(W.parsePrices(store.get(W.PRICE_KEY)), { [key]: -120 }, "the price was not remembered");
  input.value = "";
  app.handlers.input[0]({ target: input });
  assert.deepEqual(W.parsePrices(store.get(W.PRICE_KEY)), {}, "clearing the box forgets the price");
  assert.ok(!doc.getElementById("px" + i).innerHTML.includes("edge"), "a cleared price still shows an edge");
});

test("one edge colour rule: the slip and the row share edgeClass", () => {
  const js = src("football-board.js");
  assert.equal((js.match(/ev>0\.02\?/g) || []).length, 1, "the good/warn/bad threshold appears more than once");
});

/* ------------------------------------------------------------------ *
 * The player drawer (phase 2, 2026-09-29)
 *
 * A row opens a drawer instead of an inline panel: the player's id goes
 * in the URL so a row is a link, Escape and the back button close it,
 * and its tabs are the overview, the ladder as threshold buttons, and
 * the recent games the fetcher wrote. Page and stylesheet contracts
 * first, then the real script against the stub window.
 * ------------------------------------------------------------------ */

test("both football boards carry the drawer and its scrim, and the stylesheet fixes them to the viewport", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    assert.match(html, /<div[^>]*id="drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/, `${page}: no dialog drawer`);
    assert.match(html, /id="scrim"[^>]*hidden/, `${page}: no scrim`);
    assert.match(html, /id="dclose"/, `${page}: no close button`);
  }
  const css = src(SHEET);
  assert.match(css, /\.drawer\{[^}]*position:fixed/, "the drawer is not fixed to the viewport");
  assert.match(css, /\.scrim\{[^}]*position:fixed/, "the scrim is not fixed to the viewport");
  assert.match(css, /@media \(max-width:760px\)\{[^@]*\.drawer\{[^}]*(bottom:0|max-height)/, "no phone sheet rule for the drawer");
});

test("the board feature-detects the history API before touching it, and names its recent-games model calls", () => {
  const js = src("football-board.js");
  assert.match(js, /typeof window\.history/, "history is used without a feature check");
  assert.match(js, /N\.recentValues\(/); assert.match(js, /N\.recentHits\(/);
  assert.doesNotMatch(js, /id="why/, "the inline panel is still rendered");
});

const clickRow = (app, i) => {
  const btn = stubEl("button"); btn.setAttribute("data-i", String(i)); btn.setAttribute("aria-expanded", "false");
  app.handlers.click[0]({ target: { closest: (sel) => (sel === ".row" ? btn : null) } });
  return btn;
};

test("a row opens the drawer with the player in the URL; Escape and the back button close it and give focus back", async () => {
  const { app, doc, win, press } = await mountPlayers({ players: PLAYERS });
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const btn = clickRow(app, i);
  const drawer = doc.getElementById("drawer");
  assert.equal(drawer.hidden, false, "the drawer did not open");
  assert.equal(doc.getElementById("scrim").hidden, false);
  assert.ok(doc.getElementById("dbody").innerHTML.includes('class="dact"'), "the overview does not lead with the price row");
  press("dtabs", "The arithmetic");
  assert.ok(doc.getElementById("dbody").innerHTML.includes("carries"), "the arithmetic tab is not the reasoning cells");
  press("dtabs", "Overview");
  assert.ok(doc.getElementById("dtitle").textContent.includes("Alpha Wide"));
  assert.deepEqual(win.pushed.slice(-1), ["?player=a&prop=td"], "the URL does not name the player");
  const closeBtn = doc.getElementById("dclose");
  assert.ok(closeBtn.focused, "focus did not move to the close button");
  // Escape closes, the URL goes back to the bare board, focus returns to the row.
  const keys = doc.listeners.keydown; assert.ok(keys && keys.length, "no document keydown handler");
  keys[keys.length - 1]({ key: "Escape", preventDefault() {} });
  assert.equal(drawer.hidden, true);
  assert.equal(win.pushed.slice(-1)[0], "/nfl.html");
  assert.ok(btn.focused, "focus did not return to the row");
  // Open again, then the back button: a popstate to the bare path closes it without pushing.
  clickRow(app, i);
  const n = win.pushed.length;
  win.location.search = "";
  win.listeners.popstate[0]({});
  assert.equal(drawer.hidden, true);
  assert.equal(win.pushed.length, n, "a popstate must not push");
});

test("a deep link opens the drawer on that player, even one beyond the twenty-row cut", async () => {
  const many = [];
  for (let k = 0; k < 30; k++) many.push({ ...PLAYERS[0], id: "p" + k, name: "Player " + k, tds: 8 - (k % 7), recent: undefined });
  // p27 has the fewest touchdowns of the thirty, so he ranks under the cut.
  const { app, doc } = await mountPlayers({ players: many, search: "?player=p27&prop=td" });
  assert.equal(doc.getElementById("drawer").hidden, false, "the deep link did not open the drawer");
  assert.ok(doc.getElementById("dtitle").textContent.includes("Player 27"));
  assert.ok(app.__rows.length > 20, "the cut was not lifted to reach the player");
});

test("the recent-games tab draws one bar per row and the hit rate at the threshold, and nothing for a player with none", async () => {
  const { app, doc, press } = await mountPlayers({ players: PLAYERS });
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "a"));
  press("dtabs", "Recent games");
  const body = doc.getElementById("dbody").innerHTML;
  assert.equal((body.match(/<rect class="bar/g) || []).length, 3, "one bar per recent row");
  assert.match(body, /scored in <b>2<\/b> of the last <b>3<\/b>/, "touchdowns: how many of the last games he scored in");
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "b"));
  press("dtabs", "Recent games");
  assert.doesNotMatch(doc.getElementById("dbody").innerHTML, /<rect class="bar/, "a player with no rows has no chart");
  assert.match(doc.getElementById("dbody").innerHTML, /no game log/i);
});

/* A levelled receiving-yards pool: 400 games around a 60-yard projection. */
function recPool(nfl) {
  const exp = [], ratio = [];
  for (let k = 0; k < 400; k++) { exp.push(40 + (k % 40)); ratio.push(0.2 + ((k * 37) % 100) / 60); }
  return { recyds: nfl.sortedPool(exp, ratio, "recyds") };
}

test("the ladder tab is the model's rungs as buttons: the near rung pressed first, a press moves the headline and the recent-games threshold", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  press("view", "Receiving yards");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  assert.ok(i >= 0, "no receiving row for a");
  clickRow(app, i);
  press("dtabs", "Alternate lines");
  let body = doc.getElementById("dbody").innerHTML;
  assert.match(body, /class="rungs"/);
  const rungs = nfl.ladder("recyds", app.__rows[i].exp, recPool(nfl).recyds);
  assert.equal((body.match(/<button class="rung/g) || []).length, rungs.length, "one button per rung");
  assert.match(body, /aria-pressed="true"/, "no rung pressed");
  const far = rungs[rungs.length - 1];
  const drawer = doc.getElementById("drawer");
  drawer.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-rung]" ? { getAttribute: () => String(far.at) } : null) } });
  body = doc.getElementById("dbody").innerHTML;
  assert.ok(body.includes("<b>" + far.at + "+</b>"), "the headline did not move to the pressed rung");
  press("dtabs", "Recent games");
  body = doc.getElementById("dbody").innerHTML;
  const hits = nfl.recentHits("recyds", PLAYERS[0].recent, far.at);
  assert.match(body, new RegExp("reached <b>" + far.at + "\\+</b> in <b>" + hits + "</b> of the last <b>3</b>"), "the recent tab does not use the pressed rung");
});

test("the back button never pushes: a popstate to another player's URL switches the view and opens him without a new entry", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, win } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  // The back on the touchdown view, then Back lands on the wide receiver's receiving-yards link:
  // the view switches, the back is not on it, and nothing may be pushed while doing so.
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "b"));
  const n = win.pushed.length;
  win.location.search = "?player=a&prop=recyds";
  win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("dtitle").textContent, "Alpha Wide");
  assert.equal(win.pushed.length, n, "a popstate pushed");
  assert.equal(doc.getElementById("drawer").hidden, false);
});

test("re-clicking the open row does not stack a duplicate URL", async () => {
  const { app, win } = await mountPlayers({ players: PLAYERS });
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  clickRow(app, i); clickRow(app, i);
  assert.deepEqual(win.pushed, ["?player=a&prop=td"]);
});

test("a deep link to a player hidden by a filter clears the filter; one to nobody on the view closes quietly and leaves the cut alone", async () => {
  const { app, doc, win } = await mountPlayers({ players: PLAYERS, storage: {}, search: "?player=a&prop=td" });
  assert.equal(doc.getElementById("drawer").hidden, false);
  // Filter him out, then follow a link to him: the filter goes, he opens.
  const sel = doc.getElementById("teamsel"); sel.value = "LAC"; sel.onchange();
  assert.equal(doc.getElementById("drawer").hidden, true, "the drawer stayed open on a row the filter removed");
  win.location.search = "?player=a&prop=td"; win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("drawer").hidden, false, "the deep link did not clear the filter");
  assert.equal(sel.value, "", "the team filter was not cleared");
  // A link to nobody: closed, quiet, and the twenty-row cut untouched.
  const before = win.pushed.length;
  win.location.search = "?player=nobody&prop=td"; win.listeners.popstate[0]({});
  assert.equal(doc.getElementById("drawer").hidden, true);
  assert.equal(win.pushed.length, before);
  assert.ok(app.__rows.length <= 20);
});

test("the slash shortcut stays out of an open drawer", async () => {
  const { app, doc } = await mountPlayers({ players: PLAYERS });
  clickRow(app, 0);
  const q = doc.getElementById("q"); q.focused = false;
  doc.activeElement = { tagName: "BUTTON" };
  for (const h of doc.listeners.keydown) h({ key: "/", preventDefault() {} });
  assert.ok(!q.focused, "the search box took focus from behind the dialog");
});

test("a page without the drawer markup is told to reload, like a stale model", async () => {
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc(); const missing = new Set(["starseg", "tray"]);
  const real = doc.getElementById.bind(doc);
  doc.getElementById = (id) => (missing.has(id) ? null : real(id));
  const win = {};
  new Function("window", "document", src("football-board.js"))(win, doc);
  win.BetHouseFootballBoard.mount({ model: nfl, data: { season: 2026, week: 2, games: [], ratings: {}, teamFactors: {}, players: [], pools: {} }, record: null, league: "NFL", fetcher: "x", copy: { noteTD: "", noteStat: {}, noteGames: "", footer: "" } });
  assert.match(doc.getElementById("app").innerHTML, /Reload this page/);
});

/* ------------------------------------------------------------------ *
 * Stars and the compare tray (phase 3, 2026-09-29)
 *
 * A star beside a row keeps the player in the browser; "Starred only"
 * narrows the board to them; the slip can be built from them, through
 * the same candidate builder and gates as the slate; the drawer adds a
 * player to a tray that holds up to three side by side.
 * ------------------------------------------------------------------ */

test("both football boards carry the star strip, the compare button and the tray", () => {
  for (const page of ["nfl.html", "cfb.html"]) {
    const html = src(page);
    for (const id of ["starseg", "dcompare", "tray", "tcards", "tclear"]) assert.match(html, new RegExp(`id="${id}"`), `${page}: no #${id}`);
  }
  const css = src(SHEET);
  assert.match(css, /\.tray\{[^}]*position:fixed/, "the tray is not fixed to the viewport");
});

/* A star click, with the button it landed on: the row around it must not open. */
const clickStar = (app, key) => {
  const btn = stubEl("button"); btn.setAttribute("data-star", key);
  app.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-star]" ? btn : sel === ".row" ? stubEl("button") : null) } });
  return btn;
};

test("a star is kept in the browser and lit in place without opening the row; Starred only narrows the board; another tab's stars survive a save", async () => {
  const { app, doc, win, store, press } = await mountPlayers({ players: PLAYERS, storage: { "bethouse.watch.v1": JSON.stringify(["CFB|zz"]) } });
  const W = win.BetHouseWatchlist;
  const ka = W.watchKey({ league: "NFL", playerId: "a" }), kf = W.watchKey({ league: "NFL", playerId: "f" });
  const btn = clickStar(app, ka);
  assert.equal(btn.getAttribute("aria-pressed"), "true", "the star did not light in place");
  assert.equal(doc.getElementById("dtitle").textContent, "", "a star click opened the drawer");
  clickStar(app, kf);
  assert.deepEqual(W.parseWatch(store.get(W.WATCH_KEY)).sort(), ["CFB|zz", ka, kf].sort(), "the stars were not remembered, or the other board's were lost");
  press("starseg", "Starred only");
  assert.deepEqual(app.__rows.map((r) => r.p.id).sort(), ["a", "f"]);
  assert.ok(app.innerHTML.includes('data-star="' + ka + '" aria-pressed="true"'), "a re-render does not light the star");
  press("starseg", "Starred only");
  assert.equal(app.__rows.length, 6, "the toggle did not come back off");
});

test("the slip from stars is the starred players' legs and nothing else, one per game, through the same gates", async () => {
  // A third game, so three stars can fill three legs.
  const games = GAMES.concat([{ id: "g3", home: "DDD", away: "CCC", date: "2030-01-03T00:00Z", completed: false }]);
  const players = PLAYERS.concat([{ id: "g", name: "Golf End", team: "CCC", pos: "TE", games: 10, tds: 5, carries: 0, targets: 70, recYds: 600, rushYds: 0, recs: 50, passAtt: 0, passYds: 0, opp: "DDD" }]);
  const { app, win, press } = await mountPlayers({ players, games });
  const W = win.BetHouseWatchlist, key = (id) => W.watchKey({ league: "NFL", playerId: id });
  clickStar(app, key("a")); clickStar(app, key("f"));
  press("parlayseg", "Suggest a parlay");
  press("pscope", "Starred");
  press("plegs", "3 legs");
  assert.ok(app.innerHTML.includes("Cannot build that slip"), "two stars cannot fill three legs");
  clickStar(app, key("g"));
  press("plegs", "3 legs");
  const why = (app.innerHTML.match(/Cannot build that slip<\/h3><div>([^<]*)/) || [])[1];
  assert.ok(!app.innerHTML.includes("Cannot build that slip"), "three stars in three games did not build: " + why + " | candidates " + JSON.stringify((app.__candidates || []).map((c) => c.playerId + "@" + c.gameId)));
  assert.ok(app.__candidates.length, "no candidates");
  for (const c of app.__candidates) assert.ok(["a", "f", "g"].includes(String(c.playerId)), "a candidate nobody starred: " + c.playerId);
  assert.match(app.innerHTML, /Alpha Wide[\s\S]*Foxtrot Back|Foxtrot Back[\s\S]*Alpha Wide/, "the starred legs are not on the slip");
  // Unstar g and star b, who shares a game with a: one leg per game leaves two games, so three legs refuse.
  clickStar(app, key("g")); clickStar(app, key("b"));
  press("plegs", "3 legs");
  assert.ok(app.innerHTML.includes("Cannot build that slip"), "two games filled three legs");
});

test("the compare tray takes a player from the drawer, holds three at most, drops one on demand, and clears", async () => {
  const { app, doc } = await mountPlayers({ players: PLAYERS });
  const compare = doc.getElementById("dcompare"), tray = doc.getElementById("tray");
  const add = (id) => { clickRow(app, app.__rows.findIndex((r) => r.p.id === id)); compare.handlers.click[0](); };
  add("a");
  assert.equal(tray.hidden, false, "the tray did not appear");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 1);
  add("b"); add("c");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 3);
  add("f");
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 3, "a fourth was taken");
  assert.equal(compare.disabled, true, "the full tray does not disable the button");
  tray.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-untray]" ? { getAttribute: () => "b" } : null) } });
  assert.equal((doc.getElementById("tcards").innerHTML.match(/class="tcard"/g) || []).length, 2);
  assert.ok(!doc.getElementById("tcards").innerHTML.includes("Bravo Back"));
  assert.equal(compare.disabled, false, "the button did not come back once a card was dropped");
  doc.getElementById("tclear").handlers.click[0]();
  assert.equal(tray.hidden, true);
});

/* ------------------------------------------------------------------ *
 * The ledger (the restyle, 2026-09-29)
 *
 * Each football view is a headed table: caps column heads over the
 * thick-thin rule, one head per column the rows carry, and the view's
 * column set named on the .game so head and rows share a grid. The
 * header carries a stat tile of numbers the page has, and none it
 * does not.
 * ------------------------------------------------------------------ */

test("every football view renders one column-head row that names its columns, on a .game that names its column set", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  const heads = (html) => (html.match(/<div class="thead">([\s\S]*?)<\/div>/) || [])[1] || "";
  const labels = (html) => [...heads(html).matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);
  assert.equal((app.innerHTML.match(/class="thead"/g) || []).length, 1, "the touchdown view has no head row, or two");
  /* B1: the rule is that the row's first two columns are the rank and the player and every
     figure column has a head; the exact words are taste, and taste is allowed to move. */
  const headed = (html) => {
    const hs = [...heads(html).matchAll(/<span([^>]*)>([^<]*)<\/span>/g)];
    const cells = (html.match(/<button class="row[^"]*"[^>]*>([\s\S]*?)<\/button>/) || ["", ""])[1];
    const figures = (cells.match(/class="(prob|be|fair|px)[ "]/g) || []).length;
    // A figure head is a right-aligned span (thead's r:1) with words in it; one per figure cell, exactly.
    const figureHeads = hs.filter((m) => /class="r[ "]/.test(m[1]) && m[2].trim()).length;
    return { labels: hs.map((m) => m[2]).filter(Boolean), figures, figureHeads };
  };
  let h = headed(app.innerHTML);
  assert.deepEqual(h.labels.slice(0, 2), ["Rk", "Player"]);
  assert.equal(h.figureHeads, h.figures, "a figure column has no head: " + h.labels.join(" | "));
  assert.match(app.innerHTML, /<div class="game v-td">/);
  press("view", "Receiving yards");
  h = headed(app.innerHTML);
  assert.deepEqual(h.labels.slice(0, 2), ["Rk", "Player"]);
  assert.equal(h.figureHeads, h.figures, "a figure column has no head: " + h.labels.join(" | "));
  assert.match(app.innerHTML, /<div class="game v-stat">/);
  press("view", "Spread & total");
  assert.deepEqual(labels(app.innerHTML).slice(0, 2), ["Rk", "Matchup"]);
  assert.match(app.innerHTML, /<div class="game v-game nopx nostar">|<div class="game v-game nostar">/);
});

test("the stat tile carries the players priced and the build time, and a graded count only when there is a record", async () => {
  const { doc } = await mountPlayers({ players: PLAYERS });
  const tile = doc.getElementById("tile").innerHTML;
  assert.match(tile, /<b>6<\/b><span>players priced<\/span>/);
  assert.match(tile, /<b>00:00<\/b><span>built, UTC<\/span>/);
  assert.doesNotMatch(tile, /graded/, "a graded cell with no record behind it");
});

test("the stylesheet's column sets exist for every football view, and the tile sits flush right", () => {
  const css = src(SHEET);
  for (const v of ["v-td", "v-stat", "v-game"]) assert.match(css, new RegExp(`\\.game\\.${v}\\{--cols:`), `no column set for ${v}`);
  assert.match(css, /\.tile\{[^}]*margin-left:auto/);
  // The head's star track is the star's 40px minus the 10px grid gap, so its 1fr equals the row's.
  assert.match(css, /\.thead\{[^}]*grid-template-columns:var\(--cols\) 30px/);
});

test("the vs-rate pill says what the boost sort computes: up past +10%, down past -10%, steady between, nothing without a rate", async () => {
  const { app } = await mountPlayers({ players: PLAYERS });
  const rowHtml = (id) => { const i = app.__rows.findIndex((r) => r.p.id === id); const m = app.innerHTML.split('data-i="' + i + '"')[1] || ""; return m.split("</button>")[0]; };
  for (const r of app.__rows) {
    const html = rowHtml(r.p.id);
    if (!(r.s.observedRate > 0)) { assert.doesNotMatch(html, /class="pill/, r.p.name + ": a pill with no rate behind it"); continue; }
    const d = Math.round((r.s.lambda / r.s.observedRate - 1) * 100);
    const want = d >= 10 ? "pill up" : d <= -10 ? "pill down" : 'pill">steady';
    assert.ok(html.includes(want), r.p.name + ": " + d + "% should show " + want);
  }
});

/* ------------------------------------------------------------------ *
 * The live page (phase 5, 2026-09-29)
 *
 * A tracked prop is set from the drawer: a rung's "Track" button, or
 * "Track anytime TD" on the touchdown view. The page live.html reads
 * them back and polls the public feeds in the browser; live.js holds
 * the arithmetic and is tested on its own.
 * ------------------------------------------------------------------ */

test("the drawer offers a Track button on the pressed rung and on the touchdown view, keyed the way live.html reads", async () => {
  const nfl = (await import("./nfl.js")).default;
  const { app, doc, press, win } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  const W = win.BetHouseWatchlist;
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "a"));
  let body = doc.getElementById("dbody").innerHTML;
  assert.match(body, /data-track="[^"]*"[^>]*>Track anytime TD</, "no Track button on the touchdown overview");
  press("view", "Receiving yards");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  clickRow(app, i);
  press("dtabs", "Alternate lines");
  body = doc.getElementById("dbody").innerHTML;
  const m = body.match(/data-track="([^"]+)"[^>]*>Track (\d+)\+</);
  assert.ok(m, "no Track button for the pressed rung");
  // Pressing it stores a tracked prop for this player, this prop, that rung, in this game.
  const drawer = doc.getElementById("drawer");
  drawer.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-track]" ? { getAttribute: (k) => (k === "data-track" ? m[1] : null) } : null) } });
  const tracks = W.parseTracks(win.localStorage.getItem(W.TRACK_KEY));
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].playerId, "a"); assert.equal(tracks[0].prop, "recyds"); assert.equal(tracks[0].rung, Number(m[2])); assert.equal(tracks[0].gameId, "g1"); assert.equal(tracks[0].sport, "football");
  assert.match(doc.getElementById("dbody").innerHTML, /Tracking \d+\+ ✓/, "the button does not say it is tracking");
});

test("live.html is a board: shared stylesheet, the scripts it needs, a card list and a status strip", () => {
  const html = src("live.html");
  for (const s of ["watchlist.js", "bets.js", "nfl.js", "live.js", "edge.js"]) assert.match(html, new RegExp(`src="${s}"`), `live.html does not load ${s}`);
  for (const id of ["cards", "lstrip", "tile", "updated"]) assert.match(html, new RegExp(`id="${id}"`), `live.html has no #${id}`);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/[^"]*\.(js|css)"/, "an off-origin script or sheet");
});

/* ------------------------------------------------------------------ *
 * index.html is the home: tonight's slate, built from the boards' data
 *
 * The root URL used to open the baseball board. It opens a home now:
 * the slate across the boards, one card per game with the two teams'
 * logos, and a row of top picks. The logos are the one image the site
 * ships and they come from ESPN's logo CDN, so this test pins that
 * every <img> points there and nothing else loads off-origin.
 * ------------------------------------------------------------------ */

test("index.html is the home: the shared models and every board's data, the slate's ids, logos only from ESPN's CDN", () => {
  const html = src("index.html");
  for (const s of ["edge.js", "nfl.js", "cfb.js", "watchlist.js", "home.js", "mlb-data.js", "pga-data.js", "nfl-data.js", "cfb-data.js", "teams-data.js", "teams.js"]) {
    assert.match(html, new RegExp('<script src="' + s.replace(".", "\\.") + '"'), "index.html loads " + s);
  }
  for (const id of ["tile", "hero", "slate", "gcards", "tops"]) assert.match(html, new RegExp('id="' + id + '"'), "index.html has #" + id);
  assert.doesNotMatch(html, /fonts\.googleapis|https?:\/\/[^"]*\.(js|css)"/, "an off-origin script or sheet");
  // The img markup is built in the script; its src is whatever home.js's logoUrl returns (pinned to
  // ESPN's CDN in home.test.mjs), escaped, with no referrer and hidden when it does not load.
  // The logo img is faces.js's markup (pinned in faces.test.mjs) around home.js's url (pinned in home.test.mjs).
  assert.doesNotMatch(html, /<img/, "the home hand-rolls an <img> instead of asking faces.js");
  assert.match(html, /F\.img\(u,'tlogo',44\)/, "the logo is not built by faces.js");
  assert.match(html, /H\.logoUrl\(/, "the src comes from home.js");
  // The boards' verdict travels with the numbers: the replay found the favourite and the lines do not beat the market.
  assert.match(html, /id="caveat"[^>]*>[^<]*replay found neither beats the market/, "the home shows the football numbers without the boards' warning");
  assert.match(html, /window\.BetHouseCFB\|\|null/, "a missing college model must not fall back to the NFL's");
});

test("the baseball board kept its page under its new name, and every board calls the home Home", () => {
  const b = src("baseball.html");
  assert.match(b, /<title>BetHouse — Baseball<\/title>/);
  assert.match(b, /BETHOUSE_MLB|mlb-data\.js/);
  for (const page of BOARDS) {
    if (page === "index.html") continue;
    assert.match(src(page), /class="navlink" href="index\.html">Home →</, page + " links Home");
  }
});

/* ------------------------------------------------------------------ *
 * Every image on the site follows one rule, and every page can draw one
 *
 * Headshots and team marks come from the leagues' own image services
 * through faces.js. Wherever a page writes an <img>, in markup or in a
 * script string, it carries no referrer, loads lazily and hides itself
 * when it does not load; and the only image hosts named anywhere are
 * ESPN's and MLB's. Every board loads faces.js so it can ask.
 * ------------------------------------------------------------------ */

test("faces.js is the only file that writes an <img>, its markup carries the house attributes, and only the leagues' image hosts are named", () => {
  const faces = src("faces.js");
  const imgs = faces.match(/<img[^>]*>/g) || [];
  assert.equal(imgs.length, 1, "faces.js builds the img once");
  for (const attr of [/referrerpolicy="no-referrer"/, /onerror="this\.hidden=true"/, /loading="lazy"/, /decoding="async"/, /alt="/, /width="/, /height="/]) {
    assert.match(imgs[0], attr, "the img markup lacks " + attr);
  }
  for (const page of BOARDS.concat(["football-board.js", "home.js", "live.js", "bets.js", "watchlist.js"])) {
    assert.doesNotMatch(src(page), /<img/, page + " hand-rolls an <img> instead of asking faces.js");
    // Any url in the page that names an image host must be one of the two leagues' services.
    for (const url of src(page).match(/https?:\/\/[^"'\s)]+/g) || []) {
      if (!/(headshot|teamlogos|\.(png|jpe?g|gif|webp|svg)(\b|$))/i.test(url)) continue;
      assert.match(url, /^https:\/\/(a\.espncdn\.com|img\.mlbstatic\.com)\//, page + ": an image host that is not a league's: " + url);
    }
  }
  // The record page prints no player and no team, so it has no faces to load.
  for (const page of BOARDS.filter((p) => p !== "record.html")) assert.match(src(page), /<script src="faces\.js"><\/script>/, page + " does not load faces.js");
  const hosts = faces.match(/https:\/\/[a-z0-9.-]+/g) || [];
  assert.deepEqual([...new Set(hosts)].sort(), ["https://a.espncdn.com", "https://img.mlbstatic.com"], "faces.js names a host that is not a league's");
});

test("every football row carries a face cell, the matchup its marks, and the drawer head the large photo for a player and marks for a game", async () => {
  const nfl = (await import("./nfl.js")).default;
  // The fixture's ids are letters (no photo, an empty disc); one player with a real-looking id gets the photo.
  const players = PLAYERS.concat([Object.assign({}, PLAYERS[0], { id: "2577417", name: "Numeric Guy" })]);
  const { app, doc, press } = await mountPlayers({ players, pools: recPool(nfl) });
  const rows = app.innerHTML.match(/<button class="row[^"]*" aria-haspopup="dialog" data-i="\d+">[\s\S]*?<\/button>/g) || [];
  assert.ok(rows.length, "no rows");
  for (const r of rows) {
    assert.match(r, /<span class="slot">\d+<\/span><span class="face">(<img [^>]*>)?<\/span><span class="who">/, "a row without its face cell between the rank and the name: " + r.slice(0, 160));
    assert.match(r, /<span class="mtch"><img class="tmark" [^>]*teamlogos\/nfl\/500\/[a-z0-9]+\.png&amp;w=80&amp;h=80/, "a matchup without the team's mark");
  }
  const numeric = rows.find((r) => r.includes("Numeric Guy"));
  assert.match(numeric, /<span class="face"><img [^>]*headshots\/nfl\/players\/full\/2577417\.png&amp;w=96&amp;h=70[^>]*><\/span>/, "a player with an id has no photo");
  assert.match(rows.find((r) => r.includes("Alpha Wide")), /<span class="face"><\/span>/, "a player without an id should keep an empty disc");
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "2577417"));
  const df = doc.getElementById("dface").innerHTML;
  assert.match(df, /<span class="face"><img [^>]*&amp;w=200&amp;h=145/, "the drawer head has no large photo");
  assert.match(df, /<img class="tmark"/, "the drawer head has no team mark");
  press("view", "Spread & total");
  const game = (app.innerHTML.match(/<button class="row" aria-haspopup="dialog" data-i="0">[\s\S]*?<\/button>/) || [])[0] || "";
  assert.match(game, /<span class="face pair">(<img class="tmark" [^>]*>){2}<\/span>/, "a game row without both marks");
});

test("the stylesheet gives every column set a face track after the rank", () => {
  const css = src(SHEET);
  for (const m of css.matchAll(/\.game(?:\.v-[a-z]+(?:\.nopx)?)?\{--cols:([^;}]+)/g)) {
    // Desktop: rank, face, name. Phone: the rank is hidden (span.slot), the face leads.
    assert.match(m[1], /^(34px 44px 1fr|28px 1fr) /, "a column set without the face track: " + m[0]);
  }
  assert.match(css, /span\.slot,\.thead \.rk\{display:none\}/, "the phone rule that hides the rank with its head cell");
  assert.match(css, /\.face\{[^}]*border-radius:50%/);
  assert.match(css, /\.face img\{[^}]*object-fit:cover/);
  // The phone block overrides the disc's size with equal specificity, so the base rule must come first in the sheet.
  assert.ok(css.indexOf(".face{") < css.indexOf("@media (max-width:760px){"), "the .face base rule sits after the phone block and defeats its override");
  assert.ok(css.indexOf(".dface .face{") < css.indexOf("@media (max-width:760px){"), "the drawer face's base rule sits after the phone block");
  /* Tablets: a block under 960px hides some cells on the football views and gives each view a
     column set with exactly that many fewer tracks, so the grid still names every visible cell
     (the emitter at football-board.js writes the same cells on every view). It must precede the
     phone block so the phone's sets win below it and no fractional width falls in a gap. */
  const tracks = (v) => v.trim().split(/\s+/).length;
  const tab = css.match(/@media \(max-width:959px\)\{([\s\S]*?)\n\}/);
  assert.ok(tab, "no tablet block");
  assert.ok(css.indexOf("@media (max-width:959px){") < css.indexOf("@media (max-width:760px){"), "the tablet block must precede the phone block");
  for (const view of ["v-td", "v-stat"]) {
    // The cells the block hides on this view: every selector of every display:none rule in the block.
    const hidden = [];
    for (const rule of tab[1].matchAll(/([^{}]+)\{display:none\}/g)) {
      for (const sel of rule[1].split(",")) {
        const m = sel.trim().match(new RegExp("^\\.game\\." + view + " \\.row \\.([a-z]+)$"));
        if (m) hidden.push(m[1]);
      }
    }
    assert.ok(hidden.length, view + ": the tablet block hides nothing, so its column set must equal the desktop's");
    for (const variant of ["", ".nopx"]) {
      const re = new RegExp("\\.game\\." + view.replace(".", "\\.") + variant.replace(".", "\\.") + "\\{--cols:([^};]+)");
      const desk = css.slice(0, css.indexOf("@media")).match(re), tb = tab[1].match(re);
      assert.ok(desk && tb, view + variant + ": a desktop and a tablet column set");
      assert.equal(tracks(tb[1]), tracks(desk[1]) - hidden.length, view + variant + ": the tablet set's track count does not match the cells the block leaves visible");
    }
  }
});

/* ------------------------------------------------------------------ *
 * The player card: what the drawer says about a player, and where
 *
 * The drawer's head is a hero (matchup label, name, position and model
 * rank, the large photo), then bands: the headline figure with its fair
 * price; why, at most three sentences naming the terms that moved him;
 * the projection against his own rate; and a receipt (only when a
 * record is mounted) saying this call was recorded before kickoff and
 * linking to the record page. The record's aggregate for the prop is
 * NOT on the card: it is the model's honesty, not his story. The
 * overview is the price row and "how he gets there"; the arithmetic
 * (the labelled cells, "carries" included) is its own tab.
 * ------------------------------------------------------------------ */

test("the drawer's hero names the matchup, the position and the model rank in the whole field, and the bands say what the row says", async () => {
  const nfl = (await import("./nfl.js")).default;
  const record = { total: 900, days: [], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2, brier: 0.15 } } };
  const { app, doc, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl), record });
  const field = app.__rows.length;
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const r = app.__rows[i];
  clickRow(app, i);
  assert.equal(doc.getElementById("dtitle").textContent, "Alpha Wide", "the title is the name and nothing else");
  assert.equal(doc.getElementById("dkick").textContent, "KC vs LAC");
  assert.equal(doc.getElementById("dsub").textContent, "WR · Model rank #" + (i + 1) + " of " + field + " · Anytime TD");
  const bands = doc.getElementById("dbands").innerHTML;
  // The headline is the row's chance and the row's fair price, to the digit.
  const fp = nfl.fairPrice(r.s.prob);
  assert.match(bands, new RegExp('class="dband head"[\\s\\S]*Chance to score[\\s\\S]*<b class="fig">' + (100 * r.s.prob).toFixed(1) + '%</b>[\\s\\S]*fair ' + (fp > 0 ? "\\+" : "[\\u2212-]") + Math.abs(fp)), "the headline band is not the row's chance and fair price");
  // Why: his line first, with the numbers the arithmetic uses, then only the terms that moved him five percent or more.
  // Plain per-game counts beside the plain rate: the decay-weighted workload is labelled in the arithmetic tab.
  assert.match(bands, new RegExp('class="dband why"[\\s\\S]*<ul class="dwhy"><li><b>' + r.s.observedRate.toFixed(2) + '</b> TD a game on <b>' + (r.p.carries / r.p.games).toFixed(1) + '</b> carries and <b>' + (r.p.targets / r.p.games).toFixed(1) + '</b> targets over <b>' + r.p.games + '</b> games</li>'), "the why band does not lead with his plain line");
  assert.ok((bands.match(/<li>/g) || []).length <= 3, "the why band runs past three sentences");
  assert.doesNotMatch(bands, /offence <b>|defence <b>/, "the fixture's factors are 1, so no factor sentence should print");
  // The receipt: this call's own facts and the way to the record; the record's aggregate stays off the card.
  const receipt = (bands.match(/class="dband receipt"[\s\S]*?<\/div><\/div>/) || [""])[0];
  assert.match(receipt, /Recorded before kickoff/, "no receipt band");
  assert.match(receipt, /graded once the game is final/, "the receipt does not say when it is graded");
  assert.match(receipt, /<a href="record\.html#nfl">how this prop has graded →<\/a>/, "the receipt does not link to the record page");
  assert.doesNotMatch(bands, /calls graded|predicted 21\.9|816/, "the record's aggregate is on the card");
  assert.doesNotMatch(bands, /UTC/, "the fixture's build stamp carries no Z, so it must not be labelled UTC");
  // The rate band: the same direction as the row's pill, and the delta to the hundredth with the rounded percent.
  const ratio = r.s.lambda / r.s.observedRate, delta = r.s.lambda - r.s.observedRate, d = Math.round((ratio - 1) * 100);
  const cls = d >= 10 ? "up" : d <= -10 ? "down" : "steady";
  const rowHtml = app.innerHTML.match(new RegExp('data-i="' + i + '">[\\s\\S]*?</button>'))[0];
  assert.equal(cls !== "steady" ? rowHtml.includes('class="pill ' + cls + '"') : rowHtml.includes(">steady<"), true, "the fixture's pill does not match the computed direction");
  assert.match(bands, new RegExp('class="dband rate ' + cls + '"[\\s\\S]*vs his own rate[\\s\\S]*own rate ' + r.s.observedRate.toFixed(3) + ' a game[\\s\\S]*' + (delta >= 0 ? "\\+" : "\\u2212") + Math.abs(delta).toFixed(2) + ' TD \\(' + (d >= 0 ? "\\+" : "\\u2212") + Math.abs(d) + '%\\)'), "the rate band does not say the row's ratio");
  const over = doc.getElementById("dbody").innerHTML;
  assert.match(over, /class="dact"[\s\S]*Track anytime TD/, "the price and Track row is missing from the overview");
  assert.match(over, /Scored in <b>2<\/b> of his last <b>3<\/b> games/, "the overview does not say what his game log says");
  assert.doesNotMatch(over, /class="dcell"/, "the arithmetic is still on the overview");
  press("dtabs", "The arithmetic");
  const body = doc.getElementById("dbody").innerHTML;
  assert.ok((body.match(/class="dcell"/g) || []).length >= 8, "the arithmetic tab is not a grid of cells");
  assert.match(body, /<dl class="dcells">/, "the cells are not a definition list");
  assert.ok(body.includes("carries"), "the workload cell lost the word carries");
  assert.doesNotMatch(body, /<table>/, "the old definition table is still there");
  for (const label of ["Matchup", "Position", "Model rank", "Workload", "His own rate", "Offence", "Opponent", "Expected TDs", "Games"]) {
    assert.match(body, new RegExp('<dt>' + label + '</dt>'), "no cell labelled " + label);
  }
  assert.match(body, new RegExp('<dt>Model rank</dt><dd><b>#' + (i + 1) + ' of ' + field + '</b>'), "the rank cell disagrees with the hero");
  assert.match(body, new RegExp('<dt>Workload</dt><dd><b>' + r.s.perGameCarries.toFixed(1) + ' · ' + r.s.perGameReceiving.toFixed(1) + '</b>'), "the workload cell is not the row's per-game workload");
});

test("the model rank is the rank in the whole field, not on the page: the cut and the filter do not move it", async () => {
  const nfl = (await import("./nfl.js")).default;
  const many = Array.from({ length: 30 }, (_, k) => Object.assign({}, PLAYERS[0], { id: "m" + k, name: "Player " + k, tds: 1 + (k % 7), games: 10 }));
  const { app, doc, press } = await mountPlayers({ players: many, pools: recPool(nfl), search: "" });
  const shown = app.__rows.length;
  assert.ok(shown < 30, "the board did not cut the list");
  clickRow(app, shown - 1);
  const sub = doc.getElementById("dsub").textContent;
  assert.match(sub, /Model rank #\d+ of 30 ·/, "the denominator is the rows on screen, not the field: " + sub);
});

test("without a record the receipt band is absent; a stat view's card leads with the projection; a game row has no photo and no bands", async () => {
  const nfl = (await import("./nfl.js")).default;
  const record = { total: 900, days: [], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2 }, recyds: { label: "Receiving yards, over", n: 457, predicted: 41, actual: 42.9, bias: -1.9 } } };
  const bare = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  clickRow(bare.app, bare.app.__rows.findIndex((r) => r.p.id === "a"));
  assert.doesNotMatch(bare.doc.getElementById("dbands").innerHTML, /receipt/, "a receipt band with no record behind it");
  const { app, doc, press } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl), record });
  press("view", "Receiving yards");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  const r = app.__rows[i];
  clickRow(app, i);
  const bands = doc.getElementById("dbands").innerHTML;
  assert.match(bands, new RegExp('class="dband head"[\\s\\S]*Projected receiving yards[\\s\\S]*<b class="fig">' + Math.round(r.exp) + '</b>[\\s\\S]*over ' + r.line + ' hits ' + Math.round(100 * r.over) + '%'), "the stat card's headline is not the projection with the line and its chance");
  assert.match(bands, /class="dband receipt"[\s\S]*how this prop has graded →/, "the stat card has no receipt");
  assert.doesNotMatch(bands, /457|calls graded/, "the record's aggregate is on the stat card");
  assert.match(bands, new RegExp('class="dband why"[\\s\\S]*<li>Averages <b>' + (nfl.statTotal("recyds", r.p) / r.p.games).toFixed(0) + '</b> yards a game on <b>' + (nfl.statOpportunity("recyds", r.p) / r.p.games).toFixed(1) + '</b> targets over <b>' + r.p.games + '</b> games</li>'), "the stat why band does not lead with his average");
  assert.match(bands, new RegExp('<li>Cleared <b>' + Math.ceil(r.line) + '\\+</b> in <b>' + nfl.recentHits("recyds", r.p.recent, Math.ceil(r.line)) + '</b> of his last <b>3</b> games</li>'), "the stat why band does not count his recent games against the line");
  const avg = nfl.statTotal("recyds", r.p) / r.p.games, delta = r.exp - avg, d = Math.round((r.exp / avg - 1) * 100);
  assert.match(bands, new RegExp('own rate ' + avg.toFixed(0) + ' yards a game[\\s\\S]*' + (delta >= 0 ? "\\+" : "\\u2212") + Math.abs(delta).toFixed(0) + ' yards \\(' + (d >= 0 ? "\\+" : "\\u2212") + Math.abs(d) + '%\\)'), "the stat rate band does not say the row's ratio");
  assert.match(doc.getElementById("dbody").innerHTML, /class="dact"/, "the stat overview does not lead with the price row");
  assert.match(doc.getElementById("dbody").innerHTML, /How he gets there[\s\S]*Cleared <b>\d+\+<\/b> in <b>\d<\/b> of his last <b>3<\/b> games\./, "a stat overview with no chips is an empty tab");
  press("dtabs", "The arithmetic");
  const body = doc.getElementById("dbody").innerHTML;
  for (const label of ["Projection", "Over the line", "Model rank", "Season average", "Opportunities", "Opponent", "Read off", "Games"]) assert.match(body, new RegExp('<dt>' + label + '</dt>'), "no cell labelled " + label);
  assert.match(body, new RegExp('<dt>Opportunities</dt><dd><b>' + (nfl.statOpportunity("recyds", r.p) / r.p.games).toFixed(1) + '</b><span>targets a game over ' + r.p.games + ' games'), "opportunities are not per game");
  assert.doesNotMatch(body, /<p class="verdict">/, "the stat prose verdict is still there");
  press("view", "Spread & total");
  clickRow(app, 0);
  assert.doesNotMatch(doc.getElementById("dface").innerHTML, /class="face"/, "a game row shows a player photo");
  assert.equal(doc.getElementById("dbands").innerHTML, "", "a game row shows player bands");
  assert.match(doc.getElementById("dkick").textContent, /^Week \d+$/);
  assert.match(doc.getElementById("dsub").textContent, /^SoFi Stadium · /, "a game row's subtitle does not name the venue");
});

test("the receipt is only claimed for a game that had not kicked off at the build", async () => {
  const nfl = (await import("./nfl.js")).default;
  const record = { total: 900, days: [], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2 } } };
  const games = GAMES.map((g) => Object.assign({}, g, { date: "2020-01-01T00:00Z" }));
  const { app, doc } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl), record, games });
  clickRow(app, app.__rows.findIndex((r) => r.p.id === "a"));
  assert.doesNotMatch(doc.getElementById("dbands").innerHTML, /receipt/, "a build after kickoff claims it was recorded before");
});

test("the stylesheet lays the card out: a wider panel, the photo as a 150px cutout before the phone block, cells in a grid with a phone rule", () => {
  const css = src(SHEET);
  assert.match(css, /\.drawer\{[^}]*width:min\(640px,100%\)/);
  assert.match(css, /\.dface \.face\{[^}]*width:150px[^}]*border-radius:0/, "the drawer photo is not the 150px cutout");
  assert.match(css, /\.dcells\{[^}]*grid-template-columns:repeat\(3,/, "the cells are not a three-column grid");
  assert.match(css, /@media \(max-width:760px\)\{[^@]*\.dcells\{[^}]*repeat\(2,/, "no two-column phone rule for the cells");
  for (const c of [".dkick{", ".dband{", ".dband.head", ".dband.receipt", ".dband.rate", ".dcell{", ".dcell dt{", ".dcell dd{"]) assert.ok(css.includes(c), "no rule for " + c);
});

/* ------------------------------------------------------------------ *
 * B0 — the card says why; the audit moves one click away
 *
 * The user put nhlpropking.com's card beside ours and said the board
 * carries too much text to tell why one player is a favourite. So: a
 * row wears up to three chips (chips.js, thresholds in one place), the
 * card's overview carries them with their notes, the parlay strip hides
 * behind one button, each board's footer is one line, and the record
 * tables live on record.html.
 * ------------------------------------------------------------------ */

/* A player whose data-file fields earn every chip: eight games, the last
   three heavier; a fifth of his team's red-zone touches; on the field
   for most snaps; a third of the air yards. */
const CHIPPED = Object.assign({}, PLAYERS[0], {
  id: "h", name: "Hotel Wide", games: 8, tds: 4, targets: 64, carries: 0,
  log: [[0, 0, 6, 0, 1, 0], [1, 0, 6, 0, 1, 0], [0, 0, 6, 0, 0, 0], [1, 0, 6, 0, 1, 0], [0, 0, 6, 0, 1, 0], [1, 0, 12, 0, 2, 0], [0, 0, 11, 0, 1, 0], [1, 0, 11, 0, 2, 0]],
  rz: { c: 0, t: 9, g: 0, n: 8 }, usage: { snap: 0.86, snapN: 8, tsh: 0.28, ays: 0.34, aysN: 8 },
});
/* The same team's other red-zone touches, so the share has a denominator. */
const TEAMMATE = Object.assign({}, PLAYERS[1], { id: "i", name: "India Back", team: "KC", opp: "LAC", rz: { c: 27, t: 0, g: 9, n: 8 } });

test("a row wears up to three chips under the name, each a chips.js chip, and none without chips.js", async () => {
  const chips = (await import("./chips.js")).default;
  const teamFactors = { LAC: { def: 1.21, allow: { recyds: 1.12 } }, KC: { def: 1, allow: {} } };
  const { app } = await mountPlayers({ players: PLAYERS.concat([CHIPPED, TEAMMATE]), teamFactors });
  const r = app.__rows.find((x) => x.p.id === "h");
  assert.ok(r, "the chipped player is not on the board");
  const expected = chips.forPlayer(CHIPPED, { teamRz: 36, oppFactor: 1.21, opp: "LAC", what: "touchdowns" });
  assert.deepEqual(r.chips.map((c) => c.id), expected.map((c) => c.id), "the row's chips are not what chips.js computes from the data file and the model's opponent factor");
  assert.deepEqual(r.chips.map((c) => c.id), ["volume", "redzone", "defence", "snaps", "deep"]);
  const row = app.innerHTML.match(new RegExp('data-i="' + r.i + '">[\\s\\S]*?</button>'))[0];
  const who = (row.match(/<span class="who">[\s\S]*?<span class="chips">([\s\S]*?)<\/span><\/span>/) || [])[1];
  assert.ok(who, "the row has no chips line under the name");
  const worn = [...who.matchAll(/<span class="chip( [a-z]+)?">([^<]*)/g)].map((m) => m[2]);
  // Five games at 6 targets, then 12, 11, 11: 11.3 against 6.0 over the five before, +89%.
  assert.deepEqual(worn, ["Volume up +89%", "Red zone 25%", "Soft D +21%"], "a row wears the first three chips, label and value");
  assert.match(who, /class="chip up">Volume up/, "volume up is not coloured up");
  // A player with none of the fields wears only what the model knows (the soft defence); one facing an average
  // defence wears none, and the line is absent, not empty.
  assert.deepEqual(app.__rows.find((x) => x.p.id === "a").chips.map((c) => c.id), ["defence"]);
  const plain = app.__rows.find((x) => x.p.id === "b");
  assert.deepEqual(plain.chips, []);
  assert.doesNotMatch(app.innerHTML.match(new RegExp('data-i="' + plain.i + '">[\\s\\S]*?</button>'))[0], /class="chips"/);
  // Without chips.js the board mounts and no row wears a chip.
  const bare = await mountPlayers({ players: PLAYERS.concat([CHIPPED, TEAMMATE]), teamFactors, noChips: true });
  assert.doesNotMatch(bare.app.innerHTML, /class="chip/);
});

test("the defence chip replaces the stat row's soft/tough badge: only where the opponent is in the number, and then at the strength the model applies", async () => {
  const nfl = (await import("./nfl.js")).default;
  // Receptions are not shrunk toward the opponent (recsOppShrink 0); rushing yards are, at half strength.
  assert.equal(nfl.DEFAULTS[nfl.STATS.recs.oppShrinkKey], 0, "the fixture assumes receptions ignore the opponent");
  assert.equal(nfl.DEFAULTS[nfl.STATS.rushyds.oppShrinkKey], 0.5, "the fixture assumes rushing yards applies the opponent at half strength");
  const rp = recPool(nfl).recyds;
  const pools = { recyds: rp, rushyds: rp, recs: nfl.sortedPool(rp.exp.map((e) => e / 10), rp.ratio, "recs") };
  // Alpha (KC) faces LAC on the receptions view; Bravo (LAC) faces KC on the rushing view.
  const teamFactors = { LAC: { def: 1, allow: { recs: 1.3, recyds: 1.3 } }, KC: { def: 1, allow: { rushyds: 1.3 } } };
  const { app, doc, press } = await mountPlayers({ players: PLAYERS, pools, teamFactors });
  press("view", "Receptions");
  const a = app.__rows.find((x) => x.p.id === "a");
  assert.ok(a, "the receiver is not on the receptions view");
  assert.deepEqual(a.chips.filter((c) => c.id === "defence"), [], "a defence chip on a prop the opponent is not in");
  press("view", "Rushing yards");
  const b = app.__rows.find((x) => x.p.id === "b");
  assert.ok(b, "the back is not on the rushing view");
  const d = b.chips.find((c) => c.id === "defence");
  assert.ok(d, "no defence chip on a rushing row against a soft run defence");
  // The allowance is +30%; applied at half strength the model's factor is +15%, and that is what the chip says.
  assert.equal(d.label, "Soft D");
  assert.equal(d.value, "+15%");
  assert.equal(Math.round((b.oppFactor - 1) * 100), 15, "the row's applied factor is not +15%");
  clickRow(app, app.__rows.indexOf(b));
  assert.match(doc.getElementById("dbands").innerHTML, /<li>KC defence <b>\+15%<\/b>: gives up more rushing yards than average at half strength, which adds <b>\d+<\/b><\/li>/, "the why band does not say the applied factor and its strength");
  assert.doesNotMatch(src("football-board.js"), /soft D<|tough D<|>=1\.07|<=0\.93/, "the old hand-typed badge, or its threshold, is still in the board");
});

test("the card's overview is the price row and how he gets there: every chip with its note, and one sentence from the game log", async () => {
  const teamFactors = { LAC: { def: 1.21, allow: {} }, KC: { def: 1, allow: {} } };
  const { app, doc } = await mountPlayers({ players: PLAYERS.concat([CHIPPED, TEAMMATE]), teamFactors });
  const i = app.__rows.findIndex((x) => x.p.id === "h");
  clickRow(app, i);
  const over = doc.getElementById("dbody").innerHTML;
  assert.match(over, /<h4 class="muhead">How he gets there<\/h4>/);
  assert.equal((over.match(/<li>/g) || []).length, 5, "the overview does not carry every chip");
  assert.match(over, /Red zone 25%<\/span><span>9 of the 36 red-zone touches logged for KC&#39;s priced players \(carries and targets inside the 20\); his over 8 games/, "a chip's note is missing or unescaped");
  assert.match(over, /LAC gives up 21% more touchdowns than average/);
  assert.match(over, /Scored in <b>2<\/b> of his last <b>3<\/b> games/);
  // The why band names the opponent as the mover, with its figure.
  assert.match(doc.getElementById("dbands").innerHTML, /<li>LAC defence <b>\+21%<\/b>: gives up more touchdowns than average<\/li>/);
});

test("the parlay strip hides behind one button in the controls row, on every view; pressing it again clears the slip", async () => {
  const { doc, press, app } = await mountPlayers({ players: PLAYERS });
  const strip = doc.getElementById("parlayctl"), seg = doc.getElementById("parlayseg");
  assert.equal(strip.hidden, true, "the parlay strip is open before anyone asked");
  assert.equal(doc.getElementById("parlaywrap").hidden, false);
  assert.equal(seg.children.length, 1);
  assert.equal(seg.children[0].textContent, "Suggest a parlay");
  assert.equal(seg.children[0].attrs["aria-pressed"], "false");
  press("parlayseg", "Suggest a parlay");
  assert.equal(doc.getElementById("parlayctl").hidden, false, "the button did not open the strip");
  assert.equal(doc.getElementById("parlayseg").children[0].attrs["aria-pressed"], "true");
  press("plegs", "3 legs");
  assert.ok(app.innerHTML.includes("Suggested parlay") || app.innerHTML.includes("Cannot build that slip"), "no slip after a press");
  press("parlayseg", "Suggest a parlay");
  assert.equal(doc.getElementById("parlayctl").hidden, true, "the strip did not close");
  assert.ok(!app.innerHTML.includes("Suggested parlay") && !app.innerHTML.includes("Cannot build that slip"), "closing the strip left the slip on the board");
  // A price typed against a slip dies with the slip: reopen, suggest again, and the box is empty.
  press("parlayseg", "Suggest a parlay"); press("plegs", "3 legs");
  app.handlers.input[0]({ target: { id: "slipprice", value: "-150", getAttribute: () => null } });
  press("parlayseg", "Suggest a parlay");
  press("parlayseg", "Suggest a parlay"); press("plegs", "3 legs");
  assert.doesNotMatch(app.innerHTML, /id="slipprice"[^>]*value="/, "the old slip's price survived into the new slip");
  // The game view keeps the button and hides the rest of the row.
  assert.ok(SHIPPED_HIDDEN.has("controls"), "nfl.html no longer ships the controls row hidden; this test's guard assumes it does");
  assert.equal(doc.getElementById("controls").hidden, false, "the script never shows the controls row the page ships hidden");
  press("view", "Spread & total");
  assert.equal(doc.getElementById("controls").hidden, false, "the controls row is gone from the game view, and the parlay button with it");
  assert.equal(doc.getElementById("parlaywrap").hidden, false);
  for (const id of ["linewrap", "sortwrap", "teamwrap", "poswrap", "starwrap"]) assert.equal(doc.getElementById(id).hidden, true, id + " shows on the game view");
  press("view", "Anytime TD");
  for (const id of ["sortwrap", "teamwrap", "poswrap", "starwrap"]) assert.equal(doc.getElementById(id).hidden, false, id + " did not come back");
  for (const f of ["nfl.html", "cfb.html"]) {
    const m = markup(f);
    for (const id of ["sortwrap", "teamwrap", "parlaywrap", "parlayseg", "parlayctl"]) assert.match(m, new RegExp('id="' + id + '"'), f + " has no #" + id);
    assert.ok(m.indexOf('id="controls"') < m.indexOf('id="parlayctl"'), f + ": the parlay strip must sit under the controls row, not above the note");
  }
});

test("each football board's footer is one line with the graded count, the touchdown bias and a link to the record page; the tables are gone", async () => {
  const record = { total: 2360, days: ["a", "b", "c"], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2, brier: 0.15 } }, parlays: { x: { scope: "slate", legs: 3, n: 1, adjusted: 0.1, cashed: 0 } } };
  const { doc } = await mountPlayers({ players: PLAYERS, record });
  const foot = doc.getElementById("foot").innerHTML;
  assert.match(foot, /<b>2,360<\/b> predictions graded against what this board published · anytime touchdown off by <b>\+1\.2pp<\/b> · <a href="record\.html#nfl">/);
  assert.doesNotMatch(foot, /<table>|Live record|Suggested parlays|Does it work/, "the record tables are still under the board");
  assert.match(foot, /Data: ESPN/);
  const bare = await mountPlayers({ players: PLAYERS });
  assert.match(bare.doc.getElementById("foot").innerHTML, /Nothing graded yet[\s\S]*<a href="record\.html#nfl">/);
  const js = src("football-board.js");
  assert.doesNotMatch(js, /function liveRecord|parlayRecord=|C\.footer/, "football-board.js still renders the record, or reads a footer copy");
  for (const f of ["nfl.html", "cfb.html"]) assert.doesNotMatch(src(f), /footer:/, f + " still carries the replay table as copy; it lives on record.html");
});

test("record.html: one section per football league with its replay table and a live-record slot, the record files and the page script, no faces", () => {
  const m = markup("record.html"), s = src("record.html");
  for (const id of ["nfl", "cfb", "nfl-live", "cfb-live"]) assert.match(m, new RegExp('id="' + id + '"'), "no #" + id);
  assert.match(m, /Does it work\?[\s\S]*anytime touchdown[\s\S]*Brier <b>0\.1591<\/b>/, "the NFL replay table is not on the record page");
  assert.match(m, /Two FBS seasons[\s\S]*Brier <b>0\.1743<\/b>/, "the college replay table is not on the record page");
  for (const f of ["nfl-record.js", "cfb-record.js", "record-page.js"]) assert.match(s, new RegExp('<script src="' + f.replace(".", "\\.") + '"></script>'), "record.html does not load " + f);
  assert.match(s, /BetHouseRecordPage\.render\(document/);
  assert.doesNotMatch(s, /faces\.js|<img/);
  // The two boards' links land on the two sections: the college board is "College football" to the script.
  const js = src("football-board.js");
  const anchors = js.match(/RECORD_ANCHOR=\{([^}]*)\}/);
  assert.ok(anchors, "football-board.js has no RECORD_ANCHOR map");
  for (const [league, id] of [["NFL", "nfl"], ["College football", "cfb"]]) {
    assert.match(anchors[1], new RegExp("'" + league + "':'" + id + "'"), "no anchor for " + league);
    assert.match(m, new RegExp('id="' + id + '"'), "record.html has no #" + id + " for " + league);
  }
  for (const f of ["nfl.html", "cfb.html"]) assert.match(src(f), new RegExp("league: '(" + ["NFL", "College football"].join("|") + ")'"), f + " names a league the anchor map does not know");
  // Every other board offers the Record link (the nav test above checks the record page links every board).
  for (const f of BOARDS.filter((b) => b !== "record.html")) assert.match(src(f), /<a class="navlink" href="record\.html">Record →<\/a>/, f + " has no Record link");
});

test("the stylesheet carries the chips line, the why list, the how list and the record panels", () => {
  const css = src(SHEET);
  for (const c of [".who .chips{", ".chip.up{", ".chip.down{", ".dband.why{", ".dwhy{", ".dwhy li{", ".dbody .how{", ".hows li{", ".rec{", ".dband.receipt a{"]) assert.ok(css.includes(c), "no rule for " + c);
  assert.doesNotMatch(css, /\n\.how\{/, "a bare .how rule would also style the note's disclosure, which shares the class");
  assert.match(css, /\.who \.chips\{[^}]*white-space:nowrap[^}]*overflow:hidden/, "the chips line can wrap and grow the row");
});

/* ------------------------------------------------------------------ *
 * B2 — team colours, where DESIGN.md lets them go and nowhere else
 *
 * teams.js hands back bare colour values from teams-data.js (ESPN's team
 * lists, by fetch-teams.mjs). They go on a stripe along the top of the
 * home's game cards, a faint tint behind the drawer's hero and the tray
 * card's left edge: backgrounds and borders, never a text colour, so
 * white text on near-black keeps its contrast whatever the team.
 * ------------------------------------------------------------------ */

test("the home's game card wears the two teams' stripe from teams.js, as a background, and nothing without the module", () => {
  const html = src("index.html");
  assert.match(html, /T=window\.BetHouseTeams\|\|null/, "the home does not feature-detect teams.js");
  assert.match(html, /T\?T\.stripe\(g\.league,g\.awayKey,g\.homeKey\):''/, "the stripe is not teams.js's, away then home");
  assert.match(html, /<span class="gstripe" style="background:'\+esc\(stripe\)\+'"><\/span>/, "the stripe is not an escaped background on its own element");
  const css = src(SHEET);
  assert.match(css, /\.gstripe\{[^}]*position:absolute[^}]*height:4px/, "no stripe rule");
  assert.match(css, /\.gcard\{[^}]*position:relative[^}]*overflow:hidden/, "the card does not clip its stripe to its corners");
});

test("the drawer's hero takes the team's tint and the tray card its edge, both from teams.js, both as background or border", async () => {
  const teams = (await import("./teams.js")).default;
  const data = { NFL: { kc: { p: "e31837", s: "ffb81c" }, lac: { p: "0080c6", s: "ffc20e" } } };
  // The module reads the page's global at load; the board reads the module. Mount with the table in place.
  const nfl = (await import("./nfl.js")).default;
  const doc = stubDoc();
  const win = { BetHouseEdge: (await import("./edge.js")).default, BetHouseParlay: (await import("./parlay.js")).default, BetHouseFaces: (await import("./faces.js")).default, BetHouseWatchlist: (await import("./watchlist.js")).default, BetHouseChips: (await import("./chips.js")).default, BetHouseTeams: teams.use(data), pushed: [], listeners: {} };
  win.location = { search: "", pathname: "/nfl.html" }; win.history = { pushState() {}, replaceState() {} }; win.addEventListener = () => {};
  win.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // eslint-disable-next-line no-new-func
  new Function("window", "document", src("football-board.js"))(win, doc);
  win.BetHouseFootballBoard.mount({ model: nfl, data: { season: 2026, week: 2, statsSeasons: [2025, 2026], generated: "2026-09-21T00:00", gamesCached: 2, games: GAMES, ratings: RATINGS, teamFactors: {}, players: PLAYERS, pools: {}, usagePool: [] },
    record: null, league: "NFL", fetcher: "x", copy: { noteTD: "n", noteStat: Object.fromEntries(Object.keys(nfl.STATS).map((k) => [k, "n"])), noteGames: "n", gameBanner: "<p>n</p>", mlVerdict: "n", gameHonestly: "n" } });
  const app = doc.getElementById("app");
  const i = app.__rows.findIndex((r) => r.p.id === "a"); // KC
  clickRow(app, i);
  assert.equal(doc.getElementById("dhead").attrs.style, "background:rgba(227,24,55,0.16)", "the hero is not tinted with KC's primary at the faint alpha");
  const j = app.__rows.findIndex((r) => r.p.id === "d"); // ZZZ: no colour on file
  clickRow(app, j);
  assert.equal(doc.getElementById("dhead").attrs.style, "", "the previous team's tint survived onto a team with none");
  // The tray card: a left edge in the team's primary.
  clickRow(app, i);
  doc.getElementById("dcompare").handlers.click[0]();
  assert.match(doc.getElementById("tcards").innerHTML, /<div class="tcard" style="border-left-color:#e31837">/, "the tray card has no team edge");
  // Where the colours may go: background and border properties only. A team colour on text is the one
  // thing DESIGN.md forbids, so the whole file is scanned for a text-colour sink, not just the call line:
  // a `.style.color` write anywhere, or a `color:` CSS string concatenated with a team value.
  for (const page of ["football-board.js", "index.html"]) {
    const s = src(page);
    assert.doesNotMatch(s, /\.style\.color\b/, page + " writes a text colour from script");
    assert.doesNotMatch(s, /[^-]color:\s*['"]?\s*\+\s*(esc\()?(tint|edge|stripe)\b/, page + ": a team colour is concatenated into a color: declaration");
    assert.doesNotMatch(s, /(tint|edge|stripe)\s*\+\s*['"][^'"]*;?\s*color:/, page + ": a team colour precedes a color: declaration");
    // Every place a team value is used as a style must be a background or border property.
    for (const m of s.matchAll(/(background|border-left-color|[a-z-]+):\s*['"]?\s*\+\s*(esc\()?(tint|edge|stripe)\b/g)) {
      assert.ok(["background", "border-left-color"].includes(m[1]), page + ": a team colour on the " + m[1] + " property");
    }
  }
  for (const f of ["nfl.html", "cfb.html"]) {
    assert.match(src(f), /<script src="teams-data\.js"><\/script>\s*<script src="teams\.js"><\/script>/, f + " does not load the colours before teams.js");
    assert.match(markup(f), /id="dhead"/, f + " has no #dhead for the tint");
  }
  assert.match(src("football-board.js"), /'dhead'/, "dhead is not in the stale-page list");
  assert.match(src(SHEET), /\.tcard\{[^}]*border-left:4px solid/, "the tray card has no left edge to colour");
  teams.use(null);
});

test("teams-data.js is committed, generated by fetch-teams.mjs, and carries a six-hex primary for every NFL team", () => {
  const s = src("teams-data.js");
  assert.match(s, /^\/\* generated by fetch-teams\.mjs/);
  const data = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  assert.equal(Object.keys(data.NFL).length, 32);
  for (const [k, v] of Object.entries(data.NFL)) { assert.match(k, /^[a-z0-9]{2,5}$/); assert.match(v.p, /^[0-9a-f]{6}$/, k + " has no primary"); }
  assert.ok(Object.keys(data["College football"]).length > 100, "the college table is short");
  assert.ok(Object.keys(data.MLB).length >= 30);
  assert.ok(s.length < 60000, "the colours file is bigger than its job");
  // A black primary is real (the Steelers), and teams.js paints with the secondary: so every black NFL primary must have one.
  for (const [k, v] of Object.entries(data.NFL)) if (v.p === "000000") assert.match(v.s || "", /^[0-9a-f]{6}$/, k + " is black with no secondary to paint");
  // The home keys baseball by statsapi's abbreviation (home.js): every one in the data file must resolve, aliases included.
  const mlb = src("mlb-data.js");
  const abbrs = new Set([...mlb.matchAll(/"abbrev":"([A-Z]{2,3})"/g)].map((m) => m[1].toLowerCase()));
  for (const a of abbrs) assert.ok(data.MLB[a], "mlb-data.js names " + a.toUpperCase() + " and teams-data.js has no row for it");
});

/* ------------------------------------------------------------------ *
 * The drawer's close controls on a phone
 *
 * The user reported it: on a phone, once the card is scrolled, the ×
 * has scrolled away with the hero (measured: 270px above the viewport
 * after a 390px scroll) and the scrim is a 100px strip at the top, so
 * the only way out is the back button. The buttons now live in a bar
 * that sticks to the top of the sheet while it scrolls, and a downward
 * swipe from the top of the sheet closes it.
 * ------------------------------------------------------------------ */

test("both football pages keep the drawer's Compare and close buttons in a bar that sticks while the card scrolls, and the bar is in the stale-page list", () => {
  for (const f of ["nfl.html", "cfb.html"]) {
    const m = markup(f);
    const bar = (m.match(/<div class="dbar" id="dbar">([\s\S]*?)<\/div>\s*<div class="dhead"/) || [])[1];
    assert.ok(bar, f + ": no #dbar before the hero");
    assert.match(bar, /id="dcompare"/, f + ": Compare is not in the bar");
    assert.match(bar, /id="dclose"/, f + ": the close button is not in the bar");
    assert.doesNotMatch(m.match(/<div class="dhead"[\s\S]*?<div class="dbands"/)[0], /dbtns|dclose/, f + ": the hero still carries the buttons");
  }
  assert.match(src("football-board.js"), /'dbar'\]/, "dbar is not in the stale-page list");
  const css = src(SHEET);
  assert.match(css, /\.dbar\{[^}]*position:sticky[^}]*top:0/, "the bar does not stick to the top of the scrolling drawer");
  assert.match(css, /\.dbar\{[^}]*pointer-events:none/, "the bar blocks taps on what is under it");
  assert.match(css, /\.dbar button\{[^}]*pointer-events:auto/, "the bar's buttons do not take taps");
  assert.doesNotMatch(css, /\.dbtns\{/, "the old absolute button block is still styled");
});

test("on a phone a downward swipe from the top of the sheet closes the drawer; a short one, one mid-scroll, a sideways one, or one on a wide screen does not", async () => {
  const { app, doc, win } = await mountPlayers({ players: PLAYERS });
  const drawer = doc.getElementById("drawer");
  const i = app.__rows.findIndex((r) => r.p.id === "a");
  let narrow = true;
  win.matchMedia = (q) => ({ matches: q === "(max-width:760px)" && narrow });
  const swipe = (startY, endY, scrollTop, dx = 0) => {
    drawer.scrollTop = scrollTop;
    const h = (t) => (drawer.handlers[t] || [])[0];
    assert.ok(h("touchstart") && h("touchend"), "the drawer has no swipe handlers");
    assert.equal(drawer.handlers.touchmove, undefined, "a touchmove listener with nothing to do");
    h("touchstart")({ touches: [{ clientX: 100, clientY: startY }] });
    h("touchend")({ changedTouches: [{ clientX: 100 + dx, clientY: endY }] });
  };
  clickRow(app, i);
  assert.equal(drawer.hidden, false);
  swipe(100, 140, 0);
  assert.equal(drawer.hidden, false, "a 40px drag closed the sheet");
  swipe(100, 260, 200);
  assert.equal(drawer.hidden, false, "a swipe while the card is scrolled down closed it (that drag is the scroll)");
  swipe(100, 235, 0, 310);
  assert.equal(drawer.hidden, false, "a mostly sideways drag closed the sheet");
  narrow = false;
  swipe(100, 260, 0);
  assert.equal(drawer.hidden, false, "the side panel on a wide screen dismissed on a drag");
  narrow = true;
  swipe(100, 260, 0);
  assert.equal(drawer.hidden, true, "a 160px downward swipe from the top did not close the sheet");
  assert.equal(win.pushed.slice(-1)[0], "/nfl.html", "closing by swipe did not clear the player from the URL");
});

test("a data file whose weighted totals were built under other decays than the model's loses them, so the board never labels a weight it did not apply", async () => {
  const nfl = (await import("./nfl.js")).default;
  const withW = PLAYERS.map((p) => Object.assign({}, p, { w: { recyds: p.recYds * 1.2 } }));
  const stamp = (model) => ({ players: withW.map((p) => Object.assign({}, p)), pools: recPool(nfl), model });
  const same = await mountPlayers(stamp({ tdDecay: nfl.DEFAULTS.tdDecay, yardDecay: nfl.DEFAULTS.yardDecay, rushDecay: nfl.DEFAULTS.rushDecay, rushrecDecay: nfl.DEFAULTS.rushrecDecay }));
  assert.ok(same.app.__rows.every((r) => r.p.w), "the same decays: the totals stay");
  const other = await mountPlayers(stamp({ tdDecay: nfl.DEFAULTS.tdDecay, yardDecay: 0.5, rushDecay: nfl.DEFAULTS.rushDecay, rushrecDecay: nfl.DEFAULTS.rushrecDecay }));
  assert.ok(other.app.__rows.every((r) => !r.p.w), "a data file built under another decay kept its totals");
  const none = await mountPlayers(stamp(undefined));
  assert.ok(none.app.__rows.every((r) => r.p.w), "a data file with no stamp (before the era stamp) is left alone");
});

/* ------------------------------------------------------------------ *
 * B4 — the featured strip
 *
 * The view's five highest chances, each with what the record hit at that
 * chance: the tracker's 10-point band (15+ graded calls) for the prop.
 * Nothing without a record, nothing for a chance in no band, nothing on
 * the game view; a card opens the player.
 * ------------------------------------------------------------------ */

test("the featured strip is the view's five highest chances, each with the record's own figure for its band or the word that there is none yet, in descending order; a card opens the player", async () => {
  const nfl = (await import("./nfl.js")).default;
  // The real record's shape: bands only where 15 calls have been graded (today 0 to 50), not every decile; the fixture stops at 30 so its top rows sit above the record's reach, as the board's do.
  const bands = Array.from({ length: 4 }, (_, k) => ({ lo: 10 * k, n: 100 + k, predicted: 10 * k + 5, actual: 10 * k + 3 }));
  const record = { total: 1000, days: ["a"], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2, brier: 0.15, bands } } };
  const { app, doc } = await mountPlayers({ players: PLAYERS, pools: recPool(nfl), record });
  const strip = (app.innerHTML.match(/<div class="featured">[\s\S]*?<\/div><\/div>/) || [""])[0];
  assert.ok(strip, "no featured strip with a record that has bands");
  assert.ok(app.innerHTML.indexOf('class="featured"') < app.innerHTML.indexOf('class="game v-td"'), "the strip is not above the table");
  assert.doesNotMatch(strip, /five highest/, "the header counts cards it may not show (a tablet shows three)");
  const cards = [...strip.matchAll(/<button type="button" class="fcard" data-fid="([^"]+)" aria-haspopup="dialog">[\s\S]*?<span class="fnum">(\d+)%[\s\S]*?<span class="frec">([^<]*(?:<b>[^<]*<\/b>[^<]*)?)<\/span>/g)];
  const byChance = app.__rows.slice().sort((a, b) => b.s.prob - a.s.prob);
  assert.equal(cards.length, Math.min(5, app.__rows.length), "not five cards (or all the rows when fewer)");
  assert.ok(byChance.some((r) => r.s.prob >= 0.4) && byChance.some((r) => r.s.prob < 0.4), "the fixture should have rows above and below the record's top band");
  cards.forEach((m, k) => {
    const r = byChance[k];
    assert.equal(m[1], String(r.p.id), "card " + k + " is not the " + (k + 1) + "th highest chance");
    assert.equal(Number(m[2]), Math.round(100 * r.s.prob));
    // The band is the one the PRINTED chance falls in, so the card never says "60%" beside "at 50–60%".
    const lo = Math.floor(Math.round(100 * r.s.prob) / 10) * 10, b = bands.find((x) => x.lo === lo);
    if (b) assert.equal(m[3], "at " + lo + "–" + (lo + 10) + "% the record hit <b>" + Math.round(b.actual) + "%</b> of " + b.n);
    else assert.equal(m[3], "the record has under 15 graded calls at " + lo + "–" + (lo + 10) + "% yet", "a row above the record's top band is not told so");
  });
  // A card opens the drawer on that player; the handler must take the card before any row under it.
  const fid = cards[1][1];
  app.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-fid]" ? { getAttribute: () => fid } : sel === ".row" ? { getAttribute: () => "0" } : null) } });
  assert.equal(doc.getElementById("drawer").hidden, false);
  assert.equal(doc.getElementById("dtitle").textContent, PLAYERS.find((p) => p.id === fid).name);
});

test("a featured card for a player under the twenty-row cut lifts the cut and keeps the filters; the strip is touchdowns only; no record, no strip", async () => {
  const nfl = (await import("./nfl.js")).default;
  const bands = Array.from({ length: 10 }, (_, k) => ({ lo: 10 * k, n: 50, predicted: 10 * k + 5, actual: 10 * k + 4 }));
  const record = { total: 1000, days: ["a"], props: { td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2, brier: 0.15, bands }, recyds: { label: "Receiving yards, over", n: 457, predicted: 41, actual: 42.9, bias: -1.9, brier: 0.24, bands } } };
  // Thirty backs on one team, so the cut bites and a team filter is in force.
  const many = Array.from({ length: 30 }, (_, k) => Object.assign({}, PLAYERS[1], { id: "m" + k, name: "Back " + k, team: "LAC", opp: "KC", tds: 1 + (k % 7), games: 10 }));
  const { app, doc, press } = await mountPlayers({ players: many, pools: recPool(nfl), record });
  press("posseg", "RB");
  press("sortseg", "Boost");
  const strip = (app.innerHTML.match(/<div class="featured">[\s\S]*?<\/div><\/div>/) || [""])[0];
  const fid = strip.match(/data-fid="([^"]+)"/)[1];
  const shown = app.__rows.map((r) => r.p.id);
  assert.ok(shown.length < 30, "the board did not cut the list");
  const target = shown.includes(fid) ? null : fid;
  if (target) {
    app.handlers.click[0]({ target: { closest: (sel) => (sel === "[data-fid]" ? { getAttribute: () => target } : null) } });
    assert.equal(doc.getElementById("drawer").hidden, false, "the card did not open the player under the cut");
    assert.equal(doc.getElementById("dtitle").textContent, many.find((p) => p.id === target).name);
    const posPressed = doc.getElementById("posseg").children.find((b) => b.attrs["aria-pressed"] === "true");
    assert.equal(posPressed && posPressed.textContent, "RB", "opening a card under the cut cleared the position filter");
  }
  press("view", "Receiving yards");
  assert.doesNotMatch(app.innerHTML, /class="featured"/, "a strip on a counting prop: the over at the projection line is a coin flip for everyone, and the record has no band at any other line");
  press("view", "Spread & total");
  assert.doesNotMatch(app.innerHTML, /class="featured"/, "a strip on the game view");
  const none = await mountPlayers({ players: PLAYERS, pools: recPool(nfl) });
  assert.doesNotMatch(none.app.innerHTML, /class="featured"/, "a strip without a record");
  const css = src(SHEET);
  for (const c of [".featured{", ".fcards{", ".fcard{", ".fnum{", ".frec{"]) assert.ok(css.includes(c), "no rule for " + c);
  assert.match(css, /@media \(max-width:760px\)\{[^@]*\.fcards\{[^}]*overflow-x:auto/, "the strip does not scroll inside itself on a phone");
});

test("the teams page's panel scrolls sideways inside itself, the team cell sticks, and the board's matchup tags come from the core's thresholds", async () => {
  const css = src(SHEET);
  assert.match(css, /\.tscroll\{[^}]*overflow-x:auto/, "the teams panel does not scroll inside itself");
  assert.match(css, /\.teams td\.tm,\.teams th:first-child\{[^}]*position:sticky[^}]*left:0/, "the team cell does not stick while the panel scrolls");
  assert.doesNotMatch(css, /\.teams th\{[^}]*position:sticky/, "a sticky column head in a panel that never scrolls vertically");
  for (const f of ["faces.js", "teams-data.js", "teams.js", "tendencies-data.js", "tendencies-core.js", "teams-page.js"]) assert.match(src("teams.html"), new RegExp('<script src="' + f.replace(".", "\\.") + '"></script>'), "teams.html does not load " + f);
  assert.match(markup("teams.html"), /id="teams"[\s\S]*id="tfoot"/);
  // A synthetic defence a hair over the soft threshold earns the tag; one a hair under does not: the board reads the numbers against the core's thresholds, not a note string.
  const core = (await import("./tendencies-core.js")).default;
  const lg = TENDENCIES.current.league;
  const soft = Object.assign({}, TENDENCIES, { current: { off: TENDENCIES.current.off, def: { KC: TENDENCIES.current.def.KC, LAC: Object.assign({}, TENDENCIES.current.def.LAC, { deepEpa: lg.deepEpa + core.SOFT_EPA + 0.001, insideRunEpa: lg.insideRunEpa + core.SOFT_EPA - 0.001 }) }, league: lg } });
  const { app, panelFor } = await mountBoard({ tendencies: soft, games: GAMES, ratings: RATINGS });
  const html = panelFor(app.__rows.findIndex((r) => r.g.id === "g1"));
  const kcOff = html.slice(html.indexOf("KC offence vs LAC defence"), html.indexOf("LAC offence vs KC defence"));
  assert.match(kcOff, /deep pass<span class="tag soft">soft<\/span>/, "a defence exactly SOFT_EPA over the league is not tagged soft");
  assert.doesNotMatch(kcOff, /inside run<span class="tag (soft|tough)"/, "a defence at the league's inside-run EPA is tagged");
});
