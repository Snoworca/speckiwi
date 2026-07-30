import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-036 — the link-check half. The check already existed; what it lacked was a registered code
// a caller could filter on, which is why a dangling Related Docs path survived two releases here.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function linksFor(rootPath: string) {
  return checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)));
}

async function rewriteMetadataRow(rootPath: string, field: string, value: string): Promise<void> {
  const file = path.join(rootPath, ARCH_DOC);
  const text = await readFile(file, "utf8");
  const pattern = new RegExp(`^\\| ${field} \\| .*\\|$`, "m");
  if (!pattern.test(text)) throw new Error(`fixture changed: no ${field} metadata row`);
  await writeFile(file, text.replace(pattern, `| ${field} | ${value} |`), "utf8");
}

describe("FR-PARSE-036 AC-2 — a missing local Related Docs target carries SRS-W003", () => {
  it("reports the code alongside the reason text rather than replacing it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await rewriteMetadataRow(rootPath, "Related Docs", "[Gone](./99.absent.md)");

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      requirementId: "FR-ARCH-001",
      reference: "./99.absent.md",
      reason: "local file missing",
      code: "SRS-W003"
    });
  });

  it("reports nothing for a Related Docs link whose target exists", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    expect((await linksFor(rootPath)).broken).toHaveLength(0);
  });
});

describe("FR-PARSE-036 AC-3 — every broken entry carries a registered code", () => {
  it("reports a malformed GitHub Issue value as SRS-W004", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await rewriteMetadataRow(rootPath, "GitHub Issue", "https://example.com/not-an-issue");

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ reason: "invalid GitHub issue URL", code: "SRS-W004" });
  });

  it("reports a Requirement trace reference that names no existing requirement as SRS-E012", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const file = path.join(rootPath, ARCH_DOC);
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-404 | self |"), "utf8");

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ reference: "FR-ARCH-404", reason: "requirement missing", code: "SRS-E012" });
  });

  it("leaves no broken entry without a code the registry defines", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await rewriteMetadataRow(rootPath, "Related Docs", "[Gone](./99.absent.md)");
    await rewriteMetadataRow(rootPath, "GitHub Issue", "not-a-url");

    const broken = (await linksFor(rootPath)).broken;
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));

    expect(broken.length).toBeGreaterThan(0);
    for (const entry of broken) {
      expect(entry.code, `${entry.reference} carries a code`).toBeDefined();
      expect(registered.has(entry.code), `${entry.code} is registered`).toBe(true);
    }
  });
});
