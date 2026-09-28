import { describe, expect, it } from "vitest";

import { normaliseEol, readVariant, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-188
//
// Defects the 4.0.0 final verification found in the shared wave contract and the two skills that run
// it. Each block pins the structure that carries the fix — a numbered section, a `**PW-n` step, a
// table row, an option row — so the fix cannot be satisfied by a sentence elsewhere in the file.

const BUNDLES = ["claude", "codex", "etc"] as const;
const CONTRACT = "_shared/kiwi/parallel-waves.md";

const contract = (bundle: string): string => normaliseEol(readVariant(`skills/${bundle}/${CONTRACT}`));
const skill = (bundle: string, name: string): string => normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${name}/SKILL.md`)));
const shared = (bundle: string, file: string): string => normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/${file}`));
const numbered = (text: string, n: number): string => section(text, new RegExp(`^## ${n}\\.`));

function step(text: string, k: number): string {
  const body = numbered(text, 5);
  const marks = [...body.matchAll(/^\*\*PW-(\d+)\b/gm)];
  const at = marks.findIndex((mark) => Number(mark[1]) === k);
  if (at === -1) return "";
  const start = marks[at]?.index as number;
  const end = at + 1 < marks.length ? (marks[at + 1]?.index as number) : body.length;
  return body.slice(start, end);
}

/** The `run_id` pattern a skill's §0.14 row declares, anchored. */
function sessionIdPattern(text: string): RegExp | null {
  const row = text.split("\n").find((line) => /^\|\s*§0\.14\s*\|/.test(line)) ?? "";
  const match = /`run_id` = `([^`]+)`/.exec(row);
  return match ? new RegExp(`^${match[1]}$`) : null;
}

/** parallel-waves §0: the run_id inside an sds-id is lowercased, anything outside [a-z0-9.-] becomes `-`. */
const sdsRunId = (runId: string): string => runId.toLowerCase().replace(/[^a-z0-9.-]/g, "-");

// The orchestrator's default run_id is `{YYYY-MM-DD}.{git-toplevel-basename}.{work}` with a default work
// of `orchestrator-{YYYY-MM-DD}` and a `--work` of at most 40 characters; the longest wave sds-id suffix
// a run produces is a re-entry of a fragment of a two-digit wave.
const DEFAULT_RUN_ID = "2026-09-28.speckiwi.orchestrator-2026-09-28";
const LONG_WORK_RUN_ID = `2026-09-28.Snoworca_SpecKiwi.${"w".repeat(40)}`;
const EXPLICIT_RUN_ID = "Release_4.0.0-Parallel_Waves-Run-2026-09-28-abcd"; // 48, the `--run-id` cap
const LONGEST_SUFFIX = "-wave-12-r2-3"; // a part `-{k}` of the re-entry sds-id `-wave-{n}-r{m}`

describe("FR-FLOW-188 AC-2 — a worker's kiwi-pm accepts the wave sds-id the callers build", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-2 ${bundle}: the default orchestrator run_id plus the longest wave suffix passes kiwi-pm and kiwi-coder §0.14`, () => {
      const ids = [DEFAULT_RUN_ID, LONG_WORK_RUN_ID, EXPLICIT_RUN_ID].map((runId) => `${sdsRunId(runId)}${LONGEST_SUFFIX}`);
      expect(ids[0]).toBe("2026-09-28.speckiwi.orchestrator-2026-09-28-wave-12-r2-3");
      for (const name of ["kiwi-pm", "kiwi-coder"]) {
        const pattern = sessionIdPattern(skill(bundle, name));
        expect(pattern, `${bundle}/${name}: §0.14 declares no run_id pattern`).not.toBeNull();
        for (const id of ids) expect((pattern as RegExp).test(id), `${bundle}/${name}: ${id} (${id.length})`).toBe(true);
      }
    });

    it(`FR-FLOW-188 AC-2 ${bundle}: §0 derives the sds-id's run_id into the session-id alphabet`, () => {
      const line = numbered(contract(bundle), 0)
        .split("\n")
        .find((l) => l.includes("`{run_id}-wave-{n}`")) ?? "";
      expect(line, `${bundle}: §0 names no wave sds-id`).not.toBe("");
      expect(line, `${bundle}: the sds-id rule does not name the alphabet`).toContain("`[a-z0-9.-]`");
      expect(/소문자|lowercase/i.test(line), `${bundle}: the sds-id rule does not lowercase`).toBe(true);
    });

    it(`FR-FLOW-188 AC-2 ${bundle}: kiwi-sds --sds-id states the same length cap as kiwi-pm`, () => {
      const row = skill(bundle, "kiwi-sds").split("\n").find((l) => /^\|\s*`--sds-id <id>`/.test(l)) ?? "";
      expect(row, `${bundle}: no --sds-id option row`).not.toBe("");
      expect(row.includes("128"), `${bundle}: --sds-id row states no 128 cap`).toBe(true);
    });
  }
});

