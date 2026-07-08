import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "docs/analysis/kiwi-planner-2026-06-17.speckiwi.v3-0-0";
const RUN_ID = "2026-06-17.speckiwi.v3-0-0";
const PLAN_MD = `docs/plans/${RUN_ID}.plan.md`;
const SIDECAR = `docs/plans/${RUN_ID}.sidecar.json`;
const NOW = "2026-06-17T00:00:00Z";
const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const canon = (o) => Array.isArray(o) ? o.map(canon) : (o && typeof o === "object" ? Object.keys(o).sort().reduce((r, k) => ((r[k] = canon(o[k])), r), {}) : o);
const canonJson = (o) => JSON.stringify(canon(o));

const reqs = JSON.parse(readFileSync(`${DIR}/reqs.json`, "utf8"));
const byId = new Map(reqs.map((r) => [r.id, r]));
const fileMap = JSON.parse(readFileSync(`${DIR}/code_context_merged.json`, "utf8"));
let oldSidecar = null;
try { oldSidecar = JSON.parse(readFileSync(SIDECAR, "utf8")); } catch { /* first run */ }

// ---- Phase layering by scope (dependency-ordered) ----
const PHASES = [
  { id: "PH-001", scope: "ARCH", title: "ToolSpec SSOT foundations", depends_on: [] },
  { id: "PH-002", scope: "PARSE", title: "Parser & validation core", depends_on: ["PH-001"] },
  { id: "PH-003", scope: "NODE", title: "Core mutation & query layer", depends_on: ["PH-002"] },
  { id: "PH-004", scope: "CLI", title: "CLI command surface", depends_on: ["PH-003"] },
  { id: "PH-005", scope: "MCP", title: "MCP tool surface", depends_on: ["PH-003"] },
  { id: "PH-006", scope: "FLOW", title: "Workflow & rules integration", depends_on: ["PH-002", "PH-003"] },
];

// stable REQ order: by id within scope
const scopeReqs = {};
for (const p of PHASES) scopeReqs[p.scope] = reqs.filter((r) => r.scope === p.scope).sort((a, b) => a.id.localeCompare(b.id));

const phases = [];
const tasks = [];
const coverage = [];
const traceLinksAll = []; // {taskId, type, reference, link_id, relation}

// files[] from code-context analysis (generous superset; gate checks actual⊆declared)
const implFilesOf = (r) => fileMap[r.id].impl_files;
const testFileOf = (r) => fileMap[r.id].test_file;

