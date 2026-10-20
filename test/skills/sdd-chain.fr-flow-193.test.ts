import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile, skillDirs } from "./kiwi-renderings.js";

// @req FR-FLOW-193 — the default sdd chain is kiwi-srs → (kiwi-srs-feasibility) → kiwi-pm →
// kiwi-review-fix-loop over a requirement-ID set; kiwi-sds and its close-out run only under --sds;
// kiwi-planner stays retired. Supersedes FR-FLOW-184 (this file was sdd-chain.fr-flow-184).
//
// AC-1 and AC-2 are read from kiwi-pipeline §2.5 (the default chain and §2.4's end steps) and §2.5.5
// (the --sds branch), and from pipeline-v1.md; AC-3 from kiwi-srs-feasibility; AC-5, AC-6 carry the
// FR-FLOW-184 planner-retirement assertions unchanged; AC-7 reads the four files that re-enter a
// run. AC-4 is held by body-scope-chain-redirect.fr-flow-193 and AC-8 by the commit-skill suite.

const ARROW = String.raw`\s*(?:→|->)\s*`;
const FEAS = String.raw`kiwi-srs(?!-)${ARROW}\((?:조건부\)\s*|conditional\)\s*)?kiwi-srs-feasibility\)?${ARROW}`;
/** The default chain AC-1 fixes, over the cycle's requirement IDs. */
const DEFAULT_CHAIN = new RegExp(
  String.raw`${FEAS}kiwi-pm --req-filter <[^>]+> --review-hop-owned-by-parent${ARROW}kiwi-review-fix-loop --close-reqs --req-filter <[^>]+>`
);
/** The --sds chain AC-2 fixes. */
const SDS_CHAIN = new RegExp(String.raw`${FEAS}kiwi-sds${ARROW}kiwi-pm\b[^→]*?${ARROW}kiwi-review-fix-loop --close-reqs`);

function text(relPath: string): string {
  return readRepoFile(relPath).replace(/\r\n/g, "\n");
}

function pipelineBody(rendering: string): string {
  return stripFrontmatter(text(`${rendering}/kiwi-pipeline/SKILL.md`));
}

function plain(value: string): string {
  return flat(value).replace(/`/g, "");
}

function items(sectionText: string): string[] {
  return sectionText.split("\n").filter((line) => /^\d+\.\s/.test(line));
}

/** `last skill → the kiwi-* names its success row hints at`, read from every table row of `table`. */
function hints(table: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of tableRows(table)) {
    const last = (row.cells[0] ?? "").replace(/`/g, "").trim();
    if (!/TASK_DONE/.test(row.cells[1] ?? "")) continue;
    out.set(last, row.cells[2] ?? "");
  }
  return out;
}

