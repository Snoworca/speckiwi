import { cp, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtureRoot = path.resolve("test", "fixtures", "workspaces");

export async function copyFixtureWorkspace(name: string): Promise<string> {
  const source = path.join(fixtureRoot, name);
  const entries = await readdir(fixtureRoot).catch(() => []);
  if (!entries.includes(name)) {
    throw new Error(`Unknown fixture workspace: ${name}`);
  }
  const target = await mkdtemp(path.join(tmpdir(), `speckiwi-${name}-`));
  await cp(source, target, { recursive: true });
  if (name === "crlf-basic") {
    const crlfFile = path.join(target, "docs", "spec", "10.product-architecture.srs.md");
    const text = await import("node:fs/promises").then((fs) => fs.readFile(crlfFile, "utf8"));
    await writeFile(crlfFile, text.replace(/\r?\n/g, "\r\n"), "utf8");
  }
  return target;
}

export async function buildLargeSrsFixture(count: number, targetDir: string): Promise<void> {
  const specDir = path.join(targetDir, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  const blocks: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const id = `FR-ARCH-${String(index).padStart(3, "0")}`;
    blocks.push(renderRequirementBlock(id, `Generated requirement ${index}`));
  }
  await writeFile(
    path.join(specDir, "10.product-architecture.srs.md"),
    [
      "# Product Architecture",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | scope_srs |",
      "| Scope | ARCH |",
      "| Scope Name | Product Architecture |",
      "",
      "## 1. Scope Overview",
      "",
      "Generated fixture.",
      "",
      "## 2. Scope Boundaries",
      "",
      "### In Scope",
      "",
      "- generated requirements",
      "",
      "### Out of Scope",
      "",
      "- none",
      "",
      "## 3. Assumptions and Constraints",
      "",
      "- none",
      "",
      "## 4. Requirements",
      "",
      blocks.join("\n\n")
    ].join("\n"),
    "utf8"
  );
}

function renderRequirementBlock(id: string, title: string): string {
  return [
    `### ${id} — ${title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | medium |",
    "| Tags | generated |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    "Generated requirement statement.",
    "",
    "#### Rationale",
    "",
    "Generated rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Generated criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-05-08 | Generated | Fixture |"
  ].join("\n");
}
