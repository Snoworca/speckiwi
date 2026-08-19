import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESEARCH_NOTICE,
  auditResearchNotices,
  classifyNotice,
  isCompliantNotice,
  listResearchDocuments
} from "../support/research-notice.js";

// @req FR-FLOW-137 — research files are unverified working notes and say so.
//
// The rule exists because reviewing them does not work: research 18 and 19 each shipped a claim that
// a review round had passed, and each was corrected within minutes once an implementer ran the code.
// Prose review cannot execute code, so it cannot check a claim about code. What it can do is warn the
// reader, and that is what the notice is for.

const REPO_ROOT = process.cwd();
const RESEARCH_DIR = path.join(REPO_ROOT, "docs", "research");

describe("FR-FLOW-137 AC-1 — the notice is asserted over the directory, not over a list", () => {
  it("finds the documents by walking the directory, including nested ones", async () => {
    const documents = await listResearchDocuments(RESEARCH_DIR);
    expect(documents.length, "the research directory scan came back empty").toBeGreaterThan(0);
    // A walker that silently stopped at the top level would leave every nested document unchecked
    // while the case above still passed.
    expect(
      documents.some((file) => file.includes("/kiwi-orchestrator/")),
      "the scan did not descend into subdirectories"
    ).toBe(true);
  });

  it("every research document carries a compliant notice", async () => {
    const offenders = (await auditResearchNotices(RESEARCH_DIR))
      .filter((report) => !isCompliantNotice(report.classification))
      .map((report) => {
        const missing = [
          report.classification.declaresUnverified ? null : "does not declare itself unverified",
          report.classification.namesWhereTruthLives ? null : "does not say where the confirmed facts are"
        ].filter(Boolean);
        return `${path.relative(REPO_ROOT, report.file).split(path.sep).join("/")}: ${missing.join("; ")}`;
      });
    expect(offenders, "a research document is missing its notice").toEqual([]);
  });
});

describe("FR-FLOW-137 AC-2 — the notice states both halves", () => {
  it("the shared notice declares the document unverified and points at the requirements", () => {
    expect(isCompliantNotice(classifyNotice(RESEARCH_NOTICE))).toBe(true);
  });

  it("a notice that only says it is a draft does not satisfy the rule", () => {
    // The half that matters most is the second one. A reader who is told a document is provisional,
    // and not told where truth lives, treats the nearest document as truth — which is the document
    // in front of them.
    const classification = classifyNotice("# 제목\n\n> 초안입니다. 아직 정리 중입니다.\n");
    expect(classification.declaresUnverified, "'초안' alone should not read as a compliance claim").toBe(false);
    expect(isCompliantNotice(classification)).toBe(false);
  });

  it("each half alone is insufficient", () => {
    expect(isCompliantNotice(classifyNotice("> 이 문서는 미검증 작업 노트다.\n"))).toBe(false);
    expect(isCompliantNotice(classifyNotice("> 확정된 요구는 docs/spec/ 에 있다.\n"))).toBe(false);
  });

  it("a sentence that denies the link does not count as pointing at it", () => {
    // Both tokens are present and the claim is the opposite one. Checking that `docs/spec` and
    // `요구` merely co-occur would accept this, which is how a check comes to pass on the negation
    // of what it asserts.
    const denial = "> 이 문서는 미검증 작업 노트다. docs/spec 요구와는 무관한 개인 메모다.\n";
    expect(classifyNotice(denial).declaresUnverified).toBe(true);
    expect(classifyNotice(denial).namesWhereTruthLives, "a denial was read as a pointer").toBe(false);
  });

  it("a notice buried below the top of the document does not count", async () => {
    // "Near its top" is the operative part: a notice at the foot of a 300-line document is read
    // after the reader has already believed the document.
    const buried = `${"\n".repeat(40)}${RESEARCH_NOTICE}\n`;
    expect(isCompliantNotice(classifyNotice(buried))).toBe(false);
  });
});

describe("FR-FLOW-137 AC-3 — the policy names research as a class that is never LLM-reviewed", () => {
  /** The repository's verification intensity policy, which the agent instructions carry. */
  function policySection(): string {
    const body = readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    const start = body.indexOf("## Verification intensity policy");
    expect(start, "the verification intensity policy is gone from CLAUDE.md").toBeGreaterThan(-1);
    const end = body.indexOf("\n# ", start + 1);
    return end < 0 ? body.slice(start) : body.slice(start, end);
  }

  it("lists research documents alongside the classes already relaxed", () => {
    const section = policySection();
    expect(section, "the policy does not mention research documents").toMatch(/docs\/research/);
    // The classes it already names. A policy that added research while dropping one of these would
    // have traded one relaxation for another rather than adding one.
    expect(section, "the prose class is gone").toMatch(/README/);
    expect(section, "the comment class is gone").toMatch(/Comments/);
  });

  it("says the review is not run at all, rather than capping its rounds", () => {
    // Research is the one class where the answer is zero rounds, not fewer: every claim that matters
    // is re-checked against code when it becomes a requirement, and that check is strictly stronger.
    const research = policySection()
      .split(/\r?\n/)
      .filter((line) => /docs\/research/.test(line))
      .join("\n");
    expect(research, "the research class states no review rule").not.toBe("");
    expect(research, "the research class does not say the review is never run").toMatch(/never|not run|no .*review/i);
  });
});

describe("FR-FLOW-137 AC-4 — the two documents that proved the rule are not exempt from it", () => {
  it.each(["18.mcp-per-call-worktree-root-research.md", "19.verification-token-economy-research.md"])(
    "%s carries the notice",
    async (name) => {
      const reports = await auditResearchNotices(RESEARCH_DIR);
      const report = reports.find((entry) => entry.file.endsWith(name));
      expect(report, `${name} is not in the research directory`).toBeDefined();
      // These two are the evidence for the rule — each shipped wrong claims that survived review and
      // fell to a code run. Exempting them would exempt the only proven cases.
      expect(isCompliantNotice(report?.classification ?? classifyNotice(""))).toBe(true);
    }
  );
});
