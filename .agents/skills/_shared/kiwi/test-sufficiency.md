# kiwi test-sufficiency v1.0.0

The single source of the **test-sufficiency check** every workflow runs at its end (FR-FLOW-186). The judgement lives in one tool: the CLI `speckiwi coverage --tests` (FR-NODE-210) and the MCP tool `check_test_sufficiency` (FR-MCP-066) return the same result. This document defines only **when the check runs, over which scope, and what happens to its result**. A skill that runs the check cites this path and does not restate the procedure.

---

## 1. Citation convention — how a test names an acceptance criterion

- **Requirement AC**: write `<REQ-ID>` and `AC-<n>` on the **same line** of the test (its title). Example: `it("FR-AUTH-003 AC-2 — rejects an expired token", …)`.
- **SDS contract**: inside the test file the SDS Test Plan row names, write `SDS-AC-<n>` on the test line.
- A test that verifies both writes both on one line.
- `@req` comments in code are not an input of this check — the FR-FLOW-020 AC-3 exemption stands.

---

## 2. Call sites and scope — the caller fixes the scope

The check never chooses its own scope. The caller passes the scope this table names, and citation gaps of requirements outside it are not looked at (FR-NODE-210 AC-5).

| Caller | When | Scope |
|---|---|---|
| `kiwi-review-fix-loop` | its last verification step, whenever a requirement scope is known (`--close-reqs`, `--req-filter`, `--sds`) | under `--close-reqs` the `eligible` set; otherwise the `--req-filter` IDs; with neither, the IDs the one lite SDS received as `--sds` names with `@req`. Pass `--sds` as well when an SDS is given |
| `kiwi-tdd` | immediately before `promote_step_requirement` | the step requirement IDs + `--sds docs/spec/steps/<task>/design.md` |
| `kiwi-srs-sync` | immediately before writing `verified` | the requirements this run is about to write as `verified` |
| `kiwi-hot-fix` | immediately before it delegates to `kiwi-srs-sync` | the requirements root-cause mapped with `match_confidence=high` |
| `kiwi-orchestrator` | immediately before a wave's requirement promotion step (`parallel-waves.md` PW-14) | that wave's allocated requirements + `--sds` for each of its SDS files |
| `kiwi-orchestrator` | after the closing code-review hop of every rung | the rung's requirement scope — the step rung adds `--sds docs/spec/steps/<task>/design.md`. No wave SDS is passed: the close-out has deleted the SDS of every wave whose requirements were all promoted by then (FR-FLOW-183 AC-3) |
| `kiwi-pipeline` | after the cycle's closing code-review hop, before the SDS is deleted | the cycle's requirement scope + its SDS — when it was split into several files, once for each file with `--sds <that file>` |
| `kiwi-pipeline` | before the promoting `--close-reqs` hop, when the SDS was split into several files | per file, that file's `Requirements` IDs + `--sds <that file>` |
| `kiwi-wave-master` | after the design-conformance review, immediately before a wave's promotion (`parallel-waves.md` PW-14) | that wave's allocated requirements + `--sds` for each of its SDS files |
| `kiwi-wave-master` | after the run's closing code-review hop | the run's requirement scope only — the close-out has deleted the SDS of every wave whose requirements were all promoted by then (FR-FLOW-183 AC-3) |

When the scope holds no requirement ID the check does not run and the result is `no-scope`. `no-scope` is not a pass — report it as it is.

---

## 3. Procedure

1. Run the tool over the scope, following the caller's MCP rule: MCP `check_test_sufficiency` when MCP is available; the CLI only when that skill allows a CLI fallback without MCP:
   ```
   speckiwi coverage --tests --ids <id,...> --sds <path> --json
   speckiwi coverage --tests --target <t> --sds <path> --json
   ```
   Pass `--sds` only when an SDS exists. The gap list is the **tool's output** — the agent does not read tests and decide gaps itself.
   **A caller running in a worktree points the check at that worktree** — when the check runs in a linked worktree, as a `parallel-waves.md` worker does, pass `workspaceRoot` = that worktree's absolute path to MCP `check_test_sufficiency`, or run the CLI with that worktree as cwd. An MCP bound to the host root cannot see the tests the worker just wrote and reports gaps that are not there, and even after step 3's fill adds tests in the worktree, step 4's rerun still reads the host and the phantom gap never closes. Step 3's fill writes in the same worktree.
   Called with a per-call `workspaceRoot` naming a linked worktree, MCP refuses an `sds` argument under `docs/spec` (a step `design.md`) — FR-MCP-064 AC-7; when a step check has to run that way, this one call is an exception to the MCP rule: run the CLI `speckiwi coverage --tests` with the worktree as cwd. A lite SDS under `docs/sds/` is not refused.
