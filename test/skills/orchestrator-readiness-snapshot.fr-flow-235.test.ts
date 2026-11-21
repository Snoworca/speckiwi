import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../mcp/support/workspace-root-fixture.js";

// @req FR-FLOW-235 — §V.derive-readiness built the snapshot from the product target's records only,
// so a dependency in another target was never in it; the section now builds it from the whole
// repository, written to a file by the CLI.

vi.setConfig({ testTimeout: 120_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const REPO = path.resolve(import.meta.dirname, "../..");
const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((dir) => `${dir}/kiwi-orchestrator/SKILL.md`);

async function section(file: string): Promise<string> {
  const text = (await readFile(path.join(REPO, file), "utf8")).replace(/\r\n/gu, "\n");
  const start = text.indexOf("### §V.derive-readiness");
  expect(start, file).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf("\n### ", start + 1));
}

/** The one fenced command of the section that writes the snapshot file. */
function snapshotCommand(body: string): string {
  const fences = [...body.matchAll(/```(?:bash)?\n([\s\S]*?)```/gu)].map((match) => match[1] ?? "");
  const command = fences.flatMap((fence) => fence.split("\n")).find((line) => line.startsWith("node -e ")) ?? "";
  expect(command, "the section gives no command that writes the snapshot").not.toBe("");
  return command;
}

describe("FR-FLOW-235 AC-1 AC-2 AC-3 — the section in every copy", () => {
  for (const file of COPIES) {
    // @req FR-FLOW-235 AC-1 AC-2
    it(`${file}: whole-repository records from the CLI, the target's summary, every dependency`, async () => {
      const body = await section(file);
      expect(body).toContain("`speckiwi list --format=full --json`");
      expect(body).toContain("target 필터 없이");
      expect(body).toContain("`speckiwi summary --target <t> --json`");
      expect(body).toContain("의존하는 모든 요구의 레코드");
      expect(body).toContain("`missingDependencies`");
      expect(body).toContain("파일에 바로 쓴다");
      expect(body, "the records are no longer limited to the product target").not.toMatch(/제품 target 의 `list_requirements` 응답/u);
      const command = snapshotCommand(body);
      expect(command).toContain("list --format=full --json");
      expect(command).not.toMatch(/list --format=full --json[^']*--target/u);
    });

    // @req FR-FLOW-235 AC-3
    it(`${file}: the MCP route keeps every diagnostic and no target filter`, async () => {
      const body = await section(file);
      const mcp = body.split("\n").find((line) => line.includes("`includeAllDiagnostics: true`")) ?? "";
      expect(mcp).toContain("MCP");
      expect(mcp, "the MCP route is the fallback, so the section does not contradict its own size reason").toContain("CLI 를 실행할 수 없을 때뿐");
      expect(mcp, "the route says its answer passes through the agent's context").toContain("에이전트 컨텍스트를 거쳐");
      expect(mcp).toContain("target 없이");
      expect(mcp).toContain("`diagnosticsTruncation`");
      expect(body).toContain("레코드 투영 full");
    });
  }

  // @req FR-FLOW-235 AC-1 AC-2
  it("the command the section gives writes a snapshot that readiness judges ready across targets", async () => {
    const root = await gitWorkspaceRepo("fr-flow-235-", "mutation-target");
    expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(root));
    const scope = path.join(root, "docs/spec/10.product-architecture.srs.md");
    const block = (id: string, target: string, status: string, evidence: string, trace: string): string => [
      "", `### ${id} — Snapshot fixture ${id}`, "", "| Field | Value |", "| --- | --- |", "| Type | functional |", `| Target | ${target} |`,
      `| Status | ${status} |`, "| Priority | medium |", "| Tags | fixture |", "| Risk | low |", "| Stability | evolving |", "| Verification Method | test |",
      "| GitHub Issue | - |", "| Related Docs | - |", "", "#### Requirement", "", `The system SHALL keep ${id}.`, "", "#### Rationale", "", "Fixture.", "",
      "#### Acceptance Criteria", "", `- [${evidence ? "x" : " "}] AC-1: THE fixture SHALL hold.`, "", "#### Verification Evidence", "",
      "| Evidence ID | Type | Reference | Covers | Notes |", "| --- | --- | --- | --- | --- |", ...(evidence ? [evidence] : []), "", "#### Trace Links", "",
      "| Type | Reference | Relation | Notes |", "| --- | --- | --- | --- |", ...(trace ? [trace] : []), "", "#### Change Notes", "",
      "| Date | Change | Reason |", "| --- | --- | --- |", "| 2026-11-21 | Created | Fixture |", ""
    ].join("\n");
    await writeFile(scope, `${(await readFile(scope, "utf8")).trimEnd()}\n${block("FR-ARCH-002", "v1.0.0", "implemented", "| VE-1 | test | test/x.test.ts | AC-1 | fixture |", "")}${block("FR-ARCH-003", "v1.1.0", "planned", "", "| Requirement | FR-ARCH-002 | depends_on | another target |")}`, "utf8");

    const command = snapshotCommand(await section(COPIES[0]!));
    const parsed = /^node -e "(.*)" (\S+) (\S+)$/u.exec(command);
    expect(parsed, command).not.toBeNull();
    const [, source, targetArg, outArg] = parsed as RegExpExecArray;
    expect(targetArg).toBe("<t>");
    const cli = `node ${JSON.stringify(path.join(REPO, "bin", "speckiwi"))}`;
    const script = (source as string).replaceAll("'speckiwi'", JSON.stringify(cli));
    expect(script, "the command names the CLI as 'speckiwi'").not.toBe(source);
    const out = (outArg as string).replace("{run_id}", "run-235");

    // A CLI error answer stops the command before it writes a snapshot that would hide the error.
    const refused = await promisify(execFile)(process.execPath, ["-e", script, "no-such-target", "refused.json"], { cwd: root, windowsHide: true })
      .then(() => null, (error: { code?: number; stderr?: string }) => error);
    expect(refused?.code, "a CLI error answer must end the command with a non-zero code").not.toBe(0);
    expect(refused?.code).toBeDefined();
    expect(refused?.stderr ?? "").toContain("TARGET_NOT_FOUND");
    await expect(readFile(path.join(root, "refused.json"), "utf8")).rejects.toThrow();

    await promisify(execFile)(process.execPath, ["-e", script, "v1.1.0", out], { cwd: root, windowsHide: true });

    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", root, "orchestrate", "readiness", "check", "--target", "v1.1.0", "--snapshot", out, "--req", "FR-ARCH-003", "--json"], streams);
    const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { ok?: boolean };
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
  });
});
