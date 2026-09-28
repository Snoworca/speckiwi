# kiwi parallel-waves v1.0.0 — the shared contract that runs waves as parallel workers

The single source of truth for how `kiwi-orchestrator` (`R-ORCH`) and `kiwi-wave-master` execute waves. Neither skill restates this procedure; both name this file in their §0. One responsibility split across two documents is the failure where one copy gets corrected and the other silently diverges.

Read together with `local-llm-profile.md`: this profile never fans out to multiple workers, so every run here is `worktree-serial` with `isolation.reason` naming that profile, and every verifier pair runs as two sequential verification axes. The executor path and every other rule below are identical to the claude and codex renderings — only the concurrency is 1.

Governing requirements: `FR-FLOW-188` (this contract) · `FR-FLOW-187` (one SDS per wave) · `FR-FLOW-186` (test sufficiency) · `FR-FLOW-183` (SDS close-out) · `FR-NODE-213` (the wave schedule kernel) · `FR-FLOW-122` (the worktree contract).

A bare `§n` in this contract names a section of this file. A section of another document is named together with that document.

---

## 0. What the caller passes

| Argument | `kiwi-orchestrator` | `kiwi-wave-master` |
|---|---|---|
| `artifact_root` | `docs/research/{work}/` | `docs/analysis/kiwi-wave-master-{run_id}/` |
| `engine` | `kiwi-orchestrator` | `kiwi-wave-master` |
| wave verification step (§5 PW-13) | its own §12 loop P | its own §5.5 |
| host hooks | 3.a wave design and loop W (before PW-1), 3.c′ readiness and allocation check (after PW-2), 3.m wave-boundary issues (after PW-13) | none |
| integration branch (where PW-9 merges and PW-16 looks for landing) | `kiwi/orch/{run_id}/integration` (its own §15) | the branch the run root was on when the run started — the host does not switch branches during the run |

Every `{artifact_root}` below is replaced by that argument.

**A wave's `verification_cmd`** is the regression command the caller pinned at run start (`kiwi-orchestrator` Preflight P.4, `kiwi-wave-master` §2.1) — the full regression suite, so the test files of the wave SDS Test Plan are among what it runs. It passes when `failing_tests ⊆ baseline_failing_tests` (exit 0 when the baseline capture failed). The caller puts this value on the dispatch card and in the journal as is, and the verdict, the retry, landing and the promotion evidence all use the same command — no per-wave choice of command. For both callers the wave's sds-id is `{run_id}-wave-{n}` and its SDS path is `docs/sds/{run_id}-wave-{n}.sds.md`. Inside an sds-id, `{run_id}` is the run_id lowercased with every character outside `[a-z0-9.-]` replaced by `-` — the sds-id is also the worker `kiwi-pm`'s session id, so it must satisfy `kiwi-pm` §0.14's `[a-z0-9.-]{4,128}`. The default run_id with the longest suffix (`-wave-12-r2-3`) fits inside that cap.

---

## 1. Roles — who writes what

- **Host** — the main session, which stays at the run root.
- **Worker** — a subagent that takes one wave and runs in its own worktree. A lane is exactly one wave's worker.
- **Independent subagent** — an SDS author, verifier or fixer the host spawns at the run root. It is not a worker.

| What is written | Who writes it |
|---|---|
| The SRS — Requirement ID allocation, status, stability, evidence, trace, the Completed Work Log, `docs/spec/` | the host only, one at a time |
| `docs/sds/` | the host and its independent subagents only |
| `kiwi/waves.jsonl` · `kiwi/pipeline.jsonl` | the host only, through the tools |
| code and tests inside the SDS write set | the worker only, on its own branch |
| merges into the integration branch | the host only |

**A worker writes neither the SRS nor `docs/spec/`, `docs/sds/`, `kiwi/pipeline.jsonl` or `kiwi/waves.jsonl`.** SRS writes in a worker open four races no mechanism stops: the requirement ID counter and the SRS lock are per root; within one root the SRS lock fails at once instead of waiting; `kiwi-srs` changes the active target, which is global state; and the `@req` resolution test in a worker's worktree judges against that worktree's SRS. A worker's SRS mutations are written to its `--defer-srs-mutation` queue and the host replays them (PW-10).

