import { describe, expect, it } from "vitest";

import { RENDERINGS, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-228 — kiwi-pm's state records, per requirement, the test commit and the implementation
// commit `--commit-lane-work` makes, so a run's test-first order can be checked from its state alone.
// The AC numbers are the FR-FLOW-228 block in docs/spec/60.workflow-release.srs.md, which is canonical.

const PM = RENDERINGS.map((root) => `${root}/kiwi-pm/SKILL.md`);
const read = (rel: string): string => readRepoFile(rel).replace(/\r\n/g, "\n");

/** The state schema: the json block of §2.2 that carries `pm_version`. */
function stateSchema(text: string): { run?: Record<string, unknown> } {
  const block = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]!).find((body) => body.includes('"pm_version"'));
  return block === undefined ? {} : (JSON.parse(block) as { run?: Record<string, unknown> });
}

/** The field-meaning line of one state field. */
const field = (text: string, name: string): string => text.split("\n").find((line) => line.startsWith(`- \`${name}\` — `)) ?? "";

describe("FR-FLOW-228 AC-1 — the state schema holds run.commits, one entry per requirement", () => {
  it.each(PM)("%s: run.commits is a list in the schema and its entries carry the ID and both shas", (rel) => {
    // @req FR-FLOW-228 AC-1
    const text = read(rel);
    expect(Array.isArray(stateSchema(text).run?.commits), `${rel}: run.commits in the state schema`).toBe(true);
    const line = field(text, "run.commits");
    expect(line, `${rel}: run.commits field meaning`).not.toBe("");
    expect(line).toContain("`{req_id, test_sha, implementation_sha}`");
    expect(line).toContain("요구 ID, 테스트 커밋 sha, 구현 커밋 sha");
    expect(line).toContain("`--commit-lane-work` 가 §1.5 대로 커밋할 때");
  });

  it.each(PM)("%s: the run loop fills run.commits where --commit-lane-work commits", (rel) => {
    // @req FR-FLOW-228 AC-1
    const lines = read(rel).split("\n");
    const at = lines.findIndex((line) => line.includes("state.run.commit_sha = COMMIT_PER_REQUIREMENT(state)"));
    expect(at, `${rel}: the commit step`).toBeGreaterThan(-1);
    expect(lines[at + 1] ?? "").toContain("state.run.commits");
    expect(lines[at + 1] ?? "").toContain("{req_id, test_sha, implementation_sha}");
  });
});

describe("FR-FLOW-228 AC-2 — run.commit_sha keeps its meaning", () => {
  it.each(PM)("%s: run.commit_sha is still the last implementation commit", (rel) => {
    // @req FR-FLOW-228 AC-2
    const text = read(rel);
    expect(Object.hasOwn(stateSchema(text).run ?? {}, "commit_sha"), `${rel}: run.commit_sha in the state schema`).toBe(true);
    expect(field(text, "run.commit_sha")).toContain("가운데 마지막 구현 커밋, 없으면 null");
  });
});

describe("FR-FLOW-228 AC-3 — without --commit-lane-work run.commits is empty", () => {
  it.each(PM)("%s: the field says the list is empty without the flag", (rel) => {
    // @req FR-FLOW-228 AC-3
    const text = read(rel);
    expect(field(text, "run.commits")).toContain("`--commit-lane-work` 가 없으면 빈 목록 `[]` 이다");
    expect(stateSchema(text).run?.commits, `${rel}: the schema example runs without --commit-lane-work`).toEqual([]);
  });
});
