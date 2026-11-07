import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_MIRROR, ORCHESTRATOR_VARIANTS, REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// FR-FLOW-230 — kiwi-orchestrator on a repository whose SRS sits at the git top level: a host in a
// linked worktree, a target that is already authored, and the product target as the one target the
// wave close freezes. Every orchestrator rendering and the mirror is read.

const read = (rel: string): string => {
  try {
    return readFileSync(path.join(REPO_ROOT, rel), "utf8");
  } catch {
    return "";
  }
};

const ORCHESTRATORS = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

/** kiwi-wave-master carries the same MCP preflight paragraph; the mirror excludes it, so only the shipped renderings are read. */
const WAVE_MASTERS = RENDERINGS.filter((rendering) => rendering.startsWith("skills/")).map(
  (rendering) => `${rendering}/kiwi-wave-master/SKILL.md`
);

/** The paragraph that carries the target rule, held inside the compaction budget. */
const TARGET_RULE = "**run 의 target 은 제품 target 하나다.**";
const FROZEN_CLAUSE = "재생(PW-10)이 `--frozen-target` 으로 동결하는 것도 제품 target 이다 — `wave-{n}` 은 노드 이름이지 target 이 아니다.";
const EXISTING_CLAUSE = "제품 target 의 요구가 이미 PRD 를 덮으면 `--existing-srs <제품 target>` 으로 들어와 2.a 처음 저작을 건너뛴다";

function line(text: string, predicate: (candidate: string) => boolean): string {
  return text.split("\n").find(predicate) ?? "";
}

describe("FR-FLOW-230 AC-1 — the lane contract admits a host in a linked worktree", () => {
  for (const rendering of RENDERINGS) {
    it(`${rendering}: the host row passes when the two roots agree, main or linked worktree`, () => {
      // @req FR-FLOW-230 AC-1
      const text = read(`${rendering}/_shared/kiwi/worktree-lane.md`);
      const host = line(text, (candidate) => candidate.startsWith("| `host` |"));
      expect(host, `${rendering} worktree-lane.md host row`).not.toBe("");
      expect(host).not.toMatch(/아니다\*\*|\*\*not\*\* a linked worktree/);
      expect(host).toMatch(/메인 워크트리든 linked worktree 든|whether it is the main worktree or a linked worktree/);
    });

    it(`${rendering}: the host row names the reason the equality gate gives when the roots differ`, () => {
      // @req IR-CLI-093 AC-7 — the equality gate refuses first, as `roots-differ`.
      const text = read(`${rendering}/_shared/kiwi/worktree-lane.md`);
      const host = line(text, (candidate) => candidate.startsWith("| `host` |"));
      expect(host).toContain("`roots-differ`");
      expect(host).not.toContain("host-roots-differ");
      // The preflight judges the git root before comparing the two roots.
      expect(host).toContain("`git-root-not-a-repository`");
      expect(host).toContain("`git-root-not-toplevel`");
    });
  }

  for (const rel of [...ORCHESTRATORS, ...WAVE_MASTERS]) {
    it(`${rel}: the MCP preflight paragraph gives the equality gate's refusal, not a withdrawn one`, () => {
      // @req IR-MCP-005 AC-2 — a host and a lane root differ, so the equality gate refuses the undeclared call.
      const text = read(rel);
      expect(text).not.toContain("호스트를 자처하는 linked worktree 를 거부");
      expect(text).toContain("호스트 루트와 레인 루트가 다르면 등가 검사가 `roots-differ` 로 거부하므로");
    });
  }
});

describe("FR-FLOW-230 AC-2 — an entry option skips the first SRS authoring", () => {
  for (const rel of ORCHESTRATORS) {
    it(`${rel}: the rule sits inside the compaction budget`, () => {
      // @req FR-FLOW-230 AC-2
      const text = read(rel);
      const at = tokensThrough(text, EXISTING_CLAUSE);
      expect(at, `${rel} must state the --existing-srs entry`).toBeGreaterThan(0);
      expect(at).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });

    it(`${rel}: the option row names what it skips and what still runs`, () => {
      // @req FR-FLOW-230 AC-2
      const row = line(read(rel), (candidate) => candidate.startsWith("| `--existing-srs <target>` |"));
      expect(row, `${rel} §16 must list --existing-srs`).not.toBe("");
      for (const clause of [
        "2.a 처음 저작(`wave-srs-registration.md §1`)을 건너뛰어 SRS 를 바꾸지 않는다",
        "네 분류가 모두 `add_requirement` 로 시작하므로",
        "2.a′ feasibility · 2.b PRD 커버리지 · 2.d 분해는 그대로 돈다",
        "`wave-decomposition-coverage-gap` 으로 멈춘다"
      ]) {
        expect(row, clause).toContain(clause);
      }
    });

    it(`${rel}: the Phase 2 flow marks 2.a as skipped under the option`, () => {
      // @req FR-FLOW-230 AC-2
      const flow = line(read(rel), (candidate) => /^ {2}2\.a {2}\S+kiwi-srs 처음 저작/.test(candidate));
      expect(flow, `${rel} Phase 2 flow 2.a line`).toContain("`--existing-srs` 면 건너뛴다");
    });
  }

  for (const rendering of RENDERINGS) {
    it(`${rendering}: the shared decomposition order names the skip`, () => {
      // @req FR-FLOW-230 AC-2
      const step = line(read(`${rendering}/_shared/kiwi/wave-decomposition.md`), (candidate) => candidate.startsWith("2. **처음 저작** — "));
      expect(step).toContain("`kiwi-orchestrator --existing-srs` 면 이 단계를 건너뛰고, 4 의 PRD 커버리지는 그대로 돈다.");
    });
  }
});

describe("FR-FLOW-230 AC-3 — the wave close freezes the product target", () => {
  for (const rel of ORCHESTRATORS) {
    it(`${rel}: no step freezes wave-{n}`, () => {
      // @req FR-FLOW-230 AC-3
      expect(read(rel)).not.toMatch(/--frozen-target wave-/);
    });

    it(`${rel}: the replay verb freezes the product target`, () => {
      // @req FR-FLOW-230 AC-3
      const text = read(rel);
      const start = text.indexOf("### §V.replay-deferred-mutations");
      expect(start, `${rel} §V.replay-deferred-mutations`).toBeGreaterThan(0);
      const verb = text.slice(start, text.indexOf("\n### ", start + 1));
      expect(verb).toContain("--frozen-target <제품 target>");
    });

    it(`${rel}: the target rule sits inside the compaction budget`, () => {
      // @req FR-FLOW-230 AC-3
      const text = read(rel);
      const paragraph = line(text, (candidate) => candidate.startsWith(TARGET_RULE));
      expect(paragraph, `${rel} target rule paragraph`).toContain(FROZEN_CLAUSE);
      const at = tokensThrough(text, FROZEN_CLAUSE);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });
  }
});
