# kiwi parallel-waves v1.0.0 — the shared contract that runs waves as parallel workers

The single source of truth for how `kiwi-orchestrator` (`R-ORCH`) and `kiwi-wave-master` execute waves. Neither skill restates this procedure; both name this file in their §0. One responsibility split across two documents is the failure where one copy gets corrected and the other silently diverges.

Read together with `local-llm-profile.md`: this profile never fans out to multiple workers, so every run here is `worktree-serial` with `isolation.reason` naming that profile, and the `--max` verifier pair runs as two sequential verifiers. The executor path and every other rule below are identical to the claude and codex renderings — only the concurrency is 1.

Governing requirements: `FR-FLOW-188` (this contract) · `FR-FLOW-212` (one SRS authoring and requirement decomposition) · `FR-FLOW-213` (draft requirements raised just before scheduling) · `FR-FLOW-218` (worker deltas) · `FR-FLOW-195` (the wave declaration file) · `FR-FLOW-187` (one SDS per wave under `--sds`) · `FR-NODE-216` (declaration-file scheduling) · `FR-FLOW-186` (test sufficiency) · `FR-FLOW-183` (SDS close-out) · `FR-NODE-213` (the wave schedule kernel) · `FR-FLOW-122` (the worktree contract).

A bare `§n` in this contract names a section of this file. A section of another document is named together with that document.

---

## 0. What the caller passes

| Argument | `kiwi-orchestrator` | `kiwi-wave-master` |
|---|---|---|
| `artifact_root` | `docs/research/{work}/` | `docs/analysis/kiwi-wave-master-{run_id}/` |
| `engine` | `kiwi-orchestrator` | `kiwi-wave-master` |
| wave verification step (§5 PW-13) | its own §12 loop P | its own §5.5 |
| host hooks | 3.c′ readiness (before PW-4), 3.m wave-boundary issues (after PW-13) | none |
| integration branch (where PW-9 merges and PW-16 looks for landing) | `kiwi/orch/{run_id}/integration` (its own §15) | the branch the run root was on when the run started — the host does not switch branches during the run |

Every `{artifact_root}` below is replaced by that argument.

**A wave's `verification_cmd`** is the regression command the caller pinned at run start (`kiwi-orchestrator` Preflight P.4, `kiwi-wave-master` §2.1) — the full regression suite, so the wave's tests are among what it runs. It passes when `failing_tests ⊆ baseline_failing_tests` (exit 0 when the baseline capture failed). The caller puts this value on the dispatch card and in the journal as is, and the verdict, the retry, landing and the promotion evidence all use the same command — no per-wave choice of command. For both callers the wave's **unit id** is `{run_id}-wave-{n}` — the journal's `sds_id`, the worker `kiwi-pm`'s `--run-id` and the lock's wave id carry it, and under `--sds` it also names the SDS path `docs/sds/{run_id}-wave-{n}.sds.md`. The wave declaration file is `{artifact_root}waves/waves.json` (`wave-decomposition.md`). Inside a unit id, `{run_id}` is the run_id lowercased with every character outside `[a-z0-9.-]` replaced by `-` — the unit id is also the worker `kiwi-pm`'s session id, so it must satisfy `kiwi-pm` §0.14's `[a-z0-9.-]{4,128}`. The default run_id with the longest suffix (`-wave-12-r2-3`) fits inside that cap, and so does a worker's per-requirement run id (`-wave-12-r2-fr-node-1234`).

---

## 1. Roles — who writes what

- **Host** — the main session, which stays at the run root.
- **Worker** — a subagent that takes one wave and runs in its own worktree. A lane is exactly one wave's worker.
- **Independent subagent** — a verifier or fixer (an SDS author too under `--sds`) the host spawns at the run root. It is not a worker.

