import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REPO_ROOT,
  criticalGateRows,
  gateSeverityRows,
  normaliseEol,
  orderedOffsets,
  readVariant,
  section,
  stripFrontmatter,
  tableRows,
  bareGateId
} from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-188
//
// R-ORCH and kiwi-wave-master run their waves through ONE shared contract. Every assertion below
// reads a structure the contract or the skill cannot move without saying something different — a
// numbered section, a `**PW-n` step marker, a code fence, a gate table row — rather than a bare
// token that some other paragraph could also satisfy.

const BUNDLES = ["claude", "codex", "etc"] as const;
const SKILLS = ["kiwi-orchestrator", "kiwi-wave-master"] as const;
const CONTRACT = "_shared/kiwi/parallel-waves.md";

function contractText(bundle: string): string {
  return normaliseEol(readVariant(`skills/${bundle}/${CONTRACT}`));
}

function skillBody(bundle: string, skill: string): string {
  return normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${skill}/SKILL.md`)));
}

/** `## N.` to the next `## ` heading. */
function numbered(text: string, n: number): string {
  return section(text, new RegExp(`^## ${n}\\.`));
}

/** The `**PW-k` step blocks of §5, keyed by k. A step ends where the next `**PW-` marker starts. */
function steps(text: string): Map<number, string> {
  const body = numbered(text, 5);
  const out = new Map<number, string>();
  const marks = [...body.matchAll(/^\*\*PW-(\d+)\b/gm)];
  marks.forEach((mark, index) => {
    const start = mark.index as number;
    const end = index + 1 < marks.length ? (marks[index + 1]?.index as number) : body.length;
    out.set(Number(mark[1]), body.slice(start, end));
  });
  return out;
}

function step(text: string, k: number): string {
  return steps(text).get(k) ?? "";
}

/** Code fences of a text, contents only. */
function fences(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1] as string);
}

/** The §0 table rows of a skill body. */
function sectionZeroRows(body: string): string {
  return body
    .split("\n")
    .filter((line) => /^\|\s*§0\./.test(line))
    .join("\n");
}

/** Gate ids of the contract's §4 table, the critical ones only. */
function contractGateIds(text: string): string[] {
  const ids: string[] = [];
  for (const row of tableRows(numbered(text, 4))) {
    for (const cell of (row.cells[0] ?? "").split("·")) {
      const id = bareGateId(cell);
      if (id) ids.push(id);
    }
  }
  return ids;
}

describe("FR-FLOW-188 — the corpus this suite reads", () => {
  it("FR-FLOW-188 AC-1 the contract ships in every rendering the skills ship in", () => {
    for (const bundle of BUNDLES) {
      expect(existsSync(path.join(REPO_ROOT, "skills", bundle, CONTRACT)), `${bundle}: ${CONTRACT}`).toBe(true);
      expect(/v\d+\.\d+\.\d+/.test(contractText(bundle)), `${bundle}: version marker`).toBe(true);
    }
  });
});

