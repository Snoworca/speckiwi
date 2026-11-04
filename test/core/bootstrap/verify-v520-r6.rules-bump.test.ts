import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

const NEW = "SRS-MD-Rules-v2.6.0.md";

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r6-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
}

async function rulesDrift(root: string) {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.find((c) => c.label === "Rules version drift")!;
}

async function upgrade(root: string) {
  const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
  expect(result.ok).toBe(true);
}

function scopeDoc(rulesRow: string): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", ""].join("\n");
}

async function verdict(rulesRow: string) {
  const root = await freshProject();
  const rel = "docs/spec/01.alpha.srs.md";
  await writeFile(path.join(root, rel), scopeDoc(rulesRow), "utf8");
  const doctorWarned = (await rulesDrift(root)).state === "warn";
  await upgrade(root);
  const rowAfter = (await readFile(path.join(root, rel), "utf8")).split("\n").find((line) => line.startsWith("| Rules |"));
  return { doctorWarned, upgradeRewrote: rowAfter !== rulesRow };
}

describe("verify FR-PARSE-044 AC-6 pointer verdict, round 6", () => {
  // @req FR-PARSE-044 AC-6
  it("a Rules row whose title names 2.5.0 with two spaces (a prose reference the same module recognises) is stale", async () => {
    expect(await verdict(`| Rules | [SRS-MD  Authoring Rules v2.5.0](../rule/${NEW}) |`)).toEqual({ doctorWarned: true, upgradeRewrote: true });
  });

  // @req FR-PARSE-044 AC-6
  it("a current Rules row whose link carries a title is left alone", async () => {
    expect(await verdict(`| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${NEW} "SRS rules") |`)).toEqual({ doctorWarned: false, upgradeRewrote: false });
  });

  // @req FR-PARSE-044 AC-6
  it("a current Rules row whose link destination is in angle brackets is left alone", async () => {
    expect(await verdict(`| Rules | [SRS-MD Authoring Rules v2.6.0](<../rule/${NEW}>) |`)).toEqual({ doctorWarned: false, upgradeRewrote: false });
  });
});

describe("verify FR-NODE-091 readUtf8File path in message, round 6", () => {
  // @req FR-NODE-091
  it("an index that is a directory keeps the CLI error class it had before the message named the path", async () => {
    const root = await freshProject();
    const index = path.join(root, "docs", "spec", "00.index.md");
    await rm(index);
    await mkdir(index);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(["--root", root, "list", "--json"], streams);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}");
    expect({ exit, code: out.error?.code, message: out.error?.message }).toMatchObject({ exit: 2, code: "CLI_READ_ERROR" });
  });
});
