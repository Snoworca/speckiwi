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

## M-02 — §15.1's summary lines carry two stale counts the §22.16 audit corrected everywhere else — MEDIUM

Found on 2026-08-01 while authoring §15 into `docs/spec/`, by two independent drafters who each hit
their own row and reported it without seeing the other's.

| Row | Its summary line says | The defining section says | Authored as |
|---|---|---|---|
| `E6` | `computeLanePlan` is deterministic over its **eight** declared inputs — then lists nine | §5.3's `input` record has **nine** fields, and §22.16 AJ-02/03/04/16 corrected eight→nine in §4.7, §5.3 and §P2 6 | nine |
| `E10` | the catalogue additionally carries **five** fields | §5.1 names **six**, adding `tdd`, and §10.1's `TaskCatalogEntry` carries `tdd` and `dependsOnTask` | six |

The `E6` line is a straightforward miss: the count audit reached every defining section and did not
reach the §15.1 table, and `§10.5 step 1′` still repeats the stale phrase. **`E38`'s "eight" is a
different and correct number** — `lanes.lock.json` records eight *fields* pinning nine *inputs*, because
`sidecar_digest` covers both `catalog` and `existing_modules`. Do not propagate nine into `E38`.

`E10` is the one with a consequence rather than an inconsistency: **`E8`'s `tdd-pair` edge is not
computable without `tdd`**, so a catalogue built from `E10`'s five-field line cannot satisfy `E8`, and
`tdd-pair-split` is a declared `critical_gates[]` row (§13). The six-field form was implemented; the
requirement text needs widening to match.

## M-03 — three declared inputs are one member short of what their own consumers need — MEDIUM

Found on 2026-08-01 during implementation, by the agent building `lane-plan.ts`. Each is the same
shape as `M-02`'s `E10`: a declared input set that a **named consumer in the same design** cannot be
computed from. They are recorded together because the pattern is what matters — the design declares
signatures in §10.1 and behaviours in §5, and three times the signature is narrower than the
behaviour.

| Site | Declared | What a consumer needs | Consequence if built as declared |
|---|---|---|---|
| §5.2 `constraints` | `{code_roots, test_roots}` | `existing_paths` too | `write-set-overlap`'s prefix-directory clause has no input. Implemented as `{codeRoots, testRoots, existingPaths}`; arity stays five, so `E8`'s AC-1 is unaffected |
| the task catalogue | five fields (`E10`), six with `tdd` (§5.1) | `phaseDependsOn` as well | `phase-dependency` is **unreachable**, and `E8` AC-2 requires every `conflict_reason` member to be reachable. Implemented as seven |
| §10.1 `testFiles: string[]` | `string[]` | `{path, lineRange?}` | The sidecar schema is `test_files?: Array<{path, line_range?}>` (`kiwi-planner/SKILL.md:757`), and `IR-CLI-084` AC-4 requires the **line-range** rule to apply to test-file entries — unsatisfiable against a bare string. The sidecar schema wins over the design's restatement of it |

Two of the three make a declared enum member dead — `phase-dependency` outright, `tdd-pair` per
`M-02` — and `tdd-pair-split` is a declared `critical_gates[]` row (§13). A gate whose predicate can
never fire reads, from the table, exactly like one that never fires because nothing is wrong.

## M-04 — four defects the implementation found in the design's own text — MEDIUM

Found on 2026-08-01 by the agents building against these sections. Each was reproduced, not reasoned
about.

**`non-code-write-set-refused` is unsatisfiable on real data.** §5.3 lists it as a blocking outcome.
Measured against the pinned sidecars it fires for **11 tasks in `2026-06-17.speckiwi.v3-0-0` alone**,
because `req-shared` forces same-lane so a requirement's promotion is atomic, and `kiwi-planner` emits
seven non-code task types. It is also incompatible with `E7` AC-3, which requires a *plan* over those
same fixtures. Repaired at the source rather than by deleting the gate: an epilogue-bound task is
never a node of the component graph, so no lane assignment has to be undone. One consequence, stated
because it is not obvious — an edge *through* an epilogue task no longer joins the two lanes on either
side.

**`^\d+\s*단계\b` can never match `## 1단계`.** `09` §3.2 S7 gives it as one of three accepted
ordering-marker forms. In JavaScript `\b` after a non-word character does not match at that position,
so the marker the rule exists to accept is the one it rejects. Implemented as `(?!\w)`.

**D4 records the wrong `observed` value.** `09` §3.6's code block writes `p.orderedSections` for all
three of D4's disjuncts, so a removal caused by `taskListGroups` or `linkedSubIssues` is recorded as
*"D4 observed 0"* — and that value reaches `route.lock.json` and the gate's committee evidence table.
`E47`'s AC-3 requires the value it fired on, so the requirement is right and the design's code block is
wrong.

**`[INFERRED:` has nowhere to live.** §5.1 requires an inferred write set to be refusable, but the
sidecar schema is `{path, line_range?}`, so the label could only sit inside `path` — where it defeats
both `write-set-overlap` and grounding, since a label-bearing string matches no real path. Split into
a separate `TaskFileEntry.inferred` field, which takes the catalogue to **eight** fields; see `M-02`
and `M-03` for the other three the same table has grown.

## M-05 — `waves-event.md` §3's transition table has no enforcement requirement — LOW, and it is a gap not a defect

Raised on 2026-08-01 by the agent building `waves-validate.ts`, which declined to implement it rather
than shipping behaviour no requirement covers.

`waves-event.md` §3 states the transitions `pending → in_progress → complete ↘ failed`. The authored
set enforces the *consequences* of that table — `E3`'s completion gate refuses a `complete` with no
preceding passing wave-verify record, `E4`'s run predicate refuses a non-passing `final-verify`
written as `complete` — but **no requirement covers per-transition legality**, so a `complete`
following a `failed` is not refused. `E2`'s denominator is §2.3's round invariants, not §3's table.

Whether that matters is a real question and not one an implementer may answer by writing the check:
`00.charter.md:297` forbids behaviour with no requirement behind it. If the rule is wanted it needs a
requirement first.

## Verified clean

Run 2026-07-31 16:40 against `05.orchestrator-design.md` at 7,912 lines:

- `AA-nn` rows: 33, no duplicates.
- `C-nn` rows: 118, no duplicates.
- Section headings: 165, no duplicates.

This matters because an interrupted resolution round had written to the file, and a double-applied
edit — a table row inserted twice, a paragraph duplicated, a count incremented twice — would be silent
and would surface later as a spurious contradiction. It did not happen: the interrupted agent
completed its writing and was lost only on its final report.
