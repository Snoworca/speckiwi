import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { scanProse } from "../../src/core/orchestrator/prose-gate.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  ORCHESTRATOR_VERBS,
  PHASE2_GATE_IDS,
  REPO_ROOT,
  RETIRED_VERBS,
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

  it("FR-FLOW-074 AC-2 — every enum verb has exactly one §V section and every §V section names an enum verb", () => {
    // The expectation is the shipped VERBS constant (the kernel marks no verb deferred from 4.0.0), so
    // a verb added to the runtime enum with no skill section fails here rather than silently passing.
    // The former `length === 38` pinned the phase-1 subset, which no longer exists; FR-FLOW-074 states
    // no count, so the size is not restated. The lane verbs are asserted members instead, because
    // FR-NODE-213 AC-5 puts them in the closed vocabulary and an enum losing them must fail here.
    for (const verb of ["sds-wave", "probe-isolation", "dispatch-lane", "collect-lane", "verify-lane", "remediate-lane", "integrate-lane", "replay-deferred-mutations", "release-lane"]) {
      expect(ORCHESTRATOR_VERBS, `the kernel enum must carry ${verb}`).toContain(verb);
    }

    for (const variant of VARIANTS) {
      const declared = verbSectionNames(variant.body);
      expect(new Set(declared).size, `${variant.id}: no duplicate §V section`).toBe(declared.length);
      expect([...declared].sort(), `${variant.id}: §V sections must equal the verb enum`).toEqual([...ORCHESTRATOR_VERBS].sort());
    }
  });

  it("FR-FLOW-074 AC-2 — no §V section names a verb 4.0.0 retired", () => {
    // Was "no §V section names a phase-2 verb": 4.0.0 made those verbs ordinary members (FR-NODE-213
    // AC-5), so the orphan-section guard now points at the verbs that left the enum.
    for (const variant of VARIANTS) {
      const declared = new Set(verbSectionNames(variant.body));
      for (const verb of RETIRED_VERBS) {
        expect(declared.has(verb), `${variant.id}: ${verb} left the enum in 4.0.0 and must have no §V section`).toBe(false);
      }
    }
  });

  it("FR-FLOW-074 AC-2 — every §V section declares one of the three recovery classes", () => {
    for (const variant of VARIANTS) {
      for (const verb of ORCHESTRATOR_VERBS) {
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

  it("FR-FLOW-074 AC-5 — no phase-2 gate identifier appears in any variant's critical_gates[]", () => {
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
    // src/core/orchestrator/prose-gate.ts is the detector this repository ships. A skill body that
    // fails it would teach the reader a rule the tool rejects. Note the detector has no caller in
    // `src/` — this assertion is over the shipped kernel, not over a wired gate.
    for (const variant of VARIANTS) {
      const findings = scanProse(variant.body).findings;
      expect(findings.map((finding) => `${finding.rule}@${finding.lines[0]}`), `${variant.id}: prose gate findings`).toEqual([]);
    }
  });
});

describe("D1 extraction — the orchestrator is the referrer that keeps the shared modules installed", () => {
  // `installSharedResources` copies only the `_shared/kiwi/` files some installed skill references and
  // deletes the rest (`pruneSharedMirror`). `run-ledger.md` is referenced by no other skill, so if this
  // §0 row is ever dropped the module is pruned out of the mirror on the next install and every rule it
  // carries — the resume-card schema, the verb enum, the recovery classes — disappears with it.
  const COLLECTOR = /_shared\/kiwi\/([A-Za-z0-9._/-]+)/g;

  const EXTRACTED = ["verify-loop.md", "wave-decomposition.md", "wave-srs-registration.md", "run-ledger.md"];

  /**
   * Every shipped rendering. @req FR-NODE-066 AC-1 — this list used to exclude the claude variant
   * because the collector matched the relative spelling alone, and that variant never uses it. The
   * collector now reads the reference rather than one spelling of it, so the exclusion is gone and
   * the claude rendering is held to the same requirement as the others.
   */
  const RELATIVE_RENDERINGS = ["skills/claude/kiwi-orchestrator/SKILL.md", "skills/codex/kiwi-orchestrator/SKILL.md", "skills/etc/kiwi-orchestrator/SKILL.md", ORCHESTRATOR_MIRROR];

  function collectedModules(relPath: string): Set<string> {
    const out = new Set<string>();
    for (const match of readVariant(relPath).matchAll(COLLECTOR)) {
      const reference = match[1]?.replace(/[),.;:'"`]+$/g, "");
      if (reference) out.add(reference.split("/").pop() as string);
    }
    return out;
  }

  it("the replicated collector pattern still matches the one install-skill.ts uses", () => {
    // A copied regex that drifts from its source proves nothing, so the source is asserted to still
    // carry it. If install-skill.ts changes the pattern, this fails rather than passing stale.
    const installer = readFileSync(path.join(REPO_ROOT, "src/core/skills/install-skill.ts"), "utf8");
    expect(installer, "install-skill.ts must still use the replicated reference pattern").toContain(COLLECTOR.source);
  });

  it("every `../`-form rendering keeps all four extracted modules alive through the prune", () => {
    for (const relPath of RELATIVE_RENDERINGS) {
      const kept = collectedModules(relPath);
      expect([...EXTRACTED].filter((module) => !kept.has(module)), `${relPath} would let these be pruned`).toEqual([]);
    }
  });

  it("the claude rendering names all four in §0 at the version each module declares", () => {
    // The claude tree writes `~/.claude/skills/_shared/…`, which the collector deliberately does not
    // match, so the prune never runs against it — but the §0 reference must still be there and current.
    const zero = section(stripFrontmatter(readVariant("skills/claude/kiwi-orchestrator/SKILL.md")), /^##\s*0\.\s/m);
    for (const module of EXTRACTED) {
      const declared = /^#\s+.*?\b(v\d+\.\d+\.\d+)/m.exec(readVariant(`skills/claude/_shared/kiwi/${module}`))?.[1];
      expect(declared, `${module} must declare a version in its own header`).toBeDefined();
      expect(zero, `§0 must reference ${module}`).toContain(`_shared/kiwi/${module}`);
      expect(
        new RegExp(`_shared/kiwi/${module.replace(".", "\\.")}\`? ${declared}`).test(zero),
        `§0 must cite ${module} at ${declared}, the version the module itself declares`
      ).toBe(true);
    }
  });
});

describe("gate ids are declared once — no table row shadows the §0.G lookup", () => {
  // The release parity extractor scrapes gate ids out of table rows across the whole body, and a text
  // assertion that resolves a gate by its first occurrence lands on whichever row comes first. So the
  // first table row carrying a bare gate id must be the authoritative one.
  it("every gate-shaped table row's first occurrence is in §0.G or §0.S", () => {
    for (const variant of VARIANTS) {
      const lines = variant.body.split("\n");
      const owningSection = (index: number): string => {
        for (let i = index; i >= 0; i -= 1) {
          const heading = /^#{2,4}\s+(\S+)/.exec(lines[i] ?? "");
          if (heading) return heading[1] as string;
        }
        return "(preamble)";
      };

      const declared = [...criticalGateRows(variant.body).map((row) => row.gateId), ...gateSeverityRows(variant.body).map((row) => row.gateId)];
      const offenders: string[] = [];
      for (const gateId of declared) {
        const firstRow = lines.findIndex((line) => new RegExp(`^\\|\\s*\\**\`${gateId}\`\\**\\s*\\|`).test(line.trim()));
        const owner = owningSection(firstRow);
        if (!["0.G", "0.S"].includes(owner)) offenders.push(`${gateId} first appears as a row in §${owner}`);
      }
      expect(offenders, `${variant.id}: a non-authoritative row must not precede the declaration`).toEqual([]);
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

  it("AC-2 — both preflight roots are supplied, and neither is described as defaulting", () => {
    // `orchestrate preflight` declares both as requiredOption, and P.1 compares one against the other:
    // if the skill told a resumed session either root could be left to the tool, the two sides of the
    // comparison would come from one source and the mismatch P.1 exists to catch could never fire.
    const cli = readFileSync(path.join(REPO_ROOT, "src/cli/commands/orchestrate.ts"), "utf8");
    expect(cli, "--git-root must still be a requiredOption for this rule to hold").toContain('.requiredOption("--git-root <path>"');
    expect(cli, "--mcp-root must still be a requiredOption for this rule to hold").toContain('.requiredOption("--mcp-root <path>"');

    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*1\.\s.*재개/m);
      expect(body).toMatch(/`--mcp-root` 와 `--git-root` 는 \*\*둘 다 필수이며 어느 쪽도 기본값을 갖지 않는다\*\*/);
      expect(/기본값|defaults to/.test(body.replace(/어느 쪽도 기본값을 갖지 않는다/, "")), `${variant.id}: no root may be described as defaulting`).toBe(false);
      // Step 2 is one command: the `--git-root` continuation line must follow `--mcp-root` directly.
      const step2 = /^2\. speckiwi orchestrate preflight[^\n]*\n([^\n]*)$/m.exec(body);
      expect(step2?.[1], `${variant.id}: the preflight invocation must not be split by prose`).toMatch(/^\s*--git-root/);
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

  it("AC-1 — the engine states both triggers, not just the finding_id one", () => {
    // A loop that terminates only on a re-opened finding still burns its cap on a hunk that is
    // reverted and re-applied, which is the same contested-finding shape by a different route.
    for (const agent of ["claude", "codex", "etc"]) {
      const engine = readVariant(`skills/${agent}/_shared/kiwi/verify-loop.md`);
      expect(engine.length, `${agent}: verify-loop.md must exist`).toBeGreaterThan(0);
      expect(
        tiedTogether(engine, /finding_id/, [/2 라운드 이상/, /닫혔다가 다시 열리/, /hunk 가 되돌려졌다가 다시 적용/], 500),
        `${agent}: both triggers must sit in one rule`
      ).toBe(true);
    }
  });

  it("AC-3 — the engine records BOTH outcome values, verdict and reason_class", () => {
    for (const agent of ["claude", "codex", "etc"]) {
      const engine = readVariant(`skills/${agent}/_shared/kiwi/verify-loop.md`);
      expect(
        tiedTogether(engine, /즉시 종료한다/, [/`verdict` 를 `fail-residual`/, /`reason_class` 를 `"oscillation"`/, /verification-oscillation/], 400),
        `${agent}: terminating must write verdict AND reason_class, not one of the two`
      ).toBe(true);
    }
  });

  it("FR-FLOW-086 AC-5 — the rule lives in the shared engine and the body states its D/W/P/F reach", () => {
    for (const agent of ["claude", "codex", "etc"]) {
      const engine = readVariant(`skills/${agent}/_shared/kiwi/verify-loop.md`);
      expect(engine, `${agent}: verify-loop.md must carry the oscillation rule`).toContain("verification-oscillation");
    }
    // Denominator-agnostic means every caller inherits it: the orchestrator body says so by naming
    // every loop it runs rather than attaching the rule to one of them. FR-FLOW-086 AC-5 names D, W,
    // H, P and F; 4.0.0 removed loop H with the handoff documents (FR-FLOW-187 AC-4), so the loops
    // are D, W, P and F.
    for (const variant of VARIANTS) {
      expect(
        tiedTogether(variant.body, /엔진에 있으므로/, [/D·W·P·F/, /모든 루프에 도달한다/], 300),
        `${variant.id}: the reach must be stated, not implied`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-088 — isolation stated in the skill's own section zero", () => {
  it("FR-FLOW-088 AC-1 — §0 states each wave's worker runs in its own worktree, dispatched by the shared contract, serial when isolation is unavailable", () => {
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(zero.length, `${variant.id}: a 0.* isolation section must exist`).toBeGreaterThan(0);
      // One sentence carries the worker, its worktree under worktree-lane.md and the dispatching
      // contract, so a §0 that names the files in unrelated sentences does not pass.
      expect(
        tiedTogether(zero, /wave 의 워커/, [/_shared\/kiwi\/worktree-lane\.md/, /워크트리/, /_shared\/kiwi\/parallel-waves\.md/, /dispatch/], 300),
        `${variant.id}: the worker, its worktree and the dispatching contract must be stated together`
      ).toBe(true);
      expect(
        tiedTogether(zero, /격리 워커를 띄울 수 없는 런타임/, [/직렬로 돌고/, /이유를 기록한다/], 120),
        `${variant.id}: the serial fallback and its recorded reason must be stated`
      ).toBe(true);
    }
  });

  it("FR-FLOW-088 AC-2/AC-3 (retired) — the constant none-serial profile and the P.6 deferral are gone", () => {
    // AC-2 and AC-3 retired in 4.0.0 (successor FR-FLOW-188): the constant host-root profile and the
    // deferral of P.6 to 2.6.0-phase2-parallel-lanes no longer describe the run, so their presence is
    // now the defect.
    for (const variant of VARIANTS) {
      expect(variant.body, `${variant.id}: none-serial left with host-root serial execution`).not.toContain("none-serial");
      expect(variant.body, `${variant.id}: nothing is deferred to the phase-2 target any more`).not.toContain("2.6.0-phase2-parallel-lanes");
    }
  });

  it("FR-FLOW-088 AC-4 — wt-delegation-refused is declared at Preflight P.2 against a delegated pipeline --wt", () => {
    for (const variant of VARIANTS) {
      const row = criticalGateRows(variant.body).find((candidate) => candidate.gateId === "wt-delegation-refused");
      expect(row, `${variant.id}: wt-delegation-refused must be declared`).toBeDefined();
      expect(row?.location).toMatch(/P\.2/);
      expect(row?.reason).toMatch(/--wt/);
    }
  });

  it("FR-FLOW-088 AC-5 — the orchestrator gives its own reason and states no per-wave-accumulation reason", () => {
    // Revised in 4.0.0: the old text disclaimed kiwi-wave-master's per-wave-accumulation reason by
    // name; the revised criterion asks only that no such reason be stated.
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(zero).toMatch(/cycle 스코프 worktree 를 lane 스코프 worktree 안에 중첩/);
      expect(zero, `${variant.id}: §0 must state no per-wave-accumulation reason`).not.toMatch(/누적/);
    }
  });

  it("FR-FLOW-088 AC-6 (retired) — task-granularity isolation is not announced as re-entering", () => {
    // Retired in 4.0.0 (successor FR-FLOW-187): isolation is per wave, one worker per wave, and the
    // intra-wave partition that task-granularity isolation would have served is gone.
    for (const variant of VARIANTS) {
      const zero = section(variant.body, /^##\s*0\.I\b/m);
      expect(zero, `${variant.id}: task-granularity isolation does not re-enter`).not.toMatch(/task 단위 격리/);
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

  it("FR-FLOW-093 AC-7 — the run report lists its contents, the worker workspace row included", () => {
    // FR-FLOW-093 AC-7 (not revised) says the workspace rows are omitted and named as phase-2 content.
    // 4.0.0 dispatches a worker per wave into a worktree on every run (FR-FLOW-188 AC-1), so the rows
    // exist and the report lists them: unmerged worker branches and unreturned worker worktrees.
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      const report = body.split("\n").filter((line) => line.startsWith("- "));
      for (const row of [/통합 브랜치와 그 sha/, /어느 wave 가 `complete`/, /통합 브랜치에 남긴 커밋/, /run 을 끝낸 게이트/, /정확한 재개 명령/]) {
        expect(report.some((line) => row.test(line)), `${variant.id}: run report row ${row}`).toBe(true);
      }
      expect(
        report.some((line) => /병합되지 않은 워커 브랜치/.test(line) && /워커 워크트리/.test(line)),
        `${variant.id}: the report must list unmerged worker branches and unreturned worker worktrees`
      ).toBe(true);
      expect(body, `${variant.id}: the workspace rows are no longer phase-2 content`).not.toContain("2.6.0-phase2-parallel-lanes");
    }
  });

  it("FR-FLOW-093 AC-8 — the post-landing terminal halts are named and the replay gate is declared", () => {
    // FR-FLOW-093 AC-8 (not revised) marks srs-mutation-replay-failed as phase 2. Replaying deferred SRS
    // mutations on the host is part of every 4.0.0 run (FR-FLOW-083 AC-7 retired, successor FR-FLOW-188
    // AC-1), so the gate is a fourth terminal halt and is declared in critical_gates[].
    for (const variant of VARIANTS) {
      const body = section(variant.body, /^##\s*15\.\s/m);
      expect(
        tiedTogether(body, /종단 중단/, [/wave-verify-fail-residual/, /post-merge-index-drift/, /design-contradiction-at-wave-boundary/, /srs-mutation-replay-failed/], 500),
        `${variant.id}: the four terminal halts`
      ).toBe(true);
      expect(
        criticalGateRows(variant.body).map((row) => row.gateId),
        `${variant.id}: srs-mutation-replay-failed must be declared`
      ).toContain("srs-mutation-replay-failed");
    }
  });
});

describe("cross-cutting — the routing gates are declared outside critical_gates[]", () => {
  it("all four business-decision routing gates and partition-review-unrecorded carry a severity row and none is in the table", () => {
    // FR-FLOW-188 AC-7 made partition-review-unrecorded a business-decision gate, so §0.S carries it
    // beside the four routing gates.
    const businessDecision = [...ROUTING_GATE_IDS, "partition-review-unrecorded"];
    for (const variant of VARIANTS) {
      const severities = gateSeverityRows(variant.body);
      expect([...severities.map((row) => row.gateId)].sort(), `${variant.id}: the business-decision gates`).toEqual([...businessDecision].sort());
      expect(
        severities.filter((row) => row.severity !== "business-decision").map((row) => row.gateId),
        `${variant.id}: every §0.S gate is business-decision`
      ).toEqual([]);

      const critical = new Set(criticalGateRows(variant.body).map((row) => row.gateId));
      for (const gateId of businessDecision) expect(critical.has(gateId), `${variant.id}: ${gateId} must stay out of critical_gates[]`).toBe(false);
    }
  });
});
