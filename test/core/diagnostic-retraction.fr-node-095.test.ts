import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../src/core/diagnostic-registry.js";

// FR-NODE-095 — eleven codes that no path can emit are retracted from the registry and from the
// bundled rules document. A registered-and-listed code the runtime cannot produce reads as an
// enforced check, which is worse than an absent feature.
//
// The reasons live on the requirement, not in the document. No consumer ever saw these codes in
// output — the table was their only appearance — so a shipped document that explains them would be
// archaeology, and naming them would collide with the existing contract (FR-NODE-086 AC-2,
// FR-NODE-087 AC-9) that the document cites no code the registry lacks. That contract is what keeps
// this retraction honest, so it is left intact rather than exempted.

const RULES_DOCUMENT = path.join("docs", "rule", "SRS-MD-Rules-v2.5.0.md");

const RETRACTED = [
  "SRS-E009",
  "SRS-E026",
  "SRS-E027",
  "SRS-E028",
  "SRS-E029",
  "SRS-E030",
  "SRS-E031",
  "SRS-W005",
  "SRS-W006",
  "SRS-W007",
  "SRS-W021"
] as const;

/** Codes that were emitted before this change and must survive it untouched. */
const STILL_LIVE = ["SRS-E001", "SRS-E010", "SRS-E012", "SRS-W002", "SRS-W008", "SRS-W070", "SRS-W071"] as const;

async function rulesText(): Promise<string> {
  return readFile(RULES_DOCUMENT, "utf8");
}

function validationTableRows(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /^\|\s*`SRS-[EW]\d+`\s*\|/.test(line));
}

describe("FR-NODE-095 AC-1/AC-2 — the eleven codes are gone from both surfaces", () => {
  it("defines none of them in the diagnostic registry", () => {
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));
    for (const code of RETRACTED) {
      expect(registered.has(code), `${code} must not be registered`).toBe(false);
    }
  });

  it("lists none of them in the rules document validation table", async () => {
    const rows = validationTableRows(await rulesText());
    for (const code of RETRACTED) {
      expect(rows.some((row) => row.includes(`\`${code}\``)), `${code} must not be a table row`).toBe(false);
    }
  });

  it("does not name any of them anywhere else in the rules document either", async () => {
    const text = await rulesText();
    for (const code of RETRACTED) {
      expect(text.includes(code), `${code} must not appear in the rules document`).toBe(false);
    }
  });
});

describe("FR-NODE-095 AC-3 — the table says what it contains and where the rest goes", () => {
  it("states that the table lists every emittable code and only those", async () => {
    const text = await rulesText();
    const validation = text.slice(text.indexOf("### 32.1 validate-spec"));

    expect(validation).toContain("lists every code the implementation can emit, and only those");
  });

  it("names the typed release-readiness fields as the findings reported outside the table", async () => {
    const text = await rulesText();
    const validation = text.slice(text.indexOf("### 32.1 validate-spec"));

    for (const field of ["acCoverageGaps", "missingEvidenceReferences", "commandEvidencePolicyViolations", "brokenTraceLinks"]) {
      expect(validation, `the section names ${field}`).toContain(field);
    }
  });
});

describe("FR-NODE-095 AC-4 — the two guidance sections say they are not validated", () => {
  it("states that the discouraged-expression list is applied by a reviewer and reports no diagnostic", async () => {
    const text = await rulesText();
    const start = text.indexOf("### 19.4 Forbidden or Warned Expressions");
    const expressions = text.slice(start, text.indexOf("## 20.", start));

    expect(expressions).toContain("applied by a reviewer, not by validation, and no diagnostic reports a match");
  });

  it("states that the tag ceiling is a recommendation validation does not report", async () => {
    const text = await rulesText();
    const start = text.indexOf("## 17. Tags Rules");
    const tags = text.slice(start, text.indexOf("## 18.", start));

    expect(tags).toContain("validation reports no diagnostic for exceeding it");
  });
});

describe("FR-NODE-095 AC-6 — the surviving codes are untouched", () => {
  it("keeps every still-live code in the registry", () => {
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));
    for (const code of STILL_LIVE) {
      expect(registered.has(code), `${code} must remain registered`).toBe(true);
    }
  });

  it("keeps the registry and the validation table in agreement in both directions", async () => {
    const rows = validationTableRows(await rulesText());
    const documented = new Set(rows.map((row) => /`(SRS-[EW]\d+)`/.exec(row)?.[1] ?? ""));
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));

    for (const code of registered) {
      expect(documented.has(code), `${code} is registered but not documented`).toBe(true);
    }
    for (const code of documented) {
      expect(registered.has(code), `${code} is documented but not registered`).toBe(true);
    }
  });

  it("keeps the severity and title of a surviving code aligned with its table row", async () => {
    const rows = validationTableRows(await rulesText());
    for (const code of STILL_LIVE) {
      const definition = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === code);
      const row = rows.find((candidate) => candidate.includes(`\`${code}\``));
      expect(row, `${code} has a table row`).toBeDefined();
      expect(row).toContain(`| ${definition?.severity} |`);
      expect(row).toContain(definition?.title ?? " ");
    }
  });
});
