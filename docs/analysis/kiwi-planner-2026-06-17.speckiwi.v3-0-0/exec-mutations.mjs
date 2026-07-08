import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const BIN = "C:/Users/beom/AppData/Roaming/npm/node_modules/speckiwi/bin/speckiwi";
const ROOT = "C:/Work/git/_Snoworca/speckiwi";
const SIDECAR = "docs/plans/2026-06-17.speckiwi.v3-0-0.sidecar.json";
const DIR = "docs/analysis/kiwi-planner-2026-06-17.speckiwi.v3-0-0";
const JSONL = `${DIR}/mcp_call_log.jsonl`;
const sha1 = (s) => createHash("sha1").update(s, "utf8").digest("hex");
const run = (args) => execFileSync("node", [BIN, "--root", ROOT, ...args], { encoding: "utf8" });

const sc = JSON.parse(readFileSync(SIDECAR, "utf8"));
writeFileSync(JSONL, "");

const flatten = (e) => {
  if (e.call === "add_trace_link") {
    const a = e.args;
    return ["add-trace", a.target.reference, "--type", "Task", "--reference", a.source.id, "--relation", "depends_on", "--json"];
  }
  if (e.call === "add_verification_evidence") {
    const a = e.args;
    return ["add-evidence", a.id, "--type", "plan", "--reference", a.reference, "--json"];
  }
  return null;
};

const traceEntries = sc.mcp_call_log.filter((e) => e.call === "add_trace_link");
const evEntries = sc.mcp_call_log.filter((e) => e.call === "add_verification_evidence");

let okCount = 0, failCount = 0;
let step1Failed = false;

// Step 1: add_trace_link (seq 1 already applied manually -> mark ok, skip exec)
for (const e of traceEntries) {
  if (e.seq === 1) { e.ok = true; e.response_hash = sha1("preapplied"); okCount++; appendFileSync(JSONL, JSON.stringify({ seq: e.seq, call: e.call, ok: true, note: "preapplied" }) + "\n"); continue; }
  try {
    const out = run(flatten(e));
    const j = JSON.parse(out);
    e.ok = !!j.ok;
    e.response_hash = sha1(out);
    if (j.ok) okCount++; else { failCount++; step1Failed = true; }
    appendFileSync(JSONL, JSON.stringify({ seq: e.seq, call: e.call, ok: e.ok }) + "\n");
  } catch (err) {
    e.ok = false; e.response_hash = null; failCount++; step1Failed = true;
    appendFileSync(JSONL, JSON.stringify({ seq: e.seq, call: e.call, ok: false, err: String(err.stdout || err.message).slice(0, 160) }) + "\n");
  }
}

console.log("STEP1 add_trace_link: ok", okCount, "fail", failCount);

// §0.11: step1 partial failure blocks step2
let evOk = 0, evFail = 0;
if (step1Failed) {
  console.log("STEP1 had failures -> STEP2 (add_verification_evidence) BLOCKED");
} else {
  for (const e of evEntries) {
    try {
      const out = run(flatten(e));
      const j = JSON.parse(out);
      e.ok = !!j.ok; e.response_hash = sha1(out);
      if (j.ok) evOk++; else evFail++;
      appendFileSync(JSONL, JSON.stringify({ seq: e.seq, call: e.call, ok: e.ok }) + "\n");
    } catch (err) {
      e.ok = false; e.response_hash = null; evFail++;
      appendFileSync(JSONL, JSON.stringify({ seq: e.seq, call: e.call, ok: false, err: String(err.stdout || err.message).slice(0, 160) }) + "\n");
    }
  }
  console.log("STEP2 add_verification_evidence: ok", evOk, "fail", evFail);
}

writeFileSync(SIDECAR, JSON.stringify(sc, null, 1), "utf8");
console.log("DONE total ok", okCount + evOk, "fail", failCount + evFail);
