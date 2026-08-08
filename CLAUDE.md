# CLAUDE.md — Altera Engineering Standard

Shared guidance for Claude Code across Altera projects. These override default behavior —
follow them, but apply judgment (see Rigor tiers). Quality GATES are enforced in CI
(`.github/workflows/ci.yml`, `ENFORCEMENT.md`), not by this file — your job is excellent
work that clears them before they fail.

---

## SCOPE — classify the task first
- **CODE** — features, fixes, refactors, scripts, infra. The workflow below applies.
- **DOCUMENT / ANALYSIS** — reports, templates, decks, spreadsheets. Skip test/review; do the work or use a relevant skill.
- **CONVERSATION** — a question, review, advice. Just answer well. No ceremony.

---

## SESSION START
If the repo has `handoff.md`, `tasks/lessons.md`, or `.planning/`, read them first and briefly acknowledge what you found.

---

## RIGOR TIERS — match effort to risk
Over-applying ceremony to trivial work is its own failure mode. Pick honestly:
- **Trivial** (typo, config value, one-liner): just do it, then verify.
- **Standard** (a feature, bug fix, real refactor): plan → test → implement → verify.
- **High-stakes** (auth, secrets, PHI/patient data, money, migrations, public APIs, anything security-sensitive or hard to reverse): full discipline, no shortcuts.

When unsure, round UP.

---

## THE WORKFLOW (Standard / High-stakes)

### 1. PLAN
Use **Plan Mode** for anything with 3+ steps or architectural impact. Cover: restated
requirements, affected files, phased steps, risks, success criteria. High-stakes: run the
**premortem** skill on the draft plan and fold its deltas in, then STOP and get approval before implementing.

### 2. TESTS — test-driven by default
- Write the test first. Red → green → refactor. Every behavior is driven by a failing test that came before it. Default for ALL code with logic.
- **No coverage target to chase.** CI enforces a coverage *floor* — a measured baseline in `.coveragerc` / `vitest.config.ts` (not yet a per-line check on changed code); honest TDD clears it. Don't write assertion-free tests to hit a number.
- Carve-outs: **spikes** (spike to learn, then THROW IT AWAY and TDD the real thing — never ship the spike); **no-behavior code** (pure config, generated code, trivial getters, static layout).
- About to implement behavior with no failing test? STOP.
- **Retrofitting tests onto existing code is NOT TDD — the code is not the spec.** Test-first
  can't cement a bug; test-after can. Before each assertion name the **oracle**: a standard, a
  documented rule, another implementation in this repo, or the bug report. Assert the
  **invariant** (rejected / 403 / no row written), never the **packaging** (exact message,
  ordering, formatting) — packaging assertions lock in current behavior and fight the fix. No
  oracle? Mark it `# characterization:` so the next person knows they may change it. If code and
  intent diverge, write the test for the **intent** and let it FAIL — a red test documenting a
  real bug is a correct deliverable, not a broken one.

### 3. IMPLEMENT
Keep changes minimal — touch only what's necessary. If it goes sideways, STOP and re-plan.

