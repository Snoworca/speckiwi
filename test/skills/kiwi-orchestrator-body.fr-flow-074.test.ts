import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { scanProse } from "../../src/core/orchestrator/prose-gate.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  PHASE1_VERBS,
  PHASE2_GATE_IDS,
  PHASE2_VERBS,
  REPO_ROOT,
  ROUTING_GATE_IDS,
  criticalGateRows,
  gateSeverityRows,
  offsetOf,
  readVariant,
  section,
  stripFrontmatter,
  tiedTogether,
  variantBodies,
  verbSection,
  verbSectionNames
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-074  three variants, verb-indexed, three-column critical_gates[]
// @req FR-FLOW-075  a resumed session performs only next_action.verb
// @req FR-FLOW-076  write-ahead intent, write-behind result
// @req FR-FLOW-086  AC-4 — verification-oscillation is declared by the orchestrator
// @req FR-FLOW-088  orchestrator isolation stated in its own section zero
// @req FR-FLOW-093  integration branch ownership, committed run artifacts, abort report
//
// A skill body is agent instruction, so these are raw-text and proximity assertions over the
// bundled files. Where an acceptance criterion states a number — ten headings, thirteen fields,
// three recovery classes — the number is load-bearing and the assertion carries it.

const VARIANTS = variantBodies();

