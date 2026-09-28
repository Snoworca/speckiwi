import { describe, expect, it } from "vitest";

import { section } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, flat, skillFiles } from "./kiwi-renderings.js";

// @req MIG-FLOW-003 AC-1 — the kiwi skills that read workflow artifacts tell the agent to read them
// through the official readers and work-order tools first, and to fall back to the raw file only as
// the degraded path.
//
// The instruction lives in each skill's tool-policy section (`## Official Workflow Tool Policy` or
// `## Workflow 도구 정책`). A reader name found anywhere in a thousand-line body proves only that the
// name exists, so each assertion reads ONE block of that section — a paragraph or a numbered item —
// and requires the reader and the raw-read fallback in that block, reader first.
//
// Which flows are covered. kiwi-pm and kiwi-coder read their session state on `--resume`
// (`pm-state.json`, `state.json`, `worklog.jsonl`), kiwi-pipeline reads the last pipeline events,
// and the codex kiwi-srs policy names the pipeline readers. The claude and etc kiwi-srs read no
// workflow artifact outside the emit path, so they owe no reader rule; the last block below holds
// that premise, so a read flow added there later has to bring the rule with it.
//
// The related kiwi skills of AC-1 are the ones that read one of those artifact kinds too:
// kiwi-hot-fix and kiwi-review-fix-loop resume from `.kiwi/sessions/{run-id}/state.json` (kind
// `coder-state`), kiwi-orchestrator's recovery inspects the child's `pipeline.jsonl`, and
// kiwi-wave-master reads the worker's session `worklog.jsonl`.

/**
 * The official reader for the artifact each skill's covered flow reads, by its MCP name — not any
 * reader: `workflow_session_status` resolves only kind `pm-state`, so naming it for kiwi-coder's
 * `state.json` (kind `coder-state`) names a reader that never returns that file.
 */
const CODER_STATE_READER = /`workflow_(?:resolve|latest)_artifact`[^.]*`coder-state`/;
const PIPELINE_READER = /`workflow_pipeline_(?:tail|status)`/;

const READERS: Record<string, readonly RegExp[]> = {
  "kiwi-pm": [/`workflow_session_status`/],
  "kiwi-coder": [CODER_STATE_READER],
  "kiwi-pipeline": [PIPELINE_READER],
  "kiwi-srs": [PIPELINE_READER],
  "kiwi-hot-fix": [CODER_STATE_READER],
  "kiwi-review-fix-loop": [CODER_STATE_READER],
  "kiwi-orchestrator": [PIPELINE_READER],
  "kiwi-wave-master": [/`workflow_worklog_tail`/]
};

/** The skills whose resume state is the `coder-state` kind, which the PM-state reader never returns. */
const CODER_STATE_SKILLS = ["kiwi-coder", "kiwi-hot-fix", "kiwi-review-fix-loop"] as const;

/** The reader rule of one skill: the block naming every reader it owes and the raw-read fallback. */
function readerRule(rendering: string, skill: string): string {
  const readers = READERS[skill] ?? [];
  return policyBlocks(rendering, skill).find((block) => RAW_READ_AFTER.test(block) && readers.every((reader) => reader.test(block))) ?? "";
}

/** The raw read named as what comes after the reader, in either language. */
const RAW_READ_AFTER =
  /before reading .{0,160}? directly|직접 읽는 것은 [^.]*degraded 폴백|Raw file append\/read 는 degraded mode 에서만 허용/;

/** Where each skill carries a covered read flow. */
const COVERED: ReadonlyArray<readonly [skill: string, renderings: readonly string[]]> = [
  ["kiwi-pm", RENDERINGS],
  ["kiwi-coder", RENDERINGS],
  ["kiwi-pipeline", RENDERINGS],
  ["kiwi-srs", RENDERINGS.filter((rendering) => rendering === "skills/codex" || rendering === ".agents/skills")],
  ["kiwi-hot-fix", RENDERINGS],
  ["kiwi-review-fix-loop", RENDERINGS],
  ["kiwi-orchestrator", RENDERINGS],
  ["kiwi-wave-master", RENDERINGS.filter((rendering) => rendering !== ".agents/skills" || !MIRROR_EXCLUDED.includes("kiwi-wave-master"))]
];

