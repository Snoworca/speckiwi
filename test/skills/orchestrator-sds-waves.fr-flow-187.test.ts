import { describe, expect, it } from "vitest";

import {
  criticalGateRows,
  normaliseEol,
  orderedOffsets,
  readVariant,
  section,
  stripFrontmatter,
  verbSection
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-187, FR-FLOW-186, FR-FLOW-183
//
// R-ORCH writes one SDS per wave and the ladder loses R-PLAN; every orchestrator rung and
// kiwi-wave-master end with a code-review hop followed by the test-sufficiency check; the wave SDS
// is closed out around promotion. Assertions read structure — a rung heading, a call fence, a gate
// row, an ordered pair of anchors inside one section — so a sentence cannot satisfy them from a
// paragraph that is about something else.

const BUNDLES = ["claude", "codex", "etc"] as const;

function body(bundle: string, skill: string): string {
  return normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${skill}/SKILL.md`)));
}

function fences(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1] as string);
}

const R_ORCH_ROW = /^####\s+4\.5\.3\b/;
const R_STEP_ROW = /^####\s+4\.5\.1\b/;
const PROMOTION = /^##\s+14\./;

describe("FR-FLOW-187 AC-1 — the ladder is R-STEP → R-ORCH", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-1 ${bundle}: the selection order has two rungs and R-PLAN is gone`, () => {
      const text = body(bundle, "kiwi-orchestrator");
      expect(text, bundle).toMatch(/order: R-STEP → R-ORCH/);
      expect(text.includes("R-PLAN"), `${bundle}: R-PLAN survives`).toBe(false);
      expect(text.includes("plan-coverage-unclosed"), `${bundle}: plan-coverage-unclosed survives`).toBe(false);
    });

    it(`FR-FLOW-187 AC-1 ${bundle}: probe field S2 and disqualifiers D5–D7 are gone`, () => {
      const text = body(bundle, "kiwi-orchestrator");
      const probe = section(text, /^###\s+4\.2\b/);
      expect(probe, bundle).not.toBe("");
      expect(/^\|\s*S2\s*\|/m.test(probe), `${bundle}: S2 probe row`).toBe(false);
      const disqualifiers = section(text, /^###\s+4\.3\b/);
      for (const id of ["D5", "D6", "D7"]) {
        expect(new RegExp(`\\*\\*${id}\\*\\*`).test(disqualifiers), `${bundle}: ${id} row`).toBe(false);
      }
    });
  }
});

describe("FR-FLOW-187 AC-2 — step 3.c invokes kiwi-sds for each wave", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-2 ${bundle}: the R-ORCH row calls kiwi-sds with the wave sds-id and never kiwi-planner`, () => {
      const text = body(bundle, "kiwi-orchestrator");
      const row = section(text, R_ORCH_ROW);
      const call = fences(row).join("\n");
      expect(call, bundle).toMatch(/Skill\(\{ skill: "kiwi-sds",[^)]*--sds-id \{run_id\}-wave-\{n\}/s);
      expect(text.includes("kiwi-planner"), `${bundle}: kiwi-planner survives`).toBe(false);
      const map = section(text, /^##\s+3\.\s/);
      const line = map.split("\n").find((l) => /^\s+3\.c\s/.test(l)) ?? "";
      expect(line, `${bundle}: phase map 3.c`).toMatch(/kiwi-sds/);
    });

    it(`FR-FLOW-187 AC-2 ${bundle}: the SDS is committed with the wave inputs`, () => {
      const commit = verbSection(body(bundle, "kiwi-orchestrator"), "commit-wave-inputs");
      expect(commit, bundle).not.toBe("");
      expect(commit, `${bundle}: the wave input commit does not carry the SDS`).toMatch(/docs\/sds\/\{run_id\}-wave-\{n\}\.sds\.md/);
    });
  }
});

describe("FR-FLOW-187 AC-3 — allocation and grounding read the SDS", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-3 ${bundle}: unallocated-req-id checks the SDS @req set and files-not-grounded the SDS Files`, () => {
      const rows = criticalGateRows(body(bundle, "kiwi-orchestrator"));
      const allocation = rows.find((r) => r.gateId === "unallocated-req-id");
      expect(allocation, bundle).toBeDefined();
      expect((allocation as { reason: string }).reason, bundle).toMatch(/SDS[^|]*@req/);
      expect((allocation as { reason: string }).reason.includes("sidecar"), `${bundle}: sidecar`).toBe(false);
      const grounding = rows.find((r) => r.gateId === "files-not-grounded");
      expect(grounding, bundle).toBeDefined();
      expect((grounding as { reason: string }).reason, bundle).toMatch(/SDS[^|]*Files/);
      expect((grounding as { reason: string }).reason.includes("sidecar"), `${bundle}: sidecar`).toBe(false);
    });
  }
});

