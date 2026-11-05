import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 1, bundle d1.
// Every test here is meant to be red: it shows a place where the shipped skills or the new contract
// tests do not hold an acceptance criterion. Nothing in the repository is changed; mutations run on a
// temporary copy.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const pmFiles = (root: string): string[] =>
  root === "skills/claude" ? [`${root}/kiwi-pm/SKILL.md`] : [`${root}/kiwi-pm/SKILL.md`, `${root}/kiwi-pm/references/extended-workflow.md`];
const pmText = (root: string): string => pmFiles(root).map(read).join("\n");

describe("FR-FLOW-211 — the PM call SSOT names the read the gate now makes", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-1 AC-4 — the lifecycle gate and promotion read by `get_requirement`, so the
    // §0.12 row that calls itself the signature SSOT of PM calls must list it among PM reads.
    it(`${root}: §0.12 lists get_requirement among the PM reads`, () => {
      const row = read(`${root}/kiwi-pm/SKILL.md`).split("\n").find((line) => line.startsWith("| §0.12 |")) ?? "";
      const reads = /read \d+종: ([^.]+)\./.exec(row)?.[1] ?? "";
      expect(reads, `${root}: §0.12 read list`).toContain("`get_requirement`");
    });
  }
});

/** One pseudocode function: from its `FUNCTION <name>(` line to the closing fence. */
function fn(text: string, name: string): string[] {
  const start = text.indexOf(`FUNCTION ${name}(`);
  if (start < 0) return [];
  const end = text.indexOf("\n```", start);
  return text.slice(start, end < 0 ? undefined : end).split("\n");
}
const indent = (line: string): number => line.length - line.trimStart().length;
function ancestors(lines: readonly string[], at: number): string[] {
  const found: string[] = [];
  let depth = indent(lines[at] as string);
  for (let index = at - 1; index >= 0 && depth > 0; index -= 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || indent(line) >= depth) continue;
    found.push(line.trim());
    depth = indent(line);
  }
  return found;
}
/** Whether every enclosing branch of `lines[at]` is taken for a run given both --req-filter and --sds. */
function reachedWithBothFlags(lines: readonly string[], at: number): boolean {
  return ancestors(lines, at).every((guard) => {
    if (guard.startsWith("FUNCTION ") || guard === "TRY:") return true;
    if (guard.startsWith("IF NOT args.req_filter")) return false;
    if (/^IF state.sds_path AND NOT args.req_filter/.test(guard)) return false;
    if (guard.startsWith("IF state.sds_path")) return true;
    if (guard === "ELSE:") return false; // the ELSE of `IF state.sds_path:` in this function
    throw new Error(`unknown guard: ${guard}`);
  });
}

describe("FR-FLOW-211 — the gate binds the target it reads by", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-1 — kiwi-pm takes --req-filter and --sds together (§1.3 forbids neither;
    // kiwi-orchestrator gives both to a --sds wave). On that run the gate skips the active-target step
    // (guarded by --req-filter) but still reads `list_requirements(target=target)` (guarded by
    // --sds), so it reads by a target it never bound instead of by ID.
    it(`${root}: with --req-filter and --sds, target is bound wherever the gate reads by it`, () => {
      const gate = fn(pmText(root), "APPLY_LIFECYCLE_GATE");
      const bind = gate.findIndex((line) => /^\s*target = .*get_active_target/.test(line));
      const use = gate.findIndex((line) => /MCP_CALL\(list_requirements, target=target/.test(line));
      expect(bind, `${root}: target binding`).toBeGreaterThan(0);
      expect(use, `${root}: by-target read`).toBeGreaterThan(0);
      // Lead decision (round 1): AC-1 says a --req-filter run reads by ID, so the by-target read need not
      // run with both flags. The property kept is the defect's: a by-target read that runs has a bound target.
      if (reachedWithBothFlags(gate, use)) {
        expect(reachedWithBothFlags(gate, bind), `${root}: target = get_active_target runs with both flags`).toBe(true);
      }
    });
  }
});

