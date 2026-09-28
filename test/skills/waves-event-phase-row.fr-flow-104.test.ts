import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, tableRows } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-104  AC-6 — the `phase` row of every shipped waves-event.md: `sds` and `worker` joined in
//                   4.0.0, and `handoff` and `pipeline` stay only so a line below 2.0.0 still reads
//
// The kernel constant is checked elsewhere; this reads the document the requirement governs, in all
// four copies, and holds each clause to the `phase` row itself.

const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/_shared/kiwi/waves-event.md`);

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** The `phase` row's [type, values-and-description] cells. */
function phaseRow(copy: string): string[] {
  return tableRows(read(copy)).find((row) => (row.cells[0] ?? "").trim() === "`phase`")?.cells.slice(1) ?? [];
}

/** The value run the row opens with — backticked tokens joined by ` / `. */
function values(cell: string): string[] {
  const run = /^((?:`[^`]+`(?: \/ )?)+)/.exec(cell.trim())?.[1] ?? "";
  return [...run.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

describe.each(COPIES)("FR-FLOW-104 AC-6 — the phase row of %s", (copy) => {
  it("FR-FLOW-104 AC-6: the enum lists sds and worker as 2.0.0 members and keeps handoff and pipeline", () => {
    const [type, cell] = phaseRow(copy);
    expect(type, `${copy}: the phase row`).toBe("string (enum)");
    const enumValues = values(cell ?? "");
    for (const member of ["sds", "worker", "handoff", "pipeline", "intake", "design", "wave-design", "schedule", "lane", "integrate", "stage-close"]) {
      expect(enumValues, `${copy}: phase value ${member}`).toContain(member);
    }
    expect(cell).toMatch(/`sds`\(SDS 작성\)와 `worker`\(워커 dispatch\)는 2\.0\.0 신설이고/);
  });

  it("FR-FLOW-104 AC-6: handoff and pipeline stay only for lines below 2.0.0, and a 2.0.0 line carrying either is refused", () => {
    const [, cell] = phaseRow(copy);
    expect(cell, `${copy}: why the two retired values stay`).toMatch(/`pipeline` 과 `handoff` 는 2\.0\.0 미만 줄을 읽기 위해서만 남고/);
    expect(cell, `${copy}: what a 2.0.0 line carrying either raises`).toMatch(/2\.0\.0 이상 줄이 실으면 `vocabulary-retired-in-4-0-0` 이다/);
    expect(cell, `${copy}: who refuses it`).toMatch(/`journal append` 는 최신 줄에서 거절하고 `orchestrate resume` 은 심각도와 무관하게 거절한다/);
  });
});
