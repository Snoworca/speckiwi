import { describe, expect, it } from "vitest";

import { criticalGateRows, section, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile, skillSection } from "./kiwi-renderings.js";

// @req FR-FLOW-185 — kiwi-pm and kiwi-coder implement an agreed SDS as one unit of execution.
//
// Both skills are instruction text, so the contract is read from the shipped renderings: the three
// under `skills/` and the `.agents` mirror, which renders the codex variant and goes red until it is
// regenerated. codex and etc split each skill across `SKILL.md` and `references/*.md`; a section is
// looked up in whichever file of the skill carries it, and a whole-skill check reads every file.
//
// Assertions are scoped to the section or line that states the rule, because a token found anywhere
// in a 900-line body proves only that the token exists somewhere.

const PM = "kiwi-pm";
const CODER = "kiwi-coder";

/** Every markdown file of one skill in one rendering, SKILL.md first, EOL-normalised. */
function files(rendering: string, skill: string): Array<{ relPath: string; text: string }> {
  const paths = markdownFiles(rendering, skill).sort((a, b) => Number(!a.endsWith("/SKILL.md")) - Number(!b.endsWith("/SKILL.md")));
  return paths.map((relPath) => ({ relPath, text: readRepoFile(relPath).replace(/\r\n/g, "\n") }));
}

function whole(rendering: string, skill: string): string {
  return files(rendering, skill)
    .map((doc) => doc.text)
    .join("\n\n");
}

/** The first file of the skill that carries a heading matching `heading`, cut at that section's end. */
function sectionOf(rendering: string, skill: string, heading: RegExp): string {
  for (const doc of files(rendering, skill)) {
    const found = section(doc.text, heading);
    if (found !== "") return found;
  }
  return "";
}

function lineWith(text: string, re: RegExp): string {
  return text.split("\n").find((line) => re.test(line)) ?? "";
}

/** Words that turn a SHALL into a MAY. */
const HEDGE = /수 있다|해도 된다|권장|바람직|가능하면|되도록|경우에 따라|가급적/;

/** `/kiwi-sds` in the claude spelling, `$kiwi-sds` in codex and etc. */
const SDS_SKILL = /[/$]kiwi-sds\b/;