describe("FR-FLOW-074 — the kiwi-orchestrator skill ships in three variants", () => {
  it("AC-1 — every bundled variant exists and is non-empty through the ENOENT-to-empty reader", () => {
    for (const variant of ORCHESTRATOR_VARIANTS) {
      const text = readVariant(variant.relPath);
      expect(text.length, `${variant.relPath} must exist and be non-empty`).toBeGreaterThan(0);
      expect(stripFrontmatter(text).trim().length, `${variant.relPath} must carry a body`).toBeGreaterThan(0);
    }
  });

  it("AC-1 — package-doctor's expectation set names the skill, so a missing variant fails a check", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain("kiwi-orchestrator");
  });

  it("AC-2 — every phase-1 verb has exactly one §V section and every §V section names a phase-1 verb", () => {
    // The expectation is derived from the shipped VERBS constant minus 05 §4.4's phase-2 rows, so a
    // verb added to the runtime enum with no skill section fails here rather than silently passing.
    expect(PHASE1_VERBS.length).toBe(38);

    for (const variant of VARIANTS) {
      const declared = verbSectionNames(variant.body);
      expect(new Set(declared).size, `${variant.id}: no duplicate §V section`).toBe(declared.length);
      expect([...declared].sort(), `${variant.id}: §V sections must equal the phase-1 verb enum`).toEqual([...PHASE1_VERBS].sort());
    }
  });

  it("AC-2 — no §V section names a verb 05 §4.4 marks phase 2", () => {
    for (const variant of VARIANTS) {
      const declared = new Set(verbSectionNames(variant.body));
      for (const verb of PHASE2_VERBS) {
        expect(declared.has(verb), `${variant.id}: ${verb} is phase-2 and must have no §V section`).toBe(false);
      }
    }
  });

  it("AC-2 — every §V section declares one of the three recovery classes", () => {
    for (const variant of VARIANTS) {
      for (const verb of PHASE1_VERBS) {
        const body = verbSection(variant.body, verb);
        expect(body.length, `${variant.id}: §V.${verb} must have content`).toBeGreaterThan(0);
        if (verb === "halt") continue; // 05 §4.4: terminal, and declares no class.
        expect(/pure-reauthor|idempotent-by-key|externally-visible/.test(body), `${variant.id}: §V.${verb} must declare a recovery class`).toBe(true);
      }
    }
  });

  it("AC-3 — critical_gates[] is a table with exactly the three columns gate_id, reason, location", () => {
    for (const variant of VARIANTS) {
      const gatesSection = section(variant.body, /^##\s*0\.G\b/);
      expect(gatesSection, `${variant.id}: a 0.G section must declare critical_gates[]`).toContain("critical_gates");
      expect(/\|\s*gate_id\s*\|\s*reason\s*\|\s*location\s*\|/.test(gatesSection), `${variant.id}: the header must be gate_id | reason | location`).toBe(true);

      const rows = criticalGateRows(variant.body);
      expect(rows.length, `${variant.id}: the table must carry rows`).toBeGreaterThan(40);
      expect(
        rows.filter((row) => row.width !== 3).map((row) => row.gateId),
        `${variant.id}: every critical_gates[] row must be three columns wide`
      ).toEqual([]);
      expect(
        rows.filter((row) => row.reason.length === 0 || row.location.length === 0).map((row) => row.gateId),
        `${variant.id}: every row must carry a reason and a location`
      ).toEqual([]);
    }
  });

  it("AC-4 — the declared gate_id set and the §V section set are set-equal across the three variants", () => {
    const gateSets = VARIANTS.map((variant) => [...criticalGateRows(variant.body).map((row) => row.gateId)].sort());
    const verbSets = VARIANTS.map((variant) => [...verbSectionNames(variant.body)].sort());
    const severitySets = VARIANTS.map((variant) => [...gateSeverityRows(variant.body).map((row) => row.gateId)].sort());

    expect(gateSets[1]).toEqual(gateSets[0]);
    expect(gateSets[2]).toEqual(gateSets[0]);
    expect(verbSets[1]).toEqual(verbSets[0]);
    expect(verbSets[2]).toEqual(verbSets[0]);
    expect(severitySets[1]).toEqual(severitySets[0]);
    expect(severitySets[2]).toEqual(severitySets[0]);
  });

  it("AC-5 — no phase-2 gate identifier appears in any variant's critical_gates[]", () => {
    for (const variant of VARIANTS) {
      const declared = new Set(criticalGateRows(variant.body).map((row) => row.gateId));
      for (const gateId of PHASE2_GATE_IDS) {
        expect(declared.has(gateId), `${variant.id}: ${gateId} is a phase-2 gate and must not be declared`).toBe(false);
      }
    }
  });

  it("AC-5 — every declared gate id is a member of the exported GateId union", () => {
    const union = new Set<string>(GATE_IDS as readonly string[]);
    for (const variant of VARIANTS) {
      const declared = [...criticalGateRows(variant.body).map((row) => row.gateId), ...gateSeverityRows(variant.body).map((row) => row.gateId)];
      expect(
        declared.filter((gateId) => !union.has(gateId)),
        `${variant.id}: every declared gate id must be in GATE_IDS`
      ).toEqual([]);
    }
  });

  it("AC-4 — the .agents mirror is the codex rendering, and the skill is not mirror-excluded", () => {
    const exclusions = JSON.parse(readFileSync(path.join(REPO_ROOT, ".agents/skills/.speckiwi-mirror-exclusions.json"), "utf8")) as { excluded: string[] };
    expect(exclusions.excluded).not.toContain("kiwi-orchestrator");
    expect(readVariant(ORCHESTRATOR_MIRROR)).toBe(readVariant("skills/codex/kiwi-orchestrator/SKILL.md"));
  });

  it("the body does not itself trip the unmarked-normative-prose detector it ships", () => {
    // src/core/orchestrator/prose-gate.ts is what `orchestrate freeze design` runs. A skill body that
    // fails its own detector would teach the reader a rule the tool rejects.
    for (const variant of VARIANTS) {
      const findings = scanProse(variant.body).findings;
      expect(findings.map((finding) => `${finding.rule}@${finding.lines[0]}`), `${variant.id}: prose gate findings`).toEqual([]);
    }
  });
});

