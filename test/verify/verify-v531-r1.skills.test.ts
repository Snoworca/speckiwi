import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mcp, roadmapWorkspace, roadmapFile } from "../cli/roadmap-surface-fixture.js";

// Final round — 5.3.1 skills bundle (FR-FLOW-224 .. FR-FLOW-226). The tool calls the skills write are made as written
// against a temporary workspace (valid-basic with a docs/roadmap.md), and the result is checked against the AC.

const REPO = path.resolve(import.meta.dirname, "../..");
const read = (relative: string): string => readFileSync(path.join(REPO, relative), "utf8").replace(/\r\n/g, "\n");

describe("FR-FLOW-224 AC-4 — kiwi-roadmap shows the dry-run result before writing", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-roadmap/SKILL.md and .agents/skills/kiwi-roadmap/SKILL.md §1 step 3
  // ("쓰기에 꼭 필요한 값은 `kind` 와 `title` 뿐이다") and step 4 (the write is first called with `dryRun` true and its
  // result shown); step 2 routes a new item to `add_roadmap_item`.
  for (const root of ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"]) {
    // @req FR-FLOW-224 AC-4
    it(`${root}: a new item's dry-run built from the values §1 names as the only required ones returns a dry-run result`, async () => {
      const text = read(`${root}/kiwi-roadmap/SKILL.md`);
      const step = text.split("\n").find((line) => line.startsWith("3. 쓰기에 꼭 필요한 값은")) ?? "";
      expect(step, `${root}: §1 step 3`).not.toBe("");
      const required = [...(/^3\. 쓰기에 꼭 필요한 값은 (.*?) 뿐이다/.exec(step)?.[1] ?? "").matchAll(/`([a-zA-Z]+)`/g)].map((match) => match[1] as string);
      // Lead decision (5.3.1 final round): §1 step 3 now names `kind`, `title` and `reason` (the tool requires a reason on
      // every write, FR-NODE-256 AC-1/AC-4). The property kept is the defect's: a dry-run built from exactly the values step 3
      // names as the required ones returns a dry-run result.
      expect(required, `${root}: required values`).toEqual(expect.arrayContaining(["kind", "title"]));
      const values: Record<string, string> = { kind: "feature", title: "Ranked search", reason: "user asked for ranked search" };
      expect(required.every((name) => name in values), `${root}: every required value has a sample (${required.join(", ")})`).toBe(true);
      const input = Object.fromEntries(required.map((name) => [name, values[name]]));

      const ws = await roadmapWorkspace();
      const before = readFileSync(roadmapFile(ws), "utf8");
      const answer = await mcp(ws, "add_roadmap_item", { ...input, dryRun: true });
      expect(readFileSync(roadmapFile(ws), "utf8")).toBe(before);
      expect({ ok: answer.ok, error: answer.error?.message ?? null }, `${root}: add_roadmap_item ${JSON.stringify(input)} dryRun`).toEqual({ ok: true, error: null });
    });
  }
});