// Mutation runs of the FR-FLOW-211 contract test on a temporary copy of the skills.
const CONTRACT = "test/skills/kiwi-pm-req-filter-by-id.fr-flow-211.test.ts";
let sandbox = "";

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-d1-"));
  for (const rel of ["skills", ".agents/skills", "package.json"]) cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  mkdirSync(path.join(sandbox, "test/skills"), { recursive: true });
  for (const rel of [CONTRACT, "test/skills/kiwi-renderings.ts", "test/skills/kiwi-orchestrator-variants.ts"]) cpSync(path.join(REPO, rel), path.join(sandbox, rel));
  // kiwi-orchestrator-variants imports VERBS only for orchestrator suites; a stub keeps the copy off the live src tree.
  mkdirSync(path.join(sandbox, "src/core/orchestrator"), { recursive: true });
  writeFileSync(path.join(sandbox, "src/core/orchestrator/journal-schema.ts"), "export const VERBS = [] as const;\n");
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  // Baseline: the unmutated copy must pass, or a red mutation run proves nothing.
  if (runContract().status !== 0) throw new Error("the contract test does not pass on the unmutated copy");
}, 120000);

function runContract() {
  return spawnSync(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", CONTRACT, "--root", sandbox], {
    cwd: sandbox,
    encoding: "utf8"
  });
}

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

/** Runs the contract test on the sandbox with `rel` replaced by `mutate(original)`; true when it fails. */
function contractFailsWith(rel: string, mutate: (text: string) => string): boolean {
  const file = path.join(sandbox, rel);
  const original = readFileSync(file, "utf8");
  const mutated = mutate(original);
  expect(mutated, "the mutation changes the file").not.toBe(original);
  writeFileSync(file, mutated);
  try {
    return runContract().status !== 0;
  } finally {
    writeFileSync(file, original);
  }
}

describe("FR-FLOW-211 — the contract test turns red when a by-ID rule is removed", () => {
  // @req FR-FLOW-211 AC-1 — claude §4.4: the gate's CLI fallback for a --req-filter run reads by ID.
  // Removing that clause leaves `speckiwi list --target {target}`, the active-target read AC-1 removes.
  it("claude: dropping the by-ID CLI fallback of §4.4 fails the contract test", () => {
    expect(contractFailsWith("skills/claude/kiwi-pm/SKILL.md", (text) => text.replace(" (요구 집합 실행은 요구마다 `speckiwi show <ID> --json`)", ""))).toBe(true);
  }, 120000);

  // @req FR-FLOW-211 AC-1 — claude §4 intro: restoring the batch `list_requirements` read for every run.
  it("claude: restoring §4's single list_requirements read fails the contract test", () => {
    expect(
      contractFailsWith("skills/claude/kiwi-pm/SKILL.md", (text) =>
        text.replace(
          "요구 집합(§2.2 `req_ids`)을 평가한다 — 요구 집합 실행은 요구마다 `get_requirement` 로 ID 로 읽고(§1.1), `--sds` 실행은 1회 `list_requirements` read 로 일괄 평가한다.",
          "요구 집합(§2.2 `req_ids`)을 1회 `list_requirements` read 로 일괄 평가."
        )
      )
    ).toBe(true);
  }, 120000);

  // @req FR-FLOW-211 AC-1 AC-4 — codex §4.4: the MCP read of a --req-filter run is by ID.
  it("codex: dropping the by-ID MCP read of §4.4 fails the contract test", () => {
    expect(
      contractFailsWith("skills/codex/kiwi-pm/references/extended-workflow.md", (text) =>
        text.replace(" — 요구 집합 실행은 요구마다 `mcp__speckiwi__get_requirement(id)`", "")
      )
    ).toBe(true);
  }, 120000);
});
