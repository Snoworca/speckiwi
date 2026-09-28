import { describe, expect, it } from "vitest";
import { GROUNDING_VERDICTS, groundFiles, isGroundingRefusal } from "../../../src/core/orchestrator/grounding.js";

// IR-CLI-084 — the pure near-miss detector `orchestrate schedule waves` runs over every SDS Files path
// and test file before it calls the lane planner. The command collects the existing paths; this module
// judges only what it is handed.

const existingPaths = [
  "src/core/orchestrator/lane-plan.ts",
  "src/core/orchestrator/conflict.ts",
  "src/core/sds/lite-sds.ts",
  "test/core/sds/lite-sds.fr-node-209.test.ts"
];

describe("IR-CLI-084 SDS path grounding as a near-miss detector", () => {
  it("IR-CLI-084 AC-1 refuses a non-existent path within Levenshtein distance 2 of an existing path, naming the neighbour", () => {
    expect(groundFiles(["src/core/orchestrator/lane-plans.ts"], existingPaths, false)).toEqual([
      { path: "src/core/orchestrator/lane-plans.ts", verdict: "near-miss", nearest: "src/core/orchestrator/lane-plan.ts" }
    ]);
    expect(isGroundingRefusal("near-miss")).toBe(true);
  });

  it("IR-CLI-084 AC-1 refuses a two-edit typo and accepts a three-edit one, so the threshold is exactly 2", () => {
    expect(groundFiles(["src/core/sds/lite-sdss.tx"], existingPaths, false)[0]).toMatchObject({ verdict: "near-miss" });
    expect(groundFiles(["src/core/sds/lite-sdsxyz.ts"], existingPaths, false)[0]).toEqual({ path: "src/core/sds/lite-sdsxyz.ts", verdict: "new-file" });
  });

  it("IR-CLI-084 AC-2 accepts a non-existent path with no repository path inside distance 2 as a new file", () => {
    expect(groundFiles(["src/core/orchestrator/wave-dispatch.ts"], existingPaths, false)).toEqual([
      { path: "src/core/orchestrator/wave-dispatch.ts", verdict: "new-file" }
    ]);
    expect(isGroundingRefusal("new-file")).toBe(false);
  });

  it("IR-CLI-084 AC-4 grounds a test file on the same rule as a Files path", () => {
    const verdicts = groundFiles(["test/core/sds/lite-sds.fr-node-209.test.ts", "test/core/sds/lite-sds.fr-node-208.test.ts"], existingPaths, false);
    expect(verdicts.map((entry) => entry.verdict)).toEqual(["grounded", "near-miss"]);
  });

  it("IR-CLI-084 AC-5 judges only against the injected paths, so a real repository file absent from them is a new file", () => {
    expect(groundFiles(["package.json"], [], false)).toEqual([{ path: "package.json", verdict: "new-file" }]);
  });

  it("IR-CLI-084 AC-5 normalises separators and a leading ./ on both sides before judging", () => {
    expect(groundFiles([".\\src\\core\\orchestrator\\conflict.ts"], ["./src/core/orchestrator/conflict.ts"], false)).toEqual([
      { path: "src/core/orchestrator/conflict.ts", verdict: "grounded" }
    ]);
  });

  it("IR-CLI-084 AC-6 refuses a non-existent path with no near neighbour under strict grounding, and accepts it without", () => {
    expect(groundFiles(["src/core/orchestrator/wave-dispatch.ts"], existingPaths, true)).toEqual([
      { path: "src/core/orchestrator/wave-dispatch.ts", verdict: "absent" }
    ]);
    expect(isGroundingRefusal("absent")).toBe(true);
    expect(groundFiles(["src/core/orchestrator/lane-plans.ts"], existingPaths, true)[0]).toMatchObject({ verdict: "near-miss" });
  });

  it("IR-CLI-084 AC-3 declares a closed verdict vocabulary without the retired line-range verdict", () => {
    expect([...GROUNDING_VERDICTS]).toEqual(["grounded", "new-file", "near-miss", "absent"]);
    const verdicts = groundFiles(["src/core/orchestrator/conflict.ts", "src/core/orchestrator/lane-plans.ts", "docs/new.md"], existingPaths, false);
    expect(verdicts.map((entry) => entry.verdict)).toEqual(["grounded", "near-miss", "new-file"]);
  });
});
