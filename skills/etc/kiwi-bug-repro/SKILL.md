---
name: kiwi-bug-repro
description: "Confirms and reproduces a reported bug before anything is fixed. Reads the issue or description the user provides as given and records the symptom, expected behaviour, actual behaviour and reported steps; infers candidate causes by static analysis, each with file:line evidence and a confidence, before running anything; then reproduces from the smallest scope outward — a smallest-scope automated test first, more causes at module or integration scope only when that fails, and finally the product built and run in an isolated temporary copy with credentials removed — and never goes past that third stage. It ends with a failing reproduction test that matches the symptom, a reproduction without an automated test (script and observation), a 'not a bug' verdict (a requirement change goes to kiwi-srs), or a question to the user. It never changes product code and never loses the user's work. kiwi-hot-fix and kiwi-orchestrator call it first when they receive a bug. (opencode / hermes mirror). Triggers — kiwi bug repro, reproduce bug, confirm bug, is this a bug, write a reproduction test, 버그 재현, use the kiwi-bug-repro skill. Options — --analysis-only, --no-pipeline-emit, --auto, --max, --mini / --loops N, --model."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-bug-repro v0.1

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, and uses one delegated worker/evaluator at a time.

Confirm that a reported bug is real and **reproduce it before anything is fixed.** The run returns one of four things: a test that fails for the same reason as the reported symptom, a reproduction that could not be turned into an automated test (a reproduction script and the recorded observation), a "not a bug" verdict because the behaviour is what the specification says, or a question asking for what the reproduction lacks. It never fixes anything — that belongs to the caller (`kiwi-hot-fix`, `kiwi-orchestrator`) or the user.

Backing requirement: FR-FLOW-199. The callers' side is FR-FLOW-200 (`kiwi-orchestrator`) and FR-FLOW-201 (`kiwi-hot-fix`).

## Official Workflow Tool Policy

The normal path for recording the closing event is MCP `workflow_pipeline_emit`. Appending to the file by hand is allowed only in degraded mode, and must record capturing tool diagnostics, affected artifact paths, active target, and follow-up requirement or candidate ID in the user report and the event `notes`.

---

