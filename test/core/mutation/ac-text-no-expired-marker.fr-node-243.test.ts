import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria } from "../../../src/core/mutation/edit-requirement.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { MutationResult, ProjectRoot } from "../../../src/core/types.js";
import { acFixture } from "../ac-expiry-fixture.js";

// @req FR-NODE-243 AC-1 FR-PARSE-044 AC-5 — the expired marker is written only by
// expire_acceptance_criterion. Every other path that writes acceptance-criterion text must refuse
// text in the expired grammar, or it expires a criterion with any date, no Change Notes reason, and
// possibly no live criterion left.

const FORGED = "~~forged~~ [EXPIRED 1999-01-01]";
const FORGED_WITH_SUCCESSOR = "~~forged~~ [EXPIRED 1999-01-01 → FR-ARCH-002]";

type EntryPoint = (root: ProjectRoot, text: string) => Promise<MutationResult<unknown>>;

/**
 * Every mutation that writes acceptance-criterion text. The census below ties this list to the source
 * files that render an AC line, so a new writer cannot be added without joining it.
 */
const ENTRY_POINTS: Readonly<Record<string, { file: string; call: EntryPoint }>> = {
  edit_acceptance_criteria: {
    file: "src/core/mutation/check-ac.ts",
    call: (root, text) => editAcceptanceCriteria(root, { id: "FR-ARCH-001", acId: "AC-1", text })
  },
  replace_acceptance_criteria: {
    file: "src/core/mutation/edit-requirement.ts",
    call: (root, text) => replaceAcceptanceCriteria(root, { id: "FR-ARCH-001", items: [{ text: "live" }, { text }] })
  },
  add_requirement: {
    file: "src/core/mutation/render-requirement.ts",
    call: (root, text) =>
      addRequirement(root, { type: "functional", scope: "ARCH", target: "v1.0.0", title: "New", statement: "S.", acceptanceCriteria: ["live", text] })
  },
  supersede_requirement: {
    file: "src/core/mutation/render-requirement.ts",
    call: (root, text) =>
      supersedeRequirement(root, { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Next", statement: "S.", acceptanceCriteria: ["live", text], reason: "probe", confirmDiscardVerified: true })
  }
};

async function snapshot(rootPath: string): Promise<string> {
  const specDir = path.join(rootPath, "docs", "spec");
  const names = (await readdir(specDir)).sort();
  return (await Promise.all(names.filter((name) => name.endsWith(".md")).map((name) => readFile(path.join(specDir, name), "utf8")))).join("\n");
}

describe("FR-NODE-243 — no AC-text writer forges the expired marker", () => {
  for (const [name, entry] of Object.entries(ENTRY_POINTS)) {
    for (const text of [FORGED, FORGED_WITH_SUCCESSOR, `  ${FORGED}  `]) {
      // @req FR-NODE-243 AC-1
      it(`${name} refuses ${JSON.stringify(text)} and writes nothing`, async () => {
        const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first", "- [ ] AC-2: second"] });
        const before = await snapshot(rootPath);
        const result = await entry.call(await resolveProjectRoot(rootPath), text);
        expect(result.ok).toBe(false);
        expect(result.error?.message).toMatch(/expire_acceptance_criterion/);
        expect(await snapshot(rootPath)).toBe(before);
      });
    }
  }

  // @req FR-NODE-243 AC-1
  it("still accepts struck text that is not the marker grammar", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first", "- [ ] AC-2: second"] });
    const result = await ENTRY_POINTS.edit_acceptance_criteria!.call(await resolveProjectRoot(rootPath), "~~deprecated wording~~ is ignored");
    expect(result.ok).toBe(true);
  });

  // @req FR-NODE-243 AC-1 — the denominator: every source file that renders an acceptance-criterion
  // line (`- [x] AC-<n>: <text>`) or rewrites one's text after its `AC-<n>:` prefix.
  it("covers every source file that writes acceptance-criterion text", async () => {
    const renders = /\] AC-\$\{|\] \$\{acId\}: \$\{|\$\{prefix\} \$\{input\.text\}/;
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts") && renders.test(await readFile(full, "utf8"))) found.push(full.replaceAll("\\", "/"));
      }
    };
    await walk("src");
    const declared = [...new Set(Object.values(ENTRY_POINTS).map((entry) => entry.file))].sort();
    expect(found.sort()).toEqual(declared);
  });
});