**Before writing code, stop at the first rung that holds** — the best code is the code you never wrote:
1. Does this need to be built at all? (YAGNI — push back if the request is over-scoped.)
2. Standard library does it? Use it.
3. Native platform/framework feature? Use it.
4. Already-installed dependency? Use it (don't add a new one).
5. One clean line? Make it one line.
6. Only then write the minimum that works.

Deletion over addition, boring over clever, fewest files. Laziness as *discipline*, not
shortcut: trust-boundary validation, data-loss/error handling, security, PHI, and
accessibility are never cut, and TDD (§2) is unchanged.

### 4. REVIEW & SECURITY — you author and fix; CI enforces
- CI enforces Semgrep SAST, gitleaks, and the coverage floor; branch protection blocks failures. **Never weaken a gate to go green — fix the cause.**
- Before commit/push, run the **mandatory review**: **`/code-review`** against `QUALITY-RUBRIC.md` + **`/security-review`**, and resolve every HIGH finding (`/code-review ultra` for high-stakes).

### 5. VERIFY (every tier)
Run it and show the output (`/verify`, `/run`) — a claim without evidence isn't a result.

**The self-closing loop:** after every change run **`bash scripts/local-check.sh`** (`--fast` for the inner loop; full run before push). It mirrors CI exactly, so green locally == green in CI. Don't push until it's green.

**Before push or merge, the WHOLE suite must actually execute — not just the tests you wrote.** Testing your own change proves your change; it does not prove you broke nothing else, and a cross-product regression is the failure a local gate exists to catch. **A gate that reports success while skipping tests is not a gate.** Skips are normal (opt-in suites, platform guards), but they must never be invisible or unexamined: if tests were skipped because this machine lacked what they need — a real database, a live service — then the run did not tell you CI will pass, and those are precisely the tests CI is about to run for you. Read the skip count on every pre-push run and confirm each one is a deliberate opt-in. If the fast path skips a suite, the fast path is not the push gate.

### 6. DOCUMENT
- **Internal:** update `handoff.md` (what/state/blockers/decisions); if you were corrected, add a prevention rule to `tasks/lessons.md`.
- **Product:** if the change alters a user-facing feature/CLI/API/config key/install step, update docs **in the same change** via `software-docs-writer` — a Markdown doc minimum, plus the in-app help guide if one exists. Skip only for internal refactors with no external surface.

---

## AUTONOMY — when to act vs. ask
- **Just do it**: clear fixes, obvious improvements, anything reversible.
- **Confirm first**: irreversible/hard-to-undo actions (deletes, overwrites, history rewrites, force pushes), anything outward-facing, and scope expansions beyond what was asked.
- Approval for one action doesn't carry to the next unless stated.

---

## PRODUCTION-READINESS BASELINE — enterprise, not a toy
When the change ships to real users, these are defaults. The first two are security-critical (treat as High-stakes; a violation is a HIGH finding):
- **Authorization is server-side, always.** Every role/admin/ownership/tenant check is
  enforced on the server (or in the DB via row-level security). Client-side checks are UX
  only — never the gate. Assume the client is hostile and the API is called directly.
- **Session tokens never live in `localStorage`/`sessionStorage`.** Use httpOnly + Secure +
  SameSite cookies (or the platform's secure storage). `localStorage` is readable by any
  XSS, so a token there is a token leaked.
- **Batch data access; no N+1** — set-based/bulk operations, not one round-trip per row.
- **Compress on the wire** (gzip/brotli at the server/gateway); paginate and select fields, don't return whole tables.
- **Choose rendering deliberately** — resolve per-user/tenant data at request time (SSR/API), never bake it into a static build.

Full checkable form in `QUALITY-RUBRIC.md`; `/security-review` enforces the first two.

---

## CORE PRINCIPLES
- **Simplicity first** — as simple as it can be, no simpler.
- **Root causes, not band-aids** — no temporary fixes.
- **Minimal blast radius** — touch only what's necessary.
- **Honest reporting** — if tests fail or a step was skipped, say so; don't dress up partial work as done.
- **Elegance check** — for non-trivial changes, pause: "is there a cleaner way?"
- **Mark deliberate simplifications** — a tracked scope/YAGNI deferral is fine; a broken
  band-aid is not. Leave a greppable marker with the ceiling AND the upgrade trigger:
  `TODO(simplify): O(n²) scan — fine <1k rows, switch to an index above`.
  `grep -rn "TODO(simplify)"` is the debt ledger.

---

## UI/UX WORK
For any visual/interaction/UX task, plan the design BEFORE writing UI code (`frontend-design`,
or `ui-ux-pro-max`). Design skills generate UI blind — give the model eyes: **sketch** a
throwaway mockup for direction → **build on real primitives** (e.g. shadcn/ui) not hand-rolled
→ **screenshot and critique the actual pixels** (Claude Preview/Playwright), fix, repeat 2–3×
→ **audit against a rubric**. Skip for pure backend/infra/non-visual work.

---

## COMMUNICATION
- Be direct and concise. Lead with the answer, then the reasoning.
- Give a recommendation, not an exhaustive survey.
- Flag uncertainty and tradeoffs honestly — don't perform agreement.
- Reference files as clickable `path:line`.

---

## MODEL, EFFORT & SUBAGENTS
Two dials, set per session: **which model** (capability) and **what effort** (thoroughness).
Match them to the rigor tier, not to habit.

| Tier | Model | Effort |
|---|---|---|
| Trivial | `sonnet` | `low`–`medium` |
| Standard | `opus` | default (`high`) |
| High-stakes | `opus` | `xhigh`; `max` when correctness outranks cost |
| Genuinely hard — root-cause hunts, outage debugging, architecture, unfamiliar domains | `fable` | `high`+ |

- Switch with `/model` and `/effort` (or `--model` / `--effort` at launch). `effortLevel` in
  `~/.claude/settings.json` sets your default; skills and subagents override it in frontmatter.
- **Raise the effort when Claude didn't try hard enough** — skipped files, skipped tests,
  abandoned a multi-step task. **Raise the model when it wasn't capable enough.** Different
  failures, different fix; reaching for a bigger model to cure laziness just costs more.
- Fable 5 is never the default — opt in with `/model fable`. Describe the outcome you want and
  let it plan the path; over-prescribing the steps lowers its output quality.
- **Safety-classifier fallback:** Fable 5 and Opus 5 screen cybersecurity and biology content.
  Fable 5 falls back to Opus 4.8 (cyber) or Opus 5 (bio); Opus 5 falls back to Opus 4.8 for cyber
  but has **no fallback for bio — it just refuses.** After a fallback the session *stays* on the
  fallback model, so if behavior shifts mid-`/security-review`, check `/model`.
- Subagents (the Agent tool) for research, exploration, and parallel analysis — one focused task
  each, to keep the main context clean. Give them lower effort than the main loop unless the
  subtask *is* the hard part.

---

## TOOLING NOTES
- **Built in** (no plugin): `/code-review`, `/security-review`, `/simplify`, `/verify`, `/run`, `/doctor`, Plan Mode, subagents, memory.
- **`/doctor`** *(built in)* — setup checkup: install health, unparseable settings, slow hooks,
  duplicate `CLAUDE.md` files, proposed trims for checked-in guidance. Run it whenever the config
  feels off or a session behaves oddly. It supersedes the health half of `claude-code-setup`;
  prefer it, since it ships with Claude Code and needs no plugin.
- **Keep every CLAUDE.md — this one and each project's — under ~200 lines.** They load into
  every session, and length costs adherence. Multi-step procedures belong in a **skill** (loads
  on demand); per-language or per-directory conventions belong in `.claude/rules/*.md` with
  `paths:` frontmatter (loads only when Claude touches matching files). Neither costs context
  until it's needed.
- **superpowers** *(recommended)* — TDD, brainstorming, systematic-debugging.
- **precommit-gate hook** *(bundled, recommended)* — runs the project's tests before any Claude-driven `git commit` and blocks on failure; wire per INSTALL A4. Fast feedback — CI is still the gate.
- **claude-code-setup** *(official; onboarding)* — read-only "recommend automations for this project" scan; run once when a repo first adopts the standard. Suggests, doesn't gate. For config *health*, use `/doctor` instead.
- **software-docs-writer** *(bundled)* — keeps product docs + in-app help current as code changes.
- **premortem** *(bundled)* — prospective-hindsight failure pass, required on High-stakes plans (§1); also fits go-live/cutover decisions.
- Quality gates (tests, coverage floor, SAST, secrets) live in CI — see `ENFORCEMENT.md`.
