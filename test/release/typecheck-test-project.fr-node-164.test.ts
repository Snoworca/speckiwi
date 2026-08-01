import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

function runProject(extraArgs: string[] = []): CheckOutcome {
  try {
    const output = execFileSync(process.execPath, [TSC, "-p", PROJECT_FILE, ...extraArgs], { cwd: REPO_ROOT, encoding: "utf8" });
    return { exitCode: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/**
 * The compiler's own resolved view of the project, not the project file's literal text.
 *
 * The first revision read the ROOT config and asserted key PRESENCE there, which meant the comparison
 * loop ran zero times and a strictness option turned off in the root passed 7/7. An independent
 * verifier measured that with `exactOptionalPropertyTypes: false`. `--showConfig` is what the compiler
 * actually uses, so an option relaxed anywhere in the extends chain shows up here.
 */
function resolvedOptions(): Record<string, unknown> {
  const shown = runProject(["--showConfig"]);
  const parsed = JSON.parse(shown.output) as { compilerOptions?: Record<string, unknown> };
  return parsed.compilerOptions ?? {};
}

/**
 * Runs the declared script's own command text, with the `node_modules/.bin` entry npm prepends.
 *
 * The text is what is executed, so a script neutered with `|| exit 0` or `--noCheck` fails here while
 * passing any assertion that only reads it. `npm run` itself is not spawned: on Windows a `.cmd`
 * shim cannot be spawned without a shell, and passing arguments through a shell is the concatenation
 * hazard Node deprecated.
 */
function runDeclaredScript(): CheckOutcome {
  const scripts = (readJsonc("package.json").scripts ?? {}) as Record<string, string>;
  const script = scripts["typecheck:test"] ?? "";
  const bin = path.join(REPO_ROOT, "node_modules", ".bin");
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  try {
    return { exitCode: 0, output: execSync(script, { cwd: REPO_ROOT, encoding: "utf8", env }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** The repository files the compiler actually loads — the program, not the index. */
function coveredFiles(): string[] {
  const listed = runProject(["--listFiles"]);
  return listed.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith(".ts"))
    .map((line) => path.relative(REPO_ROOT, line).split(path.sep).join("/"))
    .filter((relative) => !relative.startsWith("..") && !relative.startsWith("node_modules/"));
}

function diagnosticLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
}

function readJsonc(relativePath: string): Record<string, unknown> {
  const text = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

// A probe left behind by a hard kill errors by construction, so every later `typecheck:test` would
// fail and the gate would block itself. Removed before anything reads the tree, not only after.
beforeAll(() => {
  rmSync(PROBE, { force: true });
});

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

  it("leaves every strictness option the criterion names in force, as the compiler resolves them", { timeout: 120_000 }, () => {
    // Asserted against the RESOLVED options, so relaxing one in the root config — or anywhere else in
    // the extends chain — fails here. Asserting key presence in the root instead let
    // `exactOptionalPropertyTypes: false` pass 7/7, measured by an independent verifier.
    const resolved = resolvedOptions();
    for (const key of ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes"]) {
      expect(resolved[key], `${key} must be in force under ${PROJECT_FILE}, resolved to ${JSON.stringify(resolved[key])}`).toBe(true);
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

  it("reports zero diagnostics when the declared script itself is run", { timeout: 240_000 }, () => {
    expect(existsSync(PROBE), "the probe must not be present for the baseline run").toBe(false);
    const outcome = runDeclaredScript();
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
  it("no source the compiler loads carries a @ts-ignore", { timeout: 120_000 }, () => {
    // Enumerated from the PROGRAM, not from `git ls-files`. The two sets differ: the include globs
    // match untracked files and pull in transitive imports outside the globs, so a tracked-file
    // listing leaves both classes unchecked. A verifier found a live instance of each.
    const covered = coveredFiles();
    expect(covered.length, "the covered file list must not be empty, or this assertion is vacuous").toBeGreaterThan(50);
    expect(covered, "the enumeration must reach the test tree").toContain("test/support/at.ts");

    const offenders = covered.filter((entry) => readFileSync(path.join(REPO_ROOT, entry), "utf8").includes("@ts-ignore"));
    expect(offenders).toEqual([]);
  });

  it("every @ts-expect-error the compiler loads is one where the error is the assertion", { timeout: 120_000 }, () => {
    // An unused directive is TS2578, so a stale one already fails AC-2's run. What is asserted here is
    // the other direction: a directive may not sit on a line that is merely inconvenient to type.
    const suppressions = coveredFiles().flatMap((entry) =>
      readFileSync(path.join(REPO_ROOT, entry), "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({ entry, line: line.trim(), number: index + 1 }))
        .filter((row) => row.line.includes("@ts-expect-error"))
    );

    // Each one must name what it expects on the same line, so a reader can check the claim.
    const unexplained = suppressions.filter((row) => row.line.replace(/.*@ts-expect-error/, "").trim().length < 20);
    expect(unexplained.map((row) => `${row.entry}:${row.number}`)).toEqual([]);
  });

  it("the project file turns no strictness option off", () => {
    const project = (readJsonc(PROJECT_FILE).compilerOptions ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(project)) {
      if (key === "noEmit") continue;
      expect(value, `${PROJECT_FILE} sets ${key}=false`).not.toBe(false);
    }
  });
});