## 0. Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | **This skill does not change product code and never loses the user's work.** Even when the cause is found, it is not fixed here. Before an attempt edits an existing file, save that file's bytes under `saved/` in the report directory, and restore those bytes when the attempt is abandoned. This skill deletes only files it created. Record the files each attempt touched (created and edited), each with its hash after the attempt wrote it, as that attempt's entry in the report directory's `state.json`: the attempt first records the path before writing the file and records the hash after; for an existing file it also records whether that file was unchanged from HEAD before the edit (`git diff --quiet HEAD -- <path>`); an abandoned attempt marks the files it restored or deleted as undone in that entry. When the run ends, whatever its outcome, delete `saved/` and record the run as finished in `state.json`. When a run starts, it first looks for earlier `kiwi-bug-repro` report directories whose `state.json` does not record the run as finished — such a run was interrupted — and for each one restores the saved bytes of the files not marked undone, deletes the files it created that are not marked undone (one already gone needs nothing) and records it as finished. An entry with no hash yet was cut off mid-write: when its edited file equals the bytes in `saved/`, or its created file does not exist, there is nothing to do; otherwise a cut-off write cannot be told from the user's edit, so do not restore or delete it; stop and ask (`repro-restore-conflict`, under `--auto` as well). A file whose current hash differs from the hash recorded for it was changed after that run touched it: do not restore or delete it; stop and ask the user (`repro-restore-conflict`, under `--auto` as well). When the caller passes the user's answer in (for each such file: keep it as it is now, or undo it, restoring an edited file from `saved/` and deleting a created one), apply it, then record that run as finished. Stop and ask the same way when that run's `state.json` changed within the last hour, because the run may still be going in another session. When the user confirms that run has ended and the caller passes that answer in, the hour condition no longer applies to it. The only files this skill leaves in the repository are one reproduction test and the report directory (§5). Anything that needs product code changed to confirm — a diagnostic log line, say — is changed only in the temporary copy of §0.2. |
| §0.2 | **Build and run the product only in an isolated temporary copy.** Copy the repository's working files, without `.git`, into a new directory under the OS temporary directory: inside a git worktree `.git` points at the real repository, so git commands run in the copy would act on it; when the build needs git, run `git init` in the copy. Remove from that copy the files that carry credentials (`.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`, `application-local.*`, `appsettings.*.json`, `*.tfvars`, `.envrc`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`, `.docker/config.json`, private keys such as `id_rsa*`, and the like). In the run environment, unset the environment variables that carry credentials (database URLs such as `DATABASE_URL`, cloud credentials such as `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS` and `AZURE_*`, `KUBECONFIG`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`). Redirect every variable that points at a home or configuration directory (`HOME`, `USERPROFILE`, `XDG_CONFIG_HOME` and the like) into that temporary directory. A runtime that does not take its home from those variables gets the temporary home through its own setting: a JVM through `JAVA_TOOL_OPTIONS`, appending `-Duser.home=<that directory>` to any value already there. On a runtime that cannot be given a temporary home, the test does not run: stop and ask as §4.3 does. Stage 1 and stage 2 tests also run with the credential variables unset and the home and configuration variables pointed into a new temporary directory. Dependency caches stay at the real cache, so that dependencies already downloaded still resolve: point each tool's cache setting at its real path, also for a cache that would otherwise follow the home directory (`GOMODCACHE`, `npm_config_cache`, `PIP_CACHE_DIR`, NuGet's `NUGET_PACKAGES`, and Maven's `-Dmaven.repo.local` through `MAVEN_OPTS`); a tool home that also holds credentials (`GRADLE_USER_HOME`, `CARGO_HOME`) is not passed whole; only its cache directories (`caches/`, `wrapper/`, `registry/`, `git/`) are linked into the temporary home. When the repository holds any of the credential files above, stage 1 and stage 2 tests also run in such an isolated copy: the test is written in the repository and run in the copy, so a test that loads `.env` cannot reach a real service. Never run against real user data, a production service or the user's real home configuration. When the issue carries real data, do not use it as is; build an input that copies only the shape the reproduction needs. Delete the temporary directory when done. |
| §0.3 | **Static analysis comes first.** Until the cause list of §2 exists, no test, build or product run is started. |
| §0.4 | **A reproduction matches the symptom.** A failing test is a reproduction only when the failure is the reported symptom — the same error, the same wrong value, the same wrong behaviour. A failure from a compile error, a wrong import, broken setup code or a timeout is a defect of the test. |
| §0.5 | **There are three stages and no more** (§3). When stage 3 does not reproduce, stop and ask (§4.3). |
| §0.6 | **No AI signatures anywhere / no changelog section in this skill.** Tests and reports carry no AI identification. |
| §0.7 | **`--auto` option SSOT.** This skill follows `../_shared/kiwi/auto-option.md` v1.0. Its `critical_gates[]` are declared in §0.G. An unreadable or insufficient input and a failure to reproduce stop under `--auto` too — only the user holds the missing content, environment, version, input and steps. Any other question that needs a judgement (for example two equally fitting places for the reproduction test) is a business decision, which the decision committee settles under `--auto`. |
| §0.8 | **`--mini` / `--loops N` option SSOT.** Follows `../_shared/kiwi/loop-option.md` v1.0. This skill has no verify-improve loop, so both are the documented no-op of that file's §5 — they never change the per-stage attempt caps of §3. |
| §0.9 | **`--max` / `--model`.** `--max` adds one independent cause-analysis subagent to §2, and `--auto --max` makes the decision committee five. Stages and attempt caps are unchanged. Subagents inherit the current session model; `--model <name>` overrides it. The etc profile treats `--max` as its default, so that one subagent runs on every etc run, after the main analysis rather than beside it; it stays one pass. |
| §0.10 | **etc local-LLM profile SSOT.** This skill follows `../_shared/kiwi/local-llm-profile.md`: working `speckiwi mcp` is required, `--max` is always the default (§0.9 says what that runs here), and one delegated worker or evaluator runs at a time. |

### §0.G — `--auto` critical_gates[] declaration

Each gate below halts **regardless of** `--auto` for a user decision and is never handed to the decision committee.

| gate_id | reason | location |
|---|---|---|
| `repro-input-insufficient` | the issue cannot be read, or states neither the expected nor the actual behaviour — only the user knows what is wrong | §1 |
| `repro-not-reproduced` | stages 1 to 3 each used their attempt cap without reproducing the symptom — the missing environment, version, input data or steps are held only by the user | §4.3 |
| `repro-restore-conflict` | a file an interrupted earlier run touched has changed since — restoring or deleting it could destroy the user's edit, and only the user knows which version to keep | §0.1 |

---

## 1. Input

The input is an **issue the user provides** (a link, an issue key or pasted text, from any issue tracker) or a bug description in the user's own words. When a caller invokes this skill, it passes on the input it received unchanged.

1. Read the issue as the user gave it — for a link or key, that issue's body and comments; for pasted text, that text. When the issue cannot be read (permissions, no access), do not guess its content: stop and ask the user to paste it (`repro-input-insufficient`, under `--auto` as well).
2. Before any analysis, write `docs/analysis/kiwi-bug-repro-{run-id}/input.md` with: the **symptom**, the **expected behaviour**, the **actual behaviour**, the **reported steps**, the reported environment and version, and where the input came from. Write "not reported" for anything not reported; never invent it.
3. When both the expected and the actual behaviour are empty, nothing defines what is wrong, so do not analyse: stop and ask for those two (`repro-input-insufficient`, under `--auto` as well).

