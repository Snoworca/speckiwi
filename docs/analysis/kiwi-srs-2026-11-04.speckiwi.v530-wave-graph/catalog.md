# 5.3.0 SRS catalog (kiwi-srs Phase 4)

PRD: `docs/prd/2026-11-04.v530-wave-master-work-graph-roadmap.prd.md`. Target `5.3.0`, all `planned` / `draft`. Scope: PRD-1~24, 28, 29 (PRD-25~27 roadmap is 5.4.0).

## Requirements

| 요구 ID | 제목 | 인용 PRD 항목 | depends_on |
|---|---|---|---|
| FR-NODE-244 | Wave declaration schema 2.0.0 is a work graph of nodes and edges, normalized to the same WaveDeclaration as 1.0.0 | PRD-6, PRD-8, PRD-9, PRD-11, PRD-12, PRD-13, PRD-16, PRD-19, PRD-23, PRD-24, PRD-29 | - |
| FR-NODE-245 | One shared secret-pattern module, which also catches key= values, serves synthesis redaction, the work-graph check and journal action errors | PRD-4, PRD-24 | FR-NODE-250 |
| FR-NODE-246 | orchestrate wave check reports every work-graph defect, including the AC partition, previews the stages without a lock, and replaces the allocation kernel | PRD-3, PRD-4, PRD-8, PRD-9, PRD-10, PRD-12, PRD-13, PRD-14, PRD-15, PRD-16, PRD-20, PRD-21, PRD-23, PRD-24, PRD-29 | FR-NODE-244, FR-NODE-245, FR-PARSE-044, FR-NODE-231 |
| FR-NODE-247 | orchestrate wave propose computes a deterministic draft work graph that groups whole requirements under size caps | PRD-2, PRD-4, PRD-6, PRD-8, PRD-9, PRD-10, PRD-15, PRD-16, PRD-17, PRD-18 | FR-NODE-244, FR-PARSE-044 |
| FR-NODE-248 | Verification Evidence Covers lists criteria one by one; a range such as AC-1..AC-11 is refused and reported | PRD-12, PRD-28 | - |
| FR-NODE-249 | AC completion and node state are derived from the SRS, the test citations and the run journal, never stored in the graph | PRD-4, PRD-10, PRD-12, PRD-13, PRD-14, PRD-29 | FR-NODE-244, FR-PARSE-044, FR-NODE-248, FR-NODE-250 |
| FR-NODE-250 | The run journal accepts the work-graph lines: graph reference, confirmed completion conditions, the redecompose phase and verb node-complete-action | PRD-10, PRD-13, PRD-21, PRD-24 | - |
| FR-NODE-251 | orchestrate wave actions computes the due completion actions with an idempotency key, at most once, and never sends anything itself | PRD-10, PRD-12, PRD-13, PRD-23, PRD-24 | FR-NODE-244, FR-NODE-249, FR-NODE-250 |
| FR-NODE-252 | orchestrate preservation check reports deleted or moved files, changed exports, deleted tests and weakened assertions between two revisions | PRD-2, PRD-20 | - |
| FR-NODE-253 | The appendix MCP Tool Summary table is generated from the ToolSpec registry and checked by a command instead of being edited by hand | PRD-3, PRD-4, PRD-10, PRD-28 | - |
| FR-NODE-254 | The verification round record and the wave journal record kept and dropped findings instead of severity counts | PRD-20 | - |
| FR-PARSE-045 | The validator warns on a dependency written only in prose and on a depends_on row whose target is not a requirement | PRD-16 | - |
| IR-CLI-113 | orchestrate wave status reports every node of a work graph with its derived state, AC progress, action counts and times, and runs without arguments | PRD-2, PRD-3, PRD-10, PRD-12, PRD-14, PRD-23, PRD-29 | FR-NODE-249, FR-NODE-251, FR-NODE-250 |
| IR-CLI-114 | orchestrate wave show reports one node in full: its fields, computed requirements and PRD items, per-AC verdict rows, actions, times and neighbours, within bounded responses | PRD-3, PRD-10, PRD-11, PRD-12, PRD-13, PRD-21, PRD-23 | FR-NODE-249, FR-NODE-251, FR-NODE-231, FR-NODE-242, IR-CLI-113 |
| IR-MCP-008 | MCP tools orchestrate_wave_propose, orchestrate_wave_check, orchestrate_wave_show, orchestrate_wave_actions and orchestrate_preservation_check, generated from the CLI binding table | PRD-3, PRD-10, PRD-23 | FR-NODE-253, FR-NODE-246, FR-NODE-247, FR-NODE-251, FR-NODE-252, IR-CLI-113, IR-CLI-114 |
| FR-FLOW-208 | kiwi-srs records every dependency between requirements as a depends_on Trace Link and never only in prose | PRD-16 | FR-PARSE-045 |
| FR-FLOW-209 | kiwi-srs writes PRD citations in a form speckiwi prd coverage counts | PRD-28 | FR-NODE-242 |
| FR-FLOW-210 | kiwi-prd turns each normative sentence of a long design document into its own PRD item | PRD-3, PRD-28 | - |
| FR-FLOW-211 | kiwi-pm reads the requirements of --req-filter by ID, whatever their target, for its lifecycle gate and its promotion | PRD-19 | - |
| FR-FLOW-212 | kiwi-wave-master authors the product target's SRS once from the PRD and decomposes the requirement set into a work graph | PRD-1, PRD-4, PRD-5, PRD-11, PRD-12, PRD-13, PRD-15, PRD-17, PRD-21 | FR-NODE-247, FR-NODE-246, FR-FLOW-211, FR-FLOW-208 |
| FR-FLOW-213 | Feasibility runs once before the first dispatch, and later requirements stay draft until just before their wave | PRD-21 | FR-FLOW-212 |
| FR-FLOW-214 | kiwi-wave-master enters an epic issue through PRD, SRS and decomposition instead of extracting waves from the epic | PRD-4, PRD-5 | FR-FLOW-212 |
| FR-FLOW-215 | kiwi-orchestrator R-ORCH authors the SRS once after design freeze and decomposes requirements through the same shared contract | PRD-4, PRD-5, PRD-22 | FR-FLOW-212, FR-FLOW-213 |
| FR-FLOW-216 | A wave worker runs kiwi-pm once per requirement in dependency order, leaves a test commit and an implementation commit per requirement, and reviews the wave window once | PRD-6, PRD-7, PRD-18, PRD-20 | FR-FLOW-211, FR-FLOW-212 |
| FR-FLOW-217 | Only waves not yet dispatched may be redecomposed, by fixed rules R1 to R5, and the change is journalled and checked again | PRD-9, PRD-21 | FR-NODE-246, FR-NODE-250, IR-CLI-113, FR-FLOW-212 |
| FR-FLOW-218 | Workers report requirement changes as srs_deltas without stopping, and the host turns evidenced deltas into one serial incremental kiwi-srs call per stage | PRD-20, PRD-21 | FR-NODE-243, FR-FLOW-217, FR-FLOW-212 |
| FR-FLOW-219 | A wave's PRD items are computed from its requirements' citations, and PRD coverage is checked by the tool instead of wave excerpts | PRD-3, PRD-5, PRD-20 | FR-NODE-242, FR-FLOW-209, IR-CLI-114 |
| FR-FLOW-220 | Wave-end and final verification run machine checks first, then one fresh verifier who keeps a finding only by a red test | PRD-5, PRD-20, PRD-21 | FR-NODE-246, FR-NODE-252, FR-NODE-254, FR-FLOW-218, FR-FLOW-219, FR-FLOW-216 |
| FR-FLOW-221 | The shared verification contracts, kiwi-coder and kiwi-wave-master drop severity classes and judge by kept findings only | PRD-20 | FR-NODE-254 |
| FR-FLOW-222 | kiwi-wave-master and kiwi-orchestrator write the 2.0.0 work graph, dispatch only after wave check passes, and run completion actions after each node completes | PRD-9, PRD-10, PRD-13, PRD-21, PRD-22, PRD-23, PRD-24 | FR-NODE-244, FR-NODE-246, FR-NODE-250, FR-NODE-251, IR-CLI-113, FR-FLOW-212 |
| FR-FLOW-223 | kiwi-wave-master and kiwi-pm carry their core rules within the first 5,000 estimated tokens so they survive compaction | PRD-2, PRD-3, PRD-10, PRD-18, PRD-19 | FR-FLOW-212, FR-FLOW-216, FR-FLOW-220, FR-FLOW-221, FR-FLOW-211, FR-FLOW-219 |

