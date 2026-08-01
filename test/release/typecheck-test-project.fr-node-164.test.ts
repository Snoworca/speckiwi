import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// @req FR-NODE-164 — the orchestrator test sources are type-checked at the repository's own strictness.
//
// Nothing type-checked `test/**`: `tsconfig.json` includes `src` only, `vitest.config.ts` declares no
// typecheck block, and the eslint config sets no `parserOptions.project`, so `npm run lint` is not
// type-aware over the files it lints. A fixture could therefore name a property its declared type does
// not have, or omit one the type requires, and the suite would stay green — which is how
// `anchors.fr-node-112.test.ts` came to write a `relation` into a `{type, reference}` literal and how
// `resume-merge-witness.fr-node-160.test.ts` came to build an `OrchTrailerCommit` with a `sha` field
// and no `commit`.
//
// This file is the gate's own test, so it must never assert that the check merely RAN. Every assertion
// below either reads the shipped configuration or observes the check's verdict change under a mutation
// whose application is asserted first.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_FILE = "tsconfig.test.json";
const PROBE = path.join(REPO_ROOT, "test", "core", "orchestrator", "__fr-node-164-probe.ts");
const EXCESS_PROPERTY = "propertyTheDeclaredTypeDoesNotHave";

/** The two type-graph classes AC-3 names, in one file: an excess property and an unguarded index access. */
const PROBE_SOURCE = `import type { OrchTrailerCommit } from "../../../src/core/orchestrator/lane-state.js";

export const excess: OrchTrailerCommit = { commit: "aaaa111", trailers: {}, ${EXCESS_PROPERTY}: "x" };

const shas: string[] = [];
export const unguarded: string = shas[0];
`;

interface CheckOutcome {
  readonly exitCode: number;
  readonly output: string;
}

/** The compiler is invoked directly rather than through a shell, so no argument is ever concatenated. */
const TSC = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

function runProject(): CheckOutcome {
  try {
    const output = execFileSync(process.execPath, [TSC, "-p", PROJECT_FILE], { cwd: REPO_ROOT, encoding: "utf8" });
    return { exitCode: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

function diagnosticLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
}

function readJsonc(relativePath: string): Record<string, unknown> {
  const text = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(PROBE, { force: true });
});

describe("FR-NODE-164 AC-1 — the project file exists and relaxes nothing", () => {
  it("extends the root config, emits nothing, and covers the three declared globs", () => {
    const project = readJsonc(PROJECT_FILE);
    expect(project.extends).toBe("./tsconfig.json");

    const options = (project.compilerOptions ?? {}) as Record<string, unknown>;
    expect(options.noEmit).toBe(true);

    const include = (project.include ?? []) as string[];
    expect(include).toContain("src/**/*.ts");
    expect(include).toContain("test/core/orchestrator/**/*.ts");
    expect(include).toContain("test/cli/orchestrate*.ts");
  });

  it("leaves every strictness option the root config sets in force", () => {
    const root = readJsonc("tsconfig.json").compilerOptions as Record<string, unknown>;
    const project = (readJsonc(PROJECT_FILE).compilerOptions ?? {}) as Record<string, unknown>;

    // Read from the root rather than listed here, so a strictness option added to the root config in
    // future is covered by this assertion on the day it is added.
    const strictness = Object.keys(root).filter((key) => key === "strict" || key.startsWith("no") || key.startsWith("exact"));
    expect(strictness).toContain("strict");
    expect(strictness).toContain("noUncheckedIndexedAccess");
    expect(strictness).toContain("exactOptionalPropertyTypes");

    for (const key of strictness) {
      if (!(key in project)) continue;
      expect(project[key], `${PROJECT_FILE} must not relax ${key}`).toEqual(root[key]);
    }
  });
});

describe("FR-NODE-164 AC-2 — the script exists and the repository is clean under it", () => {
  it("declares a typecheck:test script bound to that project file", () => {
    const scripts = (readJsonc("package.json").scripts ?? {}) as Record<string, string>;
    const script = scripts["typecheck:test"];
    expect(script, "package.json must declare typecheck:test").toBeTypeOf("string");
    expect(script).toContain("tsc");
    expect(script).toContain(PROJECT_FILE);
  });

  it("reports zero diagnostics over the repository", { timeout: 180_000 }, () => {
    expect(existsSync(PROBE), "the probe must not be present for the baseline run").toBe(false);
    const outcome = runProject();
    expect(diagnosticLines(outcome.output), diagnosticLines(outcome.output).slice(0, 40).join("\n")).toEqual([]);
    expect(outcome.exitCode).toBe(0);
  });
});

describe("FR-NODE-164 AC-3 and AC-4 — the check is non-vacuous, measured under a mutation", () => {
  it("fails on the mutated source and passes again once it is restored", { timeout: 240_000 }, () => {
    // The mutation is asserted to have applied BEFORE the check runs. A probe that replaces nothing
    // proves nothing: without this the whole test would pass on an empty edit and read as a gate.
    expect(existsSync(PROBE)).toBe(false);
    writeFileSync(PROBE, PROBE_SOURCE, "utf8");
    expect(existsSync(PROBE), "the mutation did not apply").toBe(true);
    expect(readFileSync(PROBE, "utf8")).toContain(EXCESS_PROPERTY);

    let mutated: CheckOutcome;
    try {
      mutated = runProject();
    } finally {
      rmSync(PROBE, { force: true });
    }

    const lines = diagnosticLines(mutated.output);
    expect(mutated.exitCode, "the check accepted a source that contradicts its own declarations").not.toBe(0);

    const onProbe = lines.filter((line) => line.includes("__fr-node-164-probe.ts"));
    expect(onProbe.length, lines.slice(0, 20).join("\n")).toBeGreaterThan(0);

    // AC-3, class 1: an object literal naming a property its declared type does not have.
    expect(onProbe.some((line) => line.includes(EXCESS_PROPERTY))).toBe(true);
    // AC-3, class 2: an index access whose `undefined` case is unhandled.
    expect(onProbe.some((line) => line.includes("undefined"))).toBe(true);

    // AC-4's second half: the restored tree passes, so the failure above was the mutation and not a
    // pre-existing condition of the repository.
    expect(existsSync(PROBE), "the mutation was not reverted").toBe(false);
    const restored = runProject();
    expect(diagnosticLines(restored.output)).toEqual([]);
    expect(restored.exitCode).toBe(0);
  });
});

describe("FR-NODE-164 AC-5 — nothing is suppressed", () => {
  it("no covered source carries a @ts-ignore", () => {
    const covered = execFileSync("git", ["ls-files", "test/core/orchestrator", "test/cli"], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    })
      .split(/\r?\n/)
      .filter((entry) => entry.endsWith(".ts"))
      .filter((entry) => entry.startsWith("test/core/orchestrator/") || /^test\/cli\/orchestrate[^/]*\.ts$/.test(entry));

    expect(covered.length, "the covered file list must not be empty, or this assertion is vacuous").toBeGreaterThan(50);

    const offenders = covered.filter((entry) => readFileSync(path.join(REPO_ROOT, entry), "utf8").includes("@ts-ignore"));
    expect(offenders).toEqual([]);
  });

  it("the project file turns no strictness option off", () => {
    const project = (readJsonc(PROJECT_FILE).compilerOptions ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(project)) {
      if (key === "noEmit") continue;
      expect(value, `${PROJECT_FILE} sets ${key}=false`).not.toBe(false);
    }
  });
});