describe("FR-FLOW-188 AC-3 — a split wave SDS is one wave, one lane, one worker", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-3 ${bundle}: §3 schedules the fragments as one wave entry and orders them inside one worker`, () => {
      const stages = numbered(contract(bundle), 3);
      const rule = stages.split("\n").find((l) => l.includes("{run_id}-wave-{n}-{k}.sds.md")) ?? "";
      expect(rule, `${bundle}: §3 has no fragment rule`).not.toBe("");
      expect(/wave 하나 = lane 하나 = 워커 하나|one wave = one lane = one worker/.test(rule), `${bundle}: ${rule.slice(0, 160)}`).toBe(true);
      expect(rule, `${bundle}: the fragments are not one --sds entry`).toContain("`{run_id}-wave-{n}=");
      // The retired rule chained fragment k on fragment k−1, which always puts them in different stages.
      expect(/k\s*[−-]\s*1/.test(stages), `${bundle}: §3 still chains fragments by --depends`).toBe(false);
      expect(/조각마다 (하나의 )?lane|each part is a lane/.test(stages), `${bundle}: §3 still makes a lane per fragment`).toBe(false);
    });

    it(`FR-FLOW-188 AC-3 ${bundle}: the dispatch card carries every fragment and the worker runs kiwi-pm once per fragment in order`, () => {
      const text = contract(bundle);
      expect(step(text, 5), `${bundle}: PW-5 card`).toContain("`sds_paths`");
      const worker = step(text, 6);
      expect(worker, `${bundle}: PW-6`).toContain("`sds_paths`");
      expect(/`sds_paths` 순서|in the order of `sds_paths`/.test(worker), `${bundle}: PW-6 does not run the fragments in card order`).toBe(true);
    });

    for (const name of ["kiwi-orchestrator", "kiwi-wave-master"]) {
      it(`FR-FLOW-188 AC-3 ${bundle}/${name}: no fragment is dispatched as a lane of its own`, () => {
        const body = skill(bundle, name);
        expect(/조각마다 (하나의 )?lane|each (part|fragment) (becomes|is) (a|its own) lane|one lane per (part|fragment)/i.test(body), `${bundle}/${name}`).toBe(false);
      });
    }
  }
});

describe("FR-FLOW-188 AC-8 — a host window without code files owes no review hop", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-8 ${bundle}: PW-12 filters the host window by kiwi-review-fix-loop §11 and records no-host-code-commits`, () => {
      const close = step(contract(bundle), 12);
      const rule = close.split("\n").find((l) => l.includes("`no-host-code-commits`")) ?? "";
      expect(rule, `${bundle}: PW-12 has no no-code branch`).not.toBe("");
      expect(rule, `${bundle}: the branch does not name the class filter`).toContain("§11");
      expect(rule, `${bundle}: the branch does not name the gate it avoids`).toContain("empty-code-scope");
    });

    it(`FR-FLOW-188 AC-8 ${bundle}: the orchestrator's §11.2 host review carries the same branch`, () => {
      const review = section(skill(bundle, "kiwi-orchestrator"), /^###\s*11\.2\s/);
      expect(review, `${bundle}: no §11.2`).not.toBe("");
      expect(review, `${bundle}: §11.2`).toContain("`no-host-code-commits`");
    });
  }
});

describe("FR-FLOW-188 AC-1 — the orchestrator spells every stage-lock path under its artifact root", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-1 ${bundle}: a command's lanes lock, existing paths and freeze path sit under docs/research/{work}/`, () => {
      const body = skill(bundle, "kiwi-orchestrator");
      const lines = body.split("\n").filter((l) => /--out|--lane-plan|--existing-paths/.test(l) && /waves\/stage-\{s\}\//.test(l));
      expect(lines.length, `${bundle}: no command line names a stage path`).toBeGreaterThanOrEqual(3);
      for (const line of lines) {
        const bare = [...line.matchAll(/(\S*)waves\/stage-\{s\}\//g)].filter((m) => !/docs\/research\/\{work\}\/$|\{artifact_root\}$/.test(m[1] as string));
        expect(bare.map((m) => m[0]), `${bundle}: ${line.trim().slice(0, 160)}`).toEqual([]);
      }
    });
  }
});

