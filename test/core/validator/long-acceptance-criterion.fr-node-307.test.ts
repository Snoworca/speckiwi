import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { appendAcceptanceCriterion, editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../../src/core/mutation/edit-requirement.js";
import { deriveCanonicalRequirementReadiness, parseRequirementSnapshot } from "../../../src/core/orchestrator/readiness.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { LONG_CRITERION_THRESHOLD } from "../../../src/core/validator/criterion-length.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { renderToolDescriptions } from "../../../src/mcp/schemas.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";
import { cliPayload, content, record, TARGET } from "../orchestrator/support/readiness-fixture.js";

// @req FR-NODE-307 — the four acceptance-criterion write routes take text of any length; a long
// criterion is reported by validate as SRS-W083 instead. An OG criterion of 26,994 characters was
// refused by edit_acceptance_criterion even when resent unchanged, while replace and add_requirement
// accepted it, which drove the session to edit the SRS by hand.

const ID = "FR-ARCH-001";
const LONG = "q".repeat(26994);

async function w083(rootPath: string) {
  const report = validateWorkspace(await parseWorkspace(await resolveProjectRoot(rootPath)));
  return report.diagnostics.filter((entry) => entry.code === "SRS-W083");
}

async function tsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await tsFiles(full)));
    else if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("FR-NODE-307 AC-1 — edit_acceptance_criterion writes a criterion longer than 16,384 units", () => {
  // @req FR-NODE-307 AC-1
  it("FR-NODE-307 AC-1: resending a 26,994-character criterion unchanged writes it, and dryRun returns the patch without writing", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: first", `- [ ] AC-2: ${LONG}`] });
    const root = await resolveProjectRoot(rootPath);
    const before = await scopeText(rootPath);

    const dry = await editAcceptanceCriteria(root, { id: ID, acId: "AC-2", text: `${LONG}r`, dryRun: true });
    expect(dry.ok, JSON.stringify(dry.error)).toBe(true);
    expect(await scopeText(rootPath)).toBe(before);

    const same = await editAcceptanceCriteria(root, { id: ID, acId: "AC-2", text: LONG });
    expect(same.ok, JSON.stringify(same.error)).toBe(true);
    expect(await scopeText(rootPath)).toBe(before);

    const longer = await editAcceptanceCriteria(root, { id: ID, acId: "AC-2", text: `${LONG}r` });
    expect(longer.ok, JSON.stringify(longer.error)).toBe(true);
    const after = await scopeText(rootPath);
    expect(after).toBe(before.replace(`- [ ] AC-2: ${LONG}\n`, `- [ ] AC-2: ${LONG}r\n`));
  });
});