describe("FR-FLOW-193 AC-1 — the default cycle runs kiwi-pm on the cycle's requirement IDs, with no kiwi-sds call", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: §2.5 states the default chain followed by the test-sufficiency check", (rendering) => {
    const cycle = section(pipelineBody(rendering), /^##\s*2\.5\s/);
    expect(cycle, `${rendering}: kiwi-pipeline has no §2.5`).not.toBe("");
    const at = plain(cycle).search(DEFAULT_CHAIN);
    expect(at, `${rendering}: §2.5 does not state the default chain`).toBeGreaterThan(-1);
    expect(plain(cycle).indexOf("_shared/kiwi/test-sufficiency.md", at), `${rendering}: no test-sufficiency check after the chain`).toBeGreaterThan(at);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: the default end steps (§2.5.4) call no kiwi-sds and no close-out", (rendering) => {
    const end = items(section(pipelineBody(rendering), /^###\s*2\.5\.4\s/));
    expect(end.length, `${rendering}: §2.5.4 has no numbered steps`).toBeGreaterThan(0);
    expect(end.filter((item) => item.includes("kiwi-sds")), `${rendering}: a default end step still calls kiwi-sds`).toEqual([]);
    const hop = end.findIndex((item) => item.includes("kiwi-review-fix-loop --close-reqs") && item.includes("--req-filter"));
    const check = end.findIndex((item) => item.includes("_shared/kiwi/test-sufficiency.md"));
    expect(hop, `${rendering}: §2.5.4 has no --close-reqs hop scoped by --req-filter`).toBeGreaterThanOrEqual(0);
    expect(check, `${rendering}: §2.5.4 does not run the check after the hop`).toBeGreaterThan(hop);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/pipeline-v1.md states the same default chain", (rendering) => {
    const contract = text(`${rendering}/_shared/kiwi/pipeline-v1.md`);
    expect(contract, `${rendering}: pipeline-v1.md is missing`).not.toBe("");
    expect(DEFAULT_CHAIN.test(plain(contract)), `${rendering}: pipeline-v1.md does not state the default chain`).toBe(true);
    expect(contract).toContain("test-sufficiency.md");
  });

  it.each(RENDERINGS)("%s: the next-step and next_hint tables follow the default order", (rendering) => {
    const tables: Array<[string, string]> = [
      ["kiwi-pipeline §5.1 T1", section(pipelineBody(rendering), /^###\s*5\.1\s/)],
      ["pipeline-event.md §4", section(text(`${rendering}/_shared/kiwi/pipeline-event.md`), /^##\s*4\.\s/)],
      ["pipeline-v1.md routing", section(text(`${rendering}/_shared/kiwi/pipeline-v1.md`), /^##\s*Routing/)]
    ];
    for (const [name, table] of tables) {
      const next = hints(table);
      expect(next.get("kiwi-srs-feasibility") ?? "", `${rendering} ${name}: feasibility does not hint kiwi-pm`).toMatch(/kiwi-pm/);
      expect(next.get("kiwi-sds") ?? "", `${rendering} ${name}: kiwi-sds does not hint kiwi-pm`).toMatch(/kiwi-pm/);
      expect(next.get("kiwi-pm") ?? "", `${rendering} ${name}: kiwi-pm does not hint the review`).toMatch(/kiwi-review-fix-loop/);
      expect(next.has("kiwi-planner"), `${rendering} ${name}: still carries a kiwi-planner row`).toBe(false);
      expect([...next.values()].join(" "), `${rendering} ${name}: still hints kiwi-planner`).not.toContain("kiwi-planner");
    }
  });
});

describe("FR-FLOW-193 AC-2 — under --sds the cycle adds kiwi-sds before kiwi-pm and the close-out around the promoting hop", () => {
  it.each(RENDERINGS)("%s/kiwi-pipeline: §2.5.5 is the --sds branch and states the --sds chain", (rendering) => {
    const branch = section(pipelineBody(rendering), /^###\s*2\.5\.5\s/);
    expect(branch, `${rendering}: kiwi-pipeline has no §2.5.5`).not.toBe("");
    expect(branch.split("\n")[0], `${rendering}: §2.5.5's heading does not name --sds`).toMatch(/--sds/);
    expect(SDS_CHAIN.test(plain(branch)), `${rendering}: §2.5.5 does not state the --sds chain`).toBe(true);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: the move runs after kiwi-pm and before the --close-reqs hop; the delete after the hop and the check", (rendering) => {
    const steps = items(section(pipelineBody(rendering), /^###\s*2\.5\.5\s/));
    const closes = steps.map((item, index) => (/^\d+\.\s+`kiwi-sds --close <sds-id>`/.test(item) ? index : -1)).filter((index) => index >= 0);
    const hop = steps.findIndex((item) => item.includes("kiwi-review-fix-loop --close-reqs"));
    const check = steps.findIndex((item, index) => index > hop && item.includes("_shared/kiwi/test-sufficiency.md"));
    expect(closes.length, `${rendering}: §2.5.5 must call kiwi-sds --close twice`).toBe(2);
    expect(hop, `${rendering}: §2.5.5 has no --close-reqs hop`).toBeGreaterThan(-1);
    expect(closes[0], `${rendering}: the move does not precede the promoting hop`).toBeLessThan(hop);
    expect(check, `${rendering}: no check after the hop`).toBeGreaterThan(hop);
    expect(closes[1], `${rendering}: the delete does not follow the hop and the check`).toBeGreaterThan(check);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/pipeline-v1.md: the --sds chain and its close-out are stated as the --sds branch", (rendering) => {
    const contract = plain(text(`${rendering}/_shared/kiwi/pipeline-v1.md`));
    const at = contract.search(SDS_CHAIN);
    expect(at, `${rendering}: pipeline-v1.md does not state the --sds chain`).toBeGreaterThan(-1);
    expect(contract.slice(Math.max(0, at - 160), at), `${rendering}: the --sds chain is not introduced as the --sds branch`).toMatch(/--sds/);
    expect(contract).toContain("kiwi-sds --close");
  });
});

describe("FR-FLOW-193 AC-3 — kiwi-srs-feasibility hints kiwi-pm and shows kiwi-sds only as the --sds branch", () => {
  it.each(RENDERINGS.filter((rendering) => rendering.startsWith("skills/")))("%s/kiwi-srs-feasibility: the emit's next_hint names kiwi-pm", (rendering) => {
    const lines = markdownFiles(rendering, "kiwi-srs-feasibility")
      .flatMap((relPath) => text(relPath).split("\n"))
      .filter((line) => /`next_hint`/.test(line) && /stability/.test(line));
    expect(lines.length, `${rendering}: no next_hint emit line found`).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `${rendering}: feasibility does not hint kiwi-pm`).toContain('"kiwi-pm"');
      expect(line, `${rendering}: feasibility still hints kiwi-sds by default`).not.toContain('"kiwi-sds"');
    }
  });

  it.each(RENDERINGS.filter((rendering) => rendering.startsWith("skills/")))("%s/kiwi-srs-feasibility: every kiwi-sds mention is the --sds branch", (rendering) => {
    const lines = markdownFiles(rendering, "kiwi-srs-feasibility")
      .flatMap((relPath) => text(relPath).split("\n"))
      .filter((line) => line.includes("kiwi-sds"));
    expect(lines.length, `${rendering}: the chain diagram no longer shows the --sds branch`).toBeGreaterThan(0);
    for (const line of lines) expect(line, `${rendering}: kiwi-sds shown outside the --sds branch`).toMatch(/--sds/);
  });
});

describe("FR-FLOW-193 AC-5 · FR-FLOW-180 AC-1 AC-2 — kiwi-planner is gone (carried from FR-FLOW-184 AC-2)", () => {
  it.each(RENDERINGS)("%s carries no kiwi-planner directory", (rendering) => {
    expect(existsSync(path.join(REPO_ROOT, rendering, "kiwi-planner")), `${rendering}/kiwi-planner still exists`).toBe(false);
  });

  const OWNED = [
    "kiwi-pipeline",
    "kiwi-sds",
    "kiwi-srs-feasibility",
    "_shared/kiwi/pipeline-event.md",
    "_shared/kiwi/pipeline-v1.md",
    "_shared/kiwi/loop-option.md",
    "_shared/kiwi/auto-option.md"
  ];

  it.each(RENDERINGS)("%s carries no workmode-policy.md", (rendering) => {
    expect(existsSync(path.join(REPO_ROOT, rendering, "_shared/kiwi/workmode-policy.md")), `${rendering}: workmode-policy.md survives`).toBe(false);
  });

  it.each(RENDERINGS)("%s: the pipeline skills and contracts name no kiwi-planner", (rendering) => {
    for (const entry of OWNED) {
      const files = entry.endsWith(".md") ? [`${rendering}/${entry}`] : markdownFiles(rendering, entry);
      for (const relPath of files) {
        const lines = text(relPath)
          .split("\n")
          .filter((line) => line.includes("kiwi-planner"));
        expect(lines, `${relPath} still names kiwi-planner`).toEqual([]);
      }
    }
  });
});

describe("FR-FLOW-193 AC-6 — the event contract enumerates kiwi-sds and not kiwi-planner (carried from FR-FLOW-184 AC-3)", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/pipeline-event.md: the skill enum lists kiwi-sds and not kiwi-planner", (rendering) => {
    const enumBlock = section(text(`${rendering}/_shared/kiwi/pipeline-event.md`), /^##\s*3\.\s/);
    const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(enumBlock)?.[1] ?? "";
    const members = fenced.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    expect(members, `${rendering}: the enum is empty`).toContain("kiwi-srs");
    expect(members).toContain("kiwi-sds");
    expect(members).not.toContain("kiwi-planner");
  });
});

describe("FR-FLOW-193 AC-7 — re-entry carries --req-filter and kiwi-pm --run-id, never --plan-run-id, and --sds-id only on an opted-in run", () => {
  const FILES = (rendering: string): string[] => [
    ...(skillDirs(rendering).includes("kiwi-pipeline") ? markdownFiles(rendering, "kiwi-pipeline") : []),
    ...(skillDirs(rendering).includes("kiwi-wave-master") ? markdownFiles(rendering, "kiwi-wave-master") : []),
    ...(skillDirs(rendering).includes("kiwi-orchestrator") ? markdownFiles(rendering, "kiwi-orchestrator") : []),
    `${rendering}/_shared/kiwi/verify-loop.md`
  ];

  it.each(RENDERINGS)("%s: --plan-run-id is gone from the four files", (rendering) => {
    for (const relPath of FILES(rendering)) expect(text(relPath), `${relPath} still names --plan-run-id`).not.toContain("--plan-run-id");
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/verify-loop.md: the re-entry unit id is kiwi-pm --run-id {run_id}-wave-{n}-r{m}", (rendering) => {
    const loop = flat(text(`${rendering}/_shared/kiwi/verify-loop.md`));
    expect(loop).toMatch(/--run-id \{run_id\}-wave-\{n\}-r\{m\}/);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: a user-given --sds-id is an SDS instruction that implies --sds", (rendering) => {
    const options = section(pipelineBody(rendering), /^###\s*1\.2\s/);
    const row = tableRows(options).find((entry) => (entry.cells[1] ?? "").includes("`--sds-id"));
    expect(row, `${rendering}: §1.2 has no --sds-id option row`).toBeDefined();
    expect(row?.cells.join(" | "), `${rendering}: --sds-id does not imply --sds`).toMatch(/`--sds` 를 함의|implies `--sds`/);
    const enumeration = options.split("\n").find((line) => /작업 입력은[^\n]*닫힌다/.test(line)) ?? "";
    expect(enumeration, `${rendering}: the work-input enumeration (FR-FLOW-124) lost --sds-id`).toContain("`--sds-id`");
  });
});