describe("FR-FLOW-188 AC-1 — every sds-id of a wave is closed, re-entries included", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-1 ${bundle}: the orchestrator's §14 closes each sds-id of the wave, naming the re-entry id`, () => {
      const promotion = section(skill(bundle, "kiwi-orchestrator"), /^##\s*14\.\s/);
      expect(promotion, `${bundle}: no §14`).not.toBe("");
      expect(promotion, `${bundle}: §14 names no re-entry id`).toContain("{run_id}-wave-{n}-r{m}");
    });

    it(`FR-FLOW-188 AC-1 ${bundle}: wave-master §5.5.8 closes each sds-id of the wave, re-entries included`, () => {
      const promotion = section(skill(bundle, "kiwi-wave-master"), /^###\s*5\.5\.8\s/);
      expect(/재진입|re-entry/.test(promotion), `${bundle}: §5.5.8 does not close re-entry SDS`).toBe(true);
    });
  }
});

describe("FR-FLOW-187 AC-3 — the allocation check is the contract's gate, so both skills declare it", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-3 ${bundle}: §4 raises unallocated-req-id at PW-2 and PW-2 names it`, () => {
      const text = contract(bundle);
      const row = tableRows(numbered(text, 4)).find((r) => (r.cells[0] ?? "").includes("`unallocated-req-id`"));
      expect(row, `${bundle}: §4 has no unallocated-req-id row`).toBeDefined();
      expect(row?.cells[2] ?? "", `${bundle}`).toContain("PW-2");
      expect(step(text, 2), `${bundle}: PW-2`).toContain("`unallocated-req-id`");
    });
  }
});

describe("FR-FLOW-187 AC-3 — the orchestrator's 3.c′ step runs the same allocation predicate", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-187 AC-3 ${bundle}: 3.c′ unions every wave SDS file and requires equality with the allocated set`, () => {
      const line = skill(bundle, "kiwi-orchestrator").split("\n").find((l) => l.startsWith("**3.c′ 배정 검사**")) ?? "";
      expect(line, `${bundle}: no 3.c′ allocation step`).not.toBe("");
      expect(line, `${bundle}: 3.c′ does not union split files`).toContain("합집합");
      expect(line, `${bundle}: 3.c′ is still a subset check`).toContain("배정 집합과 같아야");
    });
  }
});

describe("FR-FLOW-183 AC-3 — the pipeline's promoting hop always names its requirement scope", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-183 AC-3 ${bundle}: §2.5.4 item 3 passes --req-filter next to --close-reqs`, () => {
      const cycle = section(skill(bundle, "kiwi-pipeline"), /^###\s*2\.5\.4\s/);
      const item = cycle.split("\n").find((l) => /^3\.\s/.test(l)) ?? "";
      expect(item, `${bundle}: no item 3`).toContain("--close-reqs");
      expect(item, `${bundle}: item 3 has no --req-filter`).toContain("--req-filter");
    });
  }
});

describe("FR-FLOW-188 AC-1 — the caller names the integration branch the merge lands on", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-1 ${bundle}: the §0 caller table has an integration-branch row for both callers`, () => {
      const row = tableRows(numbered(contract(bundle), 0)).find((r) => (r.cells[1] ?? "").includes("kiwi/orch/{run_id}/integration"));
      expect(row, `${bundle}: §0 names no integration branch`).toBeDefined();
      expect((row?.cells[2] ?? "").trim(), `${bundle}: wave-master's branch is blank`).not.toBe("");
    });
  }
});

describe("FR-FLOW-186 AC-3 — promotion evidence has one reference rule", () => {
  // One rule, stated once in test-sufficiency §4: one row per AC with `covers`, and the reference is the
  // caller's pinned `verification_cmd` when it has one (FR-FLOW-087 AC-7), otherwise the cited test file.
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-186 AC-3 ${bundle}: test-sufficiency §4 owns the reference rule and PW-16 and §14 cite it per AC`, () => {
      const rule = section(shared(bundle, "test-sufficiency.md"), /^##\s*4\.\s/);
      expect(rule, `${bundle}: test-sufficiency §4 does not place verification_cmd`).toContain("`verification_cmd`");
      expect(rule, `${bundle}: test-sufficiency §4 does not name the per-AC covers`).toContain("`covers`");
      const promotion = step(contract(bundle), 16);
      const orchestrator = section(skill(bundle, "kiwi-orchestrator"), /^##\s*14\.\s/);
      for (const [name, text] of [["PW-16", promotion], ["§14", orchestrator]] as const) {
        expect(text, `${bundle}: ${name} does not cite the evidence rule`).toMatch(/test-sufficiency\.md` §4/);
        expect(text, `${bundle}: ${name} registers no per-AC row`).toContain("`covers`");
      }
    });
  }
});