## Supersede / extend links

| 요구 ID | 관계 | 기존 요구 |
|---|---|---|
| FR-NODE-244 | extends | FR-NODE-216 |
| FR-NODE-246 | supersedes | FR-NODE-133 |
| FR-NODE-254 | extends | FR-NODE-144 |
| IR-CLI-113 | extends | IR-CLI-104 |
| FR-FLOW-208 | extends | FR-FLOW-205 |
| FR-FLOW-210 | extends | FR-FLOW-204 |
| FR-FLOW-212 | supersedes | FR-FLOW-029 |
| FR-FLOW-212 | extends | FR-FLOW-195 |
| FR-FLOW-212 | extends | FR-FLOW-188 |
| FR-FLOW-214 | supersedes | FR-FLOW-030 |
| FR-FLOW-215 | extends | FR-FLOW-188 |
| FR-FLOW-216 | extends | FR-FLOW-115 |
| FR-FLOW-216 | extends | FR-FLOW-188 |
| FR-FLOW-216 | extends | FR-FLOW-195 |
| FR-FLOW-219 | supersedes | FR-FLOW-204 |
| FR-FLOW-220 | supersedes | FR-FLOW-044 |
| FR-FLOW-220 | extends | FR-FLOW-045 |
| FR-FLOW-220 | extends | FR-FLOW-049 |
| FR-FLOW-222 | extends | FR-FLOW-195 |
| FR-FLOW-222 | extends | FR-FLOW-188 |

