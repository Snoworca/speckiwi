// FR-NODE-121 — prose-gate's two mechanical detectors, asserted in both directions
// (05 §3.3 rules 1, 3, 4 and 6, §10.1).
//
// The gate is critical rather than a warning because the miss is silent: an under-counted design-item
// set shrinks every frozen denominator while the invariant digest reports no drift.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { countNormativeTokens, scanProse, HEDGE_TOKENS, NORMATIVE_TOKENS, PROSE_RULES, type ProseFinding } from "../../../src/core/orchestrator/prose-gate.js";
import { at } from "../../support/at.js";

const MODULE_SOURCE = "src/core/orchestrator/prose-gate.ts";

function unmarked(text: string): ProseFinding[] {
  return scanProse(text).findings.filter((finding) => finding.rule === "unmarked-normative-prose");
}

function hedges(text: string): ProseFinding[] {
  return scanProse(text).findings.filter((finding) => finding.rule === "hedge");
}

describe("FR-NODE-121 — the closed rule vocabulary", () => {
  it("draws every rule from the declared three-value enum", () => {
    expect([...PROSE_RULES]).toEqual(["script-block", "hedge", "unmarked-normative-prose"]);
  });
});

describe("FR-NODE-121 AC-1 — an unmarked normative paragraph names its exact source lines", () => {
  const document = [
    "# Design", // 1
    "", // 2
    "## 3. Lane scheduling", // 3
    "", // 4
    "### 3.1 Conflict edges", // 5
    "", // 6
    "- [D-031] The scheduler MUST treat two tasks whose file sets intersect as same-lane.", // 7
    "", // 8
    "The scheduler MUST refuse to parallelise a task whose file list is empty, and this", // 9
    "paragraph is not marked as an item." // 10
  ].join("\n");

  it("raises one finding on the unmarked paragraph", () => {
    const findings = unmarked(document);
    expect(findings).toHaveLength(1);
    expect(at(findings, 0).lines).toEqual([9, 10]);
  });
});

describe("FR-NODE-121 AC-2 — a fully marked document raises nothing", () => {
  it("raises no finding when every normative token sits inside an item row", () => {
    const document = [
      "## 3. Lane scheduling",
      "",
      "### 3.1 Conflict edges",
      "",
      "- [D-031] The scheduler MUST treat two tasks whose file sets intersect as same-lane.",
      "- [D-032] The scheduler SHALL refuse to parallelise a task whose file list is empty.",
      "- [I-004] The integrator MUST NOT rewrite a lane commit during integration.",
      "",
      "Rationale: file overlap is the actual merge-conflict predictor."
    ].join("\n");

    expect(unmarked(document)).toEqual([]);
  });
});

describe("FR-NODE-121 AC-3 — MUST NOT is one occurrence and not two", () => {
  it("counts a MUST NOT once", () => {
    expect(countNormativeTokens("The integrator MUST NOT rewrite a lane commit.")).toBe(1);
  });

  it("counts a bare MUST and a bare SHALL once each", () => {
    expect(countNormativeTokens("The scheduler MUST treat them as same-lane.")).toBe(1);
    expect(countNormativeTokens("The scheduler SHALL refuse the task.")).toBe(1);
  });

  it("counts two distinct tokens as two", () => {
    expect(countNormativeTokens("The scheduler MUST refuse it and SHALL record the reason.")).toBe(2);
  });

  it("counts none in a sentence carrying none", () => {
    expect(countNormativeTokens("File overlap is the actual merge-conflict predictor.")).toBe(0);
    expect([...NORMATIVE_TOKENS]).toEqual(["MUST NOT", "MUST", "SHALL"]);
  });
});

describe("FR-NODE-121 AC-4 — the lowest-level heading definition does not privilege third-level headings", () => {
  const document = [
    "# Design", // 1
    "", // 2
    "### Third with a deeper heading", // 3
    "", // 4
    "Prose that carries a MUST and is above a deeper heading.", // 5
    "", // 6
    "#### Fourth level", // 7
    "", // 8
    "Prose that carries a MUST under a fourth-level heading.", // 9
    "", // 10
    "### Third without a deeper heading", // 11
    "", // 12
    "Prose that carries a MUST under a third-level heading with nothing deeper." // 13
  ].join("\n");

  it("scans the fourth-level heading's content and skips the non-lowest third-level heading's", () => {
    const lines = unmarked(document).map((finding) => finding.lines);
    expect(lines).toEqual([[9], [13]]);
  });
});

