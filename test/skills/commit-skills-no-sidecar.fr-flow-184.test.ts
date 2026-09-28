import { describe, expect, it } from "vitest";

import { RENDERINGS, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-184 — the commit skills neither read nor edit a plan sidecar, and none of the four
// skills this suite covers names kiwi-planner.
//
// kiwi-commit-auto-push used to take task candidates from the newest `docs/plans/*.sidecar.json` and
// to append its own trace rows into that file's `mcp_call_log[]`; kiwi-commit-auto-pr inherited both
// and also wrote `tasks[].pr_url`. With the plan gone there is no sidecar to read, and a rule telling
// the skill to edit one is an instruction to write a file nothing reads. The `Task:` trailer those
// rows fed goes with them: its only producers were the sidecar, the plan task id a caller passed,
// and the per-task pm-state record, and 4.0.0 retires all three (FR-FLOW-185 AC-2).
//
// Every markdown file and every agent manifest of each skill is read, in every rendering and the
// mirror; the mirror rows go red until `.agents/skills` is regenerated.

const COMMIT_SKILLS = ["kiwi-commit-auto-push", "kiwi-commit-auto-pr"] as const;
const OWNED = [...COMMIT_SKILLS, "kiwi-pm", "kiwi-coder"] as const;

function docs(rendering: string, skill: string): Array<{ relPath: string; text: string }> {
  const manifests = [`${rendering}/${skill}/agents/openai.yaml`].filter((relPath) => readRepoFile(relPath) !== "");
  return [...markdownFiles(rendering, skill), ...manifests].map((relPath) => ({ relPath, text: readRepoFile(relPath) }));
}

/** What reading or editing a plan sidecar is spelled as in these skills. */
const SIDECAR = /sidecar|사이드카|docs\/plans\/|mcp_call_log|tasks\[\]\.pr_url/i;

describe("FR-FLOW-184 AC-6 — the commit skills do not read or edit a plan sidecar", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  for (const skill of COMMIT_SKILLS) {
    it.each(RENDERINGS)(`%s/${skill} names no sidecar source or edit`, (rendering) => {
      const found = docs(rendering, skill);
      expect(found.length, `${rendering}/${skill} ships no document`).toBeGreaterThan(0);
      for (const { relPath, text } of found) {
        const lines = text.split(/\r?\n/).filter((line) => SIDECAR.test(line));
        expect(lines, `${relPath} still reads or edits a plan sidecar`).toEqual([]);
      }
    });

    it.each(RENDERINGS)(`%s/${skill} keeps no plan-task trailer or selector`, (rendering) => {
      for (const { relPath, text } of docs(rendering, skill)) {
        const lines = text.split(/\r?\n/).filter((line) => /^\s*Task:\s|`Task`|--task=|T-PH\d|task_match/.test(line));
        expect(lines, `${relPath} still carries the plan-task trailer`).toEqual([]);
      }
    });
  }
});

describe("FR-FLOW-184 AC-2 — kiwi-pm, kiwi-coder and the commit skills do not name kiwi-planner", () => {
  for (const skill of OWNED) {
    it.each(RENDERINGS)(`%s/${skill} names no kiwi-planner`, (rendering) => {
      for (const { relPath, text } of docs(rendering, skill)) {
        const lines = text.split(/\r?\n/).filter((line) => line.includes("kiwi-planner"));
        expect(lines, `${relPath} still names kiwi-planner`).toEqual([]);
      }
    });
  }
});