## PRD item coverage

| PRD 항목 | 인용한 요구 ID |
|---|---|
| PRD-1 | FR-FLOW-212 |
| PRD-2 | FR-NODE-247, FR-NODE-252, IR-CLI-113, FR-FLOW-223 |
| PRD-3 | FR-NODE-246, FR-NODE-253, IR-CLI-113, IR-CLI-114, IR-MCP-008, FR-FLOW-210, FR-FLOW-219, FR-FLOW-223 |
| PRD-4 | FR-NODE-245, FR-NODE-246, FR-NODE-247, FR-NODE-249, FR-NODE-253, FR-FLOW-212, FR-FLOW-214, FR-FLOW-215 |
| PRD-5 | FR-FLOW-212, FR-FLOW-214, FR-FLOW-215, FR-FLOW-219, FR-FLOW-220 |
| PRD-6 | FR-NODE-244, FR-NODE-247, FR-FLOW-216 |
| PRD-7 | FR-FLOW-216 |
| PRD-8 | FR-NODE-244, FR-NODE-246, FR-NODE-247 |
| PRD-9 | FR-NODE-244, FR-NODE-246, FR-NODE-247, FR-FLOW-217, FR-FLOW-222 |
| PRD-10 | FR-NODE-246, FR-NODE-247, FR-NODE-249, FR-NODE-250, FR-NODE-251, FR-NODE-253, IR-CLI-113, IR-CLI-114, IR-MCP-008, FR-FLOW-222, FR-FLOW-223 |
| PRD-11 | FR-NODE-244, IR-CLI-114, FR-FLOW-212 |
| PRD-12 | FR-NODE-244, FR-NODE-246, FR-NODE-248, FR-NODE-249, FR-NODE-251, IR-CLI-113, IR-CLI-114, FR-FLOW-212 |
| PRD-13 | FR-NODE-244, FR-NODE-246, FR-NODE-249, FR-NODE-250, FR-NODE-251, IR-CLI-114, FR-FLOW-212, FR-FLOW-222 |
| PRD-14 | FR-NODE-246, FR-NODE-249, IR-CLI-113 |
| PRD-15 | FR-NODE-246, FR-NODE-247, FR-FLOW-212 |
| PRD-16 | FR-NODE-244, FR-NODE-246, FR-NODE-247, FR-PARSE-045, FR-FLOW-208 |
| PRD-17 | FR-NODE-247, FR-FLOW-212 |
| PRD-18 | FR-NODE-247, FR-FLOW-216, FR-FLOW-223 |
| PRD-19 | FR-NODE-244, FR-FLOW-211, FR-FLOW-223 |
| PRD-20 | FR-NODE-246, FR-NODE-252, FR-NODE-254, FR-FLOW-216, FR-FLOW-218, FR-FLOW-219, FR-FLOW-220, FR-FLOW-221 |
| PRD-21 | FR-NODE-246, FR-NODE-250, IR-CLI-114, FR-FLOW-212, FR-FLOW-213, FR-FLOW-217, FR-FLOW-218, FR-FLOW-220, FR-FLOW-222 |
| PRD-22 | FR-FLOW-215, FR-FLOW-222 |
| PRD-23 | FR-NODE-244, FR-NODE-246, FR-NODE-251, IR-CLI-113, IR-CLI-114, IR-MCP-008, FR-FLOW-222 |
| PRD-24 | FR-NODE-244, FR-NODE-245, FR-NODE-246, FR-NODE-250, FR-NODE-251, FR-FLOW-222 |
| PRD-28 | FR-NODE-248, FR-NODE-253, FR-FLOW-209, FR-FLOW-210 |
| PRD-29 | FR-NODE-244, FR-NODE-246, FR-NODE-249, IR-CLI-113 |

PRD-29 is an exclusion: the requirements citing it keep only dashboard-readable values (stable IDs, state times, raw progress) in tool output and add no dashboard screen.