---

## 2. Concurrency — parallel by default, `--serial` runs every fan-out one at a time

- **Parallel is the default.** The host dispatches every wave worker of a stage at once, and every other place where subagents fan out — SDS authoring, investigators, verifiers — runs in parallel too.
- **`--serial`**, or a user request in natural language — "직렬로" · "하나씩" · "순서대로" · "serially" · "one at a time" — runs **every subagent fan-out** one at a time: workers, SDS authoring, investigators, verifiers, and the `--auto` decision committee (`auto-option.md` — its members are spawned one by one, each still isolated). The executor path is the **same** as the parallel one: worktree workers at concurrency 1, and no second executor path that runs a unit at the host root. A serial run therefore still passes `--defer-srs-mutation` and the host replays.
- **A runtime that cannot spawn isolated workers runs serially and records why.** The Preflight `probe-isolation` judges whether the runtime can spawn worktree-isolated workers and whether `.claude/worktrees/` is ignored, and writes `worktree-parallel` or `worktree-serial` to `isolation.profile` and the ground (`--serial`, a natural-language request, a runtime reason) to `isolation.reason`. It never falls back silently. On such a runtime the host creates the worktree with `git worktree add` and one delegated worker runs the worker chain with that worktree as its working directory.
- A serial run still computes and publishes the stages — the record shows which waves were independent.

---

## 3. Wave dependencies and stages

- The decomposition declares `depends_on[]` per wave (`wave-decomposition.md §2`). **A wave without the field depends on every earlier wave.**
- The **ready set** is every wave that is not `complete` and whose dependencies are all `complete`. SRS and SDS are authored only for waves in the ready set — targets are never registered ahead. The "remaining wave" a carry-forward targets (`verify-loop.md §8`) is a wave whose SRS authoring has not started; when there is none, a new wave is appended.
- A **stage** is the group the tool picks from the ready set: waves whose dependencies are all merged and whose SDS write sets (Files paths ∪ Test Plan test files) are pairwise disjoint, at most `--lanes N` per stage. The host never computes it by hand:

  ```
  speckiwi orchestrate schedule waves --sds <per wave of the ready set, one SDS path or one fragment entry, in wave order> --depends '<json>' --lanes N
           --existing-paths {artifact_root}waves/stage-{s}/existing-paths.json [--strict-grounding]
           --out {artifact_root}waves/stage-{s}/lanes.lock.json --run-id {run_id} --json
  ```

  `--depends` is `{waveId: [waveId…]}` and a wave id is the SDS file name without `.sds.md` (for a split wave, the base sds-id of its fragment entry below). Dependencies already merged are dropped from the list, but the wave's key stays — a wave whose dependencies are all merged is passed as `[]`. A wave with no key is read by the tool as depending on every earlier wave and serializes for no reason. `existing-paths.json` is the dispatch base's `git ls-files` written as a JSON array. `--out` is always passed — the lock has this one spelling only. The refusals are `schedule-cycle` (a dependency cycle) and `files-not-grounded` (a typo of an existing path).