| Option | Meaning | Default |
|---|---|---|
| `--analysis-only` | record the input and run the static analysis only (end of §2) | off |
| `--no-pipeline-emit` | marks a run a caller invoked; no pipeline event is written (§5) | off |
| `--auto` · `--max` · `--mini` / `--loops N` · `--model <name>` | §0.7 · §0.9 · §0.8 · §0.9 | off (`--max` on, §0.10) / current session model |

**Run-id**: `{YYYY-MM-DD}.{project-slug}.repro-{HHMMSS}-{rand4}`, where `{rand4}` is four random lower-case hex characters; lower-case letters, digits, `.` and `-` only, and the slug is shortened when the id would pass 50 characters.

---

## 2. Static analysis — before running anything

Read the code and narrow down candidate causes before anything runs (§0.3).

1. Start from the symptom. Search the code for the error message, log text, command, UI text or function name to find the entry point, then read along the call path the reported steps take.
2. For each candidate cause, record: one sentence on what is wrong, evidence as `file:line` (at least one), a confidence (`high` / `medium` / `low`) with its reason, and the smallest unit (function, class, module) that must fail if this cause is right.
3. A candidate without `file:line` evidence does not enter the list — it is a guess.
4. Order the list by confidence. Within one confidence, put first the cause closer to the symptom (deeper on the call path).
5. Find the related requirements and contracts: the requirements and ACs that touch the symptom through MCP `search_requirements` and `get_requirement`, and the sentences in the README, docs or public API documentation that define this behaviour. They feed the judgement of §4.2 and the requirement cited in the reproduction test's title (§3). Search in both languages: put the words you would search for and their equivalents in the other language into the same query string (add English words to a Korean request; add Korean words to an English request or to a requirement you are writing in English).
6. Under `--max`, one independent subagent receives only `input.md` and the repository path and builds its own cause list by the same rules; it is not given the main list. Merge the two lists, drop duplicates and order again.

Write the result to `causes.md`. When no candidate has `file:line` evidence, skip stages 1 and 2 and go to stage 3 directly.

Under `--analysis-only` the run ends here and returns the ordered causes; it runs no stage and writes no test. The outcome is `analysis-only`.

---

## 3. Staged reproduction

The stages run in order — stage 1, stage 2, stage 3. **Move to the next stage only when the current stage has not reproduced the symptom within its attempt cap.** When a stage reproduces it, stop at that stage and go to §4.

- **One attempt** = writing one reproduction test (in stage 3, one product run), running it and recording the result. Fixing a defect of the test (§0.4) and running it again counts as one attempt. A test that cannot run because a dependency cannot be resolved (no network or registry access) is not an attempt and not a defect of the test: stop and ask for the environment as §4.3 does.
- Tests follow the repository's existing test conventions (location, naming, framework) and assert the symptom away — they assert the expected behaviour, so they fail today. When a requirement is related, cite `<REQ-ID> AC-<n>` on the test's title line (`../_shared/kiwi/test-sufficiency.md` §1). A test that replaces the suspected code with a mock is not a reproduction.
- Each attempt writes to a new test file. When the conventions require adding a case to an existing test file (a per-package test file, say), save its bytes first as §0.1 says. Never add a case to an existing file git does not track: it may hold the user's uncommitted work; write a new test file instead, or stop and ask when the conventions allow no new file.
- Record every attempt in `attempts.md`: stage, candidate cause, test file and name (or command), result and an output summary. A passing test is a record that this candidate was refuted for that input.
- An attempt that did not reproduce is abandoned as §0.1 says: the files it created are deleted and the files it edited are restored. The one test left in the repository is the one that reproduced.

### 3.1 Stage 1 — smallest scope

For the highest-confidence candidate, write an automated test at the smallest scope that calls the suspected code directly (one function or class). Use the reported input first; later attempts use boundary values or variants of the reported input. **Attempt cap 3.**

### 3.2 Stage 2 — more causes, wider scope

Take **at least two further causes** that stage 1 did not cover, in confidence order, and widen the scope to a module or integration test — real modules wired together and called close to the reported steps. When fewer than two untried candidates remain, first return to §2 and widen the search (callers, configuration, data, environment differences) for more candidates with evidence; if there are still none, record that in `attempts.md` and go on with the remaining candidates, or to stage 3 when none remain. **Attempt cap 6** (at most 3 per candidate).

### 3.3 Stage 3 — build and run the product

