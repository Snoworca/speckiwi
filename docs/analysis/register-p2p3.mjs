import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BIN = "C:/Users/beom/AppData/Roaming/npm/node_modules/speckiwi/bin/speckiwi";
const ROOT = process.cwd();
const run = (args) => execFileSync("node", [BIN, "--root", ROOT, ...args], { encoding: "utf8" });

// kiwi-srs Phase 4: P2 net-new batch (solid, low-governance-risk). new-feature, v3.0.0, evolving.
const REQS = [
  { type: "functional", scope: "NODE", priority: "low", title: "set-supersede core pairs supersede metadata with trace",
    statement: "The core layer provides a setSupersede mutation that updates either the Supersedes or the Superseded By metadata field of one requirement and, when trace sync is requested, also inserts the matching supersedes or superseded_by Trace Link row in the same transaction.",
    ac: [
      "setSupersede with a supersedes value writes only the Supersedes metadata field and changes no other metadata line.",
      "setSupersede with a superseded-by value writes only the Superseded By metadata field.",
      "setSupersede with trace sync enabled also inserts the matching supersedes or superseded_by Trace Link row.",
      "setSupersede on an unknown requirement id returns ok false and writes no file.",
      "A dry-run call returns a patch preview and leaves the file unchanged on disk."
    ], trace: "Code|src/core/mutation/add-trace.ts:1|addition_site", deps: ["FR-NODE-008"] },

  { type: "interface", scope: "CLI", priority: "low", title: "speckiwi set-supersede command",
    statement: "The speckiwi set-supersede command delegates to the setSupersede core to update the Supersedes or Superseded By metadata of a requirement, supports a sync-trace flag, dry-run, and json, and edits no requirement Status.",
    ac: [
      "speckiwi set-supersede <id> --supersedes <oldId> updates the Supersedes metadata field.",
      "speckiwi set-supersede <id> --superseded-by <newId> updates the Superseded By metadata field.",
      "speckiwi set-supersede --sync-trace also writes the matching Trace Link row.",
      "speckiwi set-supersede --dry-run prints a preview and writes no file."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["NEW:set-supersede core pairs supersede metadata with trace"] },

  { type: "functional", scope: "NODE", priority: "medium", title: "register-scopes core registers unregistered scope documents",
    statement: "The core layer provides a registerScopes mutation that adds every discovered srs.md scope document missing from the index Scope Map, the SRS-W018 set, as a Scope Map row, inferring the prefix from the requirement id prefixes in that document, defaulting to dry-run and reporting a skip reason for prefix conflicts.",
    ac: [
      "registerScopes in dry-run lists the unregistered scope documents it would add and writes no file.",
      "registerScopes with apply inserts one Scope Map row for each unregistered scope document.",
      "A scope document whose inferred prefix collides with an existing Scope Map prefix is skipped with a skip reason and not added.",
      "registerScopes modifies no Requirement Block and no Status or Type summary count."
    ], trace: "Code|src/core/validator/rules.ts:134|addition_site", deps: ["FR-PARSE-009"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi register-scopes command",
    statement: "The speckiwi register-scopes command delegates to the registerScopes core to batch-register unregistered scope documents into the Scope Map, defaults to dry-run, writes only with apply, and supports json.",
    ac: [
      "speckiwi register-scopes with no apply prints the planned Scope Map additions and writes no file.",
      "speckiwi register-scopes --apply inserts the Scope Map rows.",
      "speckiwi register-scopes --json emits the mutation result envelope.",
      "speckiwi register-scopes reports a skip reason for each prefix-conflicting document."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["NEW:register-scopes core registers unregistered scope documents"] },

  { type: "functional", scope: "NODE", priority: "medium", title: "scaffold-scope core creates and registers a new scope",
    statement: "The core layer provides a scaffoldScope mutation that creates a new scope srs.md file from the scope template and registers it in the index SRS Documents section and Scope Map section in one operation, defaulting to dry-run.",
    ac: [
      "scaffoldScope creates a new numbered scope srs.md file containing the scope template frontmatter and sections.",
      "scaffoldScope adds one row to the index SRS Documents section and one row to the Scope Map section.",
      "scaffoldScope with a name or prefix that collides with an existing scope returns ok false and writes no file.",
      "A dry-run call returns a preview of the file and index rows and writes no file."
    ], trace: "Code|src/core/bootstrap/init-project.ts:1|addition_site", deps: ["FR-NODE-008"] },

  { type: "interface", scope: "CLI", priority: "medium", title: "speckiwi scaffold-scope command",
    statement: "The speckiwi scaffold-scope command delegates to the scaffoldScope core to create and register a new scope, accepts an optional prefix and description, defaults to dry-run, and supports json.",
    ac: [
      "speckiwi scaffold-scope <name> creates the scope file and registers it in the index in one command.",
      "speckiwi scaffold-scope <name:PREFIX> uses the given prefix instead of inferring one.",
      "speckiwi scaffold-scope --dry-run prints a preview and writes no file.",
      "speckiwi scaffold-scope --json emits the mutation result envelope."
    ], trace: "Code|src/cli/commands/mutations.ts:1|addition_site", deps: ["NEW:scaffold-scope core creates and registers a new scope"] },

  { type: "interface", scope: "CLI", priority: "low", title: "speckiwi stale command for aging requirements",
    statement: "The speckiwi stale command identifies requirements that have stayed in evolving stability past a threshold measured by their most recent Change Notes date or whose verification evidence is older than a threshold, computing age from SRS date metadata only, supports optional target and json, and never writes a file.",
    ac: [
      "speckiwi stale lists requirements in evolving stability whose latest Change Notes date is older than the evolving-age threshold.",
      "speckiwi stale --evidence-age <days> flags requirements whose verification evidence is older than the given number of days.",
      "speckiwi stale computes age only from SRS date metadata and never reads outside the repository.",
      "speckiwi stale writes no file."
    ], trace: "Code|src/core/query/summary.ts:42|addition_site", deps: ["FR-PARSE-009"] }
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
  console.log("REG", r.scope, id, "<=", r.title.slice(0, 48));
}
writeFileSync("docs/analysis/2026-06-08-p2p3-id-map.json", JSON.stringify(titleToId, null, 1));

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