describe("FR-FLOW-075 — the resume procedure is the first operative content", () => {
  it("AC-1 — the numbered procedure precedes every phase and verb section in each variant", () => {
    for (const variant of VARIANTS) {
      const resume = offsetOf(variant.body, /^##\s*1\.\s.*재개/m);
      expect(resume, `${variant.id}: a numbered resume section must exist`).toBeGreaterThan(-1);

      const firstVerbSection = offsetOf(variant.body, /^###\s+§V\./m);
      const phaseFlow = offsetOf(variant.body, /^##\s*3\.\s/m);
      expect(resume, `${variant.id}: resume precedes the phase flow`).toBeLessThan(phaseFlow);
      expect(resume, `${variant.id}: resume precedes the verb index`).toBeLessThan(firstVerbSection);
    }
  });

  it("AC-1 — inside that section the order is run contract, preflight, resume, verb", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      const offsets = [/00\.run-contract\.md/, /orchestrate preflight/, /orchestrate resume/, /next_action\.verb/].map((re) => offsetOf(body, re));
      expect(offsets.every((offset) => offset > -1), `${variant.id}: all four steps must be present`).toBe(true);
      expect(offsets, `${variant.id}: the four steps must appear in the stated order`).toEqual([...offsets].sort((a, b) => a - b));
    }
  });

  it("AC-2 — preflight runs before resume, with the run-root reason stated", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      expect(body).toMatch(/--mcp-root/);
      expect(body).toMatch(/--git-root/);
      expect(tiedTogether(body, /run-root/, [/저널 경로|journal/, /먼저|before/]), `${variant.id}: the run-root-before-journal-resolution reason must be stated`).toBe(true);
    }
  });

  it("AC-3 — with no {work} the session takes work_root out of the resume card", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      expect(tiedTogether(body, /work_root/, [/\{work\}/, /추측|guess/]), `${variant.id}: work_root must come from the card rather than a guess`).toBe(true);
    }
  });

  it("AC-4 — on a blocking result only next_action.verb runs, otherwise only its §V section is read", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      expect(tiedTogether(body, /blocking/, [/next_action\.verb/, /그 밖의 어떤 것도|nothing else/]), `${variant.id}: the blocking branch must be exclusive`).toBe(true);
      expect(body).toMatch(/§V\.<next_action\.verb>/);
      expect(body).toMatch(/그 섹션만|that section only/);
    }
  });

  it("AC-5 — a resumed session never reconstructs run state from conversation", () => {
    for (const variant of VARIANTS) {
      expect(/재개 세션은 대화에서 run 상태를 복원하지 않는다/.test(variant.body), `${variant.id}: the never-from-conversation rule must be a normative sentence`).toBe(true);
    }
  });

  it("AC-2 — the rung is read from the card and computeRoute runs exactly once per run", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      expect(tiedTogether(body, /frozen\.route\.rung/, [/다시 계산하지 않는다/, /probe_digest/, /run-invariant-drift/]), `${variant.id}: read-never-recompute must be tied to the digest check`).toBe(true);
      expect(body).toMatch(/computeRoute[^.]*정확히 한 번/);
    }
  });
});

describe("FR-FLOW-076 — write-ahead intent and write-behind result", () => {
  it("AC-1 — the four-step write discipline appears in order", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*2\.\s/m);
      const offsets = [/event:"intent"/, /동사를 수행한다/, /event:"result"/, /orchestrate card write/].map((re) => offsetOf(body, re));
      expect(offsets.every((offset) => offset > -1), `${variant.id}: all four steps present`).toBe(true);
      expect(offsets, `${variant.id}: intent, verb, result, card — in that order`).toEqual([...offsets].sort((a, b) => a - b));
      expect(body).toMatch(/`intent` 는 동사 \*\*앞\*\*에, `result` 는 동사 \*\*뒤\*\*에 붙는다/);
    }
  });

  it("AC-2 — journal lines go through the tool and never through a hand-rolled append", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*2\.\s/m);
      expect(tiedTogether(body, /orchestrate journal append/, [/kiwi\/waves\.jsonl/, /직접 append 하지 않는다/]), `${variant.id}: the tool-only rule must be tied to waves.jsonl`).toBe(true);
    }
  });

  it("AC-3 — the resume invariant is the last line per (verb, wave, lane) key", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*2\.\s/m);
      expect(body).toMatch(/\(verb, wave, lane\)/);
      expect(tiedTogether(body, /\(verb, wave, lane\)/, [/마지막 줄은 `result`/, /`intent`[\s\S]{0,120}중단/]), `${variant.id}: the invariant and its interruption reading must sit together`).toBe(true);
    }
  });

  it("AC-4 — all three recovery classes are named and the first two are redone with no gate", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*2\.1\b/m);
      for (const cls of ["pure-reauthor", "idempotent-by-key", "externally-visible"]) expect(body, `${variant.id}: ${cls}`).toContain(cls);
      expect(tiedTogether(body, /pure-reauthor/, [/idempotent-by-key/, /게이트 없이/]), `${variant.id}: the first two classes are redone with no gate`).toBe(true);
    }
  });

  it("AC-5 — an interrupted externally-visible verb inspects first, and the gate halts even under --auto", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*2\.1\b/m);
      expect(
        tiedTogether(body, /interrupted-external-action/, [/점검/, /해소되지 않을 때에만/, /--auto/], 600),
        `${variant.id}: inspection-first, only-when-unresolved, and halt-under-auto must be tied`
      ).toBe(true);
    }
  });

  it("AC-1 — commit identification is by git trailer, not by subject text", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^###\s*2\.1\b/m);
      expect(tiedTogether(body, /trailer/, [/subject/, /Orch-/], 500), `${variant.id}: trailer-not-subject must be stated`).toBe(true);
    }
  });
});

