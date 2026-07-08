import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "C:/Work/git/_Snoworca/speckiwi";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const reqs = readJson(`${ROOT}/docs/analysis/2026-06-05-v3-part3-reqs.json`);
const part2Map = readJson(`${ROOT}/docs/analysis/2026-06-05-v3-title-id-map.json`);

const q = (s) => '"' + String(s) + '"';
const run = (parts) => execSync("speckiwi " + parts.map(q).join(" "), { cwd: ROOT, encoding: "utf8" });

const map = {}; // part3 title -> id
// REQ index 0 already registered manually:
map[reqs[0].title] = "FR-PARSE-028";

const log = { registered: [], traces: [], errors: [] };

// 1) register reqs[1..]
for (let i = 1; i < reqs.length; i++) {
  const r = reqs[i];
  const parts = [
    "add-requirement", "--json",
    "--type", r.type, "--scope", r.scope, "--target", "v3.0.0",
    "--title", r.title, "--requirement", r.statement,
    "--status", "planned", "--stability", "evolving", "--priority", "P2",
    "--tags", "feasibility:high", "--trace", r.trace,
  ];
  for (const ac of r.ac) parts.push("--ac", ac);
  try {
    const out = run(parts);
    const id = JSON.parse(out).value.requirementId;
    map[r.title] = id;
    log.registered.push(`${id}\t${r.scope}\t${r.title}`);
  } catch (e) {
    log.errors.push(`REGISTER FAIL: ${r.title} :: ${String(e.stdout || e.message).slice(0, 400)}`);
  }
}

// 2) wire depends_on (all 20)
const combined = { ...part2Map, ...map };
for (const r of reqs) {
  const srcId = combined[r.title];
  if (!srcId) { log.errors.push(`NO SRC ID: ${r.title}`); continue; }
  for (const depTitle of r.depends_on_titles || []) {
    const depId = combined[depTitle];
    if (!depId) { log.errors.push(`UNRESOLVED DEP: ${r.title} -> ${depTitle}`); continue; }
    if (depId === srcId) continue;
    try {
      run(["add-trace", srcId, "--type", "Requirement", "--reference", depId, "--relation", "depends_on", "--json"]);
      log.traces.push(`${srcId} depends_on ${depId}`);
    } catch (e) {
      log.errors.push(`TRACE FAIL: ${srcId} -> ${depId} :: ${String(e.stdout || e.message).slice(0, 300)}`);
    }
  }
}

writeFileSync(`${ROOT}/docs/analysis/2026-06-05-v3-part3-title-id-map.json`, JSON.stringify(map, null, 0));
console.log(`registered=${log.registered.length + 1}/20  traces=${log.traces.length}  errors=${log.errors.length}`);
console.log("--- registered ---\n" + log.registered.join("\n"));
console.log("--- traces ---\n" + log.traces.join("\n"));
if (log.errors.length) console.log("--- ERRORS ---\n" + log.errors.join("\n"));