- The tool may put several stages in the lock. **Only the first stage is dispatched.** A wave that did not fit re-enters the next computation with its authoring already done. The conflict reasons are two: `wave-dependency` and `write-set-overlap`.
- The convergence registry's `orchestrator-only` · `regenerate` paths are not written in an SDS's Files — that is why `kiwi-sds` receives `--convergence-registry`. **The host handles those paths after the merge** (PW-12).
- When `kiwi-sds` splits a wave's SDS into `{run_id}-wave-{n}-{k}.sds.md` because of the size cap, it is still **one wave = one lane = one worker**. The wave enters the schedule as one wave — its `--sds` entry is written `{run_id}-wave-{n}=<fragment 1 path>,<fragment 2 path>,…` (in k order), and the tool uses the union of the fragments' write sets as the wave's write set and records a digest per fragment. Fragments are never written in `--depends` against each other. The wave's worker calls `kiwi-pm` once per fragment in k order (PW-6) — one SDS is one `kiwi-pm` run — and returns only after every fragment is done. So `kiwi-sds --close {run_id}-wave-{n}` (PW-15) runs once, after every fragment has landed.
- **A wave's SDS files** are every file `kiwi-sds` wrote — the `artifacts.sds_files` of that call (under `--no-pipeline-emit`, the `{sds-id}.sds.md` and `{sds-id}-{k}.sds.md` files found under `docs/sds/`). The worker card's `sds_paths` holds these files in k order (one file when the SDS was not split), the `<sds_path>` a worker gives `kiwi-pm` below is one of them, and the test-sufficiency check (PW-14) runs once per SDS file of the wave with that file as `--sds`. The close-out is called by sds-id, not by file — `kiwi-sds --close <sds-id>` closes the parts itself, in k order.
- **A re-entry's new SDS** has the id `{run_id}-wave-{n}-r{m}` (m = the wave's re-entry ordinal, from 1). Calling again with the same id makes `kiwi-sds` reuse the agreed SDS and write nothing new, so a new gap always gets a new id; the same id is passed to `--sds-id` again only to continue an interrupted re-entry. Every sds-id of a wave is recorded in the journal, and the close-out (PW-15 · PW-17) runs for each of them. A re-entry runs again from PW-3 as a stage holding that one SDS — its input commit becomes the new dispatch base, and the worker is dispatched only after a stage lock is written and frozen for that SDS, so the new lane is in a frozen plan and the SDS is in the worker's base.

---

## 4. Gates — what this contract raises

A gate declaration is per skill by construction. Both skills declare **every** row below in their own `critical_gates[]` — an undeclared halt falls to `business-decision`, and under `--auto` a committee waves it through.

| gate_id | predicate | where |
|---|---|---|
| `child-srs-needs-user-or-failed` | a `/kiwi-srs` or `/kiwi-srs-feasibility` the host called returned `NEEDS_USER`/`FAILED` | PW-1 |
| `child-pipeline-needs-user-or-failed` | a `/kiwi-sds`, the host review hop, or an improvement-delegation `/kiwi-review-fix-loop` the host called returned `NEEDS_USER`/`FAILED`, or the worker's own review came back halted or with residual CRITICAL/HIGH in `review_outcome` | PW-2 · PW-8 · PW-12 · PW-13 |
| `unallocated-req-id` | the union of the wave SDS files' `@req` sets is empty, holds a requirement outside the allocated set, or misses one of the allocated set (a requirement `kiwi-sds` left out of scope, `draft` among them) | PW-2 |
| `schedule-cycle` | `schedule waves` refused over a dependency cycle | PW-4 |
| `files-not-grounded` | `schedule waves` judged an SDS path a typo of an existing path | PW-4 |
| `lane-plan-drift` | on resume, the plan recomputed from the lock's recorded inputs differs from the lock | resume |
| `worker-touched-srs` | `git status --porcelain docs/spec docs/sds` differs before and after a dispatch | PW-8 |
| `serial-unit-failed` | the worker verdict still fails after one retry against the same SDS, no commit and no `intentionally_empty` reason, or the worker's `/kiwi-pm` returned `NEEDS_USER`/`FAILED` | PW-8 · PW-9 |
| `lane-design-refuted` | a worker manifest came back with `status: design-refuted` | PW-8 |
| `srs-mutation-replay-failed` | `orchestrate replay apply` refused the replay or recorded a failure | PW-10 |
| `post-merge-index-drift` | `validate --fail-on-warning` still reports drift after `sync_index` | PW-10 |
| `cross-lane-duplication-unresolved` | a `duplicate` verdict of the duplication audit was not resolved as an issue of that wave | PW-12 |
| `test-sufficiency-gap` | the test-sufficiency check leaves a gap after its one fill (`test-sufficiency.md`) | PW-14 · end |
| `integration-test-user-consent` · `cost-warning-large-task` | the worker's `kiwi-coder` consent and cost gates — they stop even under `--auto` unless `--auto-integration` · `--auto-cost-warning` are explicit | worker |

