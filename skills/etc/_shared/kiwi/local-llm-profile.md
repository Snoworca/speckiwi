# Kiwi etc Local-LLM Profile

This file is the shared execution profile for `skills/etc` Kiwi skills used with OpenCode, Hermes, or other local-LLM hosts, including 14B/27B-class local models.

## Required Runtime Dependency

All normal Kiwi workflows require a working `speckiwi mcp` connection before SRS reads, SRS mutations, validation, status or stability changes, acceptance-criteria updates, verification evidence, trace links, or completed-work logging.

If SpecKiwi MCP is unavailable:

1. Do not perform normal SRS mutations.
2. Do not manually edit `docs/spec/**` as a fallback for requirement, AC, evidence, trace, status, stability, or completed-work changes.
3. Restrict work to diagnostics, bootstrap assistance, or remediation guidance for starting or connecting `speckiwi mcp`.
4. Halt before target-scoped SRS or implementation workflow continues.

CLI diagnostics/remediation is diagnostic/remediation only. It is not the normal mutation path for etc Kiwi skills.

## Default Mode

The etc variant always runs as if `--max` is enabled.

- Treat `--max` as the default, even when the user does not write it.
- Do not expose legacy lightweight profile toggles as active etc-mode controls.
- Preserve Max-strength gates, and execute the verification/evaluation loop through the single-worker policy below.
- For 14B/27B-class models, keep evaluation work bounded and explicit: use one evaluator role, write intermediate findings to artifacts when needed, and treat uncertainty as an improvement item rather than a pass.
- The etc `--max` default and the single-worker policy govern the verification/evaluation loop only. The `--auto` user-decision committee is sized separately by `auto-option.md` (`--auto` = 3 members, `--auto --max` = 5): `--max` raises that committee and is not a no-op (see `## `--auto` Policy`).

## Single-Worker Policy

Multi-delegated worker fanout is disabled for the verification/evaluation loop.

- Use at most one delegated worker or evaluator at a time when delegation is available.
- When a host agent baseline section mentions sequential single-worker reviewers, multiple research perspectives, `local evaluator×N`, `local-LLM max-profile×N`, or Max reviewer multiplicity, interpret it as a sequential single evaluator role under this profile.
- Do not spawn child-of-child worker groups.
- If no delegation mechanism exists, the host agent performs the step directly and records that no worker was available.
- Exception — the `--auto` user-decision committee follows `auto-option.md`'s committee sizing and voting, not this single-worker rule. On hosts that cannot spawn committee members in parallel, run the members sequentially while preserving the full committee size and merge logic.

## Evaluation Loop

The verification/evaluation-improvement loop stops only after the applicable evaluator role reports no improvements for three consecutive evaluations.

Loop contract:

1. Run the single evaluator.
2. If it reports improvements, apply or route them and reset the clean counter to 0.
3. If it reports no improvements, increment the clean counter.
4. Continue until the clean counter reaches 3.
5. Escalate to the user if the same blocker repeats three times with no safe change path.

For the local-LLM profile, "all evaluator delegated workers report no improvements for three consecutive rounds" means the single evaluator role has returned three consecutive clean evaluations.

## `--auto` Policy

When a Kiwi skill supports `--auto`, read `auto-option.md` at the first user-decision gate and follow its committee model. `--auto` convenes a 3-member decision committee and `--auto --max` a 5-member committee, escalating per `auto-option.md` §2/§3; `--max` raises the committee and is not a no-op — identical to the claude/codex variants, and the etc `--max` default does not force the committee to 5.

Because multi-worker fanout is disabled, the committee members are evaluated sequentially (one delegated worker at a time), but the committee size, voting, and merge logic from `auto-option.md` are preserved. This decision committee is a scoped exception to the `## Single-Worker Policy`, which governs only the verification/evaluation loop.

Every etc skill that uses `--auto` must declare `critical_gates[]`. A matching critical gate always halts for user input regardless of `--auto`.

## Invocation Wording

Use Open Agent Skills wording such as "use the `kiwi-srs` skill" or "run the `kiwi-planner` workflow". Avoid host-specific slash commands or provider-specific tool names.
