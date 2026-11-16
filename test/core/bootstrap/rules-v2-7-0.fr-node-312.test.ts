import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { BUNDLED_RULES_VERSION, renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-312 AC-9 — §11.4 says a new requirement may take an author-chosen unused number and that
// gaps are valid, and the rules ship as 2.7.0 so a project on 2.6.0 is told to upgrade and receives it.
// The literals are written out, not derived from the bundled constant, so reverting the bump fails here.

const repo = (file: string) => path.resolve(import.meta.dirname, "../../..", file);
const OLD_RULES = "SRS-MD-Rules-v2.6.0.md";
const NEW_RULES = "SRS-MD-Rules-v2.7.0.md";
const OLD_ROW = `| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/${OLD_RULES}) |`;
const NEW_ROW = `| Rules | [SRS-MD Authoring Rules v2.7.0](../rule/${NEW_RULES}) |`;
const ITEM_8 =
  "8. A new requirement may take a number chosen by its author, such as one parallel worktrees agreed on, provided no SRS document of the checkout has used that number in the same prefix and scope, however it is padded (`FR-AUTH-0001` is the number `FR-AUTH-001` holds); unused numbers between IDs are valid and are not reported.";

async function projectOn260(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(path.join(root, "docs", "rule", OLD_RULES), "# SRS-MD Authoring Rules v2.6.0\n", "utf8");
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const current = await readFile(indexPath, "utf8");
  const index = current.replace(NEW_ROW, OLD_ROW);
  expect(index, "the fixture's index Rules row must be replaceable").not.toBe(current);
  await writeFile(indexPath, index, "utf8");
  const block = renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, OLD_RULES);
  await writeFile(path.join(root, "CLAUDE.md"), `# Consumer notes\n\n${block}\n`, "utf8");
  return root;
}

describe("FR-NODE-312 AC-9 — SRS-MD rules 2.7.0", () => {
  // @req FR-NODE-312 AC-9
  it("bundles 2.7.0, ships its document and no 2.6.0 one", async () => {
    expect(BUNDLED_RULES_VERSION).toBe("2.7.0");
    expect(await readdir(repo("docs/rule"))).toContain(NEW_RULES);
    expect(await readdir(repo("docs/rule"))).not.toContain(OLD_RULES);
    const pkg = JSON.parse(await readFile(repo("package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain(`docs/rule/${NEW_RULES}`);
  });

  // @req FR-NODE-312 AC-9
  it("§11.4 lets a new requirement take an unused chosen number and declares gaps valid", async () => {
    const text = await readFile(repo(`docs/rule/${NEW_RULES}`), "utf8");
    expect(text.split(/\r?\n/)[0]).toBe("# SRS-MD Authoring Rules v2.7.0");
    const start = text.indexOf("### 11.4 ID Operation Rules");
    const section = text.slice(start, text.indexOf("\n---", start));
    expect(section.split(/\r?\n/)).toContain(ITEM_8);
  });

  // @req FR-NODE-312 AC-9
  it("doctor tells a project on 2.6.0 to upgrade, and upgrade installs 2.7.0 and prunes 2.6.0", async () => {
    const root = await projectOn260();
    const before = (await diagnoseHealth(await parseWorkspace({ root }))).checks.find((entry) => entry.label === "Rules version drift");
    expect(before?.message).toBe("installed rules v2.6.0 differs from bundled rules v2.7.0");

    const result = await upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
    expect(result.ok, result.error?.message).toBe(true);

    const ruleDir = path.join(root, "docs", "rule");
    expect(await readdir(ruleDir)).not.toContain(OLD_RULES);
    expect((await readFile(path.join(ruleDir, NEW_RULES), "utf8")).split(/\r?\n/)).toContain(ITEM_8);
    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
    expect(index.split(/\r?\n/).filter((line) => line.startsWith("| Rules |"))).toEqual([NEW_ROW]);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).not.toContain(OLD_RULES);
  });
});
