import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { initProject } from "../../src/core/bootstrap/init-project.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";

describe("full workflow", () => {
  it("initializes a repo and adds a requirement", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "speckiwi-full-"));
    const root = await resolveProjectRoot(rootPath, rootPath);
    expect((await initProject(root, {})).ok).toBe(true);
    const added = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "초기 요구사항",
      statement: "초기화된 문서에 요구사항을 추가한다.",
      acceptanceCriteria: ["added"]
    });
    expect(added.ok).toBe(true);
  });
});
