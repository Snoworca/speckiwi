// @req IR-CLI-099 — the help line is the only place an agent learns what a flag costs, and it acts
// on what it reads. Both gates below shipped with an empty description. Keeping the text in one
// place per gate is what makes it impossible for one command to describe it and another not to.
//
// Keyed by the gate, not by the flag spelling. `speckiwi step claim --force` spells the same flag
// but bypasses a different gate (a write-skew soft gate) with different consequences, so it is not
// this contract's business and must not be made to share this text.
//
// The first draft of the overwrite text said "under docs/spec". That was narrower than the truth,
// and an agent reading it would have concluded its own .claude/settings.json was safe — which is
// the exact mistake this requirement exists to prevent. Every call site that receives `force` is
// listed in the doc comment below; widen the text before adding another.

/** Help text for options that switch off a safety gate, keyed by the gate they switch off. */
export const SAFETY_BYPASS_OPTION_HELP = {
  /**
   * `init --force` turns off the skip in `writeIfMissing`, so every file init would otherwise leave
   * alone is rewritten from a template: the requirements index, the appendix, the step state and a
   * scope document under `docs/spec`, the hook runners under `docs/.kiwi/hooks`, `.claude/settings.json`
   * and `.codex/hooks.json`. The run reports them as updated, not as overwritten.
   */
  initOverwrite:
    "DESTRUCTIVE: rewrite every file init would otherwise leave alone, from templates — the requirements index, the appendix and the step state under docs/spec, the hook runners under docs/.kiwi, and the agent settings in .claude and .codex. Local edits to any of them are lost, no backup is kept, and the run reports them as updated.",

  /** `--ignore-lock` skips `withSrsMutationLock`, which is what keeps two writers from interleaving. */
  mutationLock:
    "bypass the SRS mutation lock; another writer may be mid-write, and the two writes can interleave"
} as const satisfies Record<string, string>;

export type SafetyBypassGate = keyof typeof SAFETY_BYPASS_OPTION_HELP;