| What is written | Who writes it |
|---|---|
| The SRS — Requirement ID allocation, status, stability, evidence, trace, the Completed Work Log, `docs/spec/` | the host only, one at a time |
| `docs/sds/` | the host and its independent subagents only |
| `kiwi/waves.jsonl` · `kiwi/pipeline.jsonl` | the host only, through the tools |
| code and tests inside the lane write set (the stage lock's `writeSet`) | the worker only, on its own branch |
| merges into the integration branch | the host only |

**A worker writes neither the SRS nor `docs/spec/`, `docs/sds/`, `kiwi/pipeline.jsonl` or `kiwi/waves.jsonl`.** SRS writes in a worker open four races no mechanism stops: the requirement ID counter and the SRS lock are per root; within one root the SRS lock fails at once instead of waiting; `kiwi-srs` changes the active target, which is global state; and the `@req` resolution test in a worker's worktree judges against that worktree's SRS. A worker's SRS mutations are written to its `--defer-srs-mutation` queue and the host replays them (PW-10).

---

## 2. Concurrency — parallel by default, `--serial` runs every fan-out one at a time

- **Parallel is the default.** The host dispatches every wave worker of a stage at once, and every other place where subagents fan out — investigators, verifiers, SDS authoring under `--sds` — runs in parallel too.
- **`--serial`**, or a user request in natural language — "직렬로" · "하나씩" · "순서대로" · "serially" · "one at a time" — runs **every subagent fan-out** one at a time: workers, SDS authoring (`--sds`), investigators, verifiers, and the `--auto` decision committee (`auto-option.md` — its members are spawned one by one, each still isolated). The executor path is the **same** as the parallel one: worktree workers at concurrency 1, and no second executor path that runs a unit at the host root. A serial run therefore still passes `--defer-srs-mutation` and the host replays.
- **A runtime that cannot spawn isolated workers runs serially and records why.** The Preflight `probe-isolation` judges whether the runtime can spawn worktree-isolated workers and whether `.claude/worktrees/` is ignored, and writes `worktree-parallel` or `worktree-serial` to `isolation.profile` and the ground (`--serial`, a natural-language request, a runtime reason) to `isolation.reason`. It never falls back silently. On such a runtime the host creates the worktree with `git worktree add` and one delegated worker runs the worker chain with that worktree as its working directory.
- A serial run still computes and publishes the stages — the record shows which waves were independent.

---

## 3. Wave declaration and stages

- The decomposition writes the run's graph to `{artifact_root}waves/waves.json` as schema 2.0.0 (`wave-decomposition.md §2`) — each node (`wave-1`, `wave-2`, …) carries `acs` · `files` · and, under `--sds`, `sds`, and the dependencies between nodes are its `edges`. No edge means no dependency — none is inferred from node order. A node's requirement set is computed from its `acs` (`wave-decomposition.md §3`).
- The **ready set** is every wave that is not `complete` and whose dependencies are all `complete` — never counted by hand, read from the `ready[]` of `speckiwi orchestrate wave status --waves {artifact_root}waves/waves.json --run-id {run_id} --json`. The SRS was authored once, ahead of the run (`wave-srs-registration.md §1`) — a stage authors no SRS and only applies worker deltas incrementally (PW-1). Under `--sds`, SDS is written only for nodes in the ready set. The "remaining wave" a carry-forward targets (`verify-loop.md §8`) is a node not yet dispatched (`wave-decomposition.md §6`); when there is none, a new node is appended.
- A **stage** is the group the tool picks from the ready set: waves whose dependencies are all `complete` and whose write sets (the entry's `files[]`, plus under `--sds` the SDS Files paths ∪ Test Plan test files) are pairwise disjoint, at most `--lanes N` per stage. The host never computes it by hand:

  ```
  speckiwi orchestrate schedule waves --waves {artifact_root}waves/waves.json --run-id {run_id} --lanes N --out {artifact_root}waves/stage-{s}/lanes.lock.json --json [--strict-grounding]
  ```

  Both commands (`wave status` and `schedule waves`) read the caller's own run journal, so each caller adds the engine argument its own skill names (`kiwi-wave-master` §5). The tool plans the ready entries only and counts a dependency that is already `complete` as satisfied. It grounds `files[]` against the paths tracked at the dispatch base itself. `--out` is always passed — the lock has this one spelling only. The refusals are `schedule-cycle` (a dependency cycle), `files-not-grounded` (a typo of an existing path) and `requirement-not-ready` (a requirement of the node that does not exist or is `draft`, `deprecated` or `discarded`); a refusal writes no lock. A wave with an empty `files[]` gets a stage of its own and is recorded as an `undeclared-write-set` conflict.
- The tool may put several stages in the lock. **Only the first stage is dispatched.** A wave that did not fit re-enters the next computation. The conflict reasons are three: `wave-dependency`, `write-set-overlap` and `undeclared-write-set`.
- The convergence registry's `orchestrator-only` · `regenerate` paths are written neither in a wave entry's `files[]` nor, under `--sds`, in an SDS's Files — that is why the decomposition leaves them out of `files[]` and `kiwi-sds` receives `--convergence-registry`. **The host handles those paths after the merge** (PW-12).
- Under `--sds`: when `kiwi-sds` splits a wave's SDS into `{run_id}-wave-{n}-{k}.sds.md` because of the size cap, it is still **one wave = one lane = one worker**. The wave entry's `sds[]` lists every fragment in k order — the tool uses the union of `files[]` and the fragments' write sets as the wave's write set and records a digest per fragment. No dependency is declared between fragments. The wave's worker calls `kiwi-pm` once per requirement and gives the fragment whose `@req` holds that requirement as `--sds` (PW-6) — and returns only after every requirement is done. So `kiwi-sds --close {run_id}-wave-{n}` (PW-15) runs once, after every fragment has landed.
- (`--sds`) **A wave's SDS files** are every file `kiwi-sds` wrote — the `artifacts.sds_files` of that call (under `--no-pipeline-emit`, the `{sds-id}.sds.md` and `{sds-id}-{k}.sds.md` files found under `docs/sds/`). The worker card's `sds_paths` holds these files in k order (one file when the SDS was not split), the `<sds_path>` a worker gives `kiwi-pm` below is one of them, and the test-sufficiency check (PW-14) runs once per SDS file of the wave with that file as `--sds`. The close-out is called by sds-id, not by file — `kiwi-sds --close <sds-id>` closes the parts itself, in k order.
- **A re-entry's** unit id is `{run_id}-wave-{n}-r{m}` (m = the wave's re-entry ordinal, from 1) — the worker `kiwi-pm`'s `--run-id` and the journal `sds_id` carry it. A re-entry runs again from PW-3 as a stage holding that one wave node, narrowed to the gap's `--req-filter` — its input commit becomes the new dispatch base, and the worker is dispatched only after a stage lock is written and frozen for that entry, so the new lane is in a frozen plan. On a run that already opted in with `--sds`, the re-entry also writes a new SDS under that id — calling again with the same id makes `kiwi-sds` reuse the agreed SDS and write nothing new, so a new gap always gets a new id, and the same id is passed to `--sds-id` again only to continue an interrupted re-entry. Every unit id of a wave is recorded in the journal, and the close-out (PW-15 · PW-17) runs for each id that has an SDS.

---

## 4. Gates — what this contract raises

A gate declaration is per skill by construction. Both skills declare **every** row below in their own `critical_gates[]` — an undeclared halt falls to `business-decision`, and under `--auto` a committee waves it through.

| gate_id | predicate | where |
|---|---|---|
| `child-srs-needs-user-or-failed` | a `/kiwi-srs` or `/kiwi-srs-feasibility` the host called returned `NEEDS_USER`/`FAILED` | PW-1 |
| `child-pipeline-needs-user-or-failed` | a `/kiwi-sds` (under `--sds`), the host review hop, or an improvement-delegation `/kiwi-review-fix-loop` the host called returned `NEEDS_USER`/`FAILED`, under `--sds` the union of the wave SDS files' `@req` sets differs from the node's requirement set (a requirement `kiwi-sds` left out of scope, `draft` among them), or the worker's own review came back halted or with kept findings in `review_outcome` | PW-2 · PW-8 · PW-12 · PW-13 |
| `requirement-not-ready` | after PW-4's raise, `schedule waves` still refused over a requirement of the node (missing, `draft`, `deprecated`, `discarded`) — the wave stops before dispatch | PW-4 |
| `schedule-cycle` | `schedule waves` refused over a dependency cycle | PW-4 |
| `files-not-grounded` | `schedule waves` judged a path of `files[]` (and, under `--sds`, of the SDS Files) a typo of an existing path | PW-4 |
| `lane-plan-drift` | on resume, the plan recomputed from the lock's recorded inputs (declaration-entry digests, and SDS digests if any) differs from the lock | resume |
| `worker-touched-srs` | `git status --porcelain docs/spec docs/sds` differs before and after a dispatch | PW-8 |
| `lane-worker-possibly-live` | a worker worktree is reported `locked`, so that worker may still be live — it is not dispatched again (FR-FLOW-118). `--auto` does not decide it — `NEEDS_USER` | PW-5 · §6 |
| `serial-unit-failed` | the worker verdict still fails after one retry of the same unit, no commit and no `intentionally_empty` reason, or the worker's `/kiwi-pm` returned `NEEDS_USER`/`FAILED` | PW-8 · PW-9 |
| `lane-design-refuted` | a worker manifest came back with `status: design-refuted` | PW-8 |
| `srs-mutation-replay-failed` | `orchestrate replay apply` refused the replay or recorded a failure | PW-10 |
| `post-merge-index-drift` | `validate --fail-on-warning` still reports drift after `sync_index` | PW-10 |
| `cross-lane-duplication-unresolved` | a `duplicate` verdict of the duplication audit was not resolved as an issue of that wave | PW-12 |
| `test-sufficiency-gap` | the test-sufficiency check leaves a gap after its one fill (`test-sufficiency.md`) | PW-14 · end |
| `integration-test-user-consent` · `cost-warning-large-task` | the worker's `kiwi-coder` consent and cost gates — they stop even under `--auto` unless `--auto-integration` · `--auto-cost-warning` are explicit | worker |

The partition review's `partition-review-unrecorded` is `business-decision` — a wrong partition is recovered by the post-merge verdict and a serial re-run, so it does not stop an `--auto` run.

---

## 5. The order of one stage

**PW-1 · Incremental SRS authoring — host, once per stage, serially.** A stage never authors the SRS from scratch. Gathering the `srs_deltas[]` of the stage's workers and applying them through the one call of `wave-srs-registration.md §2` is all this step does, and it runs after PW-10's replay and before PW-13's verification. **This never runs in parallel** (the four races of §1). With no delta, it is skipped.

**PW-2 · SDS authoring — only under `--sds`, independent subagents, one per wave, in parallel.** Without `--sds` this step is skipped — the wave is implemented from its entry's `requirements[]`. They write different files and no SRS, so parallel is safe. Under `--serial`, one at a time.

```
Skill({ skill: "kiwi-sds", args: "TARGET=<product target> --req-filter <the node's requirement set> --sds-id {run_id}-wave-{n}
        --convergence-registry <convergence registry path> --existing-modules {artifact_root}existing-modules.json --no-pipeline-emit [--auto] [--max] [--mini|--loops N] [--model <name>]" })
```

`--existing-modules` is the per-node `existing_modules` map the decomposition wrote (`wave-decomposition.md §1`); `kiwi-sds` writes the Interfaces against it, so the layer that creates a change sees the structure the verification layer holds it to. `kiwi-sds` raises the SDS to `agreed` itself once `speckiwi sds check` passes. The host collects the requirement IDs of the `sds check --json` summary of every SDS file of the wave and checks that the union is not empty and equals the node's requirement set (`orchestrate wave show`). A requirement outside it, or a node requirement missing from it (one `kiwi-sds` left out of scope, `draft` among them — it would stay in the promotion set with no code and no test), halts at `child-pipeline-needs-user-or-failed`. The SDS files are listed in the node's `sds` in k order.

**PW-3 · Input commit — host.** For each wave, the host commits that wave's SRS changes, the declaration file (its SDS too under `--sds`) and the caller's wave inputs with an explicit pathspec (`commit-wave-inputs`, trailers `Orch-Run` · `Orch-Verb` · `Orch-Wave`). **That commit's sha is the wave's dispatch base**, recorded in the journal's `isolation.base_sha`, and — by a caller that writes a resume card (`kiwi-orchestrator`, `run-ledger.md §1`) — in the card's `open[].base_sha`. It never uses `git add -A` or `git commit -a`.

**PW-4 · Freeze and publish the stage plan — host.** Before writing the lock, the host raises every `draft` requirement of the ready nodes (`ready[]` of `wave status`) — the `requirement-draft` warning of `orchestrate wave check` names them — with `Skill({ skill: "kiwi-srs-feasibility", args: "--req-filter <those draft requirements> [--auto] [--max] [--mini|--loops N]" })`. A requirement still `draft` after that is refused by `orchestrate schedule waves` as `requirement-not-ready`, and that node stops before any worker is dispatched. Before `orchestrate schedule waves` the host runs `speckiwi orchestrate wave check --waves {artifact_root}waves/waves.json --run-id {run_id} --json` — any error diagnostic stops the host before it writes a lock (fix the graph and check again). The host then writes the lock with §3's command, commits it with an explicit pathspec (`commit-run-artifacts`), then freezes it with `orchestrate freeze lanes --body <that lock> --document <that lock> --head <that commit's sha> --run-id {run_id} --out {artifact_root}waves/stage-{s}/lanes.freeze.json` (`freeze-lane-plan`) — the freeze pins the committed document as a git blob, so the commit comes first. It publishes the lock and `{artifact_root}waves/stage-{s}/partition.md` and records the `review-partition` result.

**PW-5 · Dispatch — workers, every wave of the stage at once.** Right before each dispatch the host runs `orchestrate wave check` again and dispatches only when it reports no error diagnostic — the graph may have changed since the lock was written. At the same point the host commits every `docs/spec` · `docs/sds` change it made, so both paths are clean, and records that `git status --porcelain docs/spec docs/sds` at the run root is empty — it does not dispatch otherwise, because a second edit to an already modified file leaves the same status line and would be invisible to the comparison. A worker's input is a file, `{artifact_root}waves/stage-{s}/{laneId}.dispatch.json`, not the conversation — subagent returns have come back empty repeatedly. The card carries `run_id` · `wave` · the unit id `{run_id}-wave-{n}` · `stage` · `laneId` · `target` (the product target) · the node's requirement set · under `--sds`, `sds_paths` (the lock's `sds` value for that lane, in the order of the entry's `sds[]`) · `base_sha` · the branch `kiwi/orch/{run_id}/{laneId}` · `write_set` (the lock's `writeSet` for that lane) · `verification_cmd` · the regression-baseline pin · the queue and manifest paths · the forbidden list · the propagated flags (`--auto` `--max` `--mini`/`--loops N` `--model` `--auto-integration` `--auto-cost-warning` `--drive` `--skip-clean-code` `--keep-clean-code`). Where the runtime allows it, the host spawns an `Agent` with worktree isolation (`dispatch-lane`).

When `git worktree list --porcelain` reports the lane as `locked … (pid N)`, its worker may still be live (FR-FLOW-118 forbids re-dispatching a worker that may still be live): the run does not re-dispatch that lane and does not run `git worktree unlock` on it, and halts at critical gate `lane-worker-possibly-live`, which `--auto` does not decide (`NEEDS_USER`). The report names the worktree path, pid N and a liveness hint (`tasklist /FI "PID eq N"` on Windows, `kill -0 N` on POSIX), with the caveat that which process pid N is has not been established and that a WSL or other-namespace pid can look dead. Re-dispatching or unlocking happens only on the user's answer.

**PW-6 · What a worker does.** In this order.

1. Lane-branch preparation follows `worktree-lane.md` §2 — its ancestor test decides whether to attach or to recreate at `<base_sha>`. Never trust the default HEAD of a worktree the runtime created.
2. `npm ci --include=dev --ignore-scripts`.
3. `speckiwi orchestrate preflight --json --mcp-root <path> --git-root <worktree> --role lane --lane-id {laneId} --lane-plan <run root>/{artifact_root}waves/stage-{s}/lanes.lock.json` — the lock is committed after the dispatch base, so the worktree does not hold it; `--lane-plan` is therefore the **absolute path** at the host run root, carried by the dispatch card. On a non-zero exit, do nothing, write only the reason to the manifest, and return.
4. Implementation — Implement the node's requirements one at a time, in the order requirement IDs first occur in the node's `acs` as `orchestrate wave show` gives them — one `/kiwi-pm` call per requirement:

   ```
   /kiwi-pm --req-filter <one requirement> --run-id {run_id}-wave-{n}[-r{m}]-<lower-case requirement ID> --session-suffix w{n}s{s}l{k} --no-final --no-pipeline-emit --commit-lane-work --defer-srs-mutation <queue path>
            [--sds <that fragment>] [--resume] [--auto] [--max] [--model <name>] [--mini|--loops N] [--regression-baseline <P.4 pin>] [--auto-integration] [--auto-cost-warning] [--force] [--drive]
   ```

   The run id differs per requirement — the unit id followed by that requirement ID in lower case, so each requirement gets its own `kiwi-pm` session, and the next requirement starts only after the previous requirement's `/kiwi-pm` ended `TASK_DONE`. Under `--sds`, also give the fragment whose `@req` holds that requirement as `--sds <that fragment>` — the worker finds it through the requirement IDs of `sds check --json` for each file of `sds_paths`. `{k}` is the lane's 1-based position in its stage's `laneIds`. The last four pass-throughs are carried only when the caller received them from the user. `--commit-lane-work` makes a test commit and an implementation commit per requirement (`kiwi-pm` §1.5) — without it, `kiwi-pm` commits nothing and the host has nothing to merge. The commits carry the `Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` and `REQ` · `Commit-Kind` trailers and no phase marker in the subject.

   **When one requirement fails, the node stops.** When that requirement's `/kiwi-pm` ends `NEEDS_USER` · `FAILED`, the worker runs no later requirement, skips steps 5 and 6, and writes the step-7 manifest and returns — a later requirement may build on the failed one. The manifest lists in `requirements` the landed requirements (`landed`), the failed one (`failed`) and the later ones it did not run (`held`).
5. Review its own window — without `--close-reqs`:

   ```
   Skill({ skill: "kiwi-review-fix-loop", args: "--base <base_sha> --head HEAD --req-filter <the node's requirement set>
           [--sds <sds_path>] --no-pipeline-emit [--auto] [--max] [--mini|--loops N] [--skip-clean-code | --keep-clean-code]" })
   ```

   Fixes are committed with the write-set pathspec. The review runs once, after the last requirement, over the worker's whole window — whatever the requirement and fragment count. `--sds` is passed only on an `--sds` run with a single SDS file. When the caller recorded a confirmed clean-code skip in its run state, the dispatch card's propagated flags carry `--skip-clean-code`, and when it recorded that the check is kept they carry `--keep-clean-code`; the worker adds that flag to the args above — the worker never sees the user's request, so it neither judges a speed signal itself nor asks, and without `--skip-clean-code` it runs the clean-code rounds (`kiwi-review-fix-loop` 클린 코드 라운드 block).
6. The test-sufficiency check does not run a second time — the review above received its scope through `--req-filter` (and `--sds` under `--sds`), so its last phase is this check over the wave scope (`test-sufficiency.md`). On an `--sds` run with a split SDS, after the review the worker runs `test-sufficiency.md` once per fragment with that fragment's `Requirements` IDs and `--sds <that fragment>`. The check reads **the worker's worktree** — the worktree rule of `test-sufficiency.md` §3 step 1. The result goes into the manifest's `test_sufficiency`.
7. Write the manifest and return: `{branch, head_sha, commits[], requirements, deferred_queue, reports[], red_evidence[], review_outcome, intentionally_empty, design_refuted[], srs_deltas[], out_of_lease_paths[], test_sufficiency}`. `requirements` is `{landed[], failed, held[]}` (step 4). `review_outcome` is the step-5 review's return (`TASK_DONE` · `NEEDS_USER` · `FAILED`) and the number of kept findings it left. For a wave whose `/kiwi-pm` made no commit, the worker writes the `intentionally_empty` declaration — `{sds_id, reason}`, reason at least 20 characters — into that `/kiwi-pm` run's `docs/analysis/kiwi-pm-…` bundle as `intentionally-empty.json` and carries the same value in the manifest. The host judges from the harvested copy of the bundle. `red_evidence[]` holds the red phase's **expected-failure signatures** — one `{test_id, failure}` per test that failed before implementation (the test identifier and a summary of its failure message). Each requirement's test commit precedes its implementation commit, so test-first also shows in git — the host checks that order beside this field at PW-8.
   Each `srs_deltas[]` entry is a requirement the worker found missing or wrong — `{kind, about, prd_item, evidence {test_id, failure}, files, summary}`, with `kind` one of `new-requirement` · `ac-change` · `residual`. Reporting a delta does not stop the worker, which carries on with the wave, and the worker writes nothing under `docs/spec`. The host applies the deltas at PW-1.

What a worker never does: call an SRS mutation tool, write `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl`, pass `--root`, merge or push, call `/kiwi-sds`, weaken an existing test.

**PW-7 · Join — host.** The host waits for every worker of the stage and reads the result from the manifest file, not from the return value. It harvests into `{artifact_root}waves/stage-{s}/{laneId}/` (`collect-lane`) — the queue and the manifest, and the evidence that lives only in the worktree and is never committed: the worker `kiwi-pm` session's `.kiwi/sessions/…` (worklog · `pm-state.json`), the `docs/analysis/kiwi-pm-…` bundle, and the analysis directory of the worker's review. Later steps (PW-8's `intentionally_empty` judgement, PW-13's evidence bundle, PW-16's evidence detail) read the harvested copies — the worktree is released at PW-11.

**PW-8 · Verdict — host, per worker.** A worker's green is not the verdict (`worktree-lane.md §5`). The host checks (`verify-lane`):

```
base..head has at least one commit                  (or an admissible intentionally_empty)
the manifest's red_evidence[] is not empty          (waived for intentionally_empty)
review_outcome is TASK_DONE with 0 kept findings
for each landed requirement, its test commit is an ancestor of its implementation commit   (`REQ` · `Commit-Kind` trailers)
the manifest's requirements.failed is empty
base is an ancestor of head
changed paths ⊆ the lane write set (the lock's `writeSet`)  (edits outside it: judged by the rule below)
changed paths ∩ (docs/spec/ ∪ docs/sds/) = ∅
the host runs verification_cmd once in the worktree itself and it passes (§0)
git status --porcelain docs/spec docs/sds at the run root equals the pre-dispatch record
```

When the last line differs, the run stops at `worker-touched-srs` — an MCP write that omitted `workspaceRoot` lands silently at the host, and this comparison is the one mechanism that catches that path. A manifest carrying `design-refuted` is `lane-design-refuted`. A `review_outcome` of `NEEDS_USER` · `FAILED`, or kept findings left, halts at `child-pipeline-needs-user-or-failed` — a child's halt stops the parent (each skill's §0.4). A failed verdict re-spawns a fresh worker **once** for the same unit and the same base (`remediate-lane`); Preparing the retry branch `…/{laneId}-r2` follows `worktree-lane.md` §2, and that worker resumes at the failed requirement through §6's resume cursor. A second failure is `serial-unit-failed`. An edit outside the write set is recorded and accepted when no other worker of the stage touched that path; otherwise that wave re-runs alone on the new base after PW-9.

**PW-9 · Merge — host, in wave order.** The host merges every branch that passed its verdict into the integration branch with `--no-ff` (`integrate-lane`). A merge conflict, or a new failure in the full regression after the merge, re-runs that wave alone once on the new base. A second failure is `serial-unit-failed`. Git catches textual conflicts; the post-merge regression catches semantic ones — green apart, red together.

**PW-10 · Replay — at the host root.** `orchestrate replay plan` plans the harvested queues and `orchestrate replay apply --plan <path> --applied kiwi/orchestrator/{run_id}/replay-applied.jsonl --frozen-target <product target>` applies them (`replay-deferred-mutations`). A refusal or a recorded failure is `srs-mutation-replay-failed`. Once the replay is done, PW-1's incremental authoring runs before PW-13 (`wave-srs-registration.md §2`).

**PW-11 · Release — host, only after the harvest.** `git worktree remove` returns the worker's worktree (`release-lane`). Releasing before the harvest evaporates the ignored artifacts inside it. If the release fails: on `Permission denied`, end the processes whose working directory is inside the lane (shell, vitest, editor), then retry. On `is not a working tree`, the worktree was half-removed on Windows: delete the leftover directory and run `git worktree prune`. A failure that persists is recorded in the run report and does not halt the run. A `locked` worktree goes through the `lane-worker-possibly-live` procedure first, and `git worktree remove -f -f` is never used without the user's decision.

**PW-12 · Stage close — host.** (1) The host handles the convergence registry's `regenerate` · `orchestrator-only` paths by their recipes. (2) The duplication audit compares the waves merged in the same stage with each other and with the pre-merge base; a `duplicate` verdict is opened as an issue of that wave and resolved, and an unresolved one is `cross-lane-duplication-unresolved`. (3) Once every merge and replay of the stage is done, `validate` → `sync-index` → `validate --fail-on-warning` run once, and surviving drift is `post-merge-index-drift`. (4) **The host code review reviews only the commits the host made after the merge** — each worker already reviewed its own window:

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base <last merge commit> --head <host tip> --no-pipeline-emit
        [--auto] [--max] [--mini|--loops N] [--skip-clean-code | --keep-clean-code]" })
```

It passes neither `--commit-lane-work` nor `--close-reqs`. On a run whose caller recorded a confirmed clean-code skip, add `--skip-clean-code` to the args above, and on one whose caller recorded that the check is kept, add `--keep-clean-code` — as in PW-6 step 5. When the host made no commit the window is empty and the verdict is `not-applicable-empty-window`.

Before the call, `git diff --name-only <last merge commit>..<host tip>` is filtered through the file-class table of `kiwi-review-fix-loop` §11. When no code file remains — the host commits are only the `docs/spec/` · index · README · skill-mirror commits of convergence recipes, replay and index sync — the hop is not called and `no-host-code-commits` is written to the `notes` of the journal line that records the stage close and to the final report. That skill is code-only, so calling it would only halt at `empty-code-scope`. Each worker reviewed its own window, and the run-window final review sees the whole run. When at least one code file remains, the call above runs as written.

**PW-13 · Design-conformance verification — per wave.** The caller's verification step (the §0 table) compares the merged result with the SRS · the SDS, if any · the recorded decisions. Before any verifier is spawned, the host runs the machine checks first (`verify-loop.md §2`) — partition · PRD coverage · AC citations · test-first order · preservation · regression. The verifier's input is the facts `verify-loop.md §3` names and nothing else — the worker manifest, the worker's review report and the worker's test-sufficiency result are read by the host's machine checks, not passed to the verifier. The SDS is read before PW-17 deletes it. **When the result differs from the SRS · the SDS · a decision, an independent subagent that is not the original worker fixes it, and the host re-verifies.** The route is `verify-loop.md §7` — a code defect goes to `kiwi-review-fix-loop` with an explicit scope, an intent gap the requirements (and the SDS, if any) do not cover re-enters that wave (a fresh worker under §3's re-entry unit id, scoped with `--req-filter` — on a run that already opted in with `--sds`, also a new SDS from `kiwi-sds` under that id, with `--sds-id`). The input is facts only — the original requirements, the diff, the SDS if any.

**PW-14 · Test sufficiency — host, immediately before promotion.** `test-sufficiency.md` runs over the wave scope (the node's requirement set) — for a wave that has SDS files, once per SDS file of the wave with that file as `--sds`. A remaining gap is `test-sufficiency-gap`.

**PW-15 · SDS close-out, moving — host, only for a wave that has SDS files (`--sds`).** `Skill({ skill: "kiwi-sds", args: "--close {run_id}-wave-{n} --no-pipeline-emit [--auto]" })` — once per sds-id of the wave, re-entry ids included. It moves each SDS-AC interpretation decision into the SRS as a clarification of that AC and raises only rules marked durable as constraint requirements.

**PW-16 · Promotion — host, one wave at a time.** Only a wave whose design-conformance verification is `pass` is promoted. The promotion set is the landed requirements only — those of the manifest's `requirements.landed` whose implementation commit is on the integration branch; a `failed` or `held` requirement is not in it. Landed means the requirement's implementation commit (the `REQ` · `Commit-Kind: implementation` trailers with the wave's `Orch-Wave` · `Orch-Lane` trailers) is on the integration branch and `verification_cmd` passed, or the wave's admissible `intentionally_empty` declaration (then the node's whole requirement set). The transition has two steps — landed moves `planned`/`in_progress` → `implemented`, and a `pass` with no residual naming the requirement moves `implemented` → `verified`. The evidence is `type="test"` and `type="commit"`. `type="test"` is one row per AC as `test-sufficiency.md` §4 states — its reference is `verification_cmd`, `covers` is that AC, and the notes carry the citation PW-14 returned for that AC and the path of the harvested worker `docs/analysis/kiwi-pm-…` bundle. `type="commit"` is the sha of each of the wave's trailered commits; a wave landed by `intentionally_empty` carries test evidence only. A requirement that did not land stays at its current status. `add_completed_work` is the host's too. `kiwi-orchestrator` states the same rule in its own §14.

**PW-17 · SDS close-out, deletion — host, only for a wave that has SDS files (`--sds`).** The same `kiwi-sds --close` runs once more. When every `@req` requirement is `verified` or `discarded`, the SDS file is deleted and the close-out commit carries the deletion. Git history keeps the file. A closed SDS is never read as the current design — the current design is the code.

The caller then records the wave's `complete`, carrying in `done_when_confirmed` the DW ids the host confirmed, and runs §5.1's completion actions. The next stage recomputes the ready set and starts again at PW-1.

### 5.1 Completion actions — after a node's `complete`, host only

Workers never write the journal, so completion actions are the host's alone. The host never picks actions by hand — it runs only the `due` actions `speckiwi orchestrate wave actions --waves {artifact_root}waves/waves.json --run-id {run_id} --json` returns.

1. Then, for each `due` action, append the intent line the tool gave through `orchestrate journal append`, perform the action, then append its result line. the verb is `node-complete-action`, and the result line's `result` is one of `sent` · `failed` · `waived`.
2. A `notify` is sent by resolving its channel alias to an address through the user's global agent instructions; an alias with no address there is recorded `failed` with that reason in `error`, and no address is guessed.
3. A failed action with `blocking: false` does not stop the run and is listed in the final report; while an action with `blocking: true` is `failed`, the run is not reported complete.
4. An `interrupted` action is not re-sent automatically and is reported to the user — an intent with no result cannot say whether it was sent, and sending it again may send it twice.

---

## 6. Resume

- A caller that writes a resume card (`kiwi-orchestrator`) holds the current stage's waves in progress in `open[]`, one entry per lane. A caller without a card (`kiwi-wave-master`) reads the same facts with `speckiwi orchestrate wave status --waves {artifact_root}waves/waves.json --run-id {run_id} --json` — the tool reports each wave's latest `status` · `phase` · `sds_id` · `stage` · `lane` · `base_sha` and the `ready[]` set. Journal lines are never read by hand.
- When `git worktree list --porcelain` reports the lane as `locked … (pid N)`, its worker may still be live (FR-FLOW-118 forbids re-dispatching a worker that may still be live): the run does not re-dispatch that lane and does not run `git worktree unlock` on it, and halts at critical gate `lane-worker-possibly-live`, which `--auto` does not decide (`NEEDS_USER`). The report names the worktree path, pid N and a liveness hint (`tasklist /FI "PID eq N"` on Windows, `kill -0 N` on POSIX), with the caveat that which process pid N is has not been established and that a WSL or other-namespace pid can look dead. Re-dispatching or unlocking happens only on the user's answer.
- **A leftover git `index.lock`**: when a git command is refused because `.git/index.lock` remains, delete that file only after confirming no git process is running — `tasklist /FI "IMAGENAME eq git.exe"` on Windows, `pgrep -x git` on POSIX. If one is running, wait and retry. Git inside WSL is invisible to Windows `tasklist`, so ask the user when WSL may be in use.
- When a manifest exists, the run continues from PW-7. The worker's resume cursor is its requirement-ID trailer commits (`<base_sha>` is that wave's latest dispatch base: a caller that writes the resume card reads it from `open[].base_sha`, a caller without a card (`kiwi-wave-master`) from the node row's `base_sha` in the `wave status` output above — the `isolation.base_sha` of that node's latest dispatch line) — a requirement whose commit carrying the `REQ: <requirement ID>` and `Commit-Kind: implementation` trailers lies in the range `<base_sha>..<lane branch>` is done and does not run again (commits outside that range — those of an earlier, already merged dispatch — do not count); a requirement with only its test commit resumes at its implementation — `--resume` is passed when that requirement's `pm-state.json` exists; then the worker continues with the next requirement. A requirement whose implementation commit of that lane already lies in `<base_sha>..<integration branch>` does not run again either.
- The lock's declaration-entry digests and, if any, SDS digests are measured again — `orchestrate resume` collects the facts itself and compares them (`run-ledger.md §4`). A split wave's `sds_digests` holds one digest per file, so each file is compared. A wave the close-out already touched — its SDS Status is `closed` or the file is deleted (PW-15 · PW-17) — is not compared and is passed as a closed-out wave. Any other wave whose digest changed is `lane-plan-drift`.