The partition review's `partition-review-unrecorded` is `business-decision` — a wrong partition is recovered by the post-merge verdict and a serial re-run, so it does not stop an `--auto` run.

---

## 5. The order of one stage

**PW-1 · SRS authoring — host, one at a time.** For each wave of the ready set, in wave order, `/kiwi-srs` authors the `wave-{n}` target (`wave-srs-registration.md`) and `/kiwi-srs-feasibility TARGET=wave-{n}` follows when its condition holds. **This never runs in parallel** (the four races of §1). The difference between the requirement snapshots before and after authoring is the wave's **allocated set**, written to `allocation` on the `register-wave-srs` result line. The caller writes the argument form of both calls.

**PW-2 · SDS authoring — independent subagents, one per wave, in parallel.** They write different files and no SRS, so parallel is safe. Under `--serial`, one at a time.

```
Skill({ skill: "kiwi-sds", args: "TARGET=wave-{n} --req-filter <allocated set> --sds-id {run_id}-wave-{n}
        --convergence-registry <convergence registry path> --existing-modules <design baseline path> --no-pipeline-emit [--auto] [--max] [--mini|--loops N] [--model <name>]" })
```

`--existing-modules` is the wave's `design_baseline.path` (the design-baseline JSON); `kiwi-sds` writes the Interfaces against the `existing_modules` recorded there, so the layer that creates a change sees the structure the verification layer holds it to. `kiwi-sds` raises the SDS to `agreed` itself once `speckiwi sds check` passes. The host collects the requirement IDs of the `sds check --json` summary of every SDS file of the wave and checks that the union is not empty and equals the allocated set. A requirement outside it, or an allocated requirement missing from it (one `kiwi-sds` left out of scope, `draft` among them — it would stay in the promotion set with no code and no test), halts at `unallocated-req-id`.

**PW-3 · Input commit — host.** For each wave, the host commits that wave's SRS changes, its SDS and the caller's wave inputs with an explicit pathspec (`commit-wave-inputs`, trailers `Orch-Run` · `Orch-Verb` · `Orch-Wave`). **That commit's sha is the wave's dispatch base**, recorded in the journal's `isolation.base_sha`, and — by a caller that writes a resume card (`kiwi-orchestrator`, `run-ledger.md §1`) — in the card's `open[].base_sha`. It never uses `git add -A` or `git commit -a`.

