# `--mini` / `--loops` loop-counter option — SSOT v1.0 (Codex Kiwi skills)

Shared definition of the options that bound the **verify → improve → re-verify loop round cap** for
`kiwi-*` skills. Every skill that references this file applies the semantics below at read time.

> **Note**: this `--mini` is a **round-cap preset**. It is unrelated to the model-swap (Opus→Sonnet)
> `--mini` removed by FR-FLOW-022. Model selection remains `--model <name>` only, and the former
> model-swap shared SSOT deleted by FR-FLOW-022 is NOT revived.

## 1. Option definitions

| Option | Meaning | Default |
|---|---|---|
| `--mini` | Quick-mode preset — verify/improve loop **round cap = 3** | off (skill's own default cap) |
| `--loops N` / `--loops=N` | Explicit loop counter — round cap = N (integer N ≥ 1) | off (skill's own default cap) |

- A **round** = one verify → improve cycle (evaluator runs → findings fixed → re-verify).
- The round cap is an **upper bound**. The existing severity gate (Normal `CRITICAL=0 + HIGH=0` / Max
  `2-consecutive-MEDIUM-zero`) MAY terminate the loop earlier. So `--mini` means **"at most 3 rounds"**,
  not "exactly 3".
- N in `--loops N` must be a **positive integer**. `N < 1` or a non-integer is **rejected with an error**
  (HALT + usage hint).

## 2. Precedence — `--mini` and `--loops` supplied together

| Input | Result |
|---|---|
| `--mini` only | round cap 3 |
| `--loops N` only | round cap N |
| `--mini` + `--loops N` (both) | **`--loops N` wins** — the explicit counter overrides the preset. **Order-independent**. Emit a **non-fatal warning (WARN)**: "`--mini`'s 3-round cap was overridden by `--loops N`" |

**Rationale**: an explicit/specific flag overriding a preset default is the kiwi convention
(auto-option §11.1 specific `--auto-apply` > broad `--auto`; pipeline explicit `next_hint` > Table T1;
feasibility explicit `--research-respawn-limit` > mode default; FR-FLOW-022 `--model` > session default)
and the general CLI convention (gcc `-O2` + `-fno-*`, rsync `-a` + `--no-perms`, ESLint extends override).
Unanimous 3-subagent decision — `docs/analysis/kiwi-loop-option-2026-07-12.speckiwi.v2301/priority-research.md`.

## 3. Cap-reached behavior

- If the round cap is reached before the severity gate is clean: **stop looping** and **report the
  residual findings** — no silent truncation (state what remains unresolved in the skill's output).
- **Do NOT bypass the safety gate**: residual `CRITICAL`/`HIGH` findings still surface (report +
  blocked/warn status). The round cap only stops infinite escalation; it never hides a CRITICAL.
- Warning / residual reporting channel = the skill's standard artifacts (report.md / console summary /
  worklog.jsonl).

## 4. Orthogonality with `--max` (compose)

- `--max` controls **verification strength** (evaluator count / gate strictness / committee & divergence
  escalation) and is **orthogonal** to the round cap.
- The two options **compose**: `--max --loops 5` = strict gate + 5-round cap.
- An explicit `--loops N` also overrides any `--max`-derived default cap (e.g. kiwi-srs 5→8,
  kiwi-srs-feasibility 5→15), while `--max` still governs gate strictness; the gate may still end the
  loop before the cap.

## 5. No-loop skills

Skills without a round-capped loop (kiwi-step, kiwi-srs-research) accept `--mini` / `--loops` as a
**documented no-op** (orchestration uniformity). There is no loop to cap, so behavior is unaffected.

## 6. Orchestrator propagation (FR-FLOW-035)

Orchestrators **propagate** `--mini` / `--loops N` to every kiwi child sub-skill they spawn or delegate
to. Same additive pattern as the `auto-option.md §7` child-propagation table.

| Orchestrator | Sub-skill | Propagation |
|---|---|---|
| kiwi-pm | kiwi-coder | `--mini`/`--loops N` → child spawn args |
| kiwi-pipeline | every spawned sub-skill | `--mini`/`--loops N` → all children |
| kiwi-wave-master | per-wave kiwi-srs + kiwi-pipeline | `--mini`/`--loops N` → per wave |
| kiwi-hot-fix | kiwi-srs-sync | `--mini`/`--loops N` → delegation |
| kiwi-coder | kiwi-review-fix-loop | `--mini`/`--loops N` → follow-up |

## 7. Natural-language mapping

- `--mini`: "mini mode", "quick mode", "3 rounds"
- `--loops N`: "loop N times", "N rounds", "loop count N"
