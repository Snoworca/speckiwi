import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { REPO_ROOT } from "../../skills/kiwi-orchestrator-variants.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { collectEvidenceReferenceIssuesForRecord } from "../../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import type { ProjectRoot } from "../../../src/core/types.js";

// @req FR-NODE-174 — the verified transition refuses evidence references it cannot resolve.
//
// The defect these cases pin: `update_status` admitted `verified` on `reference.trim() !== ""`, so any
// non-empty string passed as a reference. Measured in this repository, 54 requirements carried evidence
// pointing at ~/.claude/skills/, a directory outside version control, and 44 of them reached `verified`
// — after which granular edits are refused, so the rows cannot be repaired. Release readiness already
// computed exactly this and already separated `outside-project-root` from `missing`; it simply ran
// after the rows were locked.

const TARGET_ID = "FR-ARCH-001";
/** Exists in the `valid-basic` fixture, so it is the control that must NOT be refused. */
const RESOLVABLE = "docs/spec/90.appendix.md";

async function withEvidence(reference: string, type = "test"): Promise<ProjectRoot> {
  const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
  const checked = await setAcceptanceCriteriaChecked(projectRoot, { id: TARGET_ID, acIds: ["all"], checked: true });
  expect(checked.ok, "the fixture's criteria must be checkable").toBe(true);
  const evidence = await addVerificationEvidence(projectRoot, { id: TARGET_ID, type, reference });
  expect(evidence.ok, "the fixture must accept an evidence row").toBe(true);
  return projectRoot;
}

async function statusOf(projectRoot: ProjectRoot): Promise<string | undefined> {
  const workspace = await parseWorkspace(projectRoot);
  return workspace.records.find((record) => record.id === TARGET_ID)?.status;
}

describe("FR-NODE-174 — a reference the tool cannot resolve blocks verified", () => {
  it("AC-1: refuses when a path-like reference resolves outside the project root", async () => {
    const projectRoot = await withEvidence("../outside-the-checkout/notes.md");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "an evidence path outside the project root reached verified").toBe(false);
    expect(await statusOf(projectRoot), "the Status row moved despite the refusal").not.toBe("verified");
  });

  it("AC-1: refuses an absolute path outside the project root, the shape this repository actually carried", async () => {
    // The measured class: ~/.claude/skills/... expanded to an absolute path on the author's machine.
    const outside = process.platform === "win32" ? "C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md" : "/home/nobody/.claude/skills/kiwi-x/SKILL.md";
    const projectRoot = await withEvidence(outside, "inspection");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok).toBe(false);
    expect(await statusOf(projectRoot)).not.toBe("verified");
  });

  it("AC-2: refuses when the reference is under the root but names no existing file", async () => {
    const projectRoot = await withEvidence("docs/spec/there-is-no-such-file.md");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "an evidence path that does not exist reached verified").toBe(false);
    expect(await statusOf(projectRoot)).not.toBe("verified");
  });

  it("AC-3: the refusal names the offending reference", async () => {
    const projectRoot = await withEvidence("docs/spec/there-is-no-such-file.md");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message, "the caller cannot tell which row failed").toContain("there-is-no-such-file.md");
  });

  it("AC-1/AC-2 control: a reference that does resolve is not refused", async () => {
    const projectRoot = await withEvidence(RESOLVABLE);

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(await statusOf(projectRoot)).toBe("verified");
  });
});

