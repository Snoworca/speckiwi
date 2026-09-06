import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../src/core/diagnostic-registry.js";

// FR-NODE-095 — eleven codes that no path can emit are retracted from the registry and from the
// bundled rules document. A registered-and-listed code the runtime cannot produce reads as an
// enforced check, which is worse than an absent feature.
//
// The reasons live on the requirement, not in the document: naming a retracted code there would
// collide with the existing contract (FR-NODE-086 AC-2, FR-NODE-087 AC-9) that the document cites no
// code the registry lacks, and that contract is what keeps this retraction honest, so it is left
// intact rather than exempted. Retracting a code does change one observable: `explain <code>` used to
// render any registry definition and now reports the retracted ones unknown.
//
// The same requirement fixes the mirror-image defect the audit found: SRS-W044 and SRS-W045 are
// emitted by step validation and were absent from the registry, so `explain` reported unknown for a
// code a user can see in output.

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

/**
 * The §32.1 section alone, bounded at the next heading.
 *
 * Bounded rather than sliced to the end of the document, because every claim below is about what
 * THIS section says: an unbounded slice lets a phrase carried by some later section stand in for one
 * this section dropped.
 */
function validationSection(text: string): string {
  const start = text.indexOf("### 32.1 validate-spec");
  expect(start, "the rules document no longer carries a §32.1 validate-spec section").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("### 32.2", start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
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

describe("FR-NODE-095 AC-3 — the two emitted step codes are registered and explainable", () => {
  const STEP_CODES = ["SRS-W044", "SRS-W045"] as const;

  it("registers each with warning severity and a non-empty remediation", () => {
    for (const code of STEP_CODES) {
      const definition = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === code);
      expect(definition, `${code} must be registered`).toBeDefined();
      expect(definition?.severity).toBe("warning");
      expect(definition?.remediation.length).toBeGreaterThan(0);
    }
  });

  it("lists each in the validation table", async () => {
    const rows = validationTableRows(await rulesText());
    for (const code of STEP_CODES) {
      expect(rows.some((row) => row.includes(`\`${code}\``)), `${code} must have a table row`).toBe(true);
    }
  });

  it("keeps the registered message aligned with what the step validator actually emits", async () => {
    // The registry is only useful if it describes the real finding, so the emission site is the source
    // of truth for the wording rather than the other way round.
    const emitter = await readFile(path.join("src", "core", "validator", "validate-scoped.ts"), "utf8");
    expect(emitter).toContain('advisory("SRS-W044", `Step requirement shadows body requirement id:');
    expect(emitter).toContain("advisory(\"SRS-W045\", `Step '${stepName}' carries too many requirements:");

    const shadow = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === "SRS-W044");
    const overload = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === "SRS-W045");
    expect(shadow?.messageTemplate).toContain("Step requirement shadows body requirement id");
    expect(overload?.messageTemplate).toContain("carries too many requirements");
  });
});

describe("FR-NODE-095 AC-4 — the table says what it contains and where the rest goes", () => {
  it("states that the table lists every emittable code and only those", async () => {
    const validation = validationSection(await rulesText());

    expect(validation).toContain("lists every code `validate-spec` can emit, and only those");
    // The exclusivity claim was falsified by step validation, which reports outside the registry on
    // purpose. Each surface is pinned by the bullet it owns rather than by the sentence that opens
    // it: the prose inside a bullet is rewritten whenever the runtime it describes changes, and a
    // check that fails on that is measuring wording rather than content. Deleting either surface
    // still fails here, which is what the sentence literal was standing in for.
    expect(validation).toMatch(/^- Release readiness /m);
    expect(validation).toMatch(/^- Step validation /m);
    for (const code of ["SRS-W044", "SRS-W045", "STEP_DIRECT_CONFLICT", "SDS-W050", "SDS-E054", "STEP_PROMOTE_NO_EVIDENCE"]) {
      expect(validation, `the section names ${code}`).toContain(code);
    }
    // Not all of what step validation reports is an advisory: SDS-E054 carries error severity and
    // fails the step-validate exit code. A reader told "advisories" would take a refusal that stops
    // the command for a note, so the section has to say which one is not one.
    expect(validation, "the section gives SDS-E054 its error severity").toMatch(/`SDS-E054`[\s\S]{0,200}?`error` severity/);
    expect(validation, "the section says SDS-E054 turns the exit code").toMatch(/`SDS-E054`[\s\S]{0,400}?exit code/);
    // The registered pair and the unregistered rest must be distinguished, or a reader cannot tell
    // which codes `explain` will resolve.
    expect(validation).toContain("are `SRS-` codes and so are registered");
    expect(validation).toContain("The rest live in namespaces this table does not cover");
  });

  it("names the typed release-readiness fields as the findings reported outside the table", async () => {
    const validation = validationSection(await rulesText());

    for (const field of ["acCoverageGaps", "missingEvidenceReferences", "commandEvidencePolicyViolations", "brokenTraceLinks"]) {
      expect(validation, `the section names ${field}`).toContain(field);
    }
  });
});

describe("FR-NODE-095 AC-5 — the two guidance sections say they are not validated", () => {
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

describe("FR-NODE-095 AC-7 — the surviving codes are untouched", () => {
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