2. With no gap the result is `pass`, and the check ends here.
3. With gaps, spawn **one test-writing subagent**. Its input is the gap list (requirement ID, AC number and AC text; the SDS-AC and the file its Test Plan row names) and the relevant code paths. It **adds** tests whose test line cites the missing `<REQ-ID> AC-<n>` / `SDS-AC-<n>`. It must not delete, weaken or edit an existing test, and it does not change production code. It runs the tests it added — a new test that fails against the current code is neither fixed nor deleted; it is reported as a defect, and the AC it cites counts as a gap in step 5. The caller checks from the diff that the fill only added new tests — if it deleted or edited an existing test line, changed a production file, or introduced a mock, that diff is not used as citation ground and the result is recorded as `gap`. When the caller's skill has a preservation scan or a mock check, it applies them to this diff as well.
4. Rerun the tool (`check_test_sufficiency` / `speckiwi coverage --tests`) over the same scope.
5. If gaps remain (including the ACs a new test that failed in step 3 cites), raise gate `test-sufficiency-gap` — it is critical and `--auto` does not lift it. A requirement whose gaps remain is not written as `verified`.

The fill (step 3) runs only once. Do not loop steps 3 → 4.

When the caller writes nothing (for example under `--dry-run`), skip steps 3 and 4 and report the result of step 1 as it is — there is no `verified` write to stop, so no gate is raised.

If the tool cannot be called (MCP and CLI both fail, or an older release does not know `--tests`), or it returns an error instead of a result (`ok: false` or a non-zero exit — including a scope whose requirement or SDS it does not accept), the check did not run — record the result as `gap` and raise the same gate.

---

## 4. Callers that write `verified` — the citation is the test identifier

A caller that writes `verified` runs this check **before** it registers evidence, and uses the citation the tool returned for each AC (the test file path and line) as the identifier of the test that passed that AC — `add_verification_evidence` is one row per AC, `covers` is that AC and the notes carry the citation (file and line). The `reference` is the run that passed the AC: for a caller that pinned the whole run to one command (`parallel-waves.md`'s `verification_cmd` — `kiwi-orchestrator` · `kiwi-wave-master`) it is that `verification_cmd` (FR-FLOW-087 AC-7; the harvested evidence bundle path is added to the notes as the detail), and for a caller with no such command it is the cited test file. The agent does not name a test per AC itself. An AC with no citation is not checked. A citation of a new test that failed in step 3 is not used. When an AC has several citations, pick the title line of a test that runs.

**A citation must be a test that passed** — the tool reads citations and never runs a test. So a caller that writes `verified` runs the test files of the citations it will use as evidence before it registers the evidence, and uses only the citations of tests that passed in that run. A citation whose test failed, was skipped or did not run leaves its AC a gap, and a remaining gap raises `test-sufficiency-gap` as in step 5 of §3.

---

## 5. Result record

The caller records the result in its artifacts as `test_sufficiency`.

```json
{ "verdict": "pass|gap|no-scope", "scope": { "ids": [], "target": null, "sds": null }, "gaps_first": [], "fill": { "attempted": false, "tests_added": [], "failing_new_tests": [] }, "gaps_final": [] }
```

The final report of an orchestrating skill (`kiwi-pipeline`, `kiwi-wave-master`, `kiwi-orchestrator`) states this `verdict`.

---

## 6. Gate declaration

A shared document cannot declare a gate on a skill's behalf. Every skill that runs this check declares a `test-sufficiency-gap` row in its own `critical_gates[]`.

---

## 7. What this check does not guarantee

A citation is a name. The check guarantees only that every AC and SDS-AC in scope has a test line naming it. Whether a test is right is held by red-first TDD and the regression pass; whether it actually ran and passed is held by the run in §4 (the test files of the citations a caller that writes `verified` will use as evidence) and by the run in step 3 of §3 (tests the fill added). For a caller that does not write `verified`, `pass` means only that the citations exist.