Build the product in the isolated temporary copy of §0.2 and run it end to end with the reported input and steps. The first attempt follows the reported steps exactly; later attempts change one reported environment difference at a time (version, configuration, OS, data size). When a run would need a production service, real user data, the real home configuration or a removed credential, do not run it; put what it needs into the question of §4.3. **Attempt cap 3.**

**This skill never goes past stage 3.** There is no stage 4 — when stage 3 does not reproduce within its attempt cap, go to §4.3.

---

## 4. Outcomes

### 4.1 Reproduced

The result is a **failing automated test that matches the reported symptom** (`reproduced`). Record that test's red output (failure message, expected and actual values of the assertion, the key lines of the stack) in `report.md` as it is. The most likely cause is the candidate the reproducing test targeted, with its `file:line`.

When only stage 3 (build and run) reproduced, turn that observation into an automated test — write the smallest-scope test that produces the observed failure by the rules of §3 and confirm it is red (at most 3 attempts for this). When that is impossible (for example a real screen interaction or specific hardware), keep the **reproduction script** and the recorded observation (command, input, actual output, expected output) in the report directory, and state in the report that **no automated test exists**. The reproduction script builds its own isolated temporary copy as §0.2 says and runs inside it; a caller that re-runs it follows the same rule. This outcome is `reproduced-no-test`, and no caller treats it as a failing test.

Even after reproducing, check §4.2 before settling the outcome.

### 4.2 Not a bug

When the reproduced behaviour is what an SRS requirement (an AC) or a documented contract specifies, it is **not a bug** (`not-a-bug`). Report the evidence (requirement ID and AC number, or document path and sentence) and point to `kiwi-srs` for a requirement change instead of a fix.

When it is unclear whether the behaviour is specified (the requirement or contract says nothing about it, or reads two ways), one subagent judges it from the related SRS requirements, the documented contract and `report.md` alone; it is not given the main agent's conclusion. Its verdict and reason are recorded in `report.md`, and a "bug" verdict settles the outcome of §4.1.

When it is not a bug, the reproduction test asserts behaviour the specification does not ask for: delete it when this skill created the file, or restore the file as §0.1 says when the test was added to an existing one. Its content stays in the report — once the requirement changes, that test becomes the failing test of the new requirement.

### 4.3 Not reproduced

When stage 3 ends without reproducing, **stop and ask the user** (`not-reproduced`, `repro-not-reproduced`, under `--auto` as well). The question carries:

- every candidate cause tried and how each was tried — stage, test or command, input, result
- what the reproduction lacks — environment (OS, runtime, configuration), version (product and dependencies), input data, missing steps, and any run stage 3 skipped because of the isolation rule (§0.2)

One owner runs the loop after the answer. When a caller invoked this run, the caller adds the answer to the input and invokes this skill again. On a standalone run, this skill updates `input.md` and starts again from §2. A run that did not reproduce leaves no test file behind.

---

## 5. Report and pipeline event

1. Write the **report** `docs/analysis/kiwi-bug-repro-{run-id}/report.md`: the symptom (the §1 record), the candidate causes with their evidence (`file:line`, confidence), the stages and attempts tried (a summary of `attempts.md`), and the outcome — the reproduction test (file, test name, red output), the reproduction script and observation, the evidence and verdict for "not a bug", or the question. `input.md`, `causes.md`, `attempts.md`, `state.json` and, when needed, the reproduction script sit in the same directory.
2. **Return to the caller**: one outcome (`reproduced` · `reproduced-no-test` · `not-a-bug` · `not-reproduced` · `input-insufficient` · `analysis-only`), the reproduction test's file, name and red output (or the reproduction script), the ordered causes with the most likely cause's `file:line`, the related requirement IDs, the report path, and the question when the run stopped.
3. **Pipeline emit**: following `../_shared/kiwi/pipeline-event.md` v1.0.0, record exactly one closing event — `skill` = `kiwi-bug-repro`. When the caller passes `--no-pipeline-emit`, no event is written. The normal path is MCP `workflow_pipeline_emit`; the hand-built append of that file's §5.1 is the degraded fallback when the tool is unavailable.
   - `status`: `reproduced`, `reproduced-no-test`, `not-a-bug` and `analysis-only` = `TASK_DONE`; `not-reproduced` and `input-insufficient` = `NEEDS_USER`.
   - `next_hint`: `reproduced` → `kiwi-hot-fix`, `not-a-bug` → `kiwi-srs`, otherwise `null`; `reproduced-no-test` gets `null` too, because kiwi-hot-fix stops on that outcome unless `TDD_EXEMPT_REASON` is given.
   - `req_ids`: the related requirement IDs. `artifacts.analysis_dir`: the report directory. `notes`: the outcome and the reproduction test path when there is one.