describe("FR-FLOW-086 AC-4 — verification-oscillation is declared by the orchestrator", () => {
  it("appears in all three variants' critical_gates[] with a location covering any loop", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "verification-oscillation");
      expect(row, `${variant.id}: verification-oscillation must be declared`).toBeDefined();
      expect(row?.location).toMatch(/any loop|모든 루프|any/i);
    }
  });

  it("AC-3 — the body records both outcome values the engine writes on termination", () => {
    for (const variant of VARIANTS) {
      expect(tiedTogether(variant.body, /verification-oscillation/, [/fail-residual/, /oscillation/], 600), `${variant.id}: verdict and reason_class must be recorded together`).toBe(true);
    }
  });

  it("AC-5 — the engine module carries the rule denominator-agnostically for every loop", () => {
    for (const agent of ["claude", "codex", "etc"]) {
      const engine = readVariant(`skills/${agent}/_shared/kiwi/verify-loop.md`);
      expect(engine, `${agent}: verify-loop.md must carry the oscillation rule`).toContain("verification-oscillation");
      expect(engine).toContain("fail-residual");
      expect(engine).toContain("oscillation");
    }
  });
});

describe("FR-FLOW-088 — isolation stated in the skill's own section zero", () => {
  it("AC-1 — a §0 section carries all three phase-1 grounds", () => {
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(zero.length, `${variant.id}: a 0.* isolation section must exist`).toBeGreaterThan(0);
      expect(zero).toMatch(/per-wave worktree/);
      expect(zero).toMatch(/lane workspace/);
      expect(zero).toMatch(/host root/);
      expect(zero).toMatch(/통합 브랜치/);
      expect(zero).toMatch(/none-serial/);
    }
  });

  it("AC-2 — every isolation profile named in the phase-1 text is the literal none-serial", () => {
    for (const variant of VARIANTS) {
      expect(/\bbranch-serial-lane\b/.test(variant.body), `${variant.id}: branch-serial-lane is not a phase-1 profile`).toBe(false);
      expect(/\bpatch-lane\b/.test(variant.body), `${variant.id}: patch-lane is not a phase-1 profile`).toBe(false);
      for (const window of variant.body.matchAll(/isolation_profile/g)) {
        const near = variant.body.slice(Math.max(0, window.index - 200), window.index + 200);
        expect(near, `${variant.id}: every isolation_profile mention must name none-serial`).toContain("none-serial");
      }
    }
  });

  it("AC-2 — Preflight P.6 is marked deferred to 2.6.0-phase2-parallel-lanes", () => {
    for (const variant of VARIANTS) {
      expect(tiedTogether(variant.body, /P\.6/, [/2\.6\.0-phase2-parallel-lanes|이연/], 300), `${variant.id}: P.6 must be marked deferred`).toBe(true);
    }
  });

  it("AC-3 — wt-delegation-refused is declared at Preflight P.2 against a delegated pipeline --wt", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "wt-delegation-refused");
      expect(row, `${variant.id}: wt-delegation-refused must be declared`).toBeDefined();
      expect(row?.location).toMatch(/P\.2/);
      expect(row?.reason).toMatch(/--wt/);
    }
  });

  it("AC-4 — the orchestrator gives its own reason and does not restate the per-wave-accumulation one as its own", () => {
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(zero).toMatch(/cycle 스코프 worktree 를 lane 스코프 worktree 안에 중첩/);
      expect(zero).toMatch(/kiwi-wave-master[^\n]*per-wave 누적 근거를 본 스킬 자신의 근거로 다시 적지 않는다/);
    }
  });

  it("AC-5 — task-granularity isolation is named as re-entering in phase 2", () => {
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(tiedTogether(zero, /task 단위 격리/, [/2\.6\.0-phase2-parallel-lanes/, /재진입/], 400), `${variant.id}: the deferred half must be named`).toBe(true);
    }
  });
});

