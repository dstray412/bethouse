# Quality Rubric — the 8 dimensions, operationalized

The shared standard a code review grades against. Used three ways:
- **Manually**: run `/code-review` and judge the diff against these criteria.
- **In the loop**: an independent reviewer agent scores against this before a fix is accepted.
- **Automated (opt-in)**: the pre-push hook feeds this to `claude -p` and blocks on HIGH findings.

A review reports findings per dimension with a severity, then a single verdict.

**Severity**
- **HIGH** — must fix before merge (blocks). Correctness/security/data-loss/robustness defects, untested critical logic.
- **MEDIUM** — should fix; flag clearly. Maintainability/consistency problems, missing edge-case tests.
- **LOW** — nice to fix; suggestion only.

---

## 1. Correctness  *(HIGH-weight)*
Does the code do what it's supposed to, including edge cases?
- ✅ Logic matches the stated requirement; boundary/empty/null/error cases handled.
- 🚩 Off-by-one, wrong operator, unhandled branch, race condition, incorrect async/await, swallowed error that changes behavior.
- Flag a logic defect as **HIGH**.

## 2. Readability
Can a competent peer understand it without the author present?
- ✅ Intention-revealing names; small, focused functions; comments explain *why*, not *what*.
- 🚩 Cryptic names, deeply nested conditionals, dead code, commented-out blocks, magic numbers.
- Usually **MEDIUM/LOW**.

## 3. Simplicity
Is this the simplest thing that works?
- ✅ No speculative abstraction (YAGNI); minimal moving parts; straight-line where possible.
- 🚩 Premature generalization, needless layers/patterns, duplicated logic that should be one function.
- Usually **MEDIUM**; **HIGH** if complexity hides a correctness risk.

## 4. Maintainability
How hard is the next change?
- ✅ Low coupling, clear module boundaries, single responsibility, no hidden global state.
- 🚩 Shotgun surgery required to change one thing, leaky abstractions, tight coupling to incidental details.
- Usually **MEDIUM**.

## 5. Testability  *(HIGH-weight)*
Is the behavior actually proven, and is the code shaped to be tested?
- ✅ Tests exist for the changed behavior and were written test-first; deterministic; seams (DI, pure functions) where needed.
- 🚩 New/changed behavior with **no test**; tests that assert nothing; non-deterministic tests; logic untestable without heavy mocking.
- New behavior with no covering test → **HIGH**.

## 6. Performance *(appropriate to context)*
Efficient enough for where it runs — no more, no less.
- ✅ No accidental O(n²) on hot paths, no N+1 queries, no obvious wasted work; not prematurely optimized.
- 🚩 Unbounded loops/allocations on a request path, repeated I/O in a loop, loading whole datasets to use one row.
- **HIGH** only when it's a real hot-path/data-scale problem; otherwise **LOW**.

## 7. Consistency
Does it look like it belongs in this codebase?
- ✅ Follows the surrounding conventions, naming, error-handling style, and existing patterns/utilities.
- 🚩 Re-invents an existing helper, diverges from the project's idioms, mixes styles.
- Usually **MEDIUM/LOW**.

## 8. Robustness  *(HIGH-weight)*
Does it fail safely under bad input and adverse conditions?
- ✅ Validates inputs at boundaries, handles failures explicitly, no silent catch, sensible defaults/timeouts, fails closed for security.
- 🚩 Trusting unvalidated input, ignoring error returns, resource leaks, crashing on malformed data, unsafe defaults.
- Security/data-integrity defects → **HIGH**.

---

## Production-readiness checklist *(supplements the 8 dimensions; when the change ships to real users)*
Enterprise baseline — the "fine in the demo, fails in production" traps. These cut across
Robustness/Performance above; called out separately so they aren't missed. Skip for pure
internal scripts/tooling with no user-facing surface.
- ✅ Authorization enforced server-side (or DB row-level security); client checks are UX
  only. Session tokens in httpOnly+Secure+SameSite cookies, never `localStorage`. Data
  access batched/set-based (no N+1). Responses compressed at server/gateway; paginated,
  not whole-table. Per-user/tenant data resolved at request time, not baked into a build.
- 🚩 Authz/role/admin/ownership decided on the client; token in `localStorage`/
  `sessionStorage`; query-in-a-loop / N+1; returning entire tables unpaginated; per-user
  data embedded in a static artifact.
- **Server-side-authz bypass and token-in-localStorage are HIGH** (security). N+1 and
  unpaginated payloads are **HIGH** on a real hot path, otherwise MEDIUM.

---

## Verdict (required output)
After listing findings, end the review with **one** line the tooling can read:

```
VERDICT: BLOCK     # if there is ANY HIGH-severity finding
VERDICT: PASS      # otherwise (MEDIUM/LOW may still be listed)
```

For healthcare/PHI-adjacent code, treat Correctness, Testability, Robustness, and any
security finding strictly — when in doubt, **BLOCK**.
