import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-044 AC-6 — a stale SRS rules file name is reported by SRS-W073, and the warning has to say
// how to clear it. Upgrade rewrites only the pointers the tool owns, so the guidance differs by line:
// a tool-owned pointer is cleared by `speckiwi upgrade`; an author's own line is edited by hand.

const OLD_RULES = "SRS-MD-Rules-v2.5.0.md";
const NEW_RULES = "SRS-MD-Rules-v2.6.0.md";
const SCOPE_DOCUMENT = "10.product-architecture.srs.md";

async function staleRulesWarnings(root: string): Promise<Array<{ filePath: string; line: number; message: string }>> {
  return validateWorkspace(await parseWorkspace({ root }))
    .diagnostics.filter((entry) => entry.code === "SRS-W073" && entry.message.includes("BUNDLED_SRS_RULES_FILENAME"))
    .map((entry) => ({ filePath: entry.filePath as string, line: entry.line as number, message: entry.message }));
}

describe("FR-PARSE-044 AC-6 — SRS-W073 says how to clear a stale rules file name", () => {
  // @req FR-PARSE-044 AC-6
  it("sends a tool-owned Rules row to `speckiwi upgrade` and an author's line to a hand edit naming the bundled file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const index = await readFile(indexPath, "utf8");
    const staleIndex = index.replace(/SRS-MD Authoring Rules v2\.6\.0\]\(\.\.\/rule\/SRS-MD-Rules-v2\.6\.0\.md\)/, `SRS-MD Authoring Rules v2.5.0](../rule/${OLD_RULES})`);
    expect(staleIndex).not.toBe(index);
    await writeFile(indexPath, staleIndex, "utf8");
    const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
    const scope = await readFile(scopePath, "utf8");
    await writeFile(scopePath, scope.replace("Fixture architecture scope.", `Fixture architecture scope, see [the rules](../rule/${OLD_RULES}).`), "utf8");

    const warnings = await staleRulesWarnings(root);

    // The index metadata Rules row now names 2.5.0: a pointer upgrade rewrites.
    const indexRow = warnings.find((entry) => entry.filePath === "docs/spec/00.index.md");
    expect(indexRow?.message).toMatch(/`speckiwi upgrade`/);
    expect(indexRow?.message).not.toMatch(/by hand/);

    const authorLine = warnings.find((entry) => entry.filePath === `docs/spec/${SCOPE_DOCUMENT}`);
    expect(authorLine?.message).toContain(NEW_RULES);
    expect(authorLine?.message).toMatch(/by hand/);
    expect(authorLine?.message).toMatch(/link/);
    expect(authorLine?.message).not.toMatch(/run `speckiwi upgrade`/);
    // The finding and the guidance are two sentences.
    expect(indexRow?.message).toMatch(/says 2\.5\.0\. This line is a rules pointer/);
    expect(authorLine?.message).toMatch(/says 2\.5\.0\. This line is author text/);
  });

  // @req FR-PARSE-044 AC-6
  it("states both cases in the code's remediation", () => {
    const remediation = getDiagnosticDefinition("SRS-W073").remediation;
    expect(remediation).toMatch(/`speckiwi upgrade`/);
    expect(remediation).toMatch(/Rules row/);
    expect(remediation).toMatch(/Reference Documents/);
    expect(remediation).toMatch(/by hand/);
  });

  // @req FR-PARSE-044 AC-6
  // Lead decision (round 11): a reference-style Rules row is author text, so its definition is too:
  // validate sends it to a hand edit and upgrade leaves it. (Round 8 sent it to upgrade.)
  it("sends the definition line of a reference-style Rules row to a hand edit, since upgrade leaves reference-style rows alone", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
    const scope = await readFile(scopePath, "utf8");
    await writeFile(
      scopePath,
      scope.replace(
        "| Scope Name | Product Architecture |",
        `| Scope Name | Product Architecture |\n| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |\n\n[rules]: ../rule/${OLD_RULES}`
      ),
      "utf8"
    );
    const definitionLine = (await readFile(scopePath, "utf8")).split(/\r?\n/).indexOf(`[rules]: ../rule/${OLD_RULES}`) + 1;

    const warnings = await staleRulesWarnings(root);

    const onDefinition = warnings.filter((entry) => entry.filePath === `docs/spec/${SCOPE_DOCUMENT}` && entry.line === definitionLine);
    expect(onDefinition.length).toBe(1);
    expect(onDefinition[0]!.message).toMatch(/by hand/);
    expect(onDefinition[0]!.message).not.toMatch(/run `speckiwi upgrade`/);
  });

  // @req FR-PARSE-044 AC-6
  it("sends a definition an author line also uses to a hand edit, since upgrade leaves a shared definition alone", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const scopePath = path.join(root, "docs", "spec", SCOPE_DOCUMENT);
    const scope = await readFile(scopePath, "utf8");
    await writeFile(
      scopePath,
      scope
        .replace(
          "| Scope Name | Product Architecture |",
          `| Scope Name | Product Architecture |\n| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |\n\n[rules]: ../rule/${OLD_RULES}`
        )
        .replace("Fixture architecture scope.", "Fixture architecture scope, see [the old rules][rules]."),
      "utf8"
    );
    const definitionLine = (await readFile(scopePath, "utf8")).split(/\r?\n/).indexOf(`[rules]: ../rule/${OLD_RULES}`) + 1;

    const warnings = await staleRulesWarnings(root);

    const onDefinition = warnings.filter((entry) => entry.filePath === `docs/spec/${SCOPE_DOCUMENT}` && entry.line === definitionLine);
    expect(onDefinition.length).toBe(1);
    expect(onDefinition[0]!.message).toMatch(/by hand/);
    expect(onDefinition[0]!.message).not.toMatch(/run `speckiwi upgrade`/);
  });
});