describe("FR-FLOW-188 AC-1 — the contract defines the run and both skills cite it", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-1 ${bundle}: the §5 steps run SRS, SDS, stage, dispatch, join, verdict, merge, replay, conformance, test sufficiency, promotion in that order`, () => {
      const text = contractText(bundle);
      const at = steps(text);
      expect([...at.keys()].length, `${bundle}: PW steps`).toBeGreaterThanOrEqual(15);
      // Each step is identified by what it runs, not by its heading prose.
      const anchors: Array<[string, (block: string) => boolean]> = [
        ["host-serial SRS authoring", (b) => b.includes("/kiwi-srs") && b.includes("/kiwi-srs-feasibility")],
        ["SDS authoring", (b) => fences(b).some((f) => f.includes('skill: "kiwi-sds"'))],
        ["stage freeze", (b) => /orchestrate freeze lanes/.test(b)],
        ["worker dispatch", (b) => /dispatch-lane/.test(b)],
        ["join", (b) => /collect-lane/.test(b)],
        ["host verdict", (b) => /verify-lane/.test(b)],
        ["merge", (b) => /integrate-lane/.test(b) && /--no-ff/.test(b)],
        ["replay", (b) => /orchestrate replay apply/.test(b)],
        ["design conformance", (b) => /verify-loop\.md §7/.test(b)],
        ["test sufficiency", (b) => b.includes("test-sufficiency.md") && /test-sufficiency-gap/.test(b)],
        ["promotion", (b) => /add_completed_work/.test(b)]
      ];
      const found = anchors.map(([name, match]) => {
        const hit = [...at.entries()].find(([, block]) => match(block));
        expect(hit, `${bundle}: no step carries ${name}`).toBeDefined();
        return (hit as [number, string])[0];
      });
      expect([...found].sort((a, b) => a - b), `${bundle}: step order ${JSON.stringify(found)}`).toEqual(found);
    });

    it(`FR-FLOW-188 AC-1 ${bundle}: SRS authoring runs one wave at a time and SDS authoring runs per wave in parallel`, () => {
      const text = contractText(bundle);
      const srs = step(text, 1);
      expect(/하나씩|one at a time/i.test(srs), `${bundle}: PW-1 names no one-at-a-time rule`).toBe(true);
      expect(/병렬로 돌리지 않는다|never (?:run|runs) (?:them |it )?in parallel/i.test(srs), `${bundle}: PW-1 does not forbid parallel SRS authoring`).toBe(true);
      const sds = step(text, 2);
      expect(/병렬|in parallel/i.test(sds), `${bundle}: PW-2 is not parallel`).toBe(true);
      expect(/\{run_id\}-wave-\{n\}/.test(fences(sds).join("\n")), `${bundle}: PW-2 call carries no wave sds-id`).toBe(true);
    });

    it(`FR-FLOW-188 AC-1 ${bundle}: dispatch goes into worktrees under the worktree-lane contract`, () => {
      const text = contractText(bundle);
      expect(text.includes("worktree-lane.md"), `${bundle}`).toBe(true);
      const worker = step(text, 6);
      expect(fences(worker).join("\n") + worker, `${bundle}: PW-6`).toMatch(/switch -C kiwi\/orch\/\{run_id\}\/\{laneId\} <base_sha>/);
      expect(worker, `${bundle}: PW-6 preflight`).toMatch(/orchestrate preflight[^\n]*--role lane/);
    });

    for (const skill of SKILLS) {
      it(`FR-FLOW-188 AC-1 ${bundle}/${skill}: §0 names the contract and the body does not restate the host verdict`, () => {
        const body = skillBody(bundle, skill);
        expect(sectionZeroRows(body).includes("parallel-waves.md"), `${bundle}/${skill}: §0 row`).toBe(true);
        // The verdict checklist and the worker's forbidden list are the contract's; a skill that
        // carries them again is the second copy AC-1 forbids.
        expect(/변경 경로 ⊆|changed paths ⊆/.test(body), `${bundle}/${skill}: restates the verdict checklist`).toBe(false);
        expect(/base\.\.head 커밋이 0 이 아니다|base\.\.head has at least one commit/.test(body), `${bundle}/${skill}: restates the verdict checklist`).toBe(false);
      });

      it(`FR-FLOW-188 AC-1 ${bundle}/${skill}: declares every critical gate the contract raises`, () => {
        const declared = new Set(criticalGateRows(skillBody(bundle, skill)).map((row) => row.gateId));
        const raised = contractGateIds(contractText(bundle));
        expect(raised.length, `${bundle}: contract gate table`).toBeGreaterThanOrEqual(10);
        const missing = raised.filter((id) => !declared.has(id));
        expect(missing, `${bundle}/${skill}: undeclared contract gates`).toEqual([]);
      });
    }
  }
});

describe("FR-FLOW-188 AC-2 — what a worker runs and what it never writes", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-2 ${bundle}: kiwi-pm with the four flags, then its own review without --close-reqs, then the test-sufficiency check`, () => {
      const worker = step(contractText(bundle), 6);
      const pm = fences(worker).find((f) => /\/kiwi-pm SDS_PATH=/.test(f)) ?? "";
      for (const flag of ["--no-final", "--no-pipeline-emit", "--commit-lane-work", "--defer-srs-mutation"]) {
        expect(pm.includes(flag), `${bundle}: worker kiwi-pm lacks ${flag}`).toBe(true);
      }
      // The worker runs its wave SDS: `<sds_path>` is the lane's file of the wave's SDS files (§3),
      // `docs/sds/{run_id}-wave-{n}.sds.md` when kiwi-sds did not split it.
      expect(pm, `${bundle}`).toMatch(/SDS_PATH=<sds_path>/);
      const stages = numbered(contractText(bundle), 3);
      const files = stages.split("\n").find((line) => line.includes("`<sds_path>`")) ?? "";
      expect(files, `${bundle}: §3 does not define <sds_path>`).not.toBe("");
      expect(files, `${bundle}: <sds_path> is not tied to the wave's SDS files`).toMatch(/sds_files/);
      expect(contractText(bundle), `${bundle}: the wave SDS path`).toContain("docs/sds/{run_id}-wave-{n}.sds.md");
      const review = fences(worker).find((f) => f.includes('skill: "kiwi-review-fix-loop"')) ?? "";
      expect(review, `${bundle}: worker review fence`).not.toBe("");
      expect(review.includes("--close-reqs"), `${bundle}: worker review carries --close-reqs`).toBe(false);
      expect(review, `${bundle}: worker review is not over its own window`).toMatch(/--base <base_sha> --head HEAD/);
      const offsets = orderedOffsets(worker, [/\/kiwi-pm SDS_PATH=/, /skill: "kiwi-review-fix-loop"/, /test-sufficiency\.md/]);
      expect(offsets.every((o) => o >= 0), `${bundle}: ${JSON.stringify(offsets)}`).toBe(true);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    });

    it(`FR-FLOW-188 AC-2 ${bundle}: a worker writes neither the SRS nor docs/spec, docs/sds, pipeline.jsonl or waves.jsonl`, () => {
      const roles = numbered(contractText(bundle), 1);
      const rule = roles.split("\n").find((line) => /^\*\*(워커는|A worker)/.test(line)) ?? "";
      expect(rule, `${bundle}: §1 carries no worker-writes rule`).not.toBe("");
      for (const target of ["SRS", "docs/spec/", "docs/sds/", "kiwi/pipeline.jsonl", "kiwi/waves.jsonl"]) {
        expect(rule.includes(target), `${bundle}: the worker rule omits ${target}`).toBe(true);
      }
      expect(/쓰지 않(는다|고)|never writes|does not write|writes neither/i.test(rule), `${bundle}: the rule is not a prohibition`).toBe(true);
    });
  }
});

