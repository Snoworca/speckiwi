import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupFixtures, commitAll, initRepo, tempDir } from "./support/git-fixture.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

/**
 * @req FR-NODE-104 AC-3 — the phase-1 denominator is exactly HV-1, HV-2 and HV-3. HV-4's CAS case
 * belongs to `2.6.0-phase2-parallel-lanes` with `integrate()` and is deliberately absent here.
 */
const HARVEST_SUITES = [
  { id: "HV-1", file: "test/core/orchestrator/pinning.fr-node-101.test.ts" },
  { id: "HV-2", file: "test/core/orchestrator/run-lock.fr-node-102.test.ts" },
  { id: "HV-3", file: "test/core/orchestrator/readiness.fr-node-103.test.ts" }
] as const;

/**
 * `06` §5.1 measured the cwd-sensitivity defect as a divergence between "outside any repository"
 * and "inside a worktree". These three are the classes that would reproduce it: the repository
 * under test, no repository at all, and an unrelated repository whose HEAD differs from it.
 */
type CwdClass = "repository-under-test" | "outside-any-repository" | "unrelated-repository";

interface SuiteRun {
  readonly cwdClass: CwdClass;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly totals: { total: number; passed: number; failed: number };
  readonly recorded: { suite: string; cwd: string }[];
}

const runs: SuiteRun[] = [];

function runVitest(cwd: string, env: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        VITEST_BIN, "run",
        "--root", REPO_ROOT,
        "--no-file-parallelism",
        "--reporter=json",
        "--outputFile", env.SPECKIWI_HARVEST_RESULT_FILE!,
        ...HARVEST_SUITES.map((suite) => suite.file)
      ],
      { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.stdout.resume();
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stderr }));
  });
}

afterAll(cleanupFixtures);

describe.skipIf(process.env.SPECKIWI_HARVEST_CHILD === "1")(
  "FR-NODE-104 harvest verification under a non-trivial gitconfig and three working directories",
  { timeout: 1_800_000 },
  () => {
    it("AC-3: covers exactly the three phase-1 harvest suites and never HV-4", async () => {
      expect(HARVEST_SUITES).toHaveLength(3);
      expect(HARVEST_SUITES.map((suite) => suite.id)).toEqual(["HV-1", "HV-2", "HV-3"]);
      expect(HARVEST_SUITES.map((suite) => suite.id)).not.toContain("HV-4");
      for (const suite of HARVEST_SUITES) {
        await expect(access(path.join(REPO_ROOT, suite.file))).resolves.toBeUndefined();
      }
    });

    it("AC-1 and AC-2: the three suites pass under filters plus autocrlf, from three cwds", async () => {
      const workspace = await tempDir("harvest-hv5");
      const gitconfig = path.join(workspace, "harvest.gitconfig");
      await writeFile(gitconfig, [
        "[core]",
        "\tautocrlf = true",
        "[filter \"speckiwiHarvest\"]",
        "\tclean = cat",
        "\tsmudge = cat",
        "\trequired = false",
        "[filter \"speckiwiHarvestSecond\"]",
        "\tclean = cat",
        ""
      ].join("\n"), "utf8");
      expect(await readFile(gitconfig, "utf8")).toContain("autocrlf = true");

      const outside = await tempDir("harvest-outside-repo");
      const unrelated = await initRepo("harvest-unrelated-repo");
      await writeFile(path.join(unrelated, "README.md"), "# unrelated\n", "utf8");
      await commitAll(unrelated, "test: seed an unrelated repository");

      const directories: { cwdClass: CwdClass; cwd: string }[] = [
        { cwdClass: "repository-under-test", cwd: REPO_ROOT },
        { cwdClass: "outside-any-repository", cwd: outside },
        { cwdClass: "unrelated-repository", cwd: unrelated }
      ];
      expect(new Set(directories.map((entry) => entry.cwd)).size).toBe(3);

      for (const [index, directory] of directories.entries()) {
        const resultFile = path.join(workspace, `result-${index}.json`);
        const recordFile = path.join(workspace, `cwd-${index}.jsonl`);
        await writeFile(recordFile, "", "utf8");

        const outcome = await runVitest(directory.cwd, {
          GIT_CONFIG_GLOBAL: gitconfig,
          SPECKIWI_HARVEST_CHILD: "1",
          SPECKIWI_HARVEST_CWD_RECORD: recordFile,
          SPECKIWI_HARVEST_RESULT_FILE: resultFile
        });

        const report = JSON.parse(await readFile(resultFile, "utf8")) as {
          numTotalTests: number;
          numPassedTests: number;
          numFailedTests: number;
        };
        const recorded = (await readFile(recordFile, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { suite: string; cwd: string });

        runs.push({
          cwdClass: directory.cwdClass,
          cwd: directory.cwd,
          exitCode: outcome.exitCode,
          totals: {
            total: report.numTotalTests,
            passed: report.numPassedTests,
            failed: report.numFailedTests
          },
          recorded
        });
        expect(outcome.exitCode, `${directory.cwdClass} run failed:\n${outcome.stderr.slice(-4000)}`).toBe(0);
      }

      expect(runs).toHaveLength(3);

      // AC-2: each run actually observed its own working directory, and the three differ.
      for (const run of runs) {
        expect(run.recorded.map((entry) => entry.suite).sort()).toEqual(["HV-1", "HV-2", "HV-3"]);
        for (const entry of run.recorded) {
          expect(path.resolve(entry.cwd)).toBe(path.resolve(run.cwd));
        }
      }
      expect(new Set(runs.map((run) => path.resolve(run.cwd))).size).toBe(3);

      // AC-2: the same result in every one of them.
      const [first, ...rest] = runs;
      expect(first!.totals.failed).toBe(0);
      expect(first!.totals.passed).toBeGreaterThan(0);
      for (const run of rest) expect(run.totals).toEqual(first!.totals);
    });
  }
);
