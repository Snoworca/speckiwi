import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../src/core/bootstrap/templates.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { addRelatedDoc } from "../../src/core/mutation/add-related-doc.js";
import { repairRulesReferences } from "../../src/core/mutation/repair-rules-references.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";

async function fixture(edit: (text: string) => string): Promise<{ rootPath: string; file: string }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  await writeFile(file, edit(text), "utf8");
  await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  return { rootPath, file };
}


// IR-CLI-112 AC-3 regression: HEAD rewrote the whole Related Docs line, so text after an escaped pipe survived.
describe("r7 shared metadata writer drops Related Docs text after an escaped pipe", () => {
  it("A add-related-doc keeps an existing escaped pipe in Related Docs", async () => {
    const { rootPath, file } = await fixture((t) => t.replace("| Related Docs | - |", "| Related Docs | [A \\| B](a.md) |"));
    const before = await readFile(file, "utf8");
    const r = await addRelatedDoc(await resolveProjectRoot(rootPath), { id: ID, reference: "docs/x.md", dryRun: false });
    // Lead decision (round 7): the defect is silent loss. An explicit refusal that leaves the file byte-identical is also correct.
    if (r.ok) expect(await readFile(file, "utf8")).toContain("B](a.md)");
    else expect(await readFile(file, "utf8")).toBe(before);
  });

  it("B repair-rules-references keeps an existing escaped pipe in Related Docs", async () => {
    const { rootPath, file } = await fixture((t) =>
      t.replace("| Related Docs | - |", "| Related Docs | [SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md), [x \\| y](y.md) |")
    );
    await repairRulesReferences(await resolveProjectRoot(rootPath), { apply: true });
    expect(await readFile(file, "utf8")).toContain("y](y.md)");
  });

});