describe("FR-FLOW-188 AC-3 — declared dependencies and write-set-disjoint stages", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-3 ${bundle}: the decomposition declares depends_on[] and a wave without it depends on every earlier wave`, () => {
      const decomposition = normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/wave-decomposition.md`));
      const line = decomposition.split("\n").find((l) => l.includes("depends_on[]")) ?? "";
      expect(line, `${bundle}: wave-decomposition.md names no depends_on[]`).not.toBe("");
      expect(/앞 wave 전부에 의존|depends on every earlier wave/.test(decomposition), `${bundle}: no default dependency`).toBe(true);
    });

    it(`FR-FLOW-188 AC-3 ${bundle}: a stage holds merged-dependency waves with pairwise disjoint SDS write sets`, () => {
      const stages = numbered(contractText(bundle), 3);
      expect(/앞 wave 전부에 의존|depends on every earlier wave/.test(stages), `${bundle}`).toBe(true);
      expect(/서로소|pairwise disjoint/.test(stages), `${bundle}: no disjointness`).toBe(true);
      expect(/Files[^\n]{0,20}∪[^\n]{0,20}Test Plan/.test(stages), `${bundle}: write set is not Files ∪ Test Plan`).toBe(true);
      const call = fences(stages).find((f) => f.includes("orchestrate schedule waves")) ?? "";
      for (const flag of ["--sds", "--depends", "--lanes", "--out {artifact_root}waves/stage-{s}/lanes.lock.json"]) {
        expect(call.includes(flag), `${bundle}: schedule waves call lacks ${flag}`).toBe(true);
      }
    });
  }
});

