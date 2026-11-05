import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cliJson, PRD_PATH, prdWorkspace } from "../cli/prd-surface-fixture.js";
import { RENDERINGS, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-209 — the PRD citation form kiwi-srs prescribes for a requirement's Rationale is one
// `speckiwi prd coverage` counts. The AC numbers are the FR-FLOW-209 block in
// docs/spec/60.workflow-release.srs.md, which is canonical.
//
// The forms are not restated here: they are read out of every shipped kiwi-srs rendering, written
// into a fixture requirement's Rationale exactly as prescribed, and `speckiwi prd coverage --target`
// is run on it. A rendering that changed its form to one coverage does not count turns this red.

/** Every file of one kiwi-srs rendering an author reads the citation form from. */
const srsDocs = (root: string): string[] =>
  root === "skills/claude" ? [`${root}/kiwi-srs/SKILL.md`] : [`${root}/kiwi-srs/SKILL.md`, `${root}/kiwi-srs/references/extended-workflow.md`];

const read = (rel: string): string => readRepoFile(rel).replace(/\r\n/g, "\n");

/** Where each rendering prescribes a citation: the example of the core block, the §9.1 author context, and the fills: template of verdict (c). */
const SITES = [
  { name: "core-block example", pattern: /요구가 PRD 항목을 인용하는 곳은 그 요구의 Rationale 이다\(예: `([^`]+)`\)/ },
  { name: "§9.1 author context", pattern: /Rationale 에 인용한 PRD 항목\(`([^`]+)`\)/ },
  { name: "fills: template", pattern: /그 요구의 Rationale 에 `(fills: [^`]+)` 이 있을 때만 받아들인다/ },
] as const;

interface Coverage {
  uncitedItems: Array<{ id: string }>;
  uncitedRequirements: Array<{ requirementId: string }>;
  ungroundedCriteria: Array<{ requirementId: string; criterionId: string }>;
}

/**
 * The prescribed form made concrete the way an author fills it in: a placeholder criterion
 * (`AC-n`, `AC-<n>`) and item (`PRD-m`, `PRD-<n>`) become numbers, `<a|b|c>` its first choice and
 * `<reason>` a reason. A form that already names numbers is kept byte for byte.
 */
function instantiate(form: string): { rationale: string; criterion?: number; item: number } {
  const rationale = form
    .replace(/AC-(?:n|<n>)/g, "AC-2")
    .replace(/PRD-(?:m|<m>|<n>)/g, "PRD-2")
    .replace(/<([a-z]+)\|[^>]+>/g, "$1")
    .replace(/<reason>/g, "the request leaves the empty case open");
  const criterion = /AC-(\d+)/.exec(rationale)?.[1];
  const item = Number(/PRD-(\d+)/.exec(rationale)?.[1]);
  return { rationale, ...(criterion === undefined ? {} : { criterion: Number(criterion) }), item };
}

const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

/** valid-basic's FR-ARCH-001 with criteria AC-1..AC-<criteria> and the given Rationale; the PRD has `items` in-scope items. */
async function workspace(rationale: string, criteria: number, items: number): Promise<string> {
  const root = await prdWorkspace({
    items: [
      { title: "목적", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "비밀번호 재설정 링크를 추가해" },
      ...Array.from({ length: items - 1 }, (_, index) => ({
        title: `항목 ${index + 2}`,
        rows: { Kind: "in-scope", Source: "U-1", State: "confirmed" },
        quote: "Password reset email must expire after one hour.",
      })),
    ],
  });
  const file = path.join(root, SCOPE);
  const extra = Array.from({ length: Math.max(0, criteria - 2) }, (_, index) => `- [ ] AC-${index + 3}: The requirement can be counted.`);
  const text = (await readFile(file, "utf8"))
    .replace("The parser needs a small valid workspace.", rationale)
    .replace("- [ ] AC-2: The requirement can be shown.", ["- [ ] AC-2: The requirement can be shown.", ...extra].join("\n"));
  await writeFile(file, text, "utf8");
  return root;
}

describe("FR-FLOW-209 AC-1 — the citation form every kiwi-srs rendering prescribes is one prd coverage counts", () => {
  for (const root of RENDERINGS) {
    for (const site of SITES) {
      // @req FR-FLOW-209 AC-1
      it(`${root} ${site.name}: a Rationale written in exactly that form covers the item it cites`, async () => {
        const text = srsDocs(root).map(read).join("\n");
        const form = site.pattern.exec(text)?.[1];
        expect(form, `${root}: no ${site.name}`).toBeDefined();
        const { rationale, criterion, item } = instantiate(form as string);
        const fixtureRoot = await workspace(rationale, Math.max(2, criterion ?? 2), Math.max(2, item));
        const { code, json } = await cliJson<Coverage>(fixtureRoot, "coverage", PRD_PATH, "--target", "v1.0.0");
        expect(code).toBe(0);
        expect(json.uncitedItems.map((entry) => entry.id), `${rationale}: the item stays uncited`).not.toContain(`PRD-${item}`);
        expect(json.uncitedRequirements, `${rationale}: the requirement cites nothing`).toEqual([]);
        if (criterion !== undefined) {
          expect(json.ungroundedCriteria.map((entry) => entry.criterionId), `${rationale}: the criterion it names is not grounded`).not.toContain(`AC-${criterion}`);
        }
      });
    }
  }
});

describe("FR-FLOW-209 AC-2 — the short form stays because coverage counts it", () => {
  // @req FR-FLOW-209 AC-2 — AC-2 switches every rendering to the path-qualified form only WHEN coverage
  // does not count `AC-<n> ← PRD-<m>`. This holds that condition false: the day coverage stops counting
  // the short form, this goes red and AC-2's rewrite is due.
  it("prd coverage counts `AC-<n> ← PRD-<m>` with no PRD path in it", async () => {
    const root = await workspace("AC-1 ← PRD-2", 2, 2);
    const { json } = await cliJson<Coverage>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(json.uncitedItems.map((entry) => entry.id)).not.toContain("PRD-2");
    expect(json.ungroundedCriteria.map((entry) => entry.criterionId)).not.toContain("AC-1");
  });
});