describe("FR-FLOW-188 AC-5 — --serial runs the decision committee one member at a time too", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-5 ${bundle}: §2 names the committee and auto-option spawns it one by one under --serial`, () => {
      const rule = numbered(contract(bundle), 2).split("\n").find((l) => l.startsWith("- ") && l.includes("`--serial`")) ?? "";
      expect(rule, `${bundle}: §2 --serial rule does not name the committee`).toContain("auto-option.md");
      const auto = shared(bundle, "auto-option.md");
      const spawn = auto.split("\n\n").find((p) => /K회 동시 호출|spawned in a single message|evaluate the committee members sequentially/.test(p)) ?? "";
      expect(spawn, `${bundle}: auto-option has no committee spawn rule`).not.toBe("");
      expect(spawn, `${bundle}: the spawn rule ignores --serial`).toContain("--serial");
    });

    it(`FR-FLOW-188 AC-5 ${bundle}: the orchestrator's --serial option lists every natural-language trigger`, () => {
      const row = skill(bundle, "kiwi-orchestrator").split("\n").find((l) => /^\|\s*`--serial`\s*\|/.test(l)) ?? "";
      expect(row, `${bundle}: no --serial option row`).not.toBe("");
      for (const phrase of ["직렬로", "하나씩", "순서대로", "serially", "one at a time"]) {
        expect(row.includes(`"${phrase}"`), `${bundle}: the --serial row omits "${phrase}"`).toBe(true);
      }
    });
  }
});

describe("FR-FLOW-188 AC-2 — the worker's test-sufficiency check reads the worker's worktree", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-2 ${bundle}: test-sufficiency §3 step 1 states the worktree rule for every caller`, () => {
      const procedure = section(shared(bundle, "test-sufficiency.md"), /^##\s*3\.\s/);
      const first = procedure.split(/\n(?=2\.\s)/)[0] ?? "";
      expect(first, `${bundle}: step 1 does not pass workspaceRoot`).toContain("workspaceRoot");
      expect(/호스트 root|host root/.test(first), `${bundle}: step 1 does not say why the host root is wrong`).toBe(true);
    });

    it(`FR-FLOW-188 AC-2 ${bundle}: kiwi-review-fix-loop's sufficiency phase points a worktree run at its worktree`, () => {
      // `### 6.5.1` in claude, `## Test Sufficiency` in codex and etc.
      const phase = section(normaliseEol(readVariant(`skills/${bundle}/kiwi-review-fix-loop/SKILL.md`)), /^###\s*6\.5\.1\s|^##\s*Test Sufficiency\b/);
      expect(phase, `${bundle}: no §6.5.1`).not.toBe("");
      expect(phase, `${bundle}: §6.5.1`).toContain("workspaceRoot");
    });
  }
});

describe("FR-FLOW-188 — option and command spellings the verification found wrong", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-188 AC-3 ${bundle}: a merged dependency keeps its wave key with an empty list`, () => {
      const stages = numbered(contract(bundle), 3);
      const line = stages.split("\n").find((l) => l.includes("`--depends`") && l.includes("`{waveId: [waveId…]}`")) ?? "";
      expect(line, `${bundle}`).toContain("`[]`");
    });

    it(`FR-FLOW-188 AC-1 ${bundle}: the verdict's write-set line defers to the out-of-lease rule below it`, () => {
      const verdict = step(contract(bundle), 8);
      const line = verdict.split("\n").find((l) => /변경 경로 ⊆ SDS 쓰기 집합|changed paths ⊆ the SDS write set/.test(l)) ?? "";
      expect(line, `${bundle}`).not.toBe("");
      expect(/아래|below/.test(line), `${bundle}: ${line}`).toBe(true);
    });

    it(`FR-FLOW-188 AC-1 ${bundle}: wave-master's worker line carries the fields the resume reads`, () => {
      const record = section(skill(bundle, "kiwi-wave-master"), /^###\s*5\.5\.6\s/);
      const line = record.split("\n").find((l) => l.includes('phase="worker"')) ?? "";
      for (const field of ["`lane`", "`stage`", "`isolation.base_sha`", "`sds_id`"]) {
        expect(line.includes(field), `${bundle}: the worker line omits ${field}`).toBe(true);
      }
    });

    it(`FR-FLOW-188 AC-3 ${bundle}: run-ledger's wave-issues precondition follows depends_on[]`, () => {
      const line = shared(bundle, "run-ledger.md").split("\n").find((l) => l.trim().startsWith("| `P-WAVE-ISSUES-CLOSED`")) ?? "";
      expect(line, `${bundle}`).not.toBe("");
      expect(line, `${bundle}`).toContain("depends_on[]");
    });
  }
});