for (const ph of PHASES) {
  const rs = scopeReqs[ph.scope];
  const phaseNum = ph.id.slice(3); // "PH-001" -> "001"
  const taskIds = [];
  let seq = 0;
  for (const r of rs) {
    const acIds = r.ac.map((a) => a.id);
    const implFiles = implFilesOf(r);
    const testFile = testFileOf(r);
    const redId = `T-PH${phaseNum}-${String(++seq).padStart(2, "0")}`;
    const greenId = `T-PH${phaseNum}-${String(++seq).padStart(2, "0")}`;
    taskIds.push(redId, greenId);

    const reqNum = r.id; // e.g. FR-NODE-017
    const mkTC = (sfx) =>
      r.ac.map((a, i) => ({
        id: `TC-REQ-${reqNum}-AC${i + 1}-${sfx}`,
        req_id: reqNum,
        ac_refs: [a.id],
        test_file: testFile,
        test_symbol: `${reqNum} ${a.id}`,
        kind: ph.scope === "CLI" || ph.scope === "MCP" ? "integration" : "unit",
      }));

    // RED task — write failing tests
    tasks.push({
      id: redId,
      phase_id: ph.id,
      title: `Write failing tests for ${r.id}`,
      type: "code",
      req_ids: [r.id],
      files: [{ path: testFile }],
      action: `Add a failing automated test asserting each acceptance criterion of ${r.id}: ${r.title}. Run it to confirm red before implementation.`,
      acceptance_tests: [
        { kind: "checklist", items: [`Test file ${testFile} added`, `One test case per AC (${acIds.join(", ")})`, "Suite is red (fails) before implementation"] },
      ],
      verification_cmd: null,
      dod: [`${testFile} exists with ${acIds.length} test case(s)`, "Test run captured as red (non-zero exit)"],
      rollback: `git checkout -- ${testFile}`,
      trace_links: [{ link_id: `TL-${redId}-${r.id}`, source: { type: "Task", id: redId }, target: { type: "Requirement", reference: r.id }, relation: "verifies" }],
      estimated_effort: "S",
      covers_ac: acIds,
      tdd: { applicable: true, phase: "red", test_cases: mkTC("01"), red_evidence: null, green_evidence: null },
      test_files: [{ path: testFile }],
    });

    // GREEN task — implement to pass
    tasks.push({
      id: greenId,
      phase_id: ph.id,
      title: `Implement ${r.id} to pass tests`,
      type: "code",
      req_ids: [r.id],
      files: implFiles.map((p) => ({ path: p })),
      action: `Implement the smallest change satisfying ${r.id}: ${r.statement.slice(0, 220)}`,
      acceptance_tests: [
        { kind: "shell", cmd: "npx vitest run", expected_exit: 0 },
        { kind: "checklist", items: [`All ${acIds.length} test case(s) for ${r.id} green`, "No regression in existing suite"] },
      ],
      verification_cmd: { posix: `npx vitest run ${testFile}`, windows: `npx vitest run ${testFile}` },
      dod: [`All AC of ${r.id} satisfied`, "Test suite green", "No type errors"],
      rollback: `Revert implementation edits to ${implFiles.join(", ")}`,
      trace_links: [{ link_id: `TL-${greenId}-${r.id}`, source: { type: "Task", id: greenId }, target: { type: "Requirement", reference: r.id }, relation: "verifies" }],
      estimated_effort: r.priority === "high" ? "M" : "S",
      depends_on_task: [redId],
      covers_ac: acIds,
      tdd: { applicable: true, phase: "green", test_cases: mkTC("02"), red_evidence: null, green_evidence: null },
      test_files: [{ path: testFile }],
    });

    coverage.push({
      req_id: r.id,
      stability: r.stability,
      ac_total: acIds.length,
      ac_covered: acIds.length,
      missing_ac_ids: [],
      covered_tasks: [redId, greenId],
      ac_test_map: r.ac.map((a, i) => ({ ac_id: a.id, test_case_ids: [`TC-REQ-${reqNum}-AC${i + 1}-01`, `TC-REQ-${reqNum}-AC${i + 1}-02`] })),
    });

    for (const t of [redId, greenId]) traceLinksAll.push({ taskId: t, type: "Requirement", reference: r.id, relation: "verifies", link_id: `TL-${t}-${r.id}` });
  }
  phases.push({ id: ph.id, title: ph.title, goal: `Deliver all ${ph.scope} scope requirements (${rs.length} REQ)`, depends_on: ph.depends_on, task_ids: taskIds });
}

// ---- mcp_call_log ----
const mcp = [];
let seq = 0;
for (const tl of traceLinksAll) {
  const args = { source: { type: "Task", id: tl.taskId }, target: { type: "Requirement", reference: tl.reference }, relation: tl.relation };
  mcp.push({ seq: ++seq, call: "add_trace_link", args, args_hash: sha1(`add_trace_link|${canonJson(args)}`), response_hash: null, timestamp: NOW, ok: null });
}
for (const cov of coverage) {
  const args = { id: cov.req_id, type: "plan", reference: `${PLAN_MD}#${cov.covered_tasks.join(",")}` };
  mcp.push({ seq: ++seq, call: "add_verification_evidence", args, args_hash: sha1(`add_verification_evidence|${canonJson(args)}`), response_hash: null, timestamp: NOW, ok: null });
}

