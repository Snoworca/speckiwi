import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";

// Round-8 verification: kiwi-wave-master §7.5.1 now lists the three PRD stops as gates `--drive`
// does not open, and §7.5.3 tells the run to name the gate it stopped at in `waves.jsonl`'s
// `abort_gate`. `abort_gate` only takes a `GateId`; §7.5.3 lists the child-owned gates that must be
// written under another id (`serial-unit-failed`) but not the PRD stops, which are not `GateId`
// members either. Following §7.5.3 for a PRD stop writes `abort_gate: prd-record-tampered`, which
// `orchestrate run abort` refuses with `abort-gate-outside-vocabulary` and keeps the lock held —
// the `--drive` stop the PRD record needs cannot be journaled as the skill says.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc"] as const;
const PRD_STOPS = ["prd-record-tampered", "prd-unapproved-user-decision", "prd-residual-user-decision"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function section(text: string, heading: RegExp): string {
  const at = text.search(heading);
  expect(at, `precondition: heading ${heading}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n#### ", at + 1);
  return text.slice(at, end < 0 ? text.length : end);
}

async function cli(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

// @req FR-FLOW-205 AC-7 — a --drive stop at a PRD gate is journaled under a GateId the skill names
describe("a --drive stop at a PRD gate can be journaled as §7.5.3 says (verify-r8)", () => {
  it("precondition: the PRD stops are outside the GateId vocabulary and run abort refuses them", async () => {
    for (const gate of PRD_STOPS) expect((GATE_IDS as readonly string[]).includes(gate), gate).toBe(false);
    const root = await mkdtemp(path.join(tmpdir(), "verify-r8-abort-"));
    await promisify(execFile)("git", ["init", "--quiet"], { cwd: root });
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
    expect((await cli(["--root", root, "orchestrate", "run", "lock", "--owner", "verify-r8"])).exit).toBe(0);
    const refused = await cli(["--root", root, "orchestrate", "run", "abort", "--reason", "prd-record-tampered", "--run-id", "r8"]);
    expect(refused.exit).not.toBe(0);
    expect(JSON.stringify(refused.payload)).toContain("abort-gate-outside-vocabulary");
  });

  for (const root of RENDERINGS) {
    const text = read(`${root}/kiwi-wave-master/SKILL.md`);
    const closed = section(text, /^#### 7\.5\.1 .*--drive/m);
    const journal = section(text, /^#### 7\.5\.3 /m);

    it(`${root}: precondition — §7.5.1 closes the PRD stops and §7.5.3 names the stopped gate in abort_gate`, () => {
      for (const gate of PRD_STOPS) expect(closed, gate).toContain(`\`${gate}\``);
      expect(journal).toContain("`abort_gate`");
      expect(journal).toContain("abort-gate-outside-vocabulary");
    });

    for (const gate of PRD_STOPS) {
      it(`${root}: §7.5.3 says which GateId carries ${gate}`, () => {
        expect(journal.includes(gate), `§7.5.3 of ${root}/kiwi-wave-master does not name ${gate}`).toBe(true);
      });
    }
  }
});
