import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-184 — the sdd chain is kiwi-srs → (kiwi-srs-feasibility) → kiwi-sds → kiwi-pm →
// kiwi-review-fix-loop, and kiwi-planner is retired.
//
// AC-1, AC-3 and the kiwi-pipeline half of AC-5 are read from the pipeline skill, the two pipeline
// contracts and kiwi-srs-feasibility. AC-2's directory absence is read from every rendering; its
// "no skill names kiwi-planner" half is asserted here for the files this suite's owner edits —
// FR-FLOW-160's resolution sweep holds every other shipped body, because a name whose directory is
// gone does not resolve. AC-4 is held by body-scope-chain-redirect.fr-flow-184 and AC-6 by the
// commit-skill suites.

const ARROW = String.raw`\s*(?:→|->)\s*`;
/** The chain in the order AC-1 fixes, feasibility parenthesised as the conditional stage. */
const CHAIN = new RegExp(
  String.raw`kiwi-srs(?!-)${ARROW}\((?:조건부\)\s*|conditional\)\s*)?kiwi-srs-feasibility\)?${ARROW}kiwi-sds${ARROW}kiwi-pm\b${ARROW}kiwi-review-fix-loop --close-reqs`
);

function text(relPath: string): string {
  return readRepoFile(relPath).replace(/\r\n/g, "\n");
}

function pipelineBody(rendering: string): string {
  return stripFrontmatter(text(`${rendering}/kiwi-pipeline/SKILL.md`));
}

