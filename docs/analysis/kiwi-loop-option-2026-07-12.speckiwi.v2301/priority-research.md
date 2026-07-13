---
run_id: 2026-07-12.speckiwi.v2301.loop-option
kind: precedence-decision-research (3 independent subagents, user-mandated)
target: v2.3.0.1
requirements: [FR-FLOW-034, FR-FLOW-035]
question: "When both --mini (loop round-cap=3 preset) and --loops N (explicit loop counter) are supplied with conflicting values, which takes precedence?"
verdict: explicit-loops-wins + non-fatal WARN (unanimous 3/3)
generated_at: 2026-07-12
---

# --mini vs --loops precedence — 3-subagent research (user-mandated)

User (2026-07-12) explicitly required: "루프 카운트와 mini 가 같이있으면 어느것이 우선순위가 더 높게할지 서브에이전트 3개로 연구하여 결정."
Three independent subagents researched under distinct lenses; the main session synthesized. Inputs were unbiased (neutral
context only, no preferred answer supplied) per CLAUDE.md §5.

## Verdict (unanimous)
**`--loops N` takes precedence over `--mini`, order-independent, with a non-fatal WARN that the preset's implied 3-round count was overridden.**

| Lens | recommendation | warn | confidence |
| --- | --- | --- | --- |
| CLI prior-art | explicit-loops-wins | yes | 0.82 |
| User-intent / safety | explicit-loops-wins | yes | 0.80 |
| kiwi-internal consistency | explicit-loops-wins | yes | 0.80 |

## Lens 1 — CLI prior-art
Rule: a preset is a bundle of defaults; a more-specific explicit flag overrides the single value it targets. Precedents:
- gcc/clang: `-O2` enables a set of `-f*` optimizations; an explicit `-fno-*` overrides that specific one; for repeated `-O` "the last one is effective" (last/specific wins).
- rsync: `-a` implies `-rlptgoD`; `--no-perms` explicitly disables one implied component while keeping the rest.
- ESLint: an `extends` preset is overridden by explicit `rules` and later config objects ("later object takes precedence").
- webpack: `mode:'production'` sets optimization defaults that explicit `optimization.*` overrides.
- git: command-line `-c key=value` (and explicit options) override config-file presets.
- tar `-z`/`--gzip` are the SAME option aliased (not a preset-vs-explicit conflict) — distinguishes true aliases from preset bundles.
Both `--mini` and `--loops` control one dimension (round count), so treat `--mini` as a default only and let the explicit counter win; warn so the override isn't silent; order-independent is safer than strict last-flag for named flags.

## Lens 2 — user-intent / safety
A named preset is a bundle of defaults; typing an explicit number is a more deliberate, specific act. Decisive case: a user
pins `--mini` as a global "budget mode" default and adds `--loops` for one command to override it — mini-wins would make that
override impossible and silently useless. `--mini` reads as "quick defaults I may tune," not an inviolable ceiling. Silently
dropping either flag is the real danger, so honor `--loops` but WARN. Erroring is too harsh (breaks the legitimate override
workflow). Conflict-direction: loops>3 raises cost/quality above the preset (warning should be cost-aware); loops<3 is cheaper
(informational). Both resolve to explicit-wins.

## Lens 3 — kiwi-internal consistency
Kiwi already resolves flag conflicts by letting the more explicit/specific control override the broader preset/default:
- `_shared/kiwi/auto-option.md §11.1`: specific `--auto-apply` wins over broad `--auto`.
- kiwi-pipeline (§5, L235): explicit `next_hint` beats default Table T1.
- kiwi-srs-feasibility (§1.2 / §9.3): explicit `--research-respawn-limit` overrides the mode's default cap.
- FR-FLOW-022 (§0.18/§0.16): explicit `--model` overrides the current-session default.
Counter-convention (kiwi-commit-auto-pr §848: safety gate beats permissive flag → HALT) governs irreversible SAFETY gates, not
round counts; the severity gate (CRITICAL=0+HIGH=0) is the real safety mechanism and terminates the loop early regardless, so
round count is an escalation cap where explicit-wins is the right analog → WARN, not HALT.
**--max interaction:** `--max` (verifier count + gate strictness + committee/divergence escalation) is ORTHOGONAL to the round
cap and composes: `--max --loops 5` = strict gate + 5-round cap. An explicit `--loops N` also overrides any `--max`-derived
default cap (same explicit-wins principle), while `--max` still governs gate strictness; the gate can still end the loop before the cap.

## Decisions recorded into SRS
- FR-FLOW-034 AC-3: both present ⇒ `--loops` wins order-independent + non-fatal WARN.
- FR-FLOW-034 AC-6: `--max` orthogonal & composes; `--loops` overrides `--max`-derived default cap.
- Semantics: `--mini`=3 is an UPPER-BOUND cap (gate may end earlier), NOT a forced exactly-3 — chosen reading of "3번 돌립니다"
  (quick mode). Flagged to user for correction if exactly-3 was intended.
- Scope "모든 스킬" = all kiwi-* skills (consistent with FR-FLOW-022 "All kiwi-* skills"); snoworca-* is a separate forbidden
  suite (project CLAUDE.md §0.3/§0.6), out of scope.
- Verification = content-presence in natural-language skill bodies (FR-FLOW-022/014 precedent), not runtime execution.
