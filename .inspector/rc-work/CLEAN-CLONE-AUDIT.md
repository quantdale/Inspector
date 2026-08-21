# Clean-Clone Audit (RC1, Phase A)

Simulated first contact: fresh `git clone` of the repo into `%TEMP%/inspector-rc1-clean`,
followed ONLY `README.md` and `docs/DEVELOPMENT.md`. No prior knowledge used.
Environment: Windows 11, Git Bash, Node v22.23.2, pnpm 9.15.9, warm pnpm store.
Date: 2026-08-21.

## Timeline (wall clock)

| Step | Time | Result |
|---|---|---|
| `git clone` (local) | 0.5s | OK |
| Read README.md + docs/DEVELOPMENT.md | — | OK |
| `pnpm install` | 3.8s | OK (199 packages; warm store — cold network will be slower) |
| `pnpm cli doctor` | ~2s | PASS all checks, exit 0 |
| `pnpm cli run --adapter fake` | ~2s | OK: `run_… complete; deterministicFailure=target-failure` |
| `pnpm cli run --adapter fake --json` | ~2s | OK, machine-readable JSON |
| `pnpm cli runs list` | ~2s | OK, shows recorded runs |
| **Time to first successful documented command (`doctor`)** | **~2m15s total** from clone start (install dominated; on a cold store expect +1–3 min) |

## Documented commands — all worked

Everything in DEVELOPMENT.md's "Try the fake adapter" section works exactly as written,
including `--json`, `runs list`. The doc's claim "`pnpm cli` is a shorthand for
`tsx packages/cli/src/bin.ts`" is accurate. Records land in `<cwd>/.inspector/runs.db`
as documented.

## Undocumented-but-attempted commands

| Command | Result |
|---|---|
| `pnpm cli run --adapter web` | **Works** (~3s). Output: `dashboard=true; pref=true; boom=target-failure; forbidden=none`. Not mentioned anywhere in README or DEVELOPMENT.md — DEVELOPMENT.md ends at "M0"; a fresh engineer has no doc telling them web is runnable today. |
| `pnpm cli run --adapter web --url http://example.com` | Exits 0 with `dashboard=false; pref=false; boom=target-failure; forbidden=none`. Suspicious: reports the same `boom=target-failure` as the fixture run against an unrelated URL. Either `--url` is silently half-honored or the scenario still asserts fixture selectors against example.com and still reports a fabricated-looking failure with exit 0. A fresh engineer cannot tell whether their URL was actually visited. Needs a doc line and/or clearer output. |
| `pnpm cli --help` | Prints usage block but exits **1**. Help should exit 0. |
| `pnpm cli --version` | Not supported — prints usage, exit 1. |
| `pnpm cli hunt` / `findings list` / `resume` | Not implemented — usage + exit 1. Expected at this stage; usage text does not hint at roadmap. |
| `pnpm cli runs show <id> --json` | Works as documented. |

## Quality gates vs. doc claim

DEVELOPMENT.md says: *"A clean checkout should pass all four."*

- `pnpm lint` — pass (exit 0), though it emits `0 errors and 1 warning potentially fixable with --fix`.
- `pnpm typecheck` — pass.
- `pnpm test` — pass: 387 passed, 3 skipped (~17s).
- `pnpm test:integration` — **FAIL (exit code 1)** after ~4.5 min. See failure detail below
  (captured on rerun). This directly contradicts the doc line above.

### Integration failure detail

12 of the integration tests fail, every one at ~10.3–11.3s — consistent with a
subprocess/IPC startup timeout rather than assertion failures:

- `packages/adapter-fake/src/conformance.integration.test.ts` — 6 failed (capability
  negotiation, semantic actions, target-failure oracle, reset, sha256 artifact, crash
  classification)
- `packages/core/src/run-manager.integration.test.ts` — 4 failed (happy-path event
  persistence, budget exhaustion, unknown-outcome/crash classification, artifact hash
  round-trip)
- `packages/cli-adapter/src/cli.conformance.integration.test.ts` — 1 failed (common
  conformance contract)
- `packages/android/src/android.conformance.integration.test.ts` — 1 failed
  (initialize/version/capability negotiation)

Pattern: every failing test times out right around a 10s deadline while spawning an
adapter subprocess. The same adapters work instantly via the real CLI (`doctor` PASS,
fake + web runs complete in ~2–3s), so this smells like test-harness timeout too tight
for Windows/loaded-machine subprocess startup, or worker contention (the suite ran
~1980s of test time in parallel). Reproduced identically on two consecutive runs, so it
is deterministic on this machine, not flake. Either way the DEVELOPMENT.md claim is
false for a fresh engineer on Windows.

**Cross-check (post-audit):** the main repo's own baseline run
(`.inspector/rc-work/baseline.log`, same day, same machine) shows `test:integration`
**102/102 passed in ~280s**. So the failure is specific to the fresh-clone execution
context of this session — most plausibly machine load/contention during adapter
subprocess startup (this audit ran alongside other campaign activity), not a code
defect in the clone. Downgraded from "code blocker" to "gate robustness issue:
integration timeouts have no headroom and fail under concurrent load, which is exactly
when a CI/fresh-machine run needs them to hold."

## Friction points & doc inaccuracies

1. **`docs/DEVELOPMENT.md`: "A clean checkout should pass all four."** — `test:integration`
   fails on this clean clone. Highest-severity finding.
2. **No mention of the working web adapter in either README.md or DEVELOPMENT.md.**
   DEVELOPMENT.md's last section says M1 "adds the real Playwright/web adapter" (future
   tense) while `pnpm cli run --adapter web` already works. Stale doc.
3. **`pnpm cli --help` exits 1** — convention is exit 0 for help.
4. **No `--version` flag.**
5. **`run --adapter web --url …` gives no feedback about whether the URL was loaded**;
   exit 0 even when nothing matched. Silent partial support of `--url`.
6. **Lint emits 1 warning on a clean checkout** — minor, but "all gates non-interactive
   and clean" implies zero noise.
7. ~~README core-doc links missing~~ — checked: all listed docs exist. No finding.
8. Prerequisites say "pnpm 9+ (`npm i -g pnpm@9` or corepack)" — fine, but no note that a
   warm pnpm content-addressable store dramatically changes install time; not a defect.

## Pleasant surprises

- Install → doctor → fake run end-to-end in ~2 minutes with zero errors. Genuinely smooth.
- `doctor` is excellent: concrete PASS lines with resolved paths, catches node version,
  adapter presence, sqlite openability.
- Fake adapter output is honest (`deterministicFailure=target-failure`) rather than
  pretending success.
- Deterministic run IDs, durable SQLite records, `runs list/show` round-trip works first try.
- All four gates except integration are fast (<20s each).

## Cleanup

- No leftover browser/node processes observed after runs (checked via `ps`).
- Clone left in place at `%TEMP%/inspector-rc1-clean` per instructions.
