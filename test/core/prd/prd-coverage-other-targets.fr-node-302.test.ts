import { execFileSync } from "node:child_process";
import { readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parsePrd, prdCoverage } from "../../../src/core/prd/index.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { registerTarget } from "../../../src/core/mutation/set-active-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { cliJson, mcp, PRD_PATH, prdWorkspace } from "../../cli/prd-surface-fixture.js";
import { buildPrd, DEFAULT_ITEMS } from "./prd-fixture.js";

// @req FR-NODE-302 — prd coverage decides which uncited items another target covers, counting only
// citations that name this PRD's path.
//
// SSO-run-close-4908 (2026-11-11): wave-decomposition §5 ran coverage of this PRD against every other
// target, and a bare `PRD-2` there — that target's own PRD item 2 — erased this PRD's PRD-2 from the gap.

const PATH = "docs/prd/2026-11-04.reset.prd.md";
const OTHER = "docs/prd/2026-11-05.billing.prd.md";
const doc = parsePrd(buildPrd({ items: DEFAULT_ITEMS }), PATH);

function record(id: string, target: string, rationale: string, status = "planned"): RequirementRecord {
  return {
    id, title: id, type: "functional", target, status, scope: "AUTH", filePath: "docs/spec/10.auth.srs.md", headingLine: 1, metadata: {},
    requirement: "statement", rationale, acceptanceCriteria: [{ id: "AC-1", text: "x", checked: false }],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as unknown as RequirementRecord;
}

interface Report {
  uncitedItems: Array<{ id: string }>;
  missingItems: Array<{ id: string; bareCitations: Array<{ requirementId: string; target: string }> }>;
  assignedToOtherTargets: Array<{ id: string; requirements: Array<{ requirementId: string; target: string }> }>;
}

// DEFAULT_ITEMS: PRD-1 intent, PRD-2 in-scope, PRD-3 exclusion, PRD-4 proposal (proposed). This target cites neither.
const OWN = record("FR-AUTH-001", "run-target", "nothing cited");

describe("FR-NODE-302 AC-1 — a path-qualified citation in another target assigns the item there", () => {
  it("assigns PRD-2 to the target that cites this PRD's path", () => {
    const report = prdCoverage(doc, [OWN, record("FR-AUTH-002", "t-c", `AC-1 ← ${PATH}#PRD-2`)], { target: "run-target" }) as unknown as Report;
    expect(report.uncitedItems.map((item) => item.id)).toEqual(["PRD-1", "PRD-2"]);
    expect(report.assignedToOtherTargets).toEqual([{ id: "PRD-2", requirements: [{ requirementId: "FR-AUTH-002", target: "t-c" }] }]);
    expect(report.missingItems.map((item) => item.id)).toEqual(["PRD-1"]);
  });
});

describe("FR-NODE-302 AC-2 — a bare number or another PRD's path in another target covers nothing here", () => {
  it("keeps PRD-2 missing against a bare citation and names it", () => {
    const report = prdCoverage(doc, [OWN, record("FR-AUTH-003", "t-b", "AC-1 ← PRD-2")], { target: "run-target" }) as unknown as Report;
    expect(report.assignedToOtherTargets).toEqual([]);
    expect(report.missingItems).toEqual([
      { id: "PRD-1", kind: "intent", title: expect.any(String), bareCitations: [] },
      { id: "PRD-2", kind: "in-scope", title: expect.any(String), bareCitations: [{ requirementId: "FR-AUTH-003", target: "t-b" }] }
    ]);
  });

  it("keeps PRD-2 missing against another PRD's path", () => {
    const report = prdCoverage(doc, [OWN, record("FR-AUTH-004", "t-d", `AC-1 ← ${OTHER}#PRD-2`)], { target: "run-target" }) as unknown as Report;
    expect(report.assignedToOtherTargets).toEqual([]);
    expect(report.missingItems.find((item) => item.id === "PRD-2")?.bareCitations).toEqual([]);
  });
});

describe("FR-NODE-302 AC-3 — the existing fields and discarded requirements", () => {
  it("leaves uncitedItems, uncitedRequirements and ungroundedCriteria unchanged by other targets", () => {
    const alone = prdCoverage(doc, [OWN], { target: "run-target" });
    const withOthers = prdCoverage(doc, [OWN, record("FR-AUTH-002", "t-c", `AC-1 ← ${PATH}#PRD-2`)], { target: "run-target" });
    expect(withOthers.uncitedItems).toEqual(alone.uncitedItems);
    expect(withOthers.uncitedRequirements).toEqual(alone.uncitedRequirements);
    expect(withOthers.ungroundedCriteria).toEqual(alone.ungroundedCriteria);
  });

  it("does not assign an item to a discarded requirement of another target", () => {
    const report = prdCoverage(doc, [OWN, record("FR-AUTH-005", "t-c", `AC-1 ← ${PATH}#PRD-2`, "discarded")], { target: "run-target" }) as unknown as Report;
    expect(report.assignedToOtherTargets).toEqual([]);
    expect(report.missingItems.map((item) => item.id)).toEqual(["PRD-1", "PRD-2"]);
  });

  const created: string[] = [];
  afterAll(async () => {
    for (const directory of created) await rm(directory, { recursive: true, force: true });
  });

  it("answers the same through the CLI and MCP", async () => {
    const root = await prdWorkspace();
    created.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root }).toString().trim();
    expect(path.resolve(top).toLowerCase()).toBe(path.resolve(await realpath(root)).toLowerCase());
    const projectRoot = await resolveProjectRoot(root);
    expect((await registerTarget(projectRoot, { target: "t-c" })).ok).toBe(true);
    const added = await addRequirement(projectRoot, {
      type: "functional", scope: "ARCH", target: "t-c", title: "Covers the reset PRD's item 2 from another target",
      statement: "The system SHALL expire the reset link.", acceptanceCriteria: ["It expires."], rationale: `AC-1 ← ${PRD_PATH}#PRD-2`
    });
    expect(added.ok, JSON.stringify(added).slice(0, 300)).toBe(true);
    const { code, json } = await cliJson<Report>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(code).toBe(0);
    expect(json.assignedToOtherTargets.map((item) => item.id)).toEqual(["PRD-2"]);
    expect(json.missingItems.map((item) => item.id)).toEqual(["PRD-1"]);
    expect((await mcp<Report>(root, "check_prd_coverage", { path: PRD_PATH, target: "v1.0.0" })).value).toEqual(json);
  });
});

