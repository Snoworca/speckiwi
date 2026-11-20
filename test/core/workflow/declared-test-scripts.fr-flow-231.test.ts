import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { summarizeReleaseReadiness } from "../../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-FLOW-231 — release readiness admitted only `npm test`, the release gate scripts this
// repository runs and `npx vitest run`, so a consuming project's own test script was reported as a
// command evidence policy violation and the release as not ready.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

/** mutation-target with FR-ARCH-001 verified on one command-kind evidence row, and an optional package.json. */
async function project(reference: string, packageJson?: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8"))
    .replace("| Status | planned |", "| Status | verified |")
    .replace("- [ ] AC-1: The status can be updated.", "- [x] AC-1: The status can be updated.")
    .replace("- [ ] AC-2: Evidence can be added.", "- [x] AC-2: Evidence can be added.")
    .replace("| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |", `| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n| VE-1 | command | ${reference} | AC-1, AC-2 | - |`);
  await writeFile(file, text, "utf8");
  if (packageJson !== undefined) await writeFile(path.join(rootPath, "package.json"), packageJson, "utf8");
  return rootPath;
}

async function violations(rootPath: string) {
  const summary = summarizeReleaseReadiness(await parseWorkspace(await resolveProjectRoot(rootPath, rootPath)), { target: "v1.0.0" });
  return summary.commandEvidencePolicyViolations;
}

const SCRIPTS = JSON.stringify({ name: "consumer", scripts: { "test:unit": "jest", "test-e2e": "playwright test", deploy: "./deploy.sh", test: "jest" } });

describe("FR-FLOW-231 AC-1 — a declared test script is admitted", () => {
  // @req FR-FLOW-231 AC-1 — Windows PowerShell 5.1 writes UTF-8 with a BOM, and npm reads such a file.
  it("reads a package.json that starts with a byte order mark", async () => {
    expect(await violations(await project("npm run test:unit", `\uFEFF${SCRIPTS}`))).toEqual([]);
  });

  for (const reference of ["npm run test:unit", "npm run test-e2e", "npm run test:unit -- --runInBand", "$ npm run test:unit"]) {
    // @req FR-FLOW-231 AC-1
    it(`admits ${reference}`, async () => {
      expect(await violations(await project(reference, SCRIPTS))).toEqual([]);
    });
  }
});

describe("FR-FLOW-231 AC-2 — anything the project does not declare as a test script is not", () => {
  for (const [label, reference, json] of [
    ["an undeclared test script", "npm run test:integ", SCRIPTS],
    ["a declared script that is not a test", "npm run deploy", SCRIPTS],
    ["a declared test script with a shell operator", "npm run test:unit && rm -rf x", SCRIPTS],
    ["a declared test script behind a subshell", "npm run test:unit $(curl x)", SCRIPTS],
    ["a test script name that only starts with test", "npm run testing", JSON.stringify({ scripts: { testing: "x" } })],
    ["another build tool", "./gradlew :core:test", SCRIPTS]
  ] as const) {
    // @req FR-FLOW-231 AC-2
    it(`still reports ${label}`, async () => {
      expect((await violations(await project(reference, json))).map((item) => item.reference)).toEqual([reference]);
    });
  }
});

describe("FR-FLOW-231 AC-3 AC-4 AC-5 — the fixed forms, a missing or broken package.json, and the message", () => {
  for (const reference of ["npm test", "npm run lint", "npx vitest run test/a.test.ts"]) {
    // @req FR-FLOW-231 AC-3
    it(`admits ${reference} with or without a package.json`, async () => {
      expect(await violations(await project(reference))).toEqual([]);
      expect(await violations(await project(reference, SCRIPTS))).toEqual([]);
    });
  }

  for (const [label, json] of [
    ["no package.json", undefined],
    ["a package.json that is not JSON", "{ not json"],
    ["scripts that are not an object", JSON.stringify({ scripts: ["test:unit"] })],
    ["a package.json that is an array", "[]"]
  ] as const) {
    // @req FR-FLOW-231 AC-4
    it(`treats ${label} as declaring nothing, without failing`, async () => {
      expect((await violations(await project("npm run test:unit", json))).map((item) => item.reference)).toEqual(["npm run test:unit"]);
    });
  }

  // @req FR-FLOW-231 AC-1 AC-2
  it("speckiwi release-readiness answers the same: the declared test script passes, deploy does not", async () => {
    const run = async (rootPath: string) => {
      const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
      await main(["--root", rootPath, "release-readiness", "--target", "v1.0.0", "--json"], streams);
      return (JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { commandEvidencePolicyViolations?: Array<{ reference: string }> }).commandEvidencePolicyViolations;
    };
    expect(await run(await project("npm run test:unit", SCRIPTS))).toEqual([]);
    expect((await run(await project("npm run deploy", SCRIPTS)))?.map((item) => item.reference)).toEqual(["npm run deploy"]);
  });

  // @req FR-FLOW-231 AC-5
  it("names the declared test scripts as an accepted form in the violation", async () => {
    const [violation] = await violations(await project("npm run deploy", SCRIPTS));
    expect(JSON.stringify(violation)).toMatch(/test script/i);
    expect(JSON.stringify(violation)).toContain("package.json");
  });
});