describe("FR-FLOW-188 AC-4 — a design mismatch goes to an independent subagent and is re-verified", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-4 ${bundle}: the conformance step names the independent fixer and the re-verification`, () => {
      const conformance = step(contractText(bundle), 13);
      const rule = conformance.split("\n").find((line) => /원래 워커가 아닌|not the original worker/.test(line)) ?? "";
      expect(rule, `${bundle}: PW-13 does not bar the original worker`).not.toBe("");
      expect(/독립 서브에이전트|independent subagent/.test(rule), `${bundle}`).toBe(true);
      expect(/다시 검증|re-verif/.test(rule), `${bundle}: no re-verification`).toBe(true);
      expect(/SRS/.test(rule) && /SDS/.test(rule), `${bundle}: the mismatch is not stated against the SRS and the SDS`).toBe(true);
    });
  }
});

describe("FR-FLOW-188 AC-5 — --serial runs every fan-out one at a time through the same executor", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-5 ${bundle}: the option, the natural-language triggers and every fan-out are named`, () => {
      const concurrency = numbered(contractText(bundle), 2);
      // The rule is a list item; the section heading names the flag too.
      const rule = concurrency.split("\n").find((line) => line.startsWith("- ") && line.includes("`--serial`")) ?? "";
      expect(rule, `${bundle}: §2 carries no --serial rule`).not.toBe("");
      // Quoted, because each trigger is a phrase the user says; the bare word "하나씩" also appears
      // in the rule's own sentence and would satisfy an unquoted check with the trigger deleted.
      for (const phrase of ["직렬로", "하나씩", "순서대로", "serially", "one at a time"]) {
        expect(rule.includes(`"${phrase}"`), `${bundle}: missing natural-language trigger "${phrase}"`).toBe(true);
      }
      for (const fanOut of [/워커|workers?/, /SDS/, /조사자|investigators?/, /검증자|verifiers?/]) {
        expect(fanOut.test(rule), `${bundle}: --serial omits ${fanOut}`).toBe(true);
      }
      expect(/동시성 1|concurrency 1/.test(rule), `${bundle}: not concurrency 1`).toBe(true);
      expect(/두 번째 경로를 두지 않는다|no second (?:executor )?path/.test(rule), `${bundle}: a second executor path is not refused`).toBe(true);
    });

    it(`FR-FLOW-188 AC-5 ${bundle}: a runtime without isolated workers runs serially and records why`, () => {
      const concurrency = numbered(contractText(bundle), 2);
      const rule = concurrency.split("\n").find((line) => /격리 워커를 띄울 수 없는 런타임|runtime that cannot spawn isolated workers/i.test(line)) ?? "";
      expect(rule, `${bundle}`).not.toBe("");
      expect(/직렬|serial/.test(rule) && /isolation\.reason/.test(rule), `${bundle}: serial fallback without a recorded reason`).toBe(true);
      expect(/worktree-serial/.test(rule) && /worktree-parallel/.test(rule), `${bundle}: profile values`).toBe(true);
    });

    for (const skill of SKILLS) {
      it(`FR-FLOW-188 AC-5 ${bundle}/${skill}: the options name --serial and the etc rendering defaults to it`, () => {
        const body = skillBody(bundle, skill);
        // An option is a table row the skill reads its flags from; a sentence that merely mentions
        // the flag — as the phase-1 deferral note did — is not one.
        expect(/^\|[^\n]*`--serial`[^\n]*\|$/m.test(body), `${bundle}/${skill}: --serial is not an option row`).toBe(true);
        if (bundle === "etc") {
          const line = body.split("\n").find((l) => l.includes("local-llm-profile.md") && l.includes("worktree-serial")) ?? "";
          expect(line, `${bundle}/${skill}: the etc rendering does not state its serial default`).not.toBe("");
        }
      });
    }

    it(`FR-FLOW-188 AC-5 ${bundle}: the orchestrator no longer lists --serial as deferred`, () => {
      const body = skillBody(bundle, "kiwi-orchestrator");
      expect(/이연된 옵션[^\n]*--serial|deferred options[^\n]*--serial/i.test(body), `${bundle}`).toBe(false);
    });
  }
});

