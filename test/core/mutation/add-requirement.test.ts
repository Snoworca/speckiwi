import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("add requirement mutation", () => {
  it("adds a complete requirement block with generated ID and optional fields", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const result = await addRequirement(await resolveProjectRoot(rootPath), {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "새 요구사항",
      statement: "새 요구사항을 Markdown block으로 추가해야 한다.",
      acceptanceCriteria: ["block is appended", "id is generated"],
      checkedAcceptanceCriteria: ["AC-1"],
      priority: "high",
      tags: ["new", "cli"],
      risk: "medium",
      stability: "stable",
      verificationMethod: "test",
      githubIssue: "https://github.com/Snoworca/speckiwi/issues/1",
      relatedDocs: ["[Rules](../rule/SRS-MD-Rules-v1.0.0.md)"],
      rationale: "요구사항을 안전하게 확장하기 위해 필요하다.",
      implementationNotes: "CLI와 MCP가 같은 core service를 사용한다.",
      research: "docs/research/00.implementation-research-synthesis.md",
      changeNotes: "2026-05-08 | 최초 추가 | 테스트",
      evidence: [{ type: "test", reference: "test/core/mutation/add-requirement.test.ts", covers: "AC-1" }],
      trace: [{ type: "Requirement", reference: "FR-ARCH-001", relation: "related_to", notes: "baseline" }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requirementId).toBe("FR-ARCH-002");
    expect(result.value.record.id).toBe("FR-ARCH-002");
    expect(result.value.record.metadata.Priority).toBe("high");
    expect(result.value.record.priority).toBe("high");
    expect(result.patch?.operations).toBeGreaterThan(0);
    const text = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(text).toContain("### FR-ARCH-002 — 새 요구사항");
    expect(text).toContain("#### Verification Evidence");
    expect(text).toContain("| Tags | new, cli |");
  });

  it("supports the repository SRS index Primary Document column in dry-run mode", async () => {
    const root = await resolveProjectRoot(process.cwd());
    const result = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Repository dry run",
      statement: "Repository SRS dry-run add must resolve Primary Document.",
      acceptanceCriteria: ["previewed"],
      dryRun: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.filePath).toBe("docs/spec/10.product-architecture.srs.md");
    expect(result.value.written).toBe(false);
  });

  it("supports dry-run without writing and denies Scope Map path escape", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const dryRun = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "드라이런",
      statement: "파일을 쓰지 않는다.",
      acceptanceCriteria: ["previewed"],
      dryRun: true
    });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.patch?.dryRun).toBe(true);
    expect(await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).not.toContain("드라이런");

    await writeFile(
      path.join(rootPath, "docs", "spec", "00.index.md"),
      (await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8")).replaceAll("./10.product-architecture.srs.md", "../../escape.md"),
      "utf8"
    );
    const denied = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "탈출",
      statement: "탈출하면 안 된다.",
      acceptanceCriteria: ["denied"]
    });
    expect(denied.ok).toBe(false);
  });

  it("denies verified add without all checked AC and evidence", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "검증 실패",
      statement: "verified guard가 필요하다.",
      acceptanceCriteria: ["checked"],
      status: "verified"
    });
    expect(result.ok).toBe(false);
  });
});
