# kiwi feasibility policy schema v1

This reference defines the optional feasibility policy file used by
`kiwi-srs-feasibility` and the inline feasibility heuristic reused by the
`kiwi-srs` research-document verify/improve (A/B) loop.

## Policy Lookup

Resolve policy in this order:

1. `{cwd}/.kiwi/feasibility-policy.yaml`
2. `{home}/.kiwi/feasibility-policy.yaml`
3. Built-in defaults from this file

## Built-In Mapping

| Feasibility | Additional condition | Stability result | User approval |
|---|---|---|---|
| `high` | `has_verification: true` | `stable` | required |
| `high` | default | `evolving` | not required |
| `medium` | default | keep current stability | not required |
| `low` | default | `draft` | required for downgrades |
| `blocked` | status is `in_progress`, `implemented`, or `verified` | keep current stability and report conflict | not required |
| `blocked` | default | `deprecated` | required |
| no match | default | keep current stability | required |

## Optional YAML Shape

```yaml
version: 1
gates:
  status_conflict_policy: warn # warn | block
  require_user_confirm_for_stable: true
reason_template: "Feasibility policy applied by kiwi-srs-feasibility: {reason}"
mapping:
  - when:
      feasibility: high
      has_verification: true
    then:
      stability: stable
      require_user_confirm: true
```

## Validation Rules

- `version` must be `1`.
- `gates.status_conflict_policy` must be `warn` or `block` when present.
- Every mapping entry must include `when.feasibility`.
- `then.stability` must be one of `draft`, `evolving`, `stable`, `frozen`, `deprecated`, or `keep`.
- `frozen` is outside `kiwi-srs-feasibility` authority and must be rejected even if a policy file requests it.

## Inline Heuristic Reuse (kiwi-srs A/B Loop)

The `kiwi-srs` research-document verify/improve loop reuses the **Built-In Mapping** above as an
inline feasibility heuristic when Process A reports each requirement's implementability in the
current architecture. This is an inline read of the mapping only — it introduces no new dual-mode
interface and performs no stability mutation of its own (stability changes remain the exclusive
authority of `kiwi-srs-feasibility`).