describe("FR-FLOW-188 AC-6 — the host compares docs/spec and docs/sds around every dispatch", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-6 ${bundle}: the contract compares before and after and raises worker-touched-srs`, () => {
      const text = contractText(bundle);
      expect(step(text, 5), `${bundle}: PW-5 takes no snapshot`).toMatch(/git status --porcelain docs\/spec docs\/sds/);
      const verdict = step(text, 8);
      expect(verdict, `${bundle}: PW-8`).toMatch(/git status --porcelain docs\/spec docs\/sds/);
      expect(verdict.includes("worker-touched-srs"), `${bundle}: PW-8 raises no gate`).toBe(true);
    });

    for (const skill of SKILLS) {
      it(`FR-FLOW-188 AC-6 ${bundle}/${skill}: worker-touched-srs is a critical gate`, () => {
        const row = criticalGateRows(skillBody(bundle, skill)).find((r) => r.gateId === "worker-touched-srs");
        expect(row, `${bundle}/${skill}`).toBeDefined();
        expect((row as { reason: string }).reason, `${bundle}/${skill}`).toMatch(/docs\/spec/);
      });
    }
  }
});

describe("FR-FLOW-188 AC-7 — kiwi-wave-master runs its waves through the contract", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-7 ${bundle}: no per-wave kiwi-pipeline delegation remains`, () => {
      const body = skillBody(bundle, "kiwi-wave-master");
      expect(/skill: "kiwi-pipeline"/.test(body), `${bundle}: a kiwi-pipeline Skill call`).toBe(false);
      expect(/--cycle --from=feasibility/.test(body), `${bundle}: the per-wave cycle entry`).toBe(false);
      expect(/wave 별 [/$]kiwi-pipeline 을 (순차 |순서대로 )?(실행|호출|spawn)/.test(body), `${bundle}: per-wave pipeline prose`).toBe(false);
    });

    for (const skill of SKILLS) {
      it(`FR-FLOW-188 AC-7 ${bundle}/${skill}: partition-review-unrecorded is not a critical gate`, () => {
        const body = skillBody(bundle, skill);
        expect(criticalGateRows(body).map((r) => r.gateId), `${bundle}/${skill}`).not.toContain("partition-review-unrecorded");
      });
    }

    it(`FR-FLOW-188 AC-7 ${bundle}: the orchestrator declares partition-review-unrecorded as business-decision`, () => {
      const row = gateSeverityRows(skillBody(bundle, "kiwi-orchestrator")).find((r) => r.gateId === "partition-review-unrecorded");
      expect(row, `${bundle}`).toBeDefined();
      expect((row as { severity: string }).severity).toBe("business-decision");
    });
  }
});

describe("FR-FLOW-188 AC-8 — the host reviews only its own commits after a merge", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-8 ${bundle}: the stage-close review is windowed on the host's commits and the worker reviews its own window`, () => {
      const text = contractText(bundle);
      const close = step(text, 12);
      const rule = close.split("\n").find((line) => /호스트가 만든 커밋만|only the commits the host made/.test(line)) ?? "";
      expect(rule, `${bundle}: PW-12`).not.toBe("");
      expect(/워커의 창은 그 워커가|worker's window is reviewed by that worker|each worker already reviewed its own window/.test(rule), `${bundle}: the worker's own review is not named`).toBe(true);
      const review = fences(close).find((f) => f.includes('skill: "kiwi-review-fix-loop"')) ?? "";
      expect(review, `${bundle}: host review fence`).toMatch(/--base <(마지막 병합 커밋|last merge commit)>/);
      expect(review.includes("--close-reqs"), `${bundle}`).toBe(false);
    });
  }
});

describe("FR-FLOW-184 AC-5 — --sds-id replaces --plan-run-id", () => {
  const files = BUNDLES.flatMap((bundle) => [
    `skills/${bundle}/kiwi-orchestrator/SKILL.md`,
    `skills/${bundle}/kiwi-wave-master/SKILL.md`,
    `skills/${bundle}/_shared/kiwi/verify-loop.md`
  ]);
  for (const file of files) {
    it(`FR-FLOW-184 AC-5 ${file}: names --sds-id and not --plan-run-id`, () => {
      const text = readVariant(file);
      expect(text, file).not.toBe("");
      expect(text.includes("--plan-run-id"), `${file}: --plan-run-id survives`).toBe(false);
      expect(text.includes("--sds-id"), `${file}: --sds-id is not named`).toBe(true);
    });
  }
});