describe("FR-NODE-174 — the two gates agree on what a reference is", () => {
  it("AC-4: a command reference is not refused", async () => {
    const projectRoot = await withEvidence("npm run test -- --no-file-parallelism", "command");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "a command reference was treated as a missing path").toBe(true);
  });

  it("AC-4: a valid http(s) URL reference is not refused", async () => {
    const projectRoot = await withEvidence("https://example.com/ci/run/1", "url");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "a URL reference was treated as a missing path").toBe(true);
  });

  it("AC-5: the transition's verdict equals the shared resolver's verdict, reference for reference", async () => {
    const cases: Array<{ reference: string; type: string }> = [
      { reference: RESOLVABLE, type: "test" },
      { reference: "docs/spec/there-is-no-such-file.md", type: "test" },
      { reference: "../outside-the-checkout/notes.md", type: "inspection" },
      { reference: "npm run test", type: "command" },
      { reference: "https://example.com/ci/run/1", type: "url" }
    ];

    for (const { reference, type } of cases) {
      const projectRoot = await withEvidence(reference, type);
      const workspace = await parseWorkspace(projectRoot);
      const record = workspace.records.find((candidate) => candidate.id === TARGET_ID);
      expect(record, `${reference}: the fixture record vanished`).toBeDefined();
      if (!record) continue;

      const issues = collectEvidenceReferenceIssuesForRecord(projectRoot.root, record);
      const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

      expect(result.ok, `${reference}: the transition and the resolver disagree`).toBe(issues.length === 0);
    }
  });

  it("AC-5: the identifiers that carry the resolution rule live in exactly one source file", async () => {
    // A verifier showed the earlier version of this case was a tautology: it restated
    // collectMissingEvidenceReferences's own body, so two copies that agreed would satisfy it and it
    // passed even with the transition guard deleted. What actually has to hold is that there is one
    // implementation — so assert on the source, where a second copy would be visible.
    const sourceDir = path.join(REPO_ROOT, "src");
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(sourceDir);

    // Helpers that are not exported: a mention anywhere else is a second copy by definition.
    const INTERNAL = [
      "isPathLikeReference",
      "localEvidencePath",
      "outside-project-root",
      "isUnderRoot",
      "isCommandReference",
      "isUrlReference",
      "isValidHttpUrl",
      "splitEvidenceReferences",
      "realPathIfExists",
      "EVIDENCE_ISSUE_CAUSE"
    ];
    // The two exported entry points are mentioned by their callers' import lines, so what has to be
    // single-file is the definition, not the mention.
    for (const exported of ["collectEvidenceReferenceIssuesForRecord", "describeEvidenceRefusal"]) {
      const definers: string[] = [];
      for (const file of files) {
        if (new RegExp(`export function ${exported}\\b`).test(await readFile(file, "utf8"))) {
          definers.push(path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
        }
      }
      expect(definers, `${exported} is defined in more than one place`).toEqual(["src/core/workflow/release-readiness.ts"]);
    }
    for (const marker of INTERNAL) {
      const carriers: string[] = [];
      for (const file of files) {
        if ((await readFile(file, "utf8")).includes(marker)) carriers.push(path.relative(REPO_ROOT, file));
      }
      expect(carriers, `${marker} is implemented in more than one place`).toHaveLength(1);
      expect(carriers[0]?.replace(/\\/g, "/")).toBe("src/core/workflow/release-readiness.ts");
    }
  });
});

