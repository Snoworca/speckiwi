import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE_ENV_VAR, closeRunTempRoot, openRunTempRoot, RUN_TEMP_ROOT_ENV } from "./hermeticity-global.js";
import { recordPollution } from "./hermeticity-guard.js";
import { GUARD_JOURNAL_DIR_NAME } from "./repo-hermeticity.js";

// @req REL-NODE-012 — a test run keeps every temporary directory it makes under one root of its own
// and removes that root when it ends.
//
// Measured 2026-11-11: 261,300 directories in %TEMP% from 308 name prefixes. Closing them one helper
// at a time would be 308 edits that the 309th helper forgets; the run root closes them in one place.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
// A file that leaks today through `waves-fixtures.ts`, and through the agent sandbox like every file.
const LEAKS_TODAY = "test/core/orchestrator/journal-wave-spelling.fr-node-142.test.ts";
const TEMP_VARIABLES = ["TEMP", "TMP", "TMPDIR", RUN_TEMP_ROOT_ENV] as const;

const saved = new Map<string, string | undefined>();
const made: string[] = [];

function sameEnvironmentAfterwards(): void {
  for (const name of TEMP_VARIABLES) saved.set(name, process.env[name]);
}

function pointTempAt(directory: string): void {
  process.env.TEMP = directory;
  process.env.TMP = directory;
  process.env.TMPDIR = directory;
}

/** A base directory standing in for the OS temporary directory, made before the variables move. */
function fakeOsTemp(): string {
  const base = mkdtempSync(path.join(tmpdir(), "rel-node-012-"));
  made.push(base);
  return base;
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
});

describe("REL-NODE-012 AC-3 — the run's workers and their children use the run's root", () => {
  it("a worker's temporary directory is the run's root", () => {
    const root = process.env[RUN_TEMP_ROOT_ENV];
    expect(root, `${RUN_TEMP_ROOT_ENV} is not set in the worker`).toBeTruthy();
    expect(existsSync(root ?? "")).toBe(true);
    expect(tmpdir()).toBe(root);
    expect(process.env.TEMP).toBe(root);
    expect(process.env.TMP).toBe(root);
    expect(process.env.TMPDIR).toBe(root);
  });

  it("a process the worker starts inherits it", () => {
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').tmpdir())"], { encoding: "utf8" });
    expect(child.stdout).toBe(process.env[RUN_TEMP_ROOT_ENV]);
  });

  it("an outermost run makes a fresh root under the OS temporary directory and points the variables at it", () => {
    sameEnvironmentAfterwards();
    const base = fakeOsTemp();
    pointTempAt(base);
    delete process.env[RUN_TEMP_ROOT_ENV];
    const run = openRunTempRoot();
    expect(run.owned).toBe(true);
    expect(path.dirname(run.root)).toBe(base);
    expect(existsSync(run.root)).toBe(true);
    expect(process.env[RUN_TEMP_ROOT_ENV]).toBe(run.root);
    expect(tmpdir()).toBe(run.root);
    expect(process.env.TMP).toBe(run.root);
    expect(process.env.TMPDIR).toBe(run.root);
  });

  it("a nested run whose temporary directory lies inside an outer run's root uses that root", () => {
    sameEnvironmentAfterwards();
    const outer = fakeOsTemp();
    const inside = path.join(outer, "nested-test-temp");
    mkdirSync(inside);
    process.env[RUN_TEMP_ROOT_ENV] = outer;
    pointTempAt(inside);
    const run = openRunTempRoot();
    expect(run).toEqual({ root: outer, owned: false });
    expect(readdirSync(inside)).toEqual([]);
    expect(tmpdir()).toBe(inside);
  });

  it("a nested run pointed outside the inherited root makes its own", () => {
    sameEnvironmentAfterwards();
    const outer = fakeOsTemp();
    const elsewhere = fakeOsTemp();
    process.env[RUN_TEMP_ROOT_ENV] = outer;
    pointTempAt(elsewhere);
    const run = openRunTempRoot();
    expect(run.owned).toBe(true);
    expect(path.dirname(run.root)).toBe(elsewhere);
  });
});

describe("REL-NODE-012 AC-2 — the agent sandbox lies under the run's root", () => {
  it("the sandbox this worker installed is inside the run's root", () => {
    const root = process.env[RUN_TEMP_ROOT_ENV] ?? "<unset>";
    const sandbox = process.env.SPECKIWI_TEST_SANDBOX ?? "<unset>";
    const relative = path.relative(root, sandbox);
    expect(relative === "" || relative.startsWith("..") || path.isAbsolute(relative), `${sandbox} is not under ${root}`).toBe(false);
  });
});

