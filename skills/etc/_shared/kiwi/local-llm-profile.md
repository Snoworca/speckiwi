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
- Preserve Max-strength gates, but execute them through the single-worker policy below.
- For 14B/27B-class models, keep evaluation work bounded and explicit: use one evaluator role, write intermediate findings to artifacts when needed, and treat uncertainty as an improvement item rather than a pass.

## Single-Worker Policy

Multi-delegated worker fanout is disabled.

- Use at most one delegated worker or evaluator at a time when delegation is available.
- When a host agent baseline section mentions sequential single-worker reviewers, multiple research perspectives, `local evaluator×N`, `local-LLM max-profile×N`, or Max reviewer multiplicity, interpret it as a sequential single evaluator role under this profile.
- Do not spawn child-of-child worker groups.
- If no delegation mechanism exists, the host agent performs the step directly and records that no worker was available.

## Evaluation Loop

The verification/evaluation-improvement loop stops only after the applicable evaluator role reports no improvements for three consecutive evaluations.

Loop contract:

1. Run the single evaluator.
2. If it reports improvements, apply or route them and reset the clean counter to 0.
3. If it reports no improvements, increment the clean counter.
4. Continue until the clean counter reaches 3.
5. Escalate to the user if the same blocker repeats three times with no safe change path.

For the local-LLM profile, "all evaluator delegated workers report no improvements for three consecutive rounds" means the single evaluator role has returned three consecutive clean evaluations.

## Invocation Wording

Use Open Agent Skills wording such as "use the `kiwi-srs` skill" or "run the `kiwi-planner` workflow". Avoid host-specific slash commands or provider-specific tool names.