describe("FR-NODE-174 — the gate cannot be walked around", () => {
  it("AC-7: creating a requirement directly at verified is refused on an unresolvable reference", async () => {
    const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    const created = await addRequirement(projectRoot, {
      type: "functional",
      scope: "ARCH",
      title: "Minted straight to verified",
      statement: "The system SHALL do something already proven.",
      acceptanceCriteria: ["It works."],
      checkedAcceptanceCriteria: ["AC-1"],
      status: "verified",
      evidence: [{ type: "inspection", reference: "C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md", covers: "AC-1" }]
    });

    expect(created.ok, "a requirement was minted at verified pointing outside the checkout").toBe(false);
  });

  it("AC-7: the creation gate judges the row that will actually be written, defaults included", async () => {
    // A verifier walked through by OMITTING `type`. The gate built its synthetic row with
    // `String(row.type ?? "")`, which is not path-like, while render-requirement.ts writes
    // `row.type ?? "test"` — and `test` IS path-like. So the gate judged a row the document never
    // contained, and an unresolvable reference landed at `verified`.
    const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    const created = await addRequirement(projectRoot, {
      type: "functional",
      scope: "ARCH",
      title: "Minted at verified with the type omitted",
      statement: "The system SHALL do something already proven.",
      acceptanceCriteria: ["It works."],
      checkedAcceptanceCriteria: ["AC-1"],
      status: "verified",
      evidence: [{ reference: "Manual QA on staging", covers: "AC-1" }]
    });

    expect(created.ok, "omitting the evidence type walked around the gate").toBe(false);
  });

  it("AC-7: a statement cannot smuggle its own evidence table past the gate", async () => {
    // Measured bypass: renderRequirementBlock writes `statement` verbatim, so a statement carrying a
    // `#### Verification Evidence` heading replaces the table the gate judged. The gate saw a clean
    // reference; the document got an outside-root one, on a row that can no longer be edited.
    const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    const created = await addRequirement(projectRoot, {
      type: "functional",
      scope: "ARCH",
      title: "Statement carrying its own evidence table",
      statement: [
        "The system SHALL do something already proven.",
        "",
        "#### Verification Evidence",
        "",
        "| Evidence ID | Type | Reference | Covers | Notes |",
        "| --- | --- | --- | --- | --- |",
        "| VE-9 | inspection | C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md | all | - |"
      ].join("\n"),
      acceptanceCriteria: ["It works."],
      checkedAcceptanceCriteria: ["AC-1"],
      status: "verified",
      evidence: [{ type: "inspection", reference: RESOLVABLE, covers: "AC-1" }]
    });

    expect(created.ok, "a statement replaced the evidence table the gate judged").toBe(false);
  });

  it("AC-7: a statement cannot smuggle a whole verified requirement block past the gate", async () => {
    // The sharper measured bypass: create at `planned`, so the gate's own condition is false and it
    // never runs at all, while the statement carries a second requirement block that reads verified.
    const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    const created = await addRequirement(projectRoot, {
      type: "functional",
      scope: "ARCH",
      title: "Carrier for a smuggled block",
      statement: [
        "The system SHALL carry something.",
        "",
        "### FR-ARCH-777 — Smuggled straight to verified",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Type | functional |",
        "| Status | verified |",
        "",
        "#### Verification Evidence",
        "",
        "| Evidence ID | Type | Reference | Covers | Notes |",
        "| --- | --- | --- | --- | --- |",
        "| VE-1 | inspection | C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md | all | - |"
      ].join("\n"),
      acceptanceCriteria: ["It works."],
      status: "planned"
    });

    expect(created.ok, "a planned creation wrote a verified body row the gate never saw").toBe(false);

    const workspace = await parseWorkspace(projectRoot);
    expect(workspace.records.find((record) => record.id === "FR-ARCH-777"), "the smuggled block landed").toBeUndefined();
  });

  it("AC-7: creating at verified still succeeds when the reference resolves", async () => {
    const projectRoot = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    const created = await addRequirement(projectRoot, {
      type: "functional",
      scope: "ARCH",
      title: "Minted straight to verified with real evidence",
      statement: "The system SHALL do something already proven.",
      acceptanceCriteria: ["It works."],
      checkedAcceptanceCriteria: ["AC-1"],
      status: "verified",
      evidence: [{ type: "inspection", reference: RESOLVABLE, covers: "AC-1" }]
    });

    expect(created.ok, created.ok ? "" : created.error.message).toBe(true);
  });
});

