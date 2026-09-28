import { describe, expect, it } from "vitest";

import { criticalGateRows, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-186 AC-4 — kiwi-pipeline's part: the cycle ends with a code-review hop followed by
// the test-sufficiency check, and the final report states the check's result.
//
// The procedure lives once in `_shared/kiwi/test-sufficiency.md` (FR-FLOW-186 AC-1), so the pipeline
// is held to CITING it by path and to not restating its fill step. kiwi-wave-master and every
// kiwi-orchestrator rung are held by their own suites.

function body(rendering: string): string {
  return stripFrontmatter(readRepoFile(`${rendering}/kiwi-pipeline/SKILL.md`).replace(/\r\n/g, "\n"));
}

const CONTRACT = "_shared/kiwi/test-sufficiency.md";

describe("FR-FLOW-186 AC-4 — kiwi-pipeline ends with a code-review hop followed by the test-sufficiency check", () => {
  // A split SDS cannot ride the review hop's single `--sds`, so its SDS-AC citations are checked per
  // file BEFORE the promoting hop — otherwise `verified` is written before an SDS-AC gap is seen.
  it.each(RENDERINGS)("%s: a split SDS is checked per file before the promoting hop", (rendering) => {
    const items = section(body(rendering), /^###\s*2\.5\.4\s/)
      .split("\n")
      .filter((line) => /^\d+\.\s/.test(line));
    const hopAt = items.findIndex((item) => item.includes("kiwi-review-fix-loop --close-reqs"));
    expect(hopAt, `${rendering}: §2.5.4 has no promoting review hop`).toBeGreaterThan(0);
    expect(
      items.slice(0, hopAt).some((item) => /여럿|more than one/.test(item) && item.includes(CONTRACT) && /`test-sufficiency-gap`/.test(item) && /\d번으로 가지 않는다/.test(item)),
      `${rendering}: no step before the promoting hop checks a split SDS`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: the end-of-cycle subsection orders the review hop before the check", (rendering) => {
    const end = flat(section(body(rendering), /^###\s*2\.5\.4\s/));
    expect(end, `${rendering}: kiwi-pipeline has no §2.5.4 end-of-cycle subsection`).not.toBe("");
    // Read by numbered step: a split SDS also cites the contract in a step BEFORE the hop, so the first
    // citation is not the one that follows it.
    const items = section(body(rendering), /^###\s*2\.5\.4\s/)
      .split("\n")
      .filter((line) => /^\d+\.\s/.test(line));
    const review = items.findIndex((item) => item.includes("kiwi-review-fix-loop --close-reqs"));
    expect(review, `${rendering}: §2.5.4 does not name the review hop`).toBeGreaterThanOrEqual(0);
    expect(
      items.slice(review + 1).some((item) => item.includes(CONTRACT)),
      `${rendering}: no §2.5.4 step after the review hop cites ${CONTRACT} by path`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: the check's scope is the cycle's requirements and its SDS", (rendering) => {
    const end = flat(section(body(rendering), /^###\s*2\.5\.4\s/));
    expect(/요구 범위|requirement scope/i.test(end) && /--sds/.test(end), `${rendering}: the check's scope is not stated`).toBe(true);
  });

  it.each(RENDERINGS)("%s: the procedure is cited, not restated", (rendering) => {
    // The fill step is the contract's (§3 step 3). A pipeline that spells out its own fill writes a
    // second copy that drifts from the one every other caller reads.
    expect(body(rendering)).not.toMatch(/테스트 작성 서브에이전트 하나|one test-writing subagent/);
  });

  it.each(RENDERINGS)("%s: test-sufficiency-gap is declared critical", (rendering) => {
    const gate = criticalGateRows(body(rendering)).find((row) => row.gateId === "test-sufficiency-gap");
    expect(gate, `${rendering}: §0.AG does not declare test-sufficiency-gap`).toBeDefined();
    expect(gate?.reason ?? "").toContain(CONTRACT);
  });

  it.each(RENDERINGS)("%s: the final report states the check's result", (rendering) => {
    const report = section(body(rendering), /^###\s*9\.6\s/);
    expect(report, `${rendering}: kiwi-pipeline has no §9.6 cycle report`).not.toBe("");
    const line = report.split("\n").find((entry) => /테스트 충분성|test sufficiency/i.test(entry)) ?? "";
    expect(line, `${rendering}: the cycle report has no test-sufficiency line`).not.toBe("");
    expect(line, `${rendering}: the report line does not carry the contract's verdict values`).toMatch(/pass\s*\|\s*gap\s*\|\s*no-scope/);
  });
});