/** `last skill → the kiwi-* names its success row hints at`, read from every table row of `table`. */
function hints(table: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of tableRows(table)) {
    const last = (row.cells[0] ?? "").replace(/`/g, "").trim();
    if (!/TASK_DONE/.test(row.cells[1] ?? "")) continue;
    out.set(last, (row.cells[2] ?? "").match(/kiwi-[a-z-]+/g) ?? []);
  }
  return out;
}

describe("FR-FLOW-184 AC-1 — the cycle is kiwi-srs → (feasibility) → kiwi-sds → kiwi-pm → kiwi-review-fix-loop --close-reqs", () => {
  it.each(RENDERINGS)("%s/kiwi-pipeline: §2.5 states the chain", (rendering) => {
    const cycle = section(pipelineBody(rendering), /^##\s*2\.5\s/);
    expect(cycle, `${rendering}: kiwi-pipeline has no §2.5`).not.toBe("");
    expect(CHAIN.test(flat(cycle).replace(/`/g, "")), `${rendering}: §2.5 does not state the sdd chain`).toBe(true);
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: the chain is followed by the test-sufficiency check and the SDS close-out", (rendering) => {
    const cycle = flat(section(pipelineBody(rendering), /^##\s*2\.5\s/));
    const chainAt = cycle.replace(/`/g, "").search(CHAIN);
    const plain = cycle.replace(/`/g, "");
    const sufficiency = plain.indexOf("_shared/kiwi/test-sufficiency.md", chainAt);
    const closeOut = plain.indexOf("kiwi-sds --close", chainAt);
    expect(sufficiency, `${rendering}: §2.5 does not name the test-sufficiency contract after the chain`).toBeGreaterThan(chainAt);
    expect(closeOut, `${rendering}: §2.5 does not name the SDS close-out after the chain`).toBeGreaterThan(chainAt);
    // The close-out's last call — the one that deletes the SDS — follows the check (FR-FLOW-183 AC-3).
    const items = section(pipelineBody(rendering), /^###\s*2\.5\.4\s/)
      .split("\n")
      .filter((line) => /^\d+\.\s/.test(line));
    const checkAt = items.findIndex((item) => item.includes("_shared/kiwi/test-sufficiency.md"));
    expect(checkAt, `${rendering}: §2.5.4 has no step running the test-sufficiency check`).toBeGreaterThanOrEqual(0);
    expect(
      items.slice(checkAt + 1).some((item) => /^\d+\.\s+`kiwi-sds --close <sds-id>`/.test(item)),
      `${rendering}: no §2.5.4 step after the check closes the SDS out`
    ).toBe(true);
    // The move precedes the promoting hop (FR-FLOW-183: before the run promotes).
    const moveAt = items.findIndex((item) => /^\d+\.\s+`kiwi-sds --close <sds-id>`/.test(item));
    const hopAt = items.findIndex((item) => item.includes("kiwi-review-fix-loop --close-reqs"));
    expect(moveAt, `${rendering}: §2.5.4 does not move the SDS decisions before the review hop`).toBeGreaterThanOrEqual(0);
    expect(moveAt, `${rendering}: the move runs after the promoting hop`).toBeLessThan(hopAt);
  });

  it.each(RENDERINGS)("%s/_shared/kiwi/pipeline-v1.md: the shared contract states the same chain", (rendering) => {
    const contract = text(`${rendering}/_shared/kiwi/pipeline-v1.md`);
    expect(contract, `${rendering}: pipeline-v1.md is missing`).not.toBe("");
    expect(CHAIN.test(flat(contract).replace(/`/g, "")), `${rendering}: pipeline-v1.md does not state the sdd chain`).toBe(true);
    expect(contract).toContain("test-sufficiency.md");
    expect(contract).toContain("kiwi-sds --close");
  });

  it.each(RENDERINGS)("%s: the next-step tables follow the chain order", (rendering) => {
    const tables: Array<[string, string]> = [
      ["kiwi-pipeline §5.1 T1", section(pipelineBody(rendering), /^###\s*5\.1\s/)],
      ["pipeline-event.md §4", section(text(`${rendering}/_shared/kiwi/pipeline-event.md`), /^##\s*4\.\s/)],
      ["pipeline-v1.md routing", section(text(`${rendering}/_shared/kiwi/pipeline-v1.md`), /^##\s*Routing/)]
    ];
    for (const [name, table] of tables) {
      const next = hints(table);
      expect(next.get("kiwi-srs-feasibility") ?? [], `${rendering} ${name}: feasibility does not hint kiwi-sds`).toContain("kiwi-sds");
      expect(next.get("kiwi-sds") ?? [], `${rendering} ${name}: kiwi-sds does not hint kiwi-pm`).toContain("kiwi-pm");
      expect(next.get("kiwi-pm") ?? [], `${rendering} ${name}: the step after kiwi-pm skips the close-out move`).toContain("kiwi-sds");
      expect(next.has("kiwi-planner"), `${rendering} ${name}: still carries a kiwi-planner row`).toBe(false);
      expect([...next.values()].flat(), `${rendering} ${name}: still hints kiwi-planner`).not.toContain("kiwi-planner");
    }
  });
});

describe("FR-FLOW-184 AC-2 — kiwi-planner is gone", () => {
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

  // Open answer 26: the work-mode → plan tdd_policy derivation left with the plan and FR-FLOW-040 is
  // discarded, so the contract that held it is removed rather than left with no consumer.
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

describe("FR-FLOW-184 AC-3 — the event contract enumerates kiwi-sds, and feasibility hints it", () => {
  it.each(RENDERINGS)("%s/_shared/kiwi/pipeline-event.md: the skill enum lists kiwi-sds and not kiwi-planner", (rendering) => {
    const enumBlock = section(text(`${rendering}/_shared/kiwi/pipeline-event.md`), /^##\s*3\.\s/);
    const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(enumBlock)?.[1] ?? "";
    const members = fenced.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    expect(members, `${rendering}: the enum is empty`).toContain("kiwi-srs");
    expect(members).toContain("kiwi-sds");
    expect(members).not.toContain("kiwi-planner");
  });

  it.each(RENDERINGS.filter((rendering) => rendering.startsWith("skills/")))(
    "%s/kiwi-srs-feasibility: the emit's next_hint names kiwi-sds",
    (rendering) => {
      const lines = markdownFiles(rendering, "kiwi-srs-feasibility")
        .flatMap((relPath) => text(relPath).split("\n"))
        .filter((line) => /`next_hint`/.test(line) && /stability/.test(line));
      expect(lines.length, `${rendering}: no next_hint emit line found`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, `${rendering}: feasibility does not hint kiwi-sds`).toContain('"kiwi-sds"');
      }
    }
  );
});

// @req FR-FLOW-184 AC-1 — step by step, the hop after the close-out move is still the promoting hop.
describe("FR-FLOW-184 AC-1 — the review hop after the close-out move keeps --close-reqs", () => {
  it.each(RENDERINGS)("%s/kiwi-pipeline: the --close-reqs attach rule covers a kiwi-sds --close predecessor", (rendering) => {
    const handoff = section(pipelineBody(rendering), /^##\s*7\.\s/);
    const rule = handoff.split("\n").find((line) => line.includes("`--close-reqs` 를 부착한다")) ?? "";
    expect(rule, `${rendering}: §7 has no --close-reqs attach rule`).not.toBe("");
    expect(rule, `${rendering}: the attach rule drops --close-reqs after the close-out move`).toContain("kiwi-sds --close");
  });
});

describe("FR-FLOW-184 AC-5 — kiwi-pipeline re-enters with --sds-id, not --plan-run-id", () => {
  it.each(RENDERINGS)("%s/kiwi-pipeline: --plan-run-id is gone", (rendering) => {
    expect(pipelineBody(rendering)).not.toContain("--plan-run-id");
  });

  it.each(RENDERINGS)("%s/kiwi-pipeline: --sds-id is an option, a work input and forwarded to kiwi-sds and kiwi-pm", (rendering) => {
    const options = section(pipelineBody(rendering), /^###\s*1\.2\s/);
    expect(
      tableRows(options).some((row) => (row.cells[1] ?? "").includes("`--sds-id")),
      `${rendering}: §1.2 has no --sds-id option row`
    ).toBe(true);
    const enumeration = options.split("\n").find((line) => /작업 입력은[^\n]*닫힌다/.test(line)) ?? "";
    expect(enumeration, `${rendering}: the work-input enumeration does not list --sds-id`).toContain("`--sds-id`");
    const handoff = section(pipelineBody(rendering), /^##\s*7\.\s/);
    const rule = handoff.split("\n").find((line) => /`--req-filter` 와 `--sds-id` 는 함께/.test(line)) ?? "";
    expect(rule, `${rendering}: §7 does not forward --req-filter and --sds-id together`).not.toBe("");
    // The consumers are named in the clause that states the forwarding, before its explanation.
    const clause = rule.split(" — ")[0] ?? "";
    expect(/kiwi-sds/.test(clause) && /kiwi-pm/.test(clause), `${rendering}: the forwarding clause does not name kiwi-sds and kiwi-pm`).toBe(true);
    // kiwi-pm takes only SDS_PATH: the requirement filter goes to kiwi-sds and to the review hop, never to kiwi-pm.
    expect(/`--req-filter`[^—]*kiwi-review-fix-loop/.test(clause), `${rendering}: the requirement filter does not reach the review hop`).toBe(true);
    expect(/`kiwi-pm` 에는 `--sds-id` 가 가리키는 `SDS_PATH`/.test(clause), `${rendering}: kiwi-pm is not handed the SDS path alone`).toBe(true);
  });
});
