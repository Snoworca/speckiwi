# worktree-lane — how a run creates a worktree and works inside it — SSOT v1.0.0 (etc Kiwi skills)

Shared by `kiwi-orchestrator` and `kiwi-wave-master`. Neither restates this procedure; both name this
file in their §0. Read together with `local-llm-profile.md`: multi-worker fanout is disabled here, so a
run holds **one lane workspace at a time** and the parallelism this contract permits is not taken. Every
other rule below is **identical** to the claude/codex variants — the lease, the gate, the replay
admission and the teardown order do not change when lanes run one at a time. One responsibility split across two documents is the failure where one copy gets
corrected and the other silently diverges.

Governing requirements: `FR-FLOW-122` (this contract), `FR-NODE-186` (topology and the role gate),
`FR-NODE-185` (replay admission and checkpointing), `FR-FLOW-121` (`--defer-srs-mutation`), `FR-FLOW-188`
(one worker per wave).

**A lane is one wave's worker.** The lane of this contract is the one worker `parallel-waves.md`
dispatches for a wave; a wave is never split into further lanes. A lane's `write_set` is the `writeSet` the
stage lanes lock records for it — not the wave SDS write set (under `--sds` the lock records the union of
the entry's `files[]` and the SDS Files ∪ Test Plan test files). When a lane is created and who judges and merges
it is ordered by `parallel-waves.md`; this document owns the boundaries one lane must keep.

---

## 1. Two roots — name them apart first

| Name | What it is | What it owns |
|---|---|---|
| **run root** | the host checkout the MCP workspace is bound to | Requirement ID allocation, **every SRS mutation**, index roll-up, `waves.jsonl`, the run lock |
| **lane workspace** | a git worktree the run gave one wave's worker | code and test edits, and commits on its own branch — nothing else |

**The MCP root cannot move mid-session.** It is bound to the server process's working directory and
there is no restart facility. So this design does not move the session into the worktree: the host
stays put and reaches into the lane with `--root`. The direction is host → lane, one way.

That is an asset rather than a restriction: the MCP surface has no way to address a lane at all, so a
lane holding an MCP handle still cannot touch its own worktree through it.

---

## 2. Creating one — never trust the default head

**This section alone owns lane-branch preparation.** `parallel-waves.md` PW-6 step 1 and the PW-8 retry, and the worktree procedures of `kiwi-orchestrator` and `kiwi-wave-master`, do not write the commands again; they follow this section. `<branch>` is the lane branch `kiwi/orch/{run_id}/{laneId}`.

Every case starts with the **ancestor test** — `git merge-base --is-ancestor` exits 0 when the lane branch exists and this `<base_sha>` is its ancestor. On 0 it is a resume after an interruption, or a PW-8 retry, so **attach and leave the branch where it is**. Otherwise — no lane branch, or `<base_sha>` is not its ancestor (a first dispatch, or a re-entry `r{m}`) — **create or recreate the branch at `<base_sha>`** (case 3 at the failed lane branch's tip). A first dispatch and its re-entry share the lane id, so an existing branch alone does not mean a resume. On an attached branch, the `REQ` · `Commit-Kind` trailer commits in `<base_sha>..` are `parallel-waves.md §6`'s resume cursor.

1. **The host creates the worktree.**
   - Test: `git merge-base --is-ancestor <base_sha> <branch>`
   - Attach: `git worktree add <lane-root> <branch>`
   - Create or recreate: `git worktree add <lane-root> -B <branch> <base_sha>`
2. **A runtime handed you the worktree already made** — a single command is not possible.
   - Test: `git -C <lane-root> merge-base --is-ancestor <base_sha> <branch>`
   - Attach: `git -C <lane-root> switch -C <branch> <branch>` leaves the branch where it is.
   - Create or recreate: `git -C <lane-root> switch -C <branch> <base_sha>`
3. **The retry branch** (a PW-8 verdict retry, or a PW-9 merge retry) — `<branch>-r2` starts at the tip of the failed lane branch, not at the base: made at the base, it holds no trailer commit for the resume cursor to read.
   - Test: `git merge-base --is-ancestor <base_sha> <branch>-r2`
   - Attach: leave the existing `<branch>-r2` where it is (the retry worker resuming after an interruption).
   - Create or recreate: `git branch -f <branch>-r2 <branch>` — at the failed lane branch's tip. A PW-8 verdict retry runs on the same `<base_sha>`, so that tip has the base as its ancestor: the retry worker, taking `<branch>-r2` as its lane branch, attaches through the test of case 1 or 2 and resumes at the failed requirement through `parallel-waves.md §6`'s resume cursor. A merge-conflict or post-merge-regression retry (PW-9) runs on a new base, which is not that tip's ancestor, so the test of case 1 or 2 recreates `<branch>-r2` at the new base.

Either way HEAD stays ATTACHED to the branch. `checkout <sha>` is never the answer.

**Pass the base as the third argument — never split this into two commands.** `add -b BR` followed by a
separate `checkout <base_sha>` creates the branch at the current tip and then DETACHES HEAD from it.
The lane's commits pile up on a detached HEAD while the branch stays put — reproduced. The "commits on
its own branch" that §1 lists as the lane's property then do not exist, §5's `base..head` check reads
zero for a lane that did work, and removing the worktree leaves those commits unreferenced.

**Naming the base is itself not optional.** Measured: a runtime-created worktree opened at
`origin/<default-branch>`, **114 commits behind** the branch under work. A diff produced on that base
**merges cleanly**, so nothing afterwards reveals that months-old code was edited.

A worktree shares the object database, so it can move to a commit created **after** the worktree
existed — confirmed by measurement. That is what makes "start on the integration tip the earlier waves merged into"
mechanically possible.

**Bootstrap** finishes before any code work — when the host creates the worktree, before it puts an agent
into the lane; when the runtime creates the worktree together with the worker, as the worker's first action:

```
npm ci --include=dev --ignore-scripts
```

`--include=dev` is load-bearing. Under `NODE_ENV=production` npm's effective config becomes
`omit=dev`, and `npm ci` then **silently omits devDependencies and exits 0**. The lane reports green
from a toolchain that has no test runner. `--include=dev` cancels that setting without depending on
shell syntax.

---

## 3. Three things a lane never does

1. **Never calls an SRS mutation.** It only records into the queue given by
   `--defer-srs-mutation <path>`. Recording is not skipping — the four mutations are still accounted
   for, and the host replays them.
2. **Never commits under `docs/spec/`**, nor under `docs/sds/`. A lane's commits are confined to its own
   `write_set` pathspec.
3. **Never passes `--root`.** The moment `--root` appears it is an orchestrator operation, not lane
   work.

All three are checkable by the host **without the lane's self-report** — the commit range over the
shared object database is enough.

---

## 4. The gate — is the difference planned?

The run-root check does not ask whether two roots are equal. It asks whether their **difference
belongs to the frozen plan**. The `role` is **declared** by the caller, and the tool corroborates that
declaration against the repository itself.

| role | passes when |
|---|---|
| `host` | the two roots agree and that root is **not** a linked worktree |
| `lane` | the git common dir matches the host's, the top level differs, the common dir has it
**registered**, `lane_id` is in the frozen lane plan, and that lane's `write_set` touches no
`docs/spec/` path |

The discriminator is the **git common directory**: every linked worktree of one repository reports the
same one while reporting a different top level, and the caller chooses neither value.

Why `role` is not inferred: "these roots differ but share a common dir, so this must be a lane" is
satisfied by **any** worktree of the repository, including one the run never planned. Membership in the
plan is the part the caller did not choose.

---

## 5. The verdict — a lane's green is not the verdict

A lane running its own `verification_cmd` is a fast-failure device. **The verdict comes from the
host**, which sets its working directory to the lane workspace and runs the same verification command
once itself.

The reason is the trap in §2. A lane missing devDependencies believes it is green. Running it from the
host exposes that immediately.

What the host confirms from the commit range:

```
base..head commit count is non-zero        (something happened)
base is an ancestor of head                (it happened on the right baseline)
changed paths  ⊆ write_set                 (it happened inside the lease)
changed paths  ∩ (docs/spec/ ∪ docs/sds/) = empty   (SRS and SDS were left alone)
```

---

## 6. Replay — only what is admitted, only once

The host plans the harvested queue (`orchestrate replay plan`) and applies **only what is admitted** (`orchestrate replay apply`).

The admitted set is the four of `kiwi-coder §0.12`, and it is a **module constant** — an allowlist a
call site can widen is not an allowlist.

```
add_trace_link · add_verification_evidence · update_status · add_completed_work
```

Any other tool name is refused as `tool-not-deferrable`. A call carrying a target other than the frozen
one is refused as `target-not-frozen`. **The queue is written by the lane** — not trusting the queue is
the defence; trusting where the queue sits is not.

`add_completed_work` and `add_verification_evidence` append, so resuming an interrupted run naively
duplicates rows. Remaining calls are reduced from an **append-only record**, one line per attempt. A
call the record shows failed is reported as failed and is not silently retried — retrying is a decision
for the caller to make with the failure in hand.

---

## 7. Teardown

**Never reap before harvest.** Removing the worktree evaporates the gitignored artefacts inside it. The
order is always harvest → verify → integrate → release.

When `git worktree list --porcelain` reports the lane as `locked … (pid N)`, its worker may still be live (FR-FLOW-118 forbids re-dispatching a worker that may still be live): the run does not re-dispatch that lane and does not run `git worktree unlock` on it, and halts at critical gate `lane-worker-possibly-live`, which `--auto` does not decide (`NEEDS_USER`). The report names the worktree path, pid N and a liveness hint (`tasklist /FI "PID eq N"` on Windows, `kill -0 N` on POSIX), with the caveat that which process pid N is has not been established and that a WSL or other-namespace pid can look dead. Re-dispatching or unlocking happens only on the user's answer.
Unlike a session name, a worktree is a disk artefact and therefore survives
resumption — that is a side benefit of coordinating this way.
