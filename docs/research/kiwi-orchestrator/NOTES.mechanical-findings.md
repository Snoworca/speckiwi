# Mechanical findings — structural checks the semantic hunters do not perform

These come from running structural checks over the document set rather than from reading it. They are
recorded here because a hunter looking for contradictions in *meaning* will not find them, and because
the loop that would otherwise catch them is paused.

Feed these into the next hunting round as seeded findings.

---

## M-01 — the `RA-nn` id namespace is reused across revision logs — MEDIUM

`05.orchestrator-design.md` numbers each revision log's rows from `RA-01`, so the same id now names two
unrelated rows:

| id | §19.5 — revision 2, "Medium — accepted, with the reason" | §21.3 — revision 4, "The tie rung — `08` §2 applied" |
|---|---|---|
| `RA-01` | IM-M10, `red_evidence` manifest shape | X-03 marked DECIDED, drop the rung |
| `RA-02` | IM-M11, `run_id` has no format rule | §12's quarantine removed |
| `RA-03` | §17.4, `P-WAVE-ISSUES-CLOSED` checks form not correctness | `07` Q2 re-decided |
| `RA-04` | §17.2, concurrent `npm ci` untested | the two travelling conditions authored as A9 |
| `RA-05` | §17.10, layer 2 conformance is self-consistency | A7 DECLINED, A8 new |

A citation of `RA-03` is ambiguous. Every other id family in the document is unique across the whole
file — `AA-nn` (33), `C-nn` (118), and the rest of the revision-log families (204 ids total, and these
five are the only collisions), so this is an outlier rather than a convention.

The fix is to prefix by revision — `R4-A-01` or similar — and repoint any citation. Check for citations
before renaming: an unqualified `RA-03` elsewhere in the set is currently ambiguous and must be
resolved to whichever row was meant.

## Verified clean

Run 2026-07-31 16:40 against `05.orchestrator-design.md` at 7,912 lines:

- `AA-nn` rows: 33, no duplicates.
- `C-nn` rows: 118, no duplicates.
- Section headings: 165, no duplicates.

This matters because an interrupted resolution round had written to the file, and a double-applied
edit — a table row inserted twice, a paragraph duplicated, a count incremented twice — would be silent
and would surface later as a spurious contradiction. It did not happen: the interrupted agent
completed its writing and was lost only on its final report.