describe("FR-FLOW-187 AC-4 — no intra-wave partition, no handoff, no loop H, no coupling check", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-4 ${bundle}: the removed machinery is absent`, () => {
      const text = body(bundle, "kiwi-orchestrator");
      for (const [name, re] of [
        ["lane handoff document", /lanes\/lane-\{k\}\.md/],
        ["handoff validator", /validateHandoff|handoff validate/],
        ["loop H", /loop H\b|\[loop H\]/],
        ["stage coupling check", /3\.f″|stage-coupling-unresolved/],
        ["handoff gates", /handoff-not-english|handoff-verify-failed|handoff-untested-ac-over-cap|handoff-unresolvable-reference/],
        ["serial epilogue", /serial_epilogue|run-serial-epilogue/]
      ] as const) {
        expect(re.test(text), `${bundle}: ${name} survives`).toBe(false);
      }
    });

    it(`FR-FLOW-187 AC-4 ${bundle}: a lane is defined as one wave's worker`, () => {
      const text = body(bundle, "kiwi-orchestrator");
      expect(/lane 하나는 wave 하나의 워커|lane is one wave's worker/.test(text), bundle).toBe(true);
    });
  }
});

describe("FR-FLOW-186 AC-3 — the orchestrator runs the check immediately before its promotion step", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-186 AC-3 ${bundle}: §14 cites the check before the transition table`, () => {
      const promotion = section(body(bundle, "kiwi-orchestrator"), PROMOTION);
      expect(promotion, bundle).not.toBe("");
      const offsets = orderedOffsets(promotion, [/_shared\/kiwi\/test-sufficiency\.md/, /^\|\s*From\s*\|\s*To\s*\|/m]);
      expect(offsets.every((o) => o >= 0), `${bundle}: ${JSON.stringify(offsets)}`).toBe(true);
      expect(offsets[0] as number).toBeLessThan(offsets[1] as number);
      expect(promotion.includes("test-sufficiency-gap"), `${bundle}: the gate is not named`).toBe(true);
    });
  }
});

describe("FR-FLOW-183 AC-1 · AC-3 — the wave SDS is closed out around promotion", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-183 AC-1 ${bundle}: §14 runs kiwi-sds --close before the transition and again after it`, () => {
      const promotion = section(body(bundle, "kiwi-orchestrator"), PROMOTION);
      const closes = [...promotion.matchAll(/skill: "kiwi-sds", args: "--close \{run_id\}-wave-\{n\}/g)].map((m) => m.index as number);
      expect(closes.length, `${bundle}: close-out calls`).toBe(2);
      const table = promotion.search(/^\|\s*From\s*\|\s*To\s*\|/m);
      expect(closes[0] as number).toBeLessThan(table);
      expect(closes[1] as number).toBeGreaterThan(table);
    });

    it(`FR-FLOW-183 AC-3 ${bundle}: wave-master closes out through the contract before recording complete`, () => {
      const text = body(bundle, "kiwi-wave-master");
      expect(/kiwi-sds --close|skill: "kiwi-sds", args: "--close/.test(text) || /PW-14/.test(text), bundle).toBe(true);
    });
  }
});

describe("FR-FLOW-186 AC-4 — every rung and kiwi-wave-master end with a review hop then the check", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-186 AC-4 ${bundle}: R-STEP runs the check after its review hop and reports its result`, () => {
      const row = section(body(bundle, "kiwi-orchestrator"), R_STEP_ROW);
      const offsets = orderedOffsets(row, [/skill: "kiwi-review-fix-loop"/, /_shared\/kiwi\/test-sufficiency\.md/]);
      expect(offsets.every((o) => o >= 0), `${bundle}: ${JSON.stringify(offsets)}`).toBe(true);
      expect(offsets[0] as number).toBeLessThan(offsets[1] as number);
      expect(/테스트 충분성 확인 결과|test-sufficiency result/.test(row), `${bundle}: the report does not state the result`).toBe(true);
    });

    it(`FR-FLOW-186 AC-4 ${bundle}: R-ORCH runs the check after its run-window review hop`, () => {
      const final = verbSection(body(bundle, "kiwi-orchestrator"), "final-verify");
      const offsets = orderedOffsets(final, [/skill: "kiwi-review-fix-loop"/, /_shared\/kiwi\/test-sufficiency\.md/]);
      expect(offsets.every((o) => o >= 0), `${bundle}: ${JSON.stringify(offsets)}`).toBe(true);
      expect(offsets[0] as number).toBeLessThan(offsets[1] as number);
    });

    it(`FR-FLOW-186 AC-4 ${bundle}: the orchestrator's run report states the check's result`, () => {
      const report = section(body(bundle, "kiwi-orchestrator"), /^##\s+15\./);
      expect(/테스트 충분성 확인 결과|test-sufficiency result/.test(report), bundle).toBe(true);
    });

    it(`FR-FLOW-186 AC-4 ${bundle}: kiwi-wave-master runs the check after its run-window hop and before the final pass`, () => {
      const text = body(bundle, "kiwi-wave-master");
      const hop = section(text, /^##\s+5\.55\b/);
      const offsets = orderedOffsets(hop, [/skill: "kiwi-review-fix-loop"/, /_shared\/kiwi\/test-sufficiency\.md/]);
      expect(offsets.every((o) => o >= 0), `${bundle}: ${JSON.stringify(offsets)}`).toBe(true);
      expect(offsets[0] as number).toBeLessThan(offsets[1] as number);
      expect(/테스트 충분성 확인 결과|test-sufficiency result/.test(text), `${bundle}: the report does not state the result`).toBe(true);
      expect(criticalGateRows(text).map((r) => r.gateId), bundle).toContain("test-sufficiency-gap");
    });
  }

});
