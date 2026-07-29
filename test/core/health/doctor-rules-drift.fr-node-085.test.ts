import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import type { DoctorCheck } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { BUNDLED_RULES_VERSION } from "../../../src/core/bootstrap/templates.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-085 — doctor's rules check after init owns the rules documents.
//
// Red-phase suite: AC-7 and AC-8 of docs/spec/50.nodejs-implementation.srs.md FR-NODE-085.
//   - AC-7: the rules-drift remediation names a rules-only refresh command and never the force
//           flag, because that flag overwrites the index and the scope SRS documents.
//   - AC-8: the rules check verifies that the bundled-version rules file exists on disk, so a
//           missing document is reported instead of passing on the index pointer alone.

const RULES_REL = path.join("docs", "rule", `SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`);

async function rulesCheck(root: string): Promise<DoctorCheck | undefined> {
  const workspace = await parseWorkspace({ root });
  const report = await diagnoseHealth(workspace);
  // The SRS rules check, distinguished from the separate SDS rules installation check.
  return report.checks.find((entry) => /rules/i.test(entry.label) && !/SDS/i.test(entry.label));
}

async function installRulesDocument(root: string): Promise<void> {
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(path.join(root, RULES_REL), `# SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}\n`, "utf8");
}

async function setIndexRulesPointer(root: string, version: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const content = await readFile(indexPath, "utf8");
  const next = content
    .split("\n")
    .map((line) =>
      line.startsWith("| Rules |")
        ? `| Rules | [SRS-MD Authoring Rules v${version}](../rule/SRS-MD-Rules-v${version}.md) |`
        : line
    )
    .join("\n");
  await writeFile(indexPath, next, "utf8");
}

describe("FR-NODE-085 AC-7 — the rules drift remediation never names the force flag", () => {
  it("FR-NODE-085 AC-7: a drifted rules version is remediated by a rules-only refresh, not --force", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installRulesDocument(root);
    await setIndexRulesPointer(root, "0.9.0");

    const check = await rulesCheck(root);

    expect(check, "diagnoseHealth must include a rules check").toBeDefined();
    expect(check?.state).not.toBe("ok");
    expect(check?.remediation).not.toMatch(/--force/);
    expect(check?.remediation).toMatch(/speckiwi init/);
  });

  it("FR-NODE-085 AC-7: no rules check remediation mentions the force flag in any state", async () => {
    const drifted = await copyFixtureWorkspace("valid-basic");
    await installRulesDocument(drifted);
    await setIndexRulesPointer(drifted, "0.9.0");

    const missingPointer = await copyFixtureWorkspace("valid-basic");
    await installRulesDocument(missingPointer);
    const indexPath = path.join(missingPointer, "docs", "spec", "00.index.md");
    const withoutRulesRow = (await readFile(indexPath, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("| Rules |"))
      .join("\n");
    await writeFile(indexPath, withoutRulesRow, "utf8");

    const current = await copyFixtureWorkspace("valid-basic");
    await installRulesDocument(current);

    for (const root of [drifted, missingPointer, current]) {
      const check = await rulesCheck(root);
      expect(check?.remediation).not.toMatch(/--force/);
    }
  });
});

describe("FR-NODE-085 AC-8 — the rules check verifies the rules document exists on disk", () => {
  it("FR-NODE-085 AC-8: a matching index pointer with no rules file on disk is not reported ok", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await setIndexRulesPointer(root, BUNDLED_RULES_VERSION);
    await rm(path.join(root, RULES_REL), { force: true });

    const check = await rulesCheck(root);

    expect(check, "diagnoseHealth must include a rules check").toBeDefined();
    expect(check?.state).not.toBe("ok");
    expect(check?.message).toMatch(new RegExp(`SRS-MD-Rules-v${BUNDLED_RULES_VERSION.replace(/\./g, "\\.")}\\.md`));
    expect(check?.remediation).toMatch(/speckiwi init/);
    expect(check?.remediation).not.toMatch(/--force/);
  });

  it("FR-NODE-085 AC-8: a matching index pointer with the rules file installed is reported ok", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await setIndexRulesPointer(root, BUNDLED_RULES_VERSION);
    await installRulesDocument(root);

    const check = await rulesCheck(root);

    expect(check?.state).toBe("ok");
  });
});