describe("REL-NODE-012 AC-4 — the teardown removes the run's root and nothing else", () => {
  it("removes the root, read-only files inside it included, and leaves its siblings", () => {
    sameEnvironmentAfterwards();
    const base = fakeOsTemp();
    const sibling = path.join(base, "another-session-temp");
    mkdirSync(sibling);
    pointTempAt(base);
    delete process.env[RUN_TEMP_ROOT_ENV];
    const run = openRunTempRoot();
    const fixture = path.join(run.root, "git-fixture", "objects");
    mkdirSync(fixture, { recursive: true });
    const readOnly = path.join(fixture, "pack.idx");
    writeFileSync(readOnly, "x");
    chmodSync(readOnly, 0o444);
    const warnings: string[] = [];
    closeRunTempRoot(run, { warn: (message) => warnings.push(message) });
    expect(existsSync(run.root)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(readdirSync(base)).toEqual(["another-session-temp"]);
    expect(warnings).toEqual([]);
  });

  it("a root it does not own is left for the run that owns it", () => {
    const outer = fakeOsTemp();
    closeRunTempRoot({ root: outer, owned: false }, { warn: () => undefined });
    expect(existsSync(outer)).toBe(true);
  });

  it("a removal that keeps failing is a warning naming the path and the entries left, not a failure", () => {
    const root = fakeOsTemp();
    mkdirSync(path.join(root, "busy"));
    writeFileSync(path.join(root, "busy", "held.lock"), "x");
    const warnings: string[] = [];
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    expect(() =>
      closeRunTempRoot(
        { root, owned: true },
        {
          remove: () => {
            throw busy;
          },
          warn: (message) => warnings.push(message)
        }
      )
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(root);
    expect(warnings[0]).toContain("2 entries");
    expect(warnings[0]).toContain("EBUSY");
  });

  it("a root it cannot even list is still a warning naming the path, not an error", () => {
    // A file where the root should be: removal fails and listing fails too, the way a directory the
    // user cannot read fails on Windows (EPERM on scandir).
    const base = fakeOsTemp();
    const root = path.join(base, "not-a-directory");
    writeFileSync(root, "x");
    const warnings: string[] = [];
    const denied = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    expect(() =>
      closeRunTempRoot(
        { root, owned: true },
        {
          remove: () => {
            throw denied;
          },
          warn: (message) => warnings.push(message)
        }
      )
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(root);
    expect(warnings[0]).toContain("EPERM");
    expect(warnings[0]).toMatch(/\d+ entries left/);
  });

  it("retries and forces the removal rather than giving up on the first busy handle", () => {
    const root = fakeOsTemp();
    const seen: Array<Record<string, unknown>> = [];
    closeRunTempRoot(
      { root, owned: true },
      {
        remove: (target, options) => {
          seen.push({ target, ...options });
        },
        warn: () => undefined
      }
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ target: root, recursive: true, force: true });
    expect(Number(seen[0]?.maxRetries)).toBeGreaterThan(0);
  });
});

describe("REL-NODE-012 AC-1 — the guard's journal outlives the run's root", () => {
  it("a worker records pollution in the journal beside the baseline, not under the run's root", () => {
    sameEnvironmentAfterwards();
    saved.set(BASELINE_ENV_VAR, process.env[BASELINE_ENV_VAR]);
    const base = fakeOsTemp();
    const journal = path.join(base, GUARD_JOURNAL_DIR_NAME);
    mkdirSync(journal);
    const runRoot = path.join(base, "speckiwi-test-run-x");
    mkdirSync(runRoot);
    process.env[BASELINE_ENV_VAR] = path.join(journal, "baseline-1.json");
    process.env[RUN_TEMP_ROOT_ENV] = runRoot;
    pointTempAt(runRoot);
    const written = recordPollution("rel-node-012 marker");
    expect(written).toBe(path.join(journal, "pollution.log"));
    expect(readFileSync(written, "utf8")).toContain("rel-node-012 marker");
    expect(readdirSync(runRoot)).toEqual([]);
  });
});

describe("REL-NODE-012 AC-1 — a run leaves its temporary directory as it found it", () => {
  it(
    "an outermost run of a file that leaks today leaves nothing but the guard's journal, and no baseline in it",
    () => {
      const isolated = fakeOsTemp();
      const env: NodeJS.ProcessEnv = { ...process.env, TEMP: isolated, TMP: isolated, TMPDIR: isolated };
      // Run as an outermost run would: no outer root, no inherited sandbox, no inherited baseline.
      for (const name of [RUN_TEMP_ROOT_ENV, "SPECKIWI_TEST_SANDBOX", "SPECKIWI_HERMETICITY_BASELINE"]) delete env[name];
      const result = spawnSync(process.execPath, [VITEST_BIN, "run", "--root", REPO_ROOT, LEAKS_TODAY, "--reporter=dot"], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 600_000
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      expect(result.status, output).toBe(0);
      expect(readdirSync(isolated).filter((name) => name !== GUARD_JOURNAL_DIR_NAME)).toEqual([]);
      const journal = path.join(isolated, GUARD_JOURNAL_DIR_NAME);
      expect(existsSync(journal) ? readdirSync(journal) : []).toEqual([]);
    },
    600_000
  );
});
