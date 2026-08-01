import { describe, expect, it } from "vitest";
import { GROUNDING_VERDICTS, groundFiles, isGroundingRefusal } from "../../../src/core/orchestrator/grounding.js";

const existingPaths = [
  "src/core/orchestrator/task-catalog.ts",
  "src/core/orchestrator/conflict.ts",
  "src/core/workflow/validate.ts",
  "test/core/workflow/validator.test.ts"
];

const lineCounts: Record<string, number> = {
  "src/core/orchestrator/task-catalog.ts": 120,
  "src/core/orchestrator/conflict.ts": 260,
  "src/core/workflow/validate.ts": 402,
  "test/core/workflow/validator.test.ts": 610
};

describe("IR-CLI-084 sidecar path grounding as a near-miss detector", () => {
  // AC-1 — a probable typo for a real file is refused, and the near neighbour is named.
  it("refuses a non-existent path that is within Levenshtein distance 2 of an existing path", () => {
    const verdicts = groundFiles(
      [{ path: "src/core/orchestrator/task-catalogue.ts" }],
      existingPaths,
      lineCounts,
      false
    );

    expect(verdicts).toEqual([
      {
        path: "src/core/orchestrator/task-catalogue.ts",
        verdict: "near-miss",
        nearest: "src/core/orchestrator/task-catalog.ts"
      }
    ]);
    expect(isGroundingRefusal("near-miss")).toBe(true);
  });

  it("refuses a single-character typo, which is inside distance 2", () => {
    const verdicts = groundFiles([{ path: "src/core/orchestrator/conflicts.ts" }], existingPaths, lineCounts, false);

    expect(verdicts[0]).toMatchObject({ verdict: "near-miss", nearest: "src/core/orchestrator/conflict.ts" });
  });

  // AC-2 — a genuine new file is accepted, because the sidecar schema has no to-be-created marker.
  it("accepts a non-existent path with no repository path inside distance 2", () => {
    const verdicts = groundFiles([{ path: "src/core/orchestrator/lane-plan.ts" }], existingPaths, lineCounts, false);

    expect(verdicts).toEqual([{ path: "src/core/orchestrator/lane-plan.ts", verdict: "new-file" }]);
    expect(isGroundingRefusal("new-file")).toBe(false);
  });

  it("accepts a distance-3 neighbour, so the threshold is 2 rather than merely 'similar'", () => {
    // "task-catalog.ts" -> "task-catalogues.ts" is three edits: insert u, e, s.
    const verdicts = groundFiles([{ path: "src/core/orchestrator/task-catalogues.ts" }], existingPaths, lineCounts, false);

    expect(verdicts[0]).toEqual({ path: "src/core/orchestrator/task-catalogues.ts", verdict: "new-file" });
  });

  it("normalises separators and a leading ./ before judging, so a Windows-spelled entry grounds", () => {
    const verdicts = groundFiles(
      [{ path: ".\\src\\core\\orchestrator\\conflict.ts" }],
      existingPaths,
      lineCounts,
      false
    );

    expect(verdicts[0]).toEqual({ path: "src/core/orchestrator/conflict.ts", verdict: "grounded" });
  });

  // AC-3 — half (b): an existing file whose declared line range runs past its end.
  it("refuses an existing entry whose declared line range is beyond the file's line count", () => {
    const verdicts = groundFiles(
      [{ path: "src/core/orchestrator/task-catalog.ts", lineRange: "100-500" }],
      existingPaths,
      lineCounts,
      false
    );

    expect(verdicts).toEqual([
      { path: "src/core/orchestrator/task-catalog.ts", verdict: "line-range-out-of-range" }
    ]);
    expect(isGroundingRefusal("line-range-out-of-range")).toBe(true);
  });

  it("accepts the same entry once its line range is in range", () => {
    const verdicts = groundFiles(
      [{ path: "src/core/orchestrator/task-catalog.ts", lineRange: "100-118" }],
      existingPaths,
      lineCounts,
      false
    );

    expect(verdicts).toEqual([{ path: "src/core/orchestrator/task-catalog.ts", verdict: "grounded" }]);
  });

  it("accepts a single-line range at the file's last line and refuses one past it", () => {
    const atEnd = groundFiles(
      [{ path: "src/core/orchestrator/task-catalog.ts", lineRange: "120" }],
      existingPaths,
      lineCounts,
      false
    );
    const pastEnd = groundFiles(
      [{ path: "src/core/orchestrator/task-catalog.ts", lineRange: "121" }],
      existingPaths,
      lineCounts,
      false
    );

    expect(atEnd[0]?.verdict).toBe("grounded");
    expect(pastEnd[0]?.verdict).toBe("line-range-out-of-range");
  });

  // AC-6 — --strict-grounding tightens clause (a) to plain existence.
  it("refuses a non-existent path with no near neighbour under strict grounding, and accepts it without", () => {
    const entries = [{ path: "src/core/orchestrator/lane-plan.ts" }];

    expect(groundFiles(entries, existingPaths, lineCounts, true)).toEqual([
      { path: "src/core/orchestrator/lane-plan.ts", verdict: "absent" }
    ]);
    expect(groundFiles(entries, existingPaths, lineCounts, false)).toEqual([
      { path: "src/core/orchestrator/lane-plan.ts", verdict: "new-file" }
    ]);
    expect(isGroundingRefusal("absent")).toBe(true);
  });

  it("still names the near neighbour under strict grounding when one exists", () => {
    const verdicts = groundFiles(
      [{ path: "src/core/orchestrator/task-catalogue.ts" }],
      existingPaths,
      lineCounts,
      true
    );

    expect(verdicts[0]).toMatchObject({ verdict: "near-miss", nearest: "src/core/orchestrator/task-catalog.ts" });
  });

  it("declares a closed verdict vocabulary and returns one verdict per declared entry, in order", () => {
    expect([...GROUNDING_VERDICTS]).toEqual([
      "grounded",
      "new-file",
      "near-miss",
      "absent",
      "line-range-out-of-range"
    ]);

    const verdicts = groundFiles(
      [
        { path: "src/core/workflow/validate.ts" },
        { path: "src/core/orchestrator/task-catalogue.ts" },
        { path: "src/core/orchestrator/lane-plan.ts" }
      ],
      existingPaths,
      lineCounts,
      false
    );

    expect(verdicts.map((entry) => entry.verdict)).toEqual(["grounded", "near-miss", "new-file"]);
    for (const entry of verdicts) expect(GROUNDING_VERDICTS).toContain(entry.verdict);
  });

  // The impure half stays in the CLI: the detector reads nothing it was not handed.
  it("judges only against the injected arrays, so a real repository path absent from them is a new file", () => {
    const verdicts = groundFiles([{ path: "package.json" }], [], {}, false);

    expect(verdicts).toEqual([{ path: "package.json", verdict: "new-file" }]);
  });

  it("treats an existing path with no recorded line count as grounded rather than out of range", () => {
    const verdicts = groundFiles(
      [{ path: "src/core/orchestrator/conflict.ts", lineRange: "1-9999" }],
      existingPaths,
      {},
      false
    );

    expect(verdicts).toEqual([{ path: "src/core/orchestrator/conflict.ts", verdict: "grounded" }]);
  });
});