describe("FR-NODE-174 — every issue kind the resolver reports refuses the promotion", () => {
  it("AC-8: a malformed URL is refused", async () => {
    const projectRoot = await withEvidence("https://", "url");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "a malformed URL was accepted as a reference").toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("invalid-url");
  });

  it("AC-8: an empty reference cell alongside a resolvable one is refused", async () => {
    // The old gate asked only that SOME row be non-empty, so a blank row rode along. The shared
    // resolver reports it as `empty`; this pins that the transition now acts on that report.
    // The blank cell is written directly because addVerificationEvidence will not author one — the
    // shape exists in real documents regardless, which is why the resolver has a kind for it.
    const projectRoot = await withEvidence(RESOLVABLE);
    const specPath = path.join(projectRoot.root, "docs", "spec", "10.product-architecture.srs.md");
    const lines = (await readFile(specPath, "utf8")).split(/\r?\n/);
    const anchor = lines.findIndex((line) => line.startsWith("| VE-1 |"));
    expect(anchor, "the fixture has no evidence row to sit beside").toBeGreaterThan(-1);
    lines.splice(anchor + 1, 0, "| VE-2 | test |  | all | - |");
    await writeFile(specPath, lines.join("\n"), "utf8");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" });

    expect(result.ok, "a blank evidence row rode along to verified").toBe(false);
    if (result.ok) return;
    // A verifier measured the message here as "references do not resolve under the project root:
    // (empty) (empty)" — nothing failed to resolve; the row has no reference at all. A refusal that
    // names the wrong cause sends the caller to fix the wrong thing.
    expect(result.error.message, "the message asserts a resolution failure for an empty cell").not.toMatch(
      /do not resolve under the project root/
    );
    expect(result.error.message).toContain("empty");
  });

  it("AC-3: each kind's prose describes that kind and not a different one", async () => {
    // A verifier swapped the `missing` and `outside-project-root` prose and the suite stayed green,
    // because every case asserted only the bracketed token. The prose is what a caller reads, so it
    // is what has to be right: `missing` means the path IS under the root and names no file.
    const missing = await updateStatus(await withEvidence("docs/spec/nope.md"), { id: TARGET_ID, status: "verified" });
    const outside = await updateStatus(await withEvidence("../elsewhere/nope.md"), { id: TARGET_ID, status: "verified" });
    expect(missing.ok || outside.ok).toBe(false);
    if (missing.ok || outside.ok) return;

    expect(missing.error.message, "the `missing` prose describes the outside-root cause").not.toMatch(
      /not under the project root|outside the project root/
    );
    expect(missing.error.message, "the `missing` prose does not say what actually failed").toMatch(/no existing file|does not exist/);
    expect(outside.error.message, "the `outside-project-root` prose lost its cause").toMatch(/outside the project root/);
  });

  it("AC-3: the four kinds do not share a description", async () => {
    // A verifier gave `empty` the exact prose of `missing` and the suite stayed green, because this
    // case covered only three kinds. All four have to be in the set or "do not share" is untested.
    const proseOf = (message: string): string => message.replace(/^Cannot mark verified: /, "").replace(/^.*?\] /, "");

    const emptyRoot = await withEvidence(RESOLVABLE);
    const specPath = path.join(emptyRoot.root, "docs", "spec", "10.product-architecture.srs.md");
    const lines = (await readFile(specPath, "utf8")).split(/\r?\n/);
    const anchor = lines.findIndex((line) => line.startsWith("| VE-1 |"));
    lines.splice(anchor + 1, 0, "| VE-2 | test |  | all | - |");
    await writeFile(specPath, lines.join("\n"), "utf8");

    const cases = [
      await updateStatus(await withEvidence("docs/spec/nope.md"), { id: TARGET_ID, status: "verified" }),
      await updateStatus(await withEvidence("../elsewhere/nope.md"), { id: TARGET_ID, status: "verified" }),
      await updateStatus(await withEvidence("https://", "url"), { id: TARGET_ID, status: "verified" }),
      await updateStatus(emptyRoot, { id: TARGET_ID, status: "verified" })
    ];
    const proses = cases.map((result) => (result.ok ? "" : proseOf(result.error.message)));
    expect(proses.every((prose) => prose !== ""), "a kind did not refuse at all").toBe(true);
    expect(new Set(proses).size, `two of the four kinds share a description: ${proses.join(" / ")}`).toBe(4);
  });

  it("AC-3/AC-8: the refusal names the kind of failure, not one cause for all four", async () => {
    const missing = await updateStatus(await withEvidence("docs/spec/nope.md"), { id: TARGET_ID, status: "verified" });
    const outside = await updateStatus(await withEvidence("../elsewhere/nope.md"), { id: TARGET_ID, status: "verified" });

    expect(missing.ok).toBe(false);
    expect(outside.ok).toBe(false);
    if (missing.ok || outside.ok) return;
    expect(missing.error.message).toContain("missing");
    expect(outside.error.message).toContain("outside-project-root");
    // The two causes are different, so the messages must not be the same sentence.
    expect(missing.error.message).not.toBe(outside.error.message);
  });
});

describe("FR-NODE-174 — the check is scoped to the verified transition", () => {
  it("AC-6: a transition to implemented is unaffected by an unresolvable reference", async () => {
    const projectRoot = await withEvidence("docs/spec/there-is-no-such-file.md");

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "implemented" });

    expect(result.ok, "the check leaked into a non-verified transition").toBe(true);
    expect(await statusOf(projectRoot)).toBe("implemented");
  });

  it("AC-6: a transition away from verified is not blocked by the reference that is already recorded", async () => {
    const projectRoot = await withEvidence(RESOLVABLE);
    expect((await updateStatus(projectRoot, { id: TARGET_ID, status: "verified" })).ok).toBe(true);

    const result = await updateStatus(projectRoot, { id: TARGET_ID, status: "implemented" });

    expect(result.ok, "a verified row could not be walked back").toBe(true);
    expect(await statusOf(projectRoot)).toBe("implemented");
  });
});
