import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 2, bundle d1.
// Every test here is meant to be red: it shows a place where the shipped skills or the new contract
// tests do not hold an acceptance criterion. Nothing in the repository is changed; mutations run on a
// temporary copy.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

/** One pseudocode function: from its `FUNCTION <name>(` line to the closing fence. */
function fn(text: string, name: string): string[] {
  const start = text.indexOf(`FUNCTION ${name}(`);
  if (start < 0) return [];
  const end = text.indexOf("\n```", start);
  return text.slice(start, end < 0 ? undefined : end).split("\n");
}
const indent = (line: string): number => line.length - line.trimStart().length;
function ancestors(lines: readonly string[], at: number): number[] {
  const found: number[] = [];
  let depth = indent(lines[at] as string);
  for (let index = at - 1; index >= 0 && depth > 0; index -= 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || indent(line) >= depth) continue;
    found.push(index);
    depth = indent(line);
  }
  return found;
}

/** A guard over `args.sds_path` / `args.req_filter` for a run given BOTH flags; any other guard is taken as passable. */
function holdsWithBothFlags(condition: string): boolean {
  if (!/args\.(sds_path|req_filter)/.test(condition)) return true;
  const js = condition
    .replace(/args\.sds_path/g, "true")
    .replace(/args\.req_filter/g, "true")
    .replace(/\bNOT\b/g, "!")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||");
  return Function(`return (${js});`)() as boolean;
}

/** Whether a run given both --sds and --req-filter reaches `lines[at]`. */
function reachedWithBothFlags(lines: readonly string[], at: number): boolean {
  return ancestors(lines, at).every((index) => {
    const guard = (lines[index] as string).trim();
    if (guard === "ELSE:") {
      const opener = lines
        .slice(0, index)
        .map((line, i) => [line, i] as const)
        .reverse()
        .find(([line]) => indent(line) === indent(lines[index] as string) && line.trim().startsWith("IF "));
      if (opener === undefined) throw new Error("ELSE without IF");
      const condition = /^IF (.*?):(?:\s+#.*)?$/.exec(opener[0].trim())?.[1] ?? "";
      return /args\.(sds_path|req_filter)/.test(condition) ? !holdsWithBothFlags(condition) : true;
    }
    const condition = /^IF (.*?):(?:\s+#.*)?$/.exec(guard)?.[1];
    return condition === undefined ? true : holdsWithBothFlags(condition);
  });
}

describe("FR-FLOW-211 AC-2 — a --req-filter ID that does not exist stops the run, --sds or not", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-2 — WHEN a requirement named by --req-filter does not exist, kiwi-pm stops before
    // kiwi-coder runs. kiwi-pm takes --sds and --req-filter together (§4 opening: "`--req-filter` 가 있으면
    // `--sds` 실행도 요구 집합 실행처럼 읽는다"). In MAIN the only --req-filter ID check is RESOLVE_REQ_SET,
    // which sits in the ELSE of `IF args.sds_path:`, so a run given both flags never checks the IDs it
    // was named before AGENT_SPAWN_KIWI_CODER.
    it(`${root}: MAIN checks the --req-filter IDs before the kiwi-coder spawn on a run given both --sds and --req-filter`, () => {
      const main = fn(read(`${root}/kiwi-pm/SKILL.md`), "MAIN");
      const spawn = main.findIndex((line) => line.includes("# T-run"));
      expect(spawn, `${root}: the T-run (kiwi-coder) step`).toBeGreaterThan(0);
      const checks = main
        .slice(0, spawn)
        .flatMap((line, at) => (/RESOLVE_REQ_SET\(|req_filter|get_requirement/.test(line) ? [at] : []));
      expect(checks.length, `${root}: a --req-filter ID check in MAIN`).toBeGreaterThan(0);
      expect(
        checks.some((at) => reachedWithBothFlags(main, at)),
        `${root}: no --req-filter ID check is reached with --sds and --req-filter`
      ).toBe(true);
    });
  }
});

// Mutation runs of the FR-FLOW-211 contract test on a temporary copy of the skills.
const CONTRACT = "test/skills/kiwi-pm-req-filter-by-id.fr-flow-211.test.ts";
let sandbox = "";

function runContract() {
  return spawnSync(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", CONTRACT, "--root", sandbox], {
    cwd: sandbox,
    encoding: "utf8"
  });
}

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-r2-d1-"));
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

describe("FR-FLOW-211 AC-1 — the contract test turns red when the promotion drops a requirement for its target", () => {
  // @req FR-FLOW-211 AC-1 — the final promotion SHALL NOT drop a requirement because it is not in the
  // active target. Making T_FINAL_SRS_MUTATION skip every requirement whose target is not the run's
  // target (the by-ID read itself untouched) is exactly that drop.
  it("claude: a T-final skip of requirements outside the active target fails the contract test", () => {
    expect(
      contractFailsWith("skills/claude/kiwi-pm/SKILL.md", (text) =>
        text.replace("        IF NOT req: CONTINUE   #", "        IF NOT req OR req.target != state.target_slug: CONTINUE   #")
      )
    ).toBe(true);
  }, 120000);

  // @req FR-FLOW-211 AC-1 — the same drop in the lifecycle gate's classification loop: a requirement of
  // another target is never classified and never blocked, while the by-ID read stays as pinned.
  it("claude: a lifecycle-gate classification limited to the active target fails the contract test", () => {
    expect(
      contractFailsWith("skills/claude/kiwi-pm/SKILL.md", (text) =>
        text.replace("    FOR req IN reqs IF req.id IN state.req_ids:\n", "    FOR req IN reqs IF req.id IN state.req_ids AND req.target == state.target_slug:\n")
      )
    ).toBe(true);
  }, 120000);
});