describe("FR-FLOW-185 AC-1 — kiwi-pm requires an agreed SDS and halts toward kiwi-sds without one", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(RENDERINGS)("%s: the required input is SDS_PATH, an agreed docs/sds SDS", (rendering) => {
    const input = sectionOf(rendering, PM, /^###\s*1\.1\s/);
    expect(input, `${rendering}: kiwi-pm §1.1 must exist`).not.toBe("");
    expect(input).toContain("`SDS_PATH`");
    expect(input).toMatch(/docs\/sds\/[^\s`]*\.sds\.md/);
    expect(input).toContain("`agreed`");
  });

  it.each(RENDERINGS)("%s: a missing SDS_PATH halts and points to kiwi-sds", (rendering) => {
    const input = sectionOf(rendering, PM, /^###\s*1\.1\s/);
    const rule = lineWith(input, /SDS_PATH[^\n]*(?:없으면|부재)/);
    expect(rule, `${rendering}: §1.1 must state what happens without SDS_PATH`).not.toBe("");
    expect(rule, `${rendering}: the missing-input branch must halt`).toMatch(/HALT/);
    expect(rule, `${rendering}: the halt must point to kiwi-sds`).toMatch(SDS_SKILL);
    expect(HEDGE.test(rule), `${rendering}: the halt must be absolute`).toBe(false);
  });

  it.each(RENDERINGS)("%s: an SDS that is not agreed, or fails sds check, halts too", (rendering) => {
    const input = sectionOf(rendering, PM, /^###\s*1\.1\s/);
    const rule = lineWith(input, /`agreed`[^\n]*(?:아니|않)/);
    expect(rule, `${rendering}: §1.1 must refuse an SDS whose Status is not agreed`).not.toBe("");
    expect(rule).toMatch(/HALT/);
    expect(rule).toMatch(/sds check/);
    expect(rule).toMatch(SDS_SKILL);
  });

  it.each(RENDERINGS)("%s: the CLI summary opens on SDS_PATH", (rendering) => {
    const summary = sectionOf(rendering, PM, /^###\s*1\.3\s/);
    expect(summary, `${rendering}: kiwi-pm §1.3 must exist`).not.toBe("");
    expect(summary).toMatch(/[/$]kiwi-pm SDS_PATH=docs\/sds\//);
  });

  it.each(RENDERINGS)("%s: kiwi-pm names no plan input", (rendering) => {
    const text = whole(rendering, PM);
    for (const token of ["PLAN_PATH", "SIDECAR_PATH", "plan_contract", "sidecar", "plan.md"]) {
      expect(text.includes(token), `${rendering}: kiwi-pm still names ${token}`).toBe(false);
    }
  });
});

describe("FR-FLOW-185 AC-2 — one SDS is one kiwi-coder run", () => {
  it.each(RENDERINGS)("%s: §0.7 declares the unit", (rendering) => {
    const row = tableRows(sectionOf(rendering, PM, /^##\s*0\.\s/)).find((entry) => entry.cells[0] === "§0.7");
    expect(row, `${rendering}: kiwi-pm must keep its §0.7 unit row`).toBeDefined();
    const cell = row?.cells.join(" | ") ?? "";
    expect(cell).toContain("SDS 하나");
    expect(cell).toContain("kiwi-coder 실행 하나");
    expect(HEDGE.test(cell)).toBe(false);
  });

  it.each(RENDERINGS)("%s: pm-state.json records the SDS path and its sha256", (rendering) => {
    const schema = sectionOf(rendering, PM, /^###\s*2\.2\s/);
    expect(schema, `${rendering}: kiwi-pm §2.2 must exist`).not.toBe("");
    expect(schema).toContain('"sds_path"');
    expect(schema).toContain('"sds_sha256"');
    for (const stale of ['"plan_sha256"', '"sidecar_sha256"', '"plan_path"', '"tasks"']) {
      expect(schema.includes(stale), `${rendering}: pm-state still records ${stale}`).toBe(false);
    }
  });

  it.each(RENDERINGS)("%s: --from-task and the handoff execution set are gone", (rendering) => {
    const text = whole(rendering, PM);
    for (const token of ["--from-task", "task_ids[]", "--handoff", "TASK_FILTER"]) {
      expect(text.includes(token), `${rendering}: kiwi-pm still names ${token}`).toBe(false);
    }
  });

  it.each(RENDERINGS)("%s: the coder spawn prompt carries SDS_PATH", (rendering) => {
    const text = whole(rendering, PM);
    expect(lineWith(text, /^- SDS_PATH=/), `${rendering}: the spawn prompt must carry an SDS_PATH line`).not.toBe("");
  });

  it.each(RENDERINGS)("%s: kiwi-coder names no plan input or task selector", (rendering) => {
    const text = whole(rendering, CODER);
    for (const token of ["PLAN_PATH", "SIDECAR_PATH", "TASK_FILTER", "PHASE_FROM", "plan_contract", "sidecar"]) {
      expect(text.includes(token), `${rendering}: kiwi-coder still names ${token}`).toBe(false);
    }
  });
});

describe("FR-FLOW-185 AC-3 — kiwi-coder implements the SDS test-first and checks the code against it", () => {
  it.each(RENDERINGS)("%s: the required input is SDS_PATH", (rendering) => {
    const input = sectionOf(rendering, CODER, /^###\s*1\.1\s/);
    expect(input, `${rendering}: kiwi-coder §1.1 must exist`).not.toBe("");
    expect(input).toContain("`SDS_PATH`");
    expect(input).toMatch(SDS_SKILL);
  });

  it.each(RENDERINGS)("%s: cites the SDS grammar by path instead of restating it", (rendering) => {
    expect(whole(rendering, CODER)).toMatch(/docs\/rule\/SDS-MD-Rules-v[\d.]+\.md` §9/);
  });

  it.each(RENDERINGS)("%s: the test author reads the three SDS sections and the SRS ACs of the @req set", (rendering) => {
    const authoring = flat(sectionOf(rendering, CODER, /^###\s*4\.1\s/));
    expect(authoring, `${rendering}: kiwi-coder §4.1 must exist`).not.toBe(" ");
    for (const part of ["Interfaces", "Acceptance Contracts", "Test Plan"]) {
      expect(authoring.includes(part), `${rendering}: the test author must read ${part}`).toBe(true);
    }
    expect(authoring).toMatch(/`@req`/);
    expect(authoring).toMatch(/get_requirement/);
  });

  it.each(RENDERINGS)("%s: every test line cites a requirement AC or an SDS-AC", (rendering) => {
    const authoring = sectionOf(rendering, CODER, /^###\s*4\.1\s/);
    const rule = lineWith(authoring, /`<REQ-ID> AC-<n>`/);
    expect(rule, `${rendering}: §4.1 must state the test citation rule`).not.toBe("");
    expect(rule).toContain("`SDS-AC-<n>`");
    expect(rule).toMatch(/테스트 줄/);
    expect(HEDGE.test(rule), `${rendering}: the citation rule must be absolute`).toBe(false);
  });

  it.each(RENDERINGS)("%s: the tests are written and seen failing before implementation", (rendering) => {
    const flow = sectionOf(rendering, CODER, /^##\s*2\.\s/);
    const red = flow.indexOf("red");
    const impl = flow.indexOf("구현");
    expect(red, `${rendering}: the phase flow must confirm red`).toBeGreaterThan(-1);
    expect(impl).toBeGreaterThan(-1);
    expect(red, `${rendering}: red must come before implementation in the phase flow`).toBeLessThan(flow.indexOf("Phase 2"));
  });

  it.each(RENDERINGS)("%s: the SDS-code match gate checks files, symbols and ← caller connections", (rendering) => {
    const loop = sectionOf(rendering, CODER, /^###\s*5\.1\s/);
    const gate = loop.split(/\(d\) SDS-코드 일치 게이트/)[1]?.split(/\(e\)/)[0] ?? "";
    expect(gate, `${rendering}: §5.1 must carry the (d) SDS-code match gate`).not.toBe("");
    const g = flat(gate);
    expect(g).toMatch(/Files/);
    expect(g).toMatch(/심볼/);
    expect(g).toMatch(/`← caller`/);
    // Research 33 §3.3 check 다: a reference counts only outside the definition and the import lines —
    // pinned on the `← caller` line itself, so a neighbouring "정의" or "import" cannot stand in for it.
    const caller = lineWith(gate, /`← caller`/);
    expect(caller, `${rendering}: gate (d) must state how a ← caller connection is counted`).toMatch(/정의[^\n]*import[^\n]*밖/);
    expect(HEDGE.test(caller)).toBe(false);
    expect(g).toMatch(/CRITICAL/);
  });

  it.each(RENDERINGS)("%s: the plan-code gate is gone and its gate id follows", (rendering) => {
    const text = whole(rendering, CODER);
    expect(text.includes("계획-코드"), `${rendering}: kiwi-coder still names the plan-code gate`).toBe(false);
    const ids = files(rendering, CODER).flatMap((doc) => criticalGateRows(doc.text).map((row) => row.gateId));
    expect(ids).toContain("zero-tolerance-sds-code-mismatch");
    expect(ids).not.toContain("zero-tolerance-plan-code-mismatch");
  });
});

describe("FR-FLOW-185 AC-4 — standalone kiwi-pm always hands off to kiwi-review-fix-loop", () => {
  it.each(RENDERINGS)("%s: §6.4 hands off with no later or skip choice", (rendering) => {
    const handoff = sectionOf(rendering, PM, /^###\s*6\.4\s/);
    expect(handoff, `${rendering}: kiwi-pm §6.4 must exist`).not.toBe("");
    expect(handoff).toContain("kiwi-review-fix-loop");
    expect(handoff).toContain("--close-reqs");
    const always = lineWith(handoff, /(?:항상|언제나)[^\n]*kiwi-review-fix-loop|kiwi-review-fix-loop[^\n]*(?:항상|언제나)/);
    expect(always, `${rendering}: the hand-off must be stated as unconditional`).not.toBe("");
    expect(HEDGE.test(always)).toBe(false);
    for (const choice of ["나중에", "3지선다", "(3) skip"]) {
      expect(handoff.includes(choice), `${rendering}: §6.4 still offers "${choice}"`).toBe(false);
    }
  });

  it.each(RENDERINGS)("%s: the hand-off carries the SDS scope to the review", (rendering) => {
    const handoff = flat(sectionOf(rendering, PM, /^###\s*6\.4\s/));
    expect(handoff).toContain("--req-filter");
    expect(handoff).toMatch(/--sds\b/);
  });

  it.each(RENDERINGS)("%s: worker and --no-final runs leave the review to the caller", (rendering) => {
    const handoff = sectionOf(rendering, PM, /^###\s*6\.4\s/);
    const rule = lineWith(handoff, /--no-final/);
    expect(rule, `${rendering}: §6.4 must name the --no-final exception`).not.toBe("");
    expect(rule).toMatch(/호출자/);
    expect(handoff).toContain("--review-hop-owned-by-parent");
  });
});

describe("FR-FLOW-183 AC-1 · AC-3 — the standalone hand-off closes the SDS around the promoting review", () => {
  /**
   * Each skill call of §6.4, in order, with its args flattened: `Skill(skill="…", args="…")` in the
   * claude spelling, `Use $… with …` on one line in codex and etc.
   */
  function calls(rendering: string): Array<{ skill: string; args: string }> {
    const handoff = sectionOf(rendering, PM, /^###\s*6\.4\s/);
    const call = /Skill\(skill="([a-z-]+)",\s*args="([\s\S]*?)"\)|^Use \$([a-z-]+) with (.*)$/gm;
    return [...handoff.matchAll(call)].map((m) => ({
      skill: (m[1] ?? m[3]) as string,
      args: flat((m[2] ?? m[4]) as string),
    }));
  }

  it.each(RENDERINGS)("%s: FR-FLOW-183 AC-1: kiwi-sds --close moves the SDS before the review that promotes", (rendering) => {
    const order = calls(rendering);
    const review = order.findIndex((call) => call.skill === "kiwi-review-fix-loop");
    expect(review, `${rendering}: §6.4 must call kiwi-review-fix-loop`).toBeGreaterThan(0);
    const before = order.slice(0, review).filter((call) => call.skill === "kiwi-sds");
    expect(before.length, `${rendering}: kiwi-sds --close must run before the promoting review`).toBe(1);
    expect(before[0]?.args).toMatch(/^--close \{state\.run_id\}/);
  });

  it.each(RENDERINGS)("%s: FR-FLOW-183 AC-3: kiwi-sds --close runs again after the review to delete the file", (rendering) => {
    const order = calls(rendering);
    const review = order.findIndex((call) => call.skill === "kiwi-review-fix-loop");
    const after = order.slice(review + 1).filter((call) => call.skill === "kiwi-sds");
    expect(after.length, `${rendering}: kiwi-sds --close must run after the review`).toBe(1);
    expect(after[0]?.args).toMatch(/^--close \{state\.run_id\}/);
  });

  it.each(RENDERINGS)("%s: FR-FLOW-183 AC-1: the kiwi-pm event hints the kiwi-sds close first when the review will promote", (rendering) => {
    const emit = sectionOf(rendering, PM, /^##\s*10\.\s/);
    const hint = lineWith(emit, /`next_hint`/);
    expect(hint, `${rendering}: §10 must state next_hint`).not.toBe("");
    expect(hint).toMatch(/"kiwi-sds"[^\n]*CLOSE_SAFE|CLOSE_SAFE[^\n]*"kiwi-sds"/);
    expect(hint).toMatch(/"kiwi-review-fix-loop"/);
    expect(HEDGE.test(hint)).toBe(false);
    // The event is written before the hand-off runs, so it does not point back at a hop already done.
    const text = whole(rendering, PM);
    const emitAt = text.search(/^\s*EMIT_PIPELINE_EVENT\(/m);
    const handAt = text.search(/^\s*HAND_OFF_REVIEW\(/m);
    expect(emitAt, `${rendering}: MAIN must emit the pipeline event`).toBeGreaterThan(-1);
    expect(emitAt).toBeLessThan(handAt);
  });

  it.each(RENDERINGS)("%s: FR-FLOW-183 AC-1: a move that stopped keeps the review from promoting", (rendering) => {
    const handoff = sectionOf(rendering, PM, /^###\s*6\.4\s/);
    const moved = lineWith(handoff, /^MOVED\s*=/);
    expect(moved, `${rendering}: §6.4 must derive MOVED from the SDS status after the first close`).toMatch(/CLOSE_SAFE/);
    expect(moved).toMatch(/check_sds[^\n]*"closed"/);
    const review = calls(rendering).find((call) => call.skill === "kiwi-review-fix-loop");
    expect(review?.args, `${rendering}: --close-reqs must hang on MOVED, not on CLOSE_SAFE alone`).toMatch(/--close-reqs' if MOVED/);
  });

  it.each(RENDERINGS)("%s: FR-FLOW-183 AC-1: the close-out runs only when the review promotes", (rendering) => {
    // Closing an SDS whose requirements are not promoted would leave a `closed` SDS the next
    // kiwi-pm run refuses as not agreed.
    const handoff = sectionOf(rendering, PM, /^###\s*6\.4\s/);
    const rule = lineWith(handoff, /kiwi-sds --close/);
    expect(rule, `${rendering}: §6.4 must state when kiwi-sds --close runs`).not.toBe("");
    expect(rule).toMatch(/CLOSE_SAFE/);
    expect(rule).toMatch(/--close-reqs/);
    expect(HEDGE.test(rule)).toBe(false);
  });
});

describe("FR-FLOW-185 AC-5 — the delegation flags keep their meaning", () => {
  const FLAGS = ["--no-final", "--no-pipeline-emit", "--commit-lane-work", "--session-suffix", "--defer-srs-mutation"];

  it.each(RENDERINGS)("%s: kiwi-pm's CLI summary and delegation section list all five", (rendering) => {
    const summary = sectionOf(rendering, PM, /^###\s*1\.3\s/);
    const delegation = sectionOf(rendering, PM, /^###\s.*오케스트레이션 위임 플래그/);
    expect(delegation, `${rendering}: kiwi-pm must keep its delegation-flag section`).not.toBe("");
    for (const flag of FLAGS) {
      expect(summary.includes(flag), `${rendering}: §1.3 lost ${flag}`).toBe(true);
      expect(delegation.includes(flag), `${rendering}: the delegation section lost ${flag}`).toBe(true);
    }
  });
});

describe("FR-FLOW-185 AC-6 — one TDD verifier by default, two in parallel only under --max", () => {
  function tddCell(rendering: string, mode: RegExp): string {
    const rows = tableRows(sectionOf(rendering, CODER, /^###\s*1\.3\s/));
    const header = rows[0]?.cells ?? [];
    const column = header.findIndex((cell) => /TDD 검증/.test(cell));
    const row = rows.find((entry) => mode.test(entry.cells[0] ?? ""));
    return column < 0 || row === undefined ? "" : (row.cells[column] ?? "");
  }

  it.each(RENDERINGS)("%s: the mode matrix gives Normal one TDD verifier and --max two", (rendering) => {
    expect(tddCell(rendering, /Normal/), `${rendering}: the Normal row must state one TDD verifier`).toMatch(/×\s*1\b/);
    expect(tddCell(rendering, /`--max`/), `${rendering}: the --max row must state two TDD verifiers`).toMatch(/×\s*2\b/);
  });

  it.each(RENDERINGS)("%s: §4.2 states the count for both modes", (rendering) => {
    const verify = sectionOf(rendering, CODER, /^###\s*4\.2\s/);
    const def = lineWith(verify, /기본[^\n]*서브에이전트 1 개/);
    expect(def, `${rendering}: §4.2 must state one verifier subagent by default`).not.toBe("");
    const max = lineWith(verify, /`--max`[^\n]*2 개[^\n]*병렬/);
    expect(max, `${rendering}: §4.2 must state two parallel verifiers under --max`).not.toBe("");
  });

  it.each(RENDERINGS)("%s: every sentence giving the default TDD verifier count says one", (rendering) => {
    // A second statement of the default elsewhere (§0, §1.3 prose) must not contradict §4.2.
    const counts = [...whole(rendering, CODER).matchAll(/기본[^\n|]{0,20}서브에이전트\s*(\d+)\s*개/g)].map((m) => m[1]);
    expect(counts.length, `${rendering}: kiwi-coder must state the default TDD verifier count`).toBeGreaterThan(0);
    expect(counts.filter((n) => n !== "1"), `${rendering}: a default TDD verifier count other than one`).toEqual([]);
  });

  it.each(RENDERINGS)("%s: no sentence still promises two TDD verifiers in every mode", (rendering) => {
    const text = whole(rendering, CODER);
    for (const stale of ["Sonnet×2", "standard×2", "Sonnet 2 인스턴스", "모든 모드 공통"]) {
      expect(text.includes(stale), `${rendering}: kiwi-coder still says "${stale}"`).toBe(false);
    }
  });
});

describe("FR-FLOW-185 AC-2 · FR-NODE-211 AC-1 (skill side) — kiwi-pm and kiwi-coder call no tool FR-NODE-211 AC-1 removes", () => {
  const REMOVED = [
    "workflow_plan_status",
    "workflow_plan_task",
    "workflow_next_plan_task",
    "workflow_resume_hint",
    "workflow_doctor",
    "workflow_diff",
    "workflow_schema_check",
    "workflow_task_check",
    "workflow_task_uncheck",
    "workflow_checklist_set",
    "workflow_task_status_set",
    "preview_legacy_workflow_migration"
  ];

  for (const skill of [PM, CODER]) {
    it.each(RENDERINGS)(`%s/${skill} names none of the removed tools`, (rendering) => {
      const text = whole(rendering, skill);
      expect(text).not.toBe("");
      const named = REMOVED.filter((tool) => new RegExp(`\\b${tool}\\b`).test(text));
      expect(named, `${rendering}/${skill} still names removed tools`).toEqual([]);
    });
  }
});

describe("FR-FLOW-185 AC-2 — the shared --auto catalog stops recommending the task-dependency gate", () => {
  it.each(RENDERINGS)("%s: _shared/kiwi/auto-option.md names no depends-on-violation", (rendering) => {
    // One SDS is one kiwi-coder run, so no task dependency is left for kiwi-pm to violate, and
    // kiwi-pm dropped the row (FR-FLOW-053 AC-4 retired). A catalog that still recommends it hands
    // the next skill author a gate with nothing to fire it.
    const text = readRepoFile(`${rendering}/_shared/kiwi/auto-option.md`);
    expect(text.length, `${rendering}: auto-option.md is missing`).toBeGreaterThan(0);
    expect(text).not.toContain("depends-on-violation");
  });
});

describe("FR-FLOW-185 AC-4 — a caller that owns the review hop suppresses kiwi-pm's hand-off", () => {
  /** A hand-off exception line of §6.4: the flag, then what kiwi-pm does, then who runs the review. */
  function exception(rendering: string, flag: string): string {
    return lineWith(sectionOf(rendering, PM, /^###\s*6\.4\s/), new RegExp(`^- \`${flag}\``));
  }

  it.each(RENDERINGS)("FR-FLOW-185 AC-4 %s: an explicit --review-hop-owned-by-parent means no hand-off, and the parent runs the review", (rendering) => {
    const rule = exception(rendering, "--review-hop-owned-by-parent");
    expect(rule, `${rendering}: §6.4 has no rule for --review-hop-owned-by-parent`).not.toBe("");
    expect(rule, `${rendering}: the flag does not suppress the hand-off`).toMatch(/hand-off 하지 않는다/);
    expect(rule, `${rendering}: the rule does not name the parent that runs the review`).toMatch(/부모\(`kiwi-pipeline` 사이클\)가 이 실행 뒤 리뷰 홉을 직접 돈다/);
    expect(rule, `${rendering}: the suppression is not tied to the explicit argument`).toMatch(/명시적 인자로/);
    expect(HEDGE.test(rule)).toBe(false);
  });

  it.each(RENDERINGS)("FR-FLOW-185 AC-4 %s: --no-final (a worker run) likewise does not hand off", (rendering) => {
    const rule = exception(rendering, "--no-final");
    expect(rule, `${rendering}: §6.4 has no rule for --no-final`).toMatch(/hand-off 하지 않는다/);
    expect(rule).toMatch(/워커 실행/);
  });

  it.each(RENDERINGS)("FR-FLOW-185 AC-4 %s: kiwi-pipeline passes the flag to kiwi-pm and runs the review hop itself", (rendering) => {
    const cycle = skillSection(rendering, "kiwi-pipeline", /^###\s*2\.5\.4\b/);
    const call = lineWith(cycle, /^`kiwi-pm` 은 /);
    expect(call, `${rendering}: kiwi-pipeline §2.5.4 does not say how kiwi-pm is called`).toContain("--review-hop-owned-by-parent");
    expect(call, `${rendering}: kiwi-pipeline does not say kiwi-pm's own hand-off stays off`).toMatch(/`kiwi-pm` 의 자체 hand-off 는 돌지 않는다/);
    const review = lineWith(cycle, /^3\.\s/);
    expect(review, `${rendering}: the cycle's item 3 is not its own review hop`).toMatch(/^3\. 코드 리뷰 홉 `kiwi-review-fix-loop --close-reqs/);
  });
});

describe("FR-FLOW-185 AC-6 — the etc local-LLM profile runs the two verifiers one after another, with --max as its default", () => {
  const SEQUENTIAL = /한 번에 하나씩/;

  function maxLine(rendering: string): string {
    return lineWith(sectionOf(rendering, CODER, /^###\s*4\.2\s/), /`--max`[^\n]*2 개/);
  }

  it.each(RENDERINGS)("FR-FLOW-185 AC-6 %s: §4.2 states how the two --max verifiers run in this rendering", (rendering) => {
    const line = maxLine(rendering);
    expect(line, `${rendering}: §4.2 does not state the --max verifier count`).not.toBe("");
    if (rendering === "skills/etc") {
      // One clause: the etc clause of the sentence ends at the next comma or dash, so the other
      // renderings' assignment cannot answer for it.
      expect(line, "etc: the two verifiers are not run one after another").toMatch(/etc 는 [^,—]*한 번에 하나씩/);
      expect(/etc 는 [^,—]*병렬/.test(line), "etc: the etc clause runs the verifiers in parallel").toBe(false);
      expect(line, "etc: --max is not stated as the profile's default").toMatch(/etc profile 은 `--max` 가 기본이다/);
    } else {
      expect(line, `${rendering}: the two --max verifiers are not run in parallel`).toMatch(/2 개를 병렬로/);
      expect(SEQUENTIAL.test(line), `${rendering}: a parallel rendering runs its verifiers one at a time`).toBe(false);
    }
  });

  it.each(RENDERINGS)("FR-FLOW-185 AC-6 %s: the mode matrix's --max row agrees with §4.2", (rendering) => {
    const rows = tableRows(sectionOf(rendering, CODER, /^###\s*1\.3\s/));
    const column = (rows[0]?.cells ?? []).findIndex((cell) => /TDD 검증/.test(cell));
    const max = rows.find((entry) => /`--max`/.test(entry.cells[0] ?? ""));
    const cell = column < 0 || max === undefined ? "" : (max.cells[column] ?? "");
    expect(cell, `${rendering}: the --max row gives no TDD verifier count`).toMatch(/×\s*2\b/);
    if (rendering === "skills/etc") {
      expect(max?.cells[0] ?? "", "etc: the --max row is not marked as the default").toMatch(/default/);
      const defaults = rows.slice(1).filter((entry) => /기본|default/.test(entry.cells[0] ?? ""));
      expect(defaults.map((entry) => entry.cells[0]), "etc: a row other than --max is also marked as the default").toEqual([max?.cells[0]]);
      expect(cell, "etc: the --max row does not run the two one at a time").toMatch(SEQUENTIAL);
    } else {
      expect(SEQUENTIAL.test(cell), `${rendering}: the --max row runs the verifiers one at a time`).toBe(false);
    }
  });
});