describe("FR-NODE-302 AC-4 — the skills read the result instead of looping over targets", () => {
  const trees = ["claude", "codex", "etc"];
  it.each(trees.map((tree) => `skills/${tree}/_shared/kiwi/wave-decomposition.md`).concat([".agents/skills/_shared/kiwi/wave-decomposition.md"]))(
    "%s reads missingItems and assignedToOtherTargets from one coverage call",
    async (relative) => {
      const text = await readFile(path.join(process.cwd(), relative), "utf8");
      const section = text.slice(text.indexOf("## 5."), text.indexOf("## 6."));
      expect(section).toContain("`missingItems`");
      expect(section).toContain("`assignedToOtherTargets`");
      expect(section).toContain("빠진 항목의 `bareCitations` 에 나오며, 그 요구가 이 PRD 의 항목을 뜻하면 경로를 붙여 인용하라고 보고한다");
      expect(section).not.toMatch(/target `t` 마다|for each other target `t`/);
    }
  );

  it.each(["skills/claude/kiwi-srs/SKILL.md", "skills/codex/kiwi-srs/references/extended-workflow.md", "skills/etc/kiwi-srs/references/extended-workflow.md", ".agents/skills/kiwi-srs/references/extended-workflow.md"])("%s says to cite another PRD's item with its path", async (relative) => {
    const text = (await readFile(path.join(process.cwd(), relative), "utf8")).replace(/\r\n/g, "\n");
    expect(text, relative).toContain(
      "그 target 을 저작한 PRD 가 아닌 다른 PRD 의 항목을 덮는 요구는 경로를 붙여 `docs/prd/<file>.prd.md#PRD-<n>` 으로 인용한다 — 번호만 쓴 인용은 그 target 의 PRD 항목으로 읽혀, 다른 PRD 의 `prd coverage` 가 그 항목을 이 target 에 배정된 것으로 세지 않는다."
    );
  });
});