// ---- sidecar ----
const stabilitySummary = { frozen: 0, stable: 0, evolving: reqs.length, draft: 0 };
const sidecar = {
  schema_version: "1.1.0",
  plan_contract: "1.2.0",
  run_id: RUN_ID,
  target: "v3.0.0",
  plan_version: "0.1.0",
  generated_at: NOW,
  tool_versions: { speckiwi: "2.2.4", kiwi_planner: "0.6.0", validator: "0.6.0" },
  tdd_policy: "relaxed",
  md_path: PLAN_MD,
  md_sha256: "",
  phases,
  tasks,
  coverage,
  orphans: [],
  unreferenced_reqs: [],
  excluded_reqs: [],
  deferred_ac: [],
  risks: [
    { id: "R-01", severity: "med", description: "Dual CLI/MCP surface drift if ToolSpec SSOT (PH-001) not landed before adapter phases", mitigation: "PH-004/PH-005 depend on PH-003 which depends on PH-001; land ARCH first", affected_task_ids: phases.find((p) => p.id === "PH-004").task_ids.slice(0, 2) },
    { id: "R-02", severity: "low", description: "Large NODE phase (37 REQ) may need sub-batching during implementation", mitigation: "kiwi-pm processes tasks sequentially and is resumable", affected_task_ids: [] },
  ],
  open_questions: [],
  external_module_impact: [],
  tdd_decisions: [],
  coder_handoff_readiness: phases.map((p) => ({ phase_id: p.id, ready: true, blockers: [] })),
  mcp_call_log: mcp,
};

// ---- plan.md ----
const fm = [
  "---",
  `run_id: ${RUN_ID}`,
  "target: v3.0.0",
  "plan_version: 0.1.0",
  'plan_contract: "1.2.0"',
  `generated_at: ${NOW}`,
  "tool_versions:",
  "  speckiwi: 2.2.4",
  "  kiwi_planner: 0.6.0",
  "  validator: 0.6.0",
  "stability_summary:",
  `  frozen: ${stabilitySummary.frozen}`,
  `  stable: ${stabilitySummary.stable}`,
  `  evolving: ${stabilitySummary.evolving}`,
  `  draft: ${stabilitySummary.draft}`,
  "tdd_policy: relaxed",
  `sidecar_path: ./${RUN_ID}.sidecar.json`,
];