describe("FR-NODE-307 AC-2 — no write route refuses criterion text for its length", () => {
  // @req FR-NODE-307 AC-2
  it("FR-NODE-307 AC-2: edit, append, replace and add_requirement all accept the same 26,994-character text", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first", "- [ ] AC-2: second"] });
    const root = await resolveProjectRoot(rootPath);
    const calls = {
      edit: () => editAcceptanceCriteria(root, { id: ID, acId: "AC-1", text: LONG, dryRun: true }),
      append: () => appendAcceptanceCriterion(root, { id: ID, text: LONG, dryRun: true }),
      replace: () => replaceAcceptanceCriteria(root, { id: ID, items: [{ text: LONG }], dryRun: true }),
      add_requirement: () =>
        addRequirement(root, { type: "functional", scope: "ARCH", target: "v1.0.0", title: "Long criterion", statement: "It is long.", acceptanceCriteria: [LONG], dryRun: true })
    };
    for (const [route, call] of Object.entries(calls)) {
      const result = await call();
      expect(result.ok, `${route}: ${JSON.stringify(result.error)}`).toBe(true);
    }
  });

  // @req FR-NODE-307 AC-2
  it("FR-NODE-307 AC-2: the text rules still refuse a newline, a control character and empty text on edit and append", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first"] });
    const root = await resolveProjectRoot(rootPath);
    const before = await scopeText(rootPath);
    for (const text of [`${LONG}\nmore`, `${LONG}${String.fromCharCode(7)}`, ""]) {
      expect((await editAcceptanceCriteria(root, { id: ID, acId: "AC-1", text })).error?.code).toBe("USAGE");
      expect((await appendAcceptanceCriterion(root, { id: ID, text })).error?.code).toBe("USAGE");
    }
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-307 AC-2
  it("FR-NODE-307 AC-2: no module under src/ declares a length limit for criterion text", async () => {
    const offenders: string[] = [];
    for (const file of await tsFiles("src")) {
      const text = await readFile(file, "utf8");
      if (/MAX_AC_TEXT_LENGTH|16384|16,384/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("FR-NODE-307 AC-3 AC-4 AC-5 — SRS-W083 reports a live criterion over the threshold", () => {
  const sized = (length: number) => "w".repeat(length);

  // @req FR-NODE-307 AC-3
  it("FR-NODE-307 AC-3: one over the threshold gives one SRS-W083 naming the requirement, the AC, the length, the threshold and the remedy", async () => {
    const over = LONG_CRITERION_THRESHOLD + 1;
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first", `- [ ] AC-2: ${sized(over)}`] });
    const found = await w083(rootPath);
    expect(found).toHaveLength(1);
    const [warning] = found;
    expect(warning?.severity).toBe("warning");
    expect(warning?.requirementId).toBe(ID);
    expect(typeof warning?.line).toBe("number");
    for (const part of [ID, "AC-2", String(over), String(LONG_CRITERION_THRESHOLD), "§21.3 item 2", "edit_acceptance_criterion", "append_acceptance_criterion", "Implementation Notes"]) {
      expect(warning?.message, part).toContain(part);
    }
  });

  // @req FR-NODE-307 AC-4
  it("FR-NODE-307 AC-4: at and one below the threshold give no SRS-W083", async () => {
    const rootPath = await acFixture({
      acLines: [`- [ ] AC-1: ${sized(LONG_CRITERION_THRESHOLD - 1)}`, `- [ ] AC-2: ${sized(LONG_CRITERION_THRESHOLD)}`]
    });
    expect(await w083(rootPath)).toEqual([]);
  });

  // @req FR-NODE-307 AC-4
  it("FR-NODE-307 AC-4: an expired criterion over the threshold gives no SRS-W083", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first", `- [ ] AC-2: ~~${sized(LONG_CRITERION_THRESHOLD + 50)}~~ [EXPIRED 2026-11-01]`] });
    expect(await w083(rootPath)).toEqual([]);
  });

  // @req FR-NODE-307 AC-5
  it("FR-NODE-307 AC-5: the boundary follows the declared threshold, read from its one module", async () => {
    expect(Number.isInteger(LONG_CRITERION_THRESHOLD)).toBe(true);
    const declaring: string[] = [];
    for (const file of await tsFiles("src")) {
      if (/(?:const|let)\s+LONG_CRITERION_THRESHOLD\b/.test(await readFile(file, "utf8"))) declaring.push(file);
    }
    expect(declaring).toEqual([path.join("src", "core", "validator", "criterion-length.ts")]);
  });
});

describe("FR-NODE-307 AC-8 — SRS-W083 does not make a requirement not ready", () => {
  const evidence = [{ id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" }];
  const readiness = (code: string) => {
    const records = [record({ id: "FR-A-001", verificationEvidence: evidence })];
    const diagnostics = [{ code, severity: "warning" as const, message: `FR-A-001 ${code}`, requirementId: "FR-A-001" }];
    const snapshot = parseRequirementSnapshot(cliPayload(content(records, diagnostics)));
    return deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-A-001"]);
  };

  // @req FR-NODE-307 AC-8
  it("FR-NODE-307 AC-8: a requirement whose only warning is SRS-W083 is ready", () => {
    expect(readiness("SRS-W083")).toEqual([
      expect.objectContaining({ id: "FR-A-001", hardDependenciesSatisfied: true, evidenceDrift: false, ownershipVerified: true })
    ]);
  });

  // @req FR-NODE-307 AC-8
  it("FR-NODE-307 AC-8: another warning on the same requirement still makes it not ready", () => {
    expect(readiness("SRS-W011")).toEqual([expect.objectContaining({ id: "FR-A-001", ownershipVerified: false })]);
  });
});

describe("FR-NODE-307 AC-6 — descriptions and the Rules document", () => {
  // @req FR-NODE-307 AC-6
  it("FR-NODE-307 AC-6: the edit and append tool descriptions state no length limit", () => {
    const descriptions = renderToolDescriptions();
    for (const tool of ["edit_acceptance_criterion", "append_acceptance_criterion"]) {
      const text = descriptions[tool] ?? "";
      expect(text, tool).not.toBe("");
      expect(text, tool).not.toMatch(/at most \d|\d+ characters|length limit|maximum length/);
    }
  });

  // @req FR-NODE-307 AC-6
  it("FR-NODE-307 AC-6: Rules §21.3 and the diagnostic code table name SRS-W083 and its threshold", async () => {
    const rules = await readFile(path.join("docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8");
    const start = rules.indexOf("### 21.3 Authoring Rules");
    const section = rules.slice(start, rules.indexOf("\n### ", start + 1));
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain("`SRS-W083`");
    expect(section).toContain(LONG_CRITERION_THRESHOLD.toLocaleString("en-US"));
    expect(rules.split(/\r?\n/).some((line) => line.startsWith("| `SRS-W083` | warning |"))).toBe(true);
  });
});
