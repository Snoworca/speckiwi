# work-mode ↔ `tdd_policy` derivation mapping — SSOT v1.0 (Codex Kiwi skills)

work-mode is the top-level declaration; `tdd_policy` remains a plan-contract field, but its
**default derives from the current work-mode**. Every kiwi skill that references this file applies
the mapping below at read time.

work-mode surface: MCP `get_work_mode` / `set_work_mode`, CLI `speckiwi mode`. It is stored in
`docs/spec/steps/state.md`; when unset, the default mode is `wait`.

## 1. Derivation mapping (work-mode → `tdd_policy` default)

| work-mode | derived `tdd_policy` default |
|---|---|
| `tdd` | `strict` |
| `sdd` | `relaxed` |
| `wait` | `relaxed` |
| `vibe` | `relaxed` |

- i.e. **tdd → strict**, everything else (sdd / wait / vibe) → **relaxed**.
- Read order for the work-mode: MCP `get_work_mode` (preferred when available) → CLI `speckiwi mode`
  (fallback) → treat as `wait` when both are absent (**fail-open** — a work-mode that cannot be read
  never blocks the work).

## 2. `disabled` is never derived

- `tdd_policy = disabled` is **never derived from any work-mode**. `disabled` is set only by an
  explicit `--tdd-policy=disabled` flag.
- Rationale: `disabled` is an opt-out that turns off the whole TDD gate; it must not be switched on
  accidentally by mode derivation. So no mode derives to `disabled`, and even the weaker-enforcement
  modes (`wait`, `vibe`) derive only to `relaxed`.

## 3. Explicit flag wins (explicit-over-derived)

- When the user supplies an **explicit** `--tdd-policy <value>`, that value **always wins** over the
  work-mode-derived default.
- When the explicit flag overrides the derived default (explicit value ≠ derived value): emit a
  one-line **non-fatal WARN** — e.g. "explicit `--tdd-policy=<value>` overrides work-mode `<mode>`
  derived default `<derived>`". The WARN is non-fatal and does not block. When the explicit value
  equals the derived value, proceed without a WARN.
- Rationale: an explicit/specific flag overriding a derived default is the kiwi convention —
  loop-option `--loops` > `--mini`, auto-option specific `--auto-apply` > broad `--auto`,
  FR-FLOW-022 `--model` > session default.

## 4. Consumers

| Skill | Application |
|---|---|
| kiwi-planner | In Phase 0 (Bootstrap) read the work-mode and, when `--tdd-policy` is unspecified, record the §1 derived default in plan.md frontmatter / sidecar `tdd_policy`. An explicit flag wins per §3. |
| kiwi-pm | When the input plan's `tdd_policy` contradicts the current work-mode-derived default (e.g. work-mode=tdd + plan `relaxed`), emit a one-line **non-HALT WARN** per §3. The existing `tdd_policy=disabled` rejection/HALT is separate and unchanged. |
| kiwi-pipeline | work-mode routing (FR-FLOW-039) is separate — mode=tdd + step-scoped routes to kiwi-tdd, orthogonal to the tdd_policy derivation here. |
