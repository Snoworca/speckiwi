import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-NODE-270 AC-9 (5.3.2), round 1, skills bundle.
// Nothing in the repository is changed: every mutation run uses a temporary copy of the repository.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "v", GIT_AUTHOR_EMAIL: "v@example.invalid", GIT_COMMITTER_NAME: "v", GIT_COMMITTER_EMAIL: "v@example.invalid" };
const COPIED = ["bin", "dist", "docs", "scripts", "skills", ".agents", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts", "CLAUDE.md", "AGENTS.md", "agents.md", "README.md", ".gitignore"];

function makeSandbox(): string {
  const sandbox = mkdtempSync(path.join(tmpdir(), "verify-v532-r1-skills-"));
  for (const rel of COPIED) if (existsSync(path.join(REPO, rel))) cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  rmSync(path.join(sandbox, "test", "verify"), { recursive: true, force: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "copy"]]) spawnSync("git", args, { cwd: sandbox, env: GIT_ENV });
  return sandbox;
}

/** Runs all of test/skills (the skill contract tests) in `sandbox`; resolves to the exit status. */
function runContracts(sandbox: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", "test/skills", "--testTimeout", "60000", "--maxWorkers", "4", "--root", sandbox], { cwd: sandbox, env: GIT_ENV, stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Applies `from -> to` to `rel` in a fresh copy and runs the contract tests there; true when they fail. */
async function contractsFailWith(rel: string, from: string, to: string): Promise<boolean> {
  const sandbox = makeSandbox();
  try {
    const file = path.join(sandbox, rel);
    const original = readFileSync(file, "utf8");
    expect(original.split(from).length - 1, `${rel}: the rule sentence occurs once`).toBe(1);
    writeFileSync(file, original.replace(from, to));
    return (await runContracts(sandbox)) !== 0;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// The claude rendering is used because it has no .agents mirror, so a mirror drift check cannot be what catches the
// mutation. Every mutation stays inside section 7.1.2 (the section that sets the replace rule) and inverts or hedges one
// rule sentence; the AC quoted with each row forbids the mutated behaviour.
const SKILL = "skills/claude/kiwi-srs-research/SKILL.md";
type Mutation = readonly [name: string, req: string, from: string, to: string];
const MUTATIONS: readonly Mutation[] = [
  // @req FR-NODE-270 AC-9 — corpus: skills/claude/kiwi-srs-research/SKILL.md section 7.1.2 step 2
  [
    "7.1.2 step 2: the confirmation rule inverted (never pass confirmReplace when the dry run reports removed items)",
    "FR-NODE-270 AC-9 — the skill SHALL … pass `confirmReplace: true` only when that dry run reports `removedItems` above 0",
    "`confirmReplace: true` 는 그 dry run 의 `removedItems` 가 0 보다 클 때만 넘긴다:",
    "`confirmReplace: true` 는 그 dry run 의 `removedItems` 가 0 보다 클 때만 넘기지 않는다:"
  ],
  // @req FR-NODE-270 AC-9 — corpus: skills/claude/kiwi-srs-research/SKILL.md section 7.1.2 step 2
  [
    "7.1.2 step 2: an exception that confirms without a dry run",
    "FR-NODE-270 AC-9 — the skill SHALL run the replace as a dry run first … so that AC-4 neither refuses … nor lets it confirm blind",
    "dry run 없이 확인 플래그를 넘기지 않는다.",
    "급하면 dry run 없이 확인 플래그를 넘겨도 된다."
  ],
  // @req FR-NODE-270 AC-9 — corpus: skills/claude/kiwi-srs-research/SKILL.md section 7.1.2 step 3
  [
    "7.1.2 step 3: the recording rule inverted (removedLines not recorded in the run report)",
    "FR-NODE-270 AC-9 — the skill SHALL … record the dry run's `removedLines` in its run report",
    "에 그대로 기록한다.",
    "에 기록하지 않는다."
  ]
];

describe("FR-NODE-270 AC-9 — the skill contract tests turn red when a section 7.1.2 rule sentence of kiwi-srs-research is inverted or hedged", () => {
  beforeAll(async () => {
    // Baseline: the unmutated copy must pass, or a red mutation run proves nothing.
    const sandbox = makeSandbox();
    try {
      expect(await runContracts(sandbox), "the contract tests on the unmutated copy").toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 1800000);

  for (const [name, req, from, to] of MUTATIONS) {
    it(`${SKILL}: ${name} fails the contract tests`, async () => {
      expect(await contractsFailWith(SKILL, from, to), `${req}\nmutated: ${to}`).toBe(true);
    }, 3600000);
  }
});
