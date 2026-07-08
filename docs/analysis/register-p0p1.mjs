import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BIN = "C:/Users/beom/AppData/Roaming/npm/node_modules/speckiwi/bin/speckiwi";
const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync("docs/analysis/2026-06-08-p0p1-reqs.json", "utf8").replace(/^﻿/, ""));
const registerNew = manifest.register_new;
const order = (manifest.registration_order || []).slice();

const byTitle = new Map(registerNew.map((r) => [r.title, r]));
for (const r of registerNew) if (!order.includes(r.title)) order.push(r.title);

const prio = (p) => (p === "P0" ? "high" : "medium");
const titleToId = {};

function run(args) {
  return execFileSync("node", [BIN, "--root", ROOT, ...args], { encoding: "utf8" });
}

// Phase 1: register requirements in dependency order
for (const title of order) {
  const r = byTitle.get(title);
  if (!r) continue;
  const args = [
    "add-requirement", "--type", r.type, "--scope", r.scope, "--target", "v3.0.0",
    "--title", r.title, "--requirement", r.statement,
    "--status", "planned", "--stability", "evolving", "--priority", prio(r.priority),
    "--tags", "feasibility:high", "--trace", r.trace, "--json"
  ];
  for (const a of r.ac || []) args.push("--ac", a);
  let id = "FAIL";
  try {
    const out = run(args);
    const j = JSON.parse(out);
    id = (j.value && j.value.requirementId) || j.requirementId || ("PARSE:" + out.slice(0, 80));
  } catch (e) {
    id = "ERR:" + String(e.stdout || e.message || "").slice(0, 140);
  }
  titleToId[title] = id;
  console.log("REG", r.scope, id, "<=", title.slice(0, 52));
}
writeFileSync("docs/analysis/2026-06-08-p0p1-id-map.json", JSON.stringify(titleToId, null, 1));

// Phase 2: depends_on trace links (NEW:title resolved to minted ids)
let ok = 0, fail = 0;
const bad = (x) => !x || x.startsWith("ERR") || x.startsWith("FAIL") || x.startsWith("PARSE");
for (const title of order) {
  const r = byTitle.get(title);
  if (!r) continue;
  const id = titleToId[title];
  if (bad(id)) continue;
  for (const dep of r.depends_on || []) {
    let ref = dep.startsWith("NEW:") ? titleToId[dep.slice(4)] : dep;
    if (bad(ref) || ref === id) { console.log("SKIP", id, dep.slice(0, 44)); continue; }
    try { run(["add-trace", id, "--type", "Requirement", "--reference", ref, "--relation", "depends_on", "--json"]); ok++; }
    catch (e) { fail++; console.log("TLFAIL", id, "->", ref, String(e.stdout || e.message || "").slice(0, 90)); }
  }
}
console.log("TRACELINKS ok", ok, "fail", fail);
console.log("DONE");