**PW-4 · Freeze and publish the stage plan — host.** The host writes the lock with §3's command, commits it with an explicit pathspec (`commit-run-artifacts`), then freezes it with `orchestrate freeze lanes --body <that lock> --document <that lock> --head <that commit's sha> --run-id {run_id} --out {artifact_root}waves/stage-{s}/lanes.freeze.json` (`freeze-lane-plan`) — the freeze pins the committed document as a git blob, so the commit comes first. It publishes the lock and `{artifact_root}waves/stage-{s}/partition.md` and records the `review-partition` result.

**PW-5 · Dispatch — workers, every wave of the stage at once.** Right before dispatch the host commits every `docs/spec` · `docs/sds` change it made, so both paths are clean, and records that `git status --porcelain docs/spec docs/sds` at the run root is empty — it does not dispatch otherwise, because a second edit to an already modified file leaves the same status line and would be invisible to the comparison. A worker's input is a file, `{artifact_root}waves/stage-{s}/{laneId}.dispatch.json`, not the conversation — subagent returns have come back empty repeatedly. The card carries `run_id` · `wave` · `stage` · `laneId` · `target` · the allocated set · `sds_paths` (the lock's `sds` value for that lane — one file, or for a split wave the array in the order its `--sds` entry listed) · `base_sha` · the branch `kiwi/orch/{run_id}/{laneId}` · `write_set` · `verification_cmd` · the regression-baseline pin · the queue and manifest paths · the forbidden list · the propagated flags (`--auto` `--max` `--mini`/`--loops N` `--model` `--auto-integration` `--auto-cost-warning` `--drive`). Where the runtime allows it, the host spawns an `Agent` with worktree isolation (`dispatch-lane`).

**PW-6 · What a worker does.** In this order.

1. `git -C <worktree> switch -C kiwi/orch/{run_id}/{laneId} <base_sha>` — never trust the default HEAD of a worktree the runtime created (`worktree-lane.md §2`).
2. `npm ci --include=dev --ignore-scripts`.
3. `speckiwi orchestrate preflight --json --mcp-root <path> --git-root <worktree> --role lane --lane-id {laneId} --lane-plan <run root>/{artifact_root}waves/stage-{s}/lanes.lock.json` — the lock is committed after the dispatch base, so the worktree does not hold it; `--lane-plan` is therefore the **absolute path** at the host run root, carried by the dispatch card. On a non-zero exit, do nothing, write only the reason to the manifest, and return.
4. Implement — once per file of `sds_paths`, in the order of `sds_paths` (fragment order), giving that file as `<sds_path>`. The next fragment starts only after the previous fragment's `/kiwi-pm` ended `TASK_DONE`:

   ```
   /kiwi-pm SDS_PATH=<sds_path> --session-suffix w{n}s{s}l{k} --no-final --no-pipeline-emit
            --commit-lane-work --defer-srs-mutation <queue path> [--resume] [--auto] [--max] [--model <name>]
            [--mini|--loops N] [--regression-baseline <P.4 pin>] [--auto-integration] [--auto-cost-warning] [--force] [--drive]
   ```

   `{k}` is the lane's 1-based position in its stage's `laneIds`. The last four pass-throughs are carried only when the caller received them from the user. Without `--commit-lane-work`, `kiwi-pm` commits nothing and the host has nothing to merge. The commits carry the `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` trailers and no phase marker in the subject.
5. Review its own window — without `--close-reqs`:

   ```
   Skill({ skill: "kiwi-review-fix-loop", args: "--base <base_sha> --head HEAD --req-filter <allocated set>
           --sds <sds_path> --no-pipeline-emit [--auto] [--max] [--mini|--loops N]" })
   ```

   Fixes are committed with the write-set pathspec. The review runs once over the worker's whole window whatever the fragment count — it takes one `--sds`, so when `sds_paths` holds two or more files it is called without `--sds`.
6. With one SDS the test-sufficiency check does not run a second time — the review above received its scope through `--req-filter` and `--sds`, so its last phase is this check over the wave scope (`test-sufficiency.md`). With a split SDS, after the review the worker runs `test-sufficiency.md` once per fragment with that fragment's `Requirements` IDs and `--sds <that fragment>`. The check reads **the worker's worktree** — the worktree rule of `test-sufficiency.md` §3 step 1. The result goes into the manifest's `test_sufficiency`.
7. Write the manifest and return: `{branch, head_sha, commits[], deferred_queue, reports[], red_evidence[], review_outcome, intentionally_empty, design_refuted[], out_of_lease_paths[], test_sufficiency}`. `review_outcome` is the step-5 review's return (`TASK_DONE` · `NEEDS_USER` · `FAILED`) and its residual CRITICAL/HIGH count. For a wave whose `/kiwi-pm` made no commit, the worker writes the `intentionally_empty` declaration — `{sds_id, reason}`, reason at least 20 characters — into that `/kiwi-pm` run's `docs/analysis/kiwi-pm-…` bundle as `intentionally-empty.json` and carries the same value in the manifest. The host judges from the harvested copy of the bundle. `red_evidence[]` holds the red phase's **expected-failure signatures** — one `{test_id, failure}` per test that failed before implementation (the test identifier and a summary of its failure message). One run is one commit, so commit order cannot show the tests came first (FR-FLOW-115 AC-2); the red evidence lives in this field only.

What a worker never does: call an SRS mutation tool, write `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl`, pass `--root`, merge or push, call `/kiwi-sds`, weaken an existing test.

**PW-7 · Join — host.** The host waits for every worker of the stage and reads the result from the manifest file, not from the return value. It harvests into `{artifact_root}waves/stage-{s}/{laneId}/` (`collect-lane`) — the queue and the manifest, and the evidence that lives only in the worktree and is never committed: the worker `kiwi-pm` session's `.kiwi/sessions/…` (worklog · `pm-state.json`), the `docs/analysis/kiwi-pm-…` bundle, and the analysis directory of the worker's review. Later steps (PW-8's `intentionally_empty` judgement, PW-13's evidence bundle, PW-16's evidence detail) read the harvested copies — the worktree is released at PW-11.

**PW-8 · Verdict — host, per worker.** A worker's green is not the verdict (`worktree-lane.md §5`). The host checks (`verify-lane`):

```
base..head has at least one commit                  (or an admissible intentionally_empty)
the manifest's red_evidence[] is not empty          (waived for intentionally_empty)
review_outcome is TASK_DONE with 0 residual CRITICAL/HIGH
base is an ancestor of head
changed paths ⊆ the SDS write set                   (edits outside it: judged by the rule below)
changed paths ∩ (docs/spec/ ∪ docs/sds/) = ∅
the host runs verification_cmd once in the worktree itself and it passes (§0)
git status --porcelain docs/spec docs/sds at the run root equals the pre-dispatch record
```

When the last line differs, the run stops at `worker-touched-srs` — an MCP write that omitted `workspaceRoot` lands silently at the host, and this comparison is the one mechanism that catches that path. A manifest carrying `design-refuted` is `lane-design-refuted`. A `review_outcome` of `NEEDS_USER` · `FAILED`, or residual CRITICAL/HIGH, halts at `child-pipeline-needs-user-or-failed` — a child's halt stops the parent (each skill's §0.4). A failed verdict re-spawns a fresh worker **once** against the same SDS and the same base (`remediate-lane`, branch `…/{laneId}-r2`). A second failure is `serial-unit-failed`. An edit outside the write set is recorded and accepted when no other worker of the stage touched that path; otherwise that wave re-runs alone on the new base after PW-9.

**PW-9 · Merge — host, in wave order.** The host merges every branch that passed its verdict into the integration branch with `--no-ff` (`integrate-lane`). A merge conflict, or a new failure in the full regression after the merge, re-runs that wave alone once on the new base. A second failure is `serial-unit-failed`. Git catches textual conflicts; the post-merge regression catches semantic ones — green apart, red together.

**PW-10 · Replay — at the host root.** `orchestrate replay plan` plans the harvested queues and `orchestrate replay apply --plan <path> --applied kiwi/orchestrator/{run_id}/replay-applied.jsonl --frozen-target wave-{n}` applies them (`replay-deferred-mutations`). A refusal or a recorded failure is `srs-mutation-replay-failed`.

**PW-11 · Release — host, only after the harvest.** `git worktree remove` returns the worker's worktree (`release-lane`). Releasing before the harvest evaporates the ignored artifacts inside it.

**PW-12 · Stage close — host.** (1) The host handles the convergence registry's `regenerate` · `orchestrator-only` paths by their recipes. (2) The duplication audit compares the waves merged in the same stage with each other and with the pre-merge base; a `duplicate` verdict is opened as an issue of that wave and resolved, and an unresolved one is `cross-lane-duplication-unresolved`. (3) Once every merge and replay of the stage is done, `validate` → `sync-index` → `validate --fail-on-warning` run once, and surviving drift is `post-merge-index-drift`. (4) **The host code review reviews only the commits the host made after the merge** — each worker already reviewed its own window:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base <last merge commit> --head <host tip> --no-pipeline-emit
        [--auto] [--max] [--mini|--loops N]" })
```

It passes neither `--commit-lane-work` nor `--close-reqs`. When the host made no commit the window is empty and the verdict is `not-applicable-empty-window`.

Before the call, `git diff --name-only <last merge commit>..<host tip>` is filtered through the file-class table of `kiwi-review-fix-loop` §11. When no code file remains — the host commits are only the `docs/spec/` · index · README · skill-mirror commits of convergence recipes, replay and index sync — the hop is not called and `no-host-code-commits` is written to the `notes` of the journal line that records the stage close and to the final report. That skill is code-only, so calling it would only halt at `empty-code-scope`. Each worker reviewed its own window, and the run-window final review sees the whole run. When at least one code file remains, the call above runs as written.

**PW-13 · Design-conformance verification — per wave.** The caller's verification step (the §0 table) compares the merged result with the SRS · the SDS · the recorded decisions. The evidence bundle carries the SDS · the worker manifest · the worker's review report · the worker's test-sufficiency result — the SDS is read before PW-17 deletes it. **When the result differs from the SRS · the SDS · a decision, an independent subagent that is not the original worker fixes it, and the host re-verifies.** The route is `verify-loop.md §7` — a code defect goes to `kiwi-review-fix-loop` with an explicit scope, an intent gap the SDS does not cover re-enters that wave (a new SDS from `kiwi-sds` under §3's re-entry id and a fresh worker, scoped with `--sds-id` and `--req-filter`). The input is facts only — the original requirements, the diff, the SDS.

**PW-14 · Test sufficiency — host, immediately before promotion.** `test-sufficiency.md` runs over the wave scope (the allocated set), once per SDS file of the wave with that file as `--sds`. A remaining gap is `test-sufficiency-gap`.

**PW-15 · SDS close-out, moving — host.** `Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })` — once per sds-id of the wave, re-entry ids included. It moves each SDS-AC interpretation decision into the SRS as a clarification of that AC and raises only rules marked durable as constraint requirements.

**PW-16 · Promotion — host, one wave at a time.** Only a wave whose design-conformance verification is `pass` is promoted. The set is the wave's allocated set **when its worker has landed** and empty otherwise. Landed means the worker commits carrying the wave's `Orch-Wave` · `Orch-Lane` trailers are on the integration branch and `verification_cmd` passed, or an admissible `intentionally_empty` declaration. The transition has two steps — landed moves `planned`/`in_progress` → `implemented`, and a `pass` with no residual naming the requirement moves `implemented` → `verified`. The evidence is `type="test"` and `type="commit"`. `type="test"` is one row per AC as `test-sufficiency.md` §4 states — its reference is `verification_cmd`, `covers` is that AC, and the notes carry the citation PW-14 returned for that AC and the path of the harvested worker `docs/analysis/kiwi-pm-…` bundle. `type="commit"` is the sha of each of the wave's trailered commits; a wave landed by `intentionally_empty` carries test evidence only. A wave that did not land leaves its requirements at their current status. `add_completed_work` is the host's too. `kiwi-orchestrator` states the same rule in its own §14.

**PW-17 · SDS close-out, deletion — host.** The same `kiwi-sds --close` runs once more. When every `@req` requirement is `verified` or `discarded`, the SDS file is deleted and the close-out commit carries the deletion. Git history keeps the file. A closed SDS is never read as the current design — the current design is the code.

The caller then records the wave's `complete`. The next stage recomputes the ready set and starts again at PW-1.

---

## 6. Resume

- A caller that writes a resume card (`kiwi-orchestrator`) holds the current stage's waves in progress in `open[]`, one entry per lane. A caller without a card (`kiwi-wave-master`) reads the same facts from the worker lines of `waves.jsonl` (`phase="worker"`, `lane`, `stage`, `isolation.base_sha`) — `{key: "wave-{n}/s{s}/{laneId}", state, base_sha, head_sha}`.
- A live worker (`git worktree list --porcelain` reports `locked … (pid N)`) is never dispatched again.
- When a manifest exists, the run continues from PW-7. When a trailered commit of that lane already exists on the worker branch or the integration branch, `/kiwi-pm` does not run again; when `pm-state.json` exists, `--resume` is passed. For a split wave this is judged per fragment — a fragment whose session is `done` is skipped and the worker resumes at the first unfinished fragment.
- The SDS digests in the lock are measured again — a split wave's `sds_digests` holds one digest per file, so each file is compared. A wave the close-out already touched — its SDS Status is `closed` or the file is deleted (PW-15 · PW-17) — is not compared and is passed as a closed-out wave. Any other wave whose digest changed is `lane-plan-drift`.