describe("FR-NODE-121 AC-5 — blockquote and fenced-code content are excluded from both scans", () => {
  it("raises no finding for a normative token inside a blockquote", () => {
    const document = ["### Conflict edges", "", "> The scheduler MUST treat two tasks whose file sets intersect as same-lane."].join("\n");
    expect(unmarked(document)).toEqual([]);
  });

  it("raises no finding for a normative token inside a fenced code block", () => {
    const document = ["### Conflict edges", "", "```markdown", "The scheduler MUST treat two tasks as same-lane.", "```"].join("\n");
    expect(unmarked(document)).toEqual([]);
  });

  it("raises no hedge finding for a hedge token inside a fenced code block", () => {
    const token = HEDGE_TOKENS[0];
    const document = ["### Conflict edges", "", "```text", `The result is ${token} correct.`, "```"].join("\n");
    expect(hedges(document)).toEqual([]);
  });

  it("still raises the finding when the same paragraph sits outside both constructs", () => {
    const document = ["### Conflict edges", "", "The scheduler MUST treat two tasks whose file sets intersect as same-lane."].join("\n");
    expect(unmarked(document)).toHaveLength(1);
  });
});

describe("FR-NODE-121 AC-6 — the normative token set is English-only", () => {
  it("raises no finding for a Korean modal carrier", () => {
    const document = ["### Conflict edges", "", "스케줄러는 파일 집합이 겹치는 두 태스크를 반드시 같은 레인에 배치한다."].join("\n");
    expect(unmarked(document)).toEqual([]);
  });

  it("counts no normative token in the same sentence", () => {
    expect(countNormativeTokens("스케줄러는 반드시 같은 레인에 배치한다. 절대 금지한다.")).toBe(0);
  });
});

describe("FR-NODE-121 AC-7 — the hedge detector fires from the exported vocabulary and names the token", () => {
  it("declares a non-empty vocabulary", () => {
    expect(HEDGE_TOKENS.length).toBeGreaterThan(0);
  });

  it.each(HEDGE_TOKENS.map((token) => [token]))("fires on %s and names it in the finding", (token) => {
    const document = ["### Conflict edges", "", `The partition is ${token} the one the plan intended.`].join("\n");
    const findings = hedges(document);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.token)).toContain(token);
  });

  it("raises no hedge finding for a document containing none of them", () => {
    const document = ["### Conflict edges", "", "- [D-031] The scheduler MUST treat two tasks whose file sets intersect as same-lane."].join("\n");
    for (const token of HEDGE_TOKENS) expect(document.toLowerCase()).not.toContain(token.toLowerCase());
    expect(hedges(document)).toEqual([]);
  });
});

describe("FR-NODE-121 AC-8 — the hedge vocabulary ships in the module's own source", () => {
  it("declares the constant in prose-gate.ts rather than in a JSON asset", async () => {
    const source = await readFile(MODULE_SOURCE, "utf8");
    expect(source).toContain("export const HEDGE_TOKENS");
    for (const token of HEDGE_TOKENS) expect(source).toContain(token);
  });

  it("loads no asset at runtime, so the constant reaches a consumer install through plain tsc", async () => {
    const source = await readFile(MODULE_SOURCE, "utf8");
    expect(source).not.toContain(".json");
    expect(source).not.toContain("readFile");
    expect(source).not.toContain("require(");
  });
});

describe("FR-NODE-121 AC-9 — scanProse takes one argument and has one mode", () => {
  it("declares exactly one parameter", () => {
    expect(scanProse.length).toBe(1);
  });

  it("returns the same findings for the same text on two calls", () => {
    const document = ["### Conflict edges", "", "The scheduler MUST treat two tasks whose file sets intersect as same-lane."].join("\n");
    expect(JSON.stringify(scanProse(document))).toBe(JSON.stringify(scanProse(document)));
  });
});
