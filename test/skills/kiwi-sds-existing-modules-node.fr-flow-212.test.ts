import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-212 AC-2 — with no `wave-{n}` target left, kiwi-sds cannot find a wave's existing modules by
// its `TARGET`: `TARGET` is now the product target every wave shares. It reads the node map the
// decomposition writes (`{artifact_root}existing-modules.json`, `wave-decomposition.md §1`) under the
// node its `--sds-id` names, so FR-FLOW-063 AC-7 (SDS authoring reads that wave's recorded modules and
// no other wave's) still holds.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const KIWI_SDS = RENDERINGS.map((root) => `${root}/kiwi-sds/SKILL.md`);

/** The `### n.m` subsection that starts with `heading`, up to the next `###` or `##` heading. */
function subsection(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  const stop = lines.findIndex((line, i) => i > start && /^#{2,3}\s/.test(line));
  return lines.slice(start, stop < 0 ? undefined : stop).join("\n");
}

describe("FR-FLOW-212 AC-2 — kiwi-sds keys --existing-modules by the node of its --sds-id", () => {
  // @req FR-FLOW-212 AC-2
  it.each(KIWI_SDS)("%s: the option row reads the node map under the wave of --sds-id", (rel) => {
    const row = read(rel).split("\n").find((line) => /^\|\s*`--existing-modules <path>`/.test(line)) ?? "";
    expect(row, `${rel}: no option row`).not.toBe("");
    expect(row).toContain("`existing-modules.json`");
    expect(row).toContain("`--sds-id`");
    expect(row).toContain("`{run_id}-wave-{n}`");
    expect(row).toContain("`wave-{n}`");
    expect(row).not.toMatch(/`TARGET` 과 같은 wave|wave `TARGET` names/);
  });

  // @req FR-FLOW-212 AC-2 — the read phase uses the same key and still forbids re-creating or renaming.
  it.each(KIWI_SDS)("%s: §2.2 reads the --sds-id node's existing_modules, never the TARGET's", (rel) => {
    const readPhase = subsection(read(rel), /^###\s*2\.2\b/);
    const sentence = readPhase.split("\n").find((line) => line.includes("`--existing-modules`")) ?? "";
    expect(sentence).toMatch(/`--sds-id` 가 가리키는 노드|node its `--sds-id` names/);
    expect(sentence).not.toMatch(/`TARGET` 의 wave 항목|wave `TARGET` names/);
  });

  // @req FR-FLOW-212 AC-2 — the callers pass the node map, not a design baseline.
  it.each(KIWI_SDS)("%s: the caller sentence names the node map", (rel) => {
    const caller = read(rel).split("\n").find((line) => /^(R-ORCH 와 kiwi-wave-master|R-ORCH and kiwi-wave-master)/.test(line)) ?? "";
    expect(caller, `${rel}: no caller sentence`).not.toBe("");
    expect(caller).toContain("`existing-modules.json`");
    expect(caller).not.toMatch(/설계 기준선|design baseline/);
  });
});
