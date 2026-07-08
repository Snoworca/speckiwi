import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BIN = "C:/Users/beom/AppData/Roaming/npm/node_modules/speckiwi/bin/speckiwi";
const ROOT = process.cwd();
const run = (args) => execFileSync("node", [BIN, "--root", ROOT, ...args], { encoding: "utf8" });

// kiwi-srs Phase 4: new-feature batch. All target v3.0.0, status planned, stability evolving.
// addition_site traces (not yet implemented) keep status at planned per skill section 0.14.
const REQS = [
  // ---- P0: sync-counts (core + command) ----
  { type: "functional", scope: "NODE", priority: "high", title: "sync-counts core recomputes index summary cells from records",
    statement: "The core layer provides a syncCounts mutation that recomputes the 00.index Status Summary and Requirement Type Summary count cells from the full set of Requirement Block records using the same countsByStatus and countsByType logic as summarizeTarget, rewrites only those summary cells in place, and defaults to a check that reports drift without writing.",
    ac: [
      "syncCounts defaults to a check that returns each summary cell expected versus actual count and writes no file.",
      "With apply enabled syncCounts rewrites the Status Summary and Requirement Type Summary cells to the actual record counts and changes no other line.",
      "syncCounts modifies no Requirement Block Status, Stability, or id and does not change the Active Target.",
      "When the declared counts already equal the actual counts syncCounts performs zero write operations.",
      "syncCounts reuses the existing patch-plan stale-snapshot guard so a concurrent edit yields a stale-patch failure."
    ], trace: "Code|src/core/query/summary.ts:42|addition_site", deps: ["FR-NODE-013"] },

  { type: "interface", scope: "CLI", priority: "high", title: "speckiwi sync-counts command",
    statement: "The speckiwi sync-counts command delegates to the syncCounts core, defaults to a non-writing check, writes the index summary cells only with apply, supports json output, and returns a non-zero exit code under check when count drift exists so it can gate CI.",
    ac: [
      "speckiwi sync-counts with no apply prints a per-cell drift report and writes no file.",
      "speckiwi sync-counts --apply updates the 00.index Status Summary and Requirement Type Summary cells.",
      "speckiwi sync-counts --json emits the mutation result envelope consistent with other commands.",
      "speckiwi sync-counts --check returns a non-zero exit code when any summary count differs from the actual record count."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["NEW:sync-counts core recomputes index summary cells from records"] },

  // ---- P1: supersede CLI mirror ----
  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi supersede command",
    statement: "The speckiwi supersede command mirrors the existing supersede_requirement core mutation by creating a successor requirement that traces supersedes the old id and then discarding the old requirement in one command, returning the new id, supporting dry-run and json, and delegating every core guard without a bypass option.",
    ac: [
      "speckiwi supersede --old <id> --new-title <t> --new-statement <s> --scope <s> --type <ty> creates a successor requirement and discards the old requirement, returning the new id.",
      "speckiwi supersede --dry-run prints a preview of the two-step sequence and writes no file.",
      "The command passes the core self-reference, reverse-duplicate, and verified-regression guards through without any bypass flag.",
      "speckiwi supersede --json emits the mutation result envelope consistent with other mutation commands."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["FR-NODE-030"] },

  // ---- P1: restore (core + command) ----
  { type: "functional", scope: "NODE", priority: "medium", title: "restore core un-discards a requirement with required reason",
    statement: "The core layer provides a restore mutation that transitions a discarded requirement back to an active status defaulting to planned, removes the heading strikethrough and DISCARDED marker, restores the Status metadata, and appends a Change Notes row in one transaction, requiring a reason and warning when a previously verified requirement is restored.",
    ac: [
      "restore on a discarded requirement sets its Status to the requested active status, defaulting to planned.",
      "restore removes the heading strikethrough and the DISCARDED marker from the requirement heading.",
      "restore appends one Change Notes row carrying the supplied reason in the same patch.",
      "restore without a reason returns ok false and writes no file.",
      "restoring a requirement that was previously verified emits a stale acceptance-criteria and evidence warning."
    ], trace: "Code|src/core/mutation/update-status.ts:78|addition_site", deps: ["FR-NODE-019"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi restore command",
    statement: "The speckiwi restore command delegates to the restore core to un-discard a requirement, requires a reason, supports an optional target status, dry-run, and json, and writes nothing when the reason is missing.",
    ac: [
      "speckiwi restore <id> --reason <r> un-discards the requirement to planned by default.",
      "speckiwi restore <id> --to <status> --reason <r> un-discards to the given active status.",
      "speckiwi restore --dry-run prints a preview and writes no file.",
      "speckiwi restore without --reason returns a non-zero exit code and writes no file."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["NEW:restore core un-discards a requirement with required reason"] },

  // ---- P1: read-only commands ----
  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi history command for requirement Change Notes",
    statement: "The speckiwi history command outputs the Change Notes of a single requirement as date, change, and reason rows sorted chronologically, supports an optional since filter and json, and never writes a file.",
    ac: [
      "speckiwi history <id> lists the requirement Change Notes rows in ascending date order.",
      "speckiwi history <id> --since <date> includes only rows on or after the date inclusive.",
      "speckiwi history on an unknown requirement id returns a non-zero exit code.",
      "speckiwi history on a requirement with no Change Notes returns an empty result without error."
    ], trace: "Code|src/core/query/records.ts:140|addition_site", deps: ["FR-PARSE-009"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi changed-since command for cross-requirement timeline",
    statement: "The speckiwi changed-since command aggregates requirements whose most recent Change Notes date is on or after a given date across all requirements, supports optional target and scope filters and json, and never writes a file.",
    ac: [
      "speckiwi changed-since <date> returns requirements with a Change Notes date on or after the date.",
      "speckiwi changed-since <date> --target <t> and --scope <s> restrict the result set.",
      "speckiwi changed-since with a malformed date returns exit code two.",
      "speckiwi changed-since with a future date returns an empty result set."
    ], trace: "Code|src/core/query/summary.ts:85|addition_site", deps: ["FR-PARSE-009"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi attention command for a ranked work queue",
    statement: "The speckiwi attention command merges blocked, implemented-not-verified, missing-evidence, and stability-blocker requirements into one priority-ranked work queue with a deterministic tie-break of priority then risk then status, supports optional target and top limit and json, and never writes a file.",
    ac: [
      "speckiwi attention ranks the merged queue deterministically by priority then risk then status.",
      "speckiwi attention --top <n> limits the output to the first n entries.",
      "speckiwi attention --top with a negative value returns exit code two.",
      "speckiwi attention writes no file and reports the same order for identical input."
    ], trace: "Code|src/core/query/summary.ts:85|addition_site", deps: ["FR-PARSE-009"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi commands catalog manifest",
    statement: "The speckiwi commands command renders the full command catalog with name, kind, args, options, read-only flag, and result exit mapping from the ToolSpec registry in a single call, supports json, and never writes a file.",
    ac: [
      "speckiwi commands --json emits every registered command with name, kind, args, options, and read-only flag.",
      "The catalog is derived from the ToolSpec registry and does not hardcode an expected command list.",
      "speckiwi commands writes no file.",
      "Adding a ToolSpec entry makes that command appear in the catalog without a separate edit."
    ], trace: "Code|src/mcp/schemas.ts:1|addition_site", deps: ["FR-ARCH-006", "REL-ARCH-002"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi doctor environment health command",
    statement: "The speckiwi doctor command reports a consolidated health diagnosis covering docs spec presence and parseability, agent workflow block version currency, bundled versus installed rules version drift, Active Target set, scope and target consistency, and Node version, supports json, and with fix re-runs the idempotent init upsert for missing or outdated workflow blocks only.",
    ac: [
      "speckiwi doctor reports each checked item with an ok, warn, or fail state and a remediation hint.",
      "speckiwi doctor --json emits the structured diagnosis report.",
      "speckiwi doctor without --fix writes no file.",
      "speckiwi doctor --fix re-upserts only missing or outdated agent workflow blocks and changes no Requirement Block data."
    ], trace: "Code|src/core/bootstrap/init-project.ts:1|addition_site", deps: ["FR-NODE-044"] },

  // ---- P1: rules CLI-first policy ----
  { type: "functional", scope: "FLOW", priority: "medium", title: "init agent workflow block declares a tool-first write policy",
    statement: "The init-injected agent instruction block, rendered by renderAgentInstructionSnippet and versioned by AGENT_INSTRUCTION_VERSION and made canonical by the SRS-MD-Rules managed block, states a tool-first write policy in which agents prefer SpecKiwi MCP tools and the speckiwi CLI when MCP is unavailable over direct Markdown editing for structured-data mutations, while agents may read SRS Markdown directly and may edit free-text prose directly, and when no tool covers a required mutation agents may edit Markdown directly but must report the missing-tool gap.",
    ac: [
      "The agent instruction block text states that structured-data mutations prefer SpecKiwi tools over direct Markdown editing and that reading Markdown and editing free-text prose directly is allowed.",
      "The block states that a mutation with no covering tool may be done by direct edit but the missing-tool gap must be reported in the work summary.",
      "The block reaffirms that the policy does not override docs-only operability and does not create a requirements source outside docs/spec.",
      "AGENT_INSTRUCTION_VERSION is raised for this change and the idempotent init upsert deterministically replaces an outdated block.",
      "The SRS-MD-Rules managed block body and the rendered template output contain the same tool-first wording."
    ], trace: "Code|src/core/bootstrap/templates.ts:229|addition_site", deps: ["FR-NODE-044", "FR-FLOW-006"] }
];

const titleToId = {};
for (const r of REQS) {
  const args = ["add-requirement", "--type", r.type, "--scope", r.scope, "--target", "v3.0.0",
    "--title", r.title, "--requirement", r.statement, "--status", "planned", "--stability", "evolving",
    "--priority", r.priority, "--tags", "feasibility:high", "--trace", r.trace, "--json"];
  for (const a of r.ac) args.push("--ac", a);
  let id = "FAIL";
  try { const j = JSON.parse(run(args)); id = (j.value && j.value.requirementId) || j.requirementId || ("P:" + JSON.stringify(j).slice(0, 80)); }
  catch (e) { id = "ERR:" + String(e.stdout || e.message || "").slice(0, 130); }
  titleToId[r.title] = id;
  console.log("REG", r.scope, id, "<=", r.title.slice(0, 50));
}
writeFileSync("docs/analysis/2026-06-08-netnew-id-map.json", JSON.stringify(titleToId, null, 1));

const bad = (x) => !x || x.startsWith("ERR") || x.startsWith("FAIL") || x.startsWith("P:");
let ok = 0, fail = 0;
for (const r of REQS) {
  const id = titleToId[r.title];
  if (bad(id)) continue;
  for (const dep of r.deps || []) {
    const ref = dep.startsWith("NEW:") ? titleToId[dep.slice(4)] : dep;
    if (bad(ref) || ref === id) { console.log("SKIP", id, dep.slice(0, 40)); continue; }
    try { run(["add-trace", id, "--type", "Requirement", "--reference", ref, "--relation", "depends_on", "--json"]); ok++; }
    catch (e) { fail++; console.log("TLFAIL", id, "->", ref, String(e.stdout || e.message || "").slice(0, 80)); }
  }
}
console.log("TRACELINKS ok", ok, "fail", fail, "\nDONE");
