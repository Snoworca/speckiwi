import { describe, expect, it } from "vitest";

import { section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-196 — kiwi-tdd runs the tdd cycle on acceptance lines recorded in the step's intent.md
// and checked by `speckiwi step validate`; the step SDS design.md is authored only under --sds.
// Supersedes FR-FLOW-173, whose skip-record suite (sds-skip-record.fr-flow-173) is removed: AC-5
// forbids the record it asserted.
//
// Each of the four renderings is read on its own bytes (claude Korean, codex/etc and the mirror
// English), so prose checks carry both spellings.

const SKILL = "kiwi-tdd";

function body(rendering: string): string {
  return stripFrontmatter(readRepoFile(`${rendering}/${SKILL}/SKILL.md`).replace(/\r\n/g, "\n"));
}

function part(rendering: string, heading: RegExp): string {
  return section(body(rendering), heading);
}

function rule(rendering: string, id: string): string {
  return (
    tableRows(part(rendering, /^##\s*0\.\s/))
      .find((row) => row.cells[0] === id)
      ?.cells.join(" | ") ?? ""
  );
}

/** §2.3 up to its first `####` subsection — the default Phase 2. */
function defaultPhase2(rendering: string): string {
  return part(rendering, /^###\s*2\.3\s/).split(/^####\s/m)[0] ?? "";
}

describe("FR-FLOW-196 AC-1 — by default Phase 2 records acceptance lines in intent.md and checks them with step validate", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(RENDERINGS)("%s: the default Phase 2 writes ## Acceptance with EARS AC-<n> lines", (rendering) => {
    const phase = flat(defaultPhase2(rendering));
    expect(phase, `${rendering}: §2.3 is missing`).not.toBe(" ");
    expect(phase).toContain("docs/spec/steps/<task>/intent.md");
    expect(phase).toContain("`## Acceptance`");
    expect(phase).toMatch(/`AC-<n>: WHEN … THE SYSTEM SHALL …`/);
  });

  it.each(RENDERINGS)("%s: step validate runs before Phase 3 and gates on STEP_ACCEPTANCE_MISSING", (rendering) => {
    const phase = flat(defaultPhase2(rendering));
    const validate = phase.indexOf("speckiwi step validate <task>");
    const missing = phase.indexOf("STEP_ACCEPTANCE_MISSING");
    const phase3 = phase.indexOf("Phase 3");
    expect(validate, `${rendering}: the default Phase 2 does not run step validate`).toBeGreaterThan(-1);
    expect(missing, `${rendering}: the default Phase 2 does not name STEP_ACCEPTANCE_MISSING`).toBeGreaterThan(-1);
    expect(validate, `${rendering}: the check does not precede the move to Phase 3`).toBeLessThan(phase3);
  });

  it.each(RENDERINGS)("%s: the default Phase 2 creates no design.md and no skip record", (rendering) => {
    const phase = flat(defaultPhase2(rendering));
    expect(phase).toMatch(/design\.md 를 만들지 않는다|does not create `?design\.md`?/);
    expect(phase).toContain("speckiwi step scaffold <task>");
    expect(phase.includes("step scaffold <task> --sds"), `${rendering}: the default path scaffolds design.md`).toBe(false);
  });
});

describe("FR-FLOW-196 AC-2 — Phase 3 turns each AC line into a failing test citing <task> AC-<n>, red and committed first", () => {
  it.each(RENDERINGS)("%s", (rendering) => {
    const red = flat(part(rendering, /^###\s*2\.4\s/));
    expect(red).toContain("`<task> AC-<n>`");
    expect(red).toMatch(/red/);
    const commit = red.search(/커밋|commit/);
    const impl = red.search(/구현 착수 금지|start implementation before red/i);
    expect(commit, `${rendering}: Phase 3 does not commit the tests`).toBeGreaterThan(-1);
    expect(impl, `${rendering}: Phase 3 does not bar implementation before red`).toBeGreaterThan(-1);
  });
});

describe("FR-FLOW-196 AC-3 — Phase 6 copies the acceptance lines into the block and checks sufficiency without --sds", () => {
  it.each(RENDERINGS)("%s", (rendering) => {
    const promote = flat(part(rendering, /^###\s*2\.7\s/));
    expect(promote).toMatch(/`## Acceptance` (줄을 같은 순서와 번호로|lines in the same order and numbering)/);
    expect(promote).toContain("`<REQ-ID> AC-<n>`");
    expect(promote).toMatch(/--ids <[^>]+>` (와|with) `--sds` (없이|omitted)|--ids <[^>]+>`[^.]{0,40}(no|without) `--sds`/);
    const sufficiency = promote.indexOf("test-sufficiency.md");
    const call = promote.indexOf("promote_step_requirement");
    expect(sufficiency, `${rendering}: Phase 6 does not run the check`).toBeGreaterThan(-1);
    expect(sufficiency, `${rendering}: the check does not precede promotion`).toBeLessThan(call);
  });
});

describe("FR-FLOW-196 AC-4 — under --sds the 4.0.0 cycle applies", () => {
  it.each(RENDERINGS)("%s: §2.3.1 is the --sds branch with the SDS checklist", (rendering) => {
    const branch = part(rendering, /^####\s*2\.3\.1\s/);
    expect(branch, `${rendering}: kiwi-tdd has no §2.3.1`).not.toBe("");
    expect(branch.split("\n")[0]).toMatch(/--sds/);
    const text = flat(branch);
    expect(text).toContain("speckiwi step scaffold <task> --sds");
    expect(text).toMatch(/SDS-AC-n: WHEN … THE SYSTEM SHALL …/);
    expect(text).toMatch(/Test Plan/);
    expect(text).toMatch(/200/);
    expect(text).toMatch(/SDS-W051/);
    expect(text).toContain("`SDS-AC-<n>`");
    expect(text).toContain("--sds docs/spec/steps/<task>/design.md");
  });
});

describe("FR-FLOW-196 AC-5 — §0.4 and §0.5 state the acceptance contract, and no rendering names the skip record", () => {
  it.each(RENDERINGS)("%s: §0.4", (rendering) => {
    const row = rule(rendering, "§0.4");
    expect(row).toMatch(/acceptance 계약이 생기기 전에는 테스트를 쓰지 않는다|[Nn]o test is written before the step's acceptance contract exists/);
    for (const part of ["intent.md `## Acceptance`", "`step validate`", "design.md", "`--sds`"]) expect(row, `${rendering}: §0.4 lost ${part}`).toContain(part);
  });

  it.each(RENDERINGS)("%s: §0.5 sends a contract change back to a revised acceptance line and red", (rendering) => {
    const row = rule(rendering, "§0.5");
    expect(row).toMatch(/고친 acceptance 줄|revised acceptance line/);
    expect(row).toContain("`--sds`");
    expect(row).toMatch(/red/);
  });

  it.each(RENDERINGS)("%s: no SDS-E054 and no ## SDS Skip anywhere in the skill", (rendering) => {
    const text = readRepoFile(`${rendering}/${SKILL}/SKILL.md`);
    expect(text).not.toContain("SDS-E054");
    expect(text).not.toContain("SDS Skip");
  });
});

describe("FR-FLOW-196 AC-6 — Phase 5 describes vibe-gate as checking the synthesized step and its acceptance contract", () => {
  it.each(RENDERINGS)("%s", (rendering) => {
    const regression = flat(part(rendering, /^###\s*2\.6\s/));
    expect(regression).toContain("speckiwi vibe-gate check");
    expect(regression).toMatch(/합성된 step 디렉터리와 step 의 acceptance 계약|the synthesized step directory and the step's acceptance contract/);
  });
});