const lines = [];
lines.push("## §1 개요");
lines.push("");
lines.push("### 1.1 목표");
lines.push("");
lines.push("v3.0.0 활성 target 의 전체 요구사항(103건, 전부 evolving)을 TDD(red/green) 페어 Task 로 분해한 구현 계획. ToolSpec SSOT 기반 CLI/MCP 정합, 파서/검증 코어, mutation/query 확장, CLI/MCP 어댑터, 워크플로/규칙 통합을 포괄한다.");
lines.push("");
lines.push("### 1.2 범위");
lines.push("");
lines.push("- v3.0.0 target 의 비-deprecated 요구사항 전수(103건).");
lines.push("- 각 REQ 는 red(실패 테스트 선작성) + green(최소 구현) Task 페어로 분해.");
lines.push("");
lines.push("### 1.3 제외사항");
lines.push("");
lines.push("- 다른 target 의 요구사항. deprecated/draft 요구사항(현재 0건).");
lines.push("");
lines.push("### 1.4 전제조건 / 가정");
lines.push("");
lines.push("- speckiwi CLI(v2.2.4) 가용(cli-fallback 모드; MCP 미구성). 모든 trace 앵커는 cwd 내부.");
lines.push("");
lines.push("## §2 Phase 목록");
lines.push("");
lines.push("| phase_id | title | goal | depends_on | task_count |");
lines.push("| --- | --- | --- | --- | --- |");
for (const p of phases) lines.push(`| ${p.id} | ${p.title} | ${p.goal} | ${p.depends_on.join(" ") || "-"} | ${p.task_ids.length} |`);
lines.push("");
lines.push("## §3 Task 상세");
lines.push("");
const taskById = new Map(tasks.map((t) => [t.id, t]));
for (const p of phases) {
  lines.push(`### §3.${p.id} ${p.title}`);
  lines.push("");
  for (const tid of p.task_ids) {
    const t = taskById.get(tid);
    const filesStr = t.files.map((f) => (f.line_range ? `${f.path}:${f.line_range}` : f.path)).join(", ");
    lines.push(`#### §3.${p.id}.${t.id} ${t.title}`);
    lines.push("");
    lines.push(`- id: ${t.id}`);
    lines.push(`- phase_id: ${t.phase_id}`);
    lines.push(`- title: ${t.title}`);
    lines.push(`- type: ${t.type}`);
    lines.push(`- req_ids: [${t.req_ids.join(", ")}]`);
    lines.push(`- files: [${filesStr}]`);
    lines.push(`- action: ${t.action}`);
    lines.push(`- acceptance_tests: ${JSON.stringify(t.acceptance_tests)}`);
    lines.push(`- verification_cmd: ${t.verification_cmd ? JSON.stringify(t.verification_cmd) : "null"}`);
    lines.push(`- dod: ${t.dod.join("; ")}`);
    lines.push(`- rollback: ${t.rollback}`);
    lines.push(`- estimated_effort: ${t.estimated_effort}`);
    if (t.depends_on_task) lines.push(`- depends_on_task: [${t.depends_on_task.join(", ")}]`);
    lines.push(`- covers_ac: [${t.covers_ac.join(", ")}]`);
    lines.push(`- tdd: {applicable: ${t.tdd.applicable}, phase: ${t.tdd.phase}, test_cases_count: ${t.tdd.test_cases.length}}`);
    lines.push("");
  }
}
lines.push("## §4 REQ ↔ Task 역색인");
lines.push("");
lines.push("| req_id | stability | task_ids | ac_covered/ac_total |");
lines.push("| --- | --- | --- | --- |");
for (const cov of coverage) lines.push(`| ${cov.req_id} | ${cov.stability} | ${cov.covered_tasks.join(" ")} | ${cov.ac_covered}/${cov.ac_total} |`);
lines.push("");
lines.push("## §5 위험 · 미해결");
lines.push("");
lines.push("### 5.1 위험");
lines.push("");
for (const r of sidecar.risks) lines.push(`- ${r.id} (${r.severity}): ${r.description} — 완화: ${r.mitigation}`);
lines.push("");
lines.push("### 5.2 Open Questions");
lines.push("");
lines.push("- (없음)");
lines.push("");
lines.push("### 5.3 unreferenced_reqs");
lines.push("");
lines.push("- (없음 — 전 REQ 커버)");
lines.push("");
lines.push("## §6 부록");
lines.push("");
lines.push(`- 사이드카: ./${RUN_ID}.sidecar.json`);
lines.push(`- 검증: node ~/.claude/skills/kiwi-planner/validator.mjs ${PLAN_MD} ${SIDECAR} --target v3.0.0 --inventory-file ${DIR}/inventory.json --out docs/plans/${RUN_ID}.validator.json`);
lines.push(`- mcp_call_log: add_trace_link ${traceLinksAll.length} + add_verification_evidence ${coverage.length} = ${mcp.length}`);
lines.push("");

const body = lines.join("\n");
const mdSansHash = fm.join("\n") + "\n---\n\n" + body;
const md = fm.join("\n") + `\nmd_sha256: ${sha256(body)}\n---\n\n` + body;
sidecar.md_sha256 = sha256(body);

// Preserve executed mutation state + TDD evidence from prior sidecar (avoid re-running mutations / losing red evidence)
if (oldSidecar) {
  const oldOk = new Map((oldSidecar.mcp_call_log || []).map((e) => [e.args_hash, e]));
  for (const e of sidecar.mcp_call_log) {
    const prev = oldOk.get(e.args_hash);
    if (prev) { e.ok = prev.ok; e.response_hash = prev.response_hash; }
  }
  const oldTask = new Map((oldSidecar.tasks || []).map((t) => [t.id, t]));
  for (const t of sidecar.tasks) {
    const prev = oldTask.get(t.id);
    if (prev && prev.tdd) {
      if (prev.tdd.red_evidence) t.tdd.red_evidence = prev.tdd.red_evidence;
      if (prev.tdd.green_evidence) t.tdd.green_evidence = prev.tdd.green_evidence;
    }
  }
}

writeFileSync(PLAN_MD, md, "utf8");
writeFileSync(SIDECAR, JSON.stringify(sidecar, null, 1), "utf8");
console.log("phases", phases.length, "tasks", tasks.length, "coverage", coverage.length, "mcp", mcp.length);
console.log("plan bytes", md.length, "sidecar bytes", JSON.stringify(sidecar).length);