describe("FR-FLOW-093 — integration branch, committed run artifacts, and the abort report", () => {
  it("AC-1 — the branch is named, created or adopted at 0.b, and recorded in frozen", () => {
    for (const variant of VARIANTS) {
      expect(variant.body).toContain("kiwi/orch/{run_id}/integration");
      expect(tiedTogether(variant.body, /kiwi\/orch\/\{run_id\}\/integration/, [/--base-branch/, /frozen/], 600), `${variant.id}: base-branch and frozen must be tied to the branch name`).toBe(true);
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "integration-branch-unavailable");
      expect(row?.location, `${variant.id}: integration-branch-unavailable at 0.b`).toMatch(/0\.b/);
    }
  });

  it("AC-2 — never merged into the base branch, no PR, and the one obligation the orchestrator cannot discharge", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      expect(body).toMatch(/base 브랜치로 결코 병합하지 않고 pull request 를 결코 열지 않는다/);
      expect(tiedTogether(body, /이행할 수 없는 의무/, [/validate/, /sync-index/, /base 브랜치/], 400), `${variant.id}: the post-merge obligation must be stated`).toBe(true);
      const contract = section(variant.body, /^###\s*1\.1\b/m);
      expect(contract).toMatch(/병합 금지/);
      expect(contract).toMatch(/PR 생성 금지/);
    }
  });

  it("AC-3 — commit-run-artifacts stages an explicit pathspec and the two bulk forms are forbidden", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      expect(tiedTogether(body, /commit-run-artifacts/, [/명시 pathspec/], 900), `${variant.id}: the schedule must state an explicit pathspec`).toBe(true);
      const contract = section(variant.body, /^###\s*1\.1\b/m);
      expect(contract).toContain("git add -A");
      expect(contract).toContain("git commit -a");
    }
  });

  it("AC-4 — abort-run is distinct from halt, leaves the branch, writes the report, releases the lock", () => {
    for (const variant of VARIANTS) {
      const verb = verbSection(variant.body, "abort-run");
      expect(verb).toMatch(/`halt` 의 동의어가 \*\*아니다\*\*/);
      expect(verb).toContain("frozen.integration_branch");
      expect(verb).toContain("00.run-report.md");
      expect(verb).toMatch(/P\.5[^\n]*lock 을 해제/);
      expect(verbSection(variant.body, "halt")).toMatch(/`halt` 가 아니라 `abort-run`/);
    }
  });

  it("AC-5 — the phase-1 report contents are listed and the workspace rows are named phase 2", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      for (const row of [/통합 브랜치와 그 sha/, /어느 wave 가 `complete`/, /통합 브랜치에 남긴 커밋/, /run 을 끝낸 게이트/, /정확한 재개 명령/]) {
        expect(row.test(body), `${variant.id}: run report row ${row}`).toBe(true);
      }
      expect(tiedTogether(body, /workspace 행/, [/2\.6\.0-phase2-parallel-lanes/, /조용히 빠뜨리지 않는다/], 400), `${variant.id}: the omitted rows must be named as phase 2`).toBe(true);
    }
  });

  it("AC-6 — the three post-landing terminal halts are named and the replay gate is marked phase 2", () => {
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      expect(tiedTogether(body, /종단 중단/, [/wave-verify-fail-residual/, /post-merge-index-drift/, /design-contradiction-at-wave-boundary/], 500), `${variant.id}: the three terminal halts`).toBe(true);
      expect(tiedTogether(body, /srs-mutation-replay-failed/, [/2\.6\.0-phase2-parallel-lanes/], 200), `${variant.id}: the replay gate is phase 2`).toBe(true);
      expect(
        criticalGateRows(variant.body).map((row) => row.gateId),
        `${variant.id}: srs-mutation-replay-failed must not be declared in phase 1`
      ).not.toContain("srs-mutation-replay-failed");
    }
  });
});

describe("cross-cutting — the routing gates are declared outside critical_gates[]", () => {
  it("all four business-decision routing gates carry a severity row and none is in the table", () => {
    for (const variant of VARIANTS) {
      const severities = gateSeverityRows(variant.body);
      expect([...severities.map((row) => row.gateId)].sort(), `${variant.id}: the four routing gates`).toEqual([...ROUTING_GATE_IDS].sort());
      expect(
        severities.filter((row) => row.severity !== "business-decision").map((row) => row.gateId),
        `${variant.id}: every routing gate is business-decision`
      ).toEqual([]);

      const critical = new Set(criticalGateRows(variant.body).map((row) => row.gateId));
      for (const gateId of ROUTING_GATE_IDS) expect(critical.has(gateId), `${variant.id}: ${gateId} must stay out of critical_gates[]`).toBe(false);
    }
  });
});