const CASES = COVERED.flatMap(([skill, renderings]) => renderings.map((rendering) => [rendering, skill] as const));

function skillText(rendering: string, skill: string): string {
  return skillFiles(rendering, skill)
    .map((doc) => doc.text)
    .join("\n\n");
}

/** The paragraphs and numbered items of the skill's tool-policy sections, flattened. */
function policyBlocks(rendering: string, skill: string): string[] {
  const text = skillText(rendering, skill);
  return [/^## Official Workflow Tool Policy\s*$/, /^## Workflow 도구 정책\s*$/]
    .map((heading) => section(text, heading))
    .flatMap((policy) => policy.split(/\n\s*\n|\n(?=\d+\.\s)/))
    .map((block) => flat(block).trim())
    .filter((block) => block !== "" && !block.startsWith("#"));
}

describe("MIG-FLOW-003 AC-1 — official readers and work-order tools come before raw file reads", () => {
  it.each(CASES)("MIG-FLOW-003 AC-1 %s/%s: one policy block names the reader of the covered artifact and makes the raw read the fallback after it", (rendering, skill) => {
    const blocks = policyBlocks(rendering, skill);
    expect(blocks.length, `${rendering}/${skill}: no workflow tool-policy section`).toBeGreaterThan(0);
    const rule = readerRule(rendering, skill);
    expect(rule, `${rendering}/${skill}: no policy block names the reader of its covered artifact before a raw file read`).not.toBe("");
    for (const reader of READERS[skill] ?? []) {
      expect(rule.search(reader), `${rendering}/${skill}: the raw read is named before the reader it falls back from`).toBeLessThan(
        rule.search(RAW_READ_AFTER)
      );
    }
  });

  it.each(RENDERINGS.flatMap((rendering) => CODER_STATE_SKILLS.map((skill) => [rendering, skill] as const)))(
    "MIG-FLOW-003 AC-1 %s/%s: the coder-state resume file is not sent to the PM-state reader",
    (rendering, skill) => {
      const rule = readerRule(rendering, skill);
      expect(rule, `${rendering}/${skill}: no reader rule to check`).not.toBe("");
      expect(rule, `${rendering}/${skill}: workflow_session_status reads pm-state, not state.json`).not.toContain("`workflow_session_status`");
    }
  );

  it.each(RENDERINGS)("MIG-FLOW-003 AC-1 %s/kiwi-pipeline: the next step is chosen through the work-order tool", (rendering) => {
    const rule = readerRule(rendering, "kiwi-pipeline");
    expect(rule, `${rendering}/kiwi-pipeline: the reader rule does not name get_next_work_order`).toContain("`get_next_work_order`");
  });

  it.each(RENDERINGS.filter((rendering) => rendering !== "skills/codex" && rendering !== ".agents/skills"))(
    "MIG-FLOW-003 AC-1 %s/kiwi-srs: reads no workflow artifact outside the emit path, so owes no reader rule",
    (rendering) => {
      const text = skillText(rendering, "kiwi-srs");
      expect(text, `${rendering}/kiwi-srs is missing`).not.toBe("");
      expect(text, `${rendering}/kiwi-srs now reads session state; it owes the reader rule`).not.toMatch(/\.kiwi\/sessions|worklog/);
      const raw = text.split("\n").filter((line) => line.includes("pipeline.jsonl"));
      expect(
        raw.filter((line) => !/append/.test(line)),
        `${rendering}/kiwi-srs names pipeline.jsonl outside an append; it owes the reader rule`
      ).toEqual([]);
    }
  );
});
