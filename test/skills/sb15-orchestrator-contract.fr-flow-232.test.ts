import { describe, expect, it } from "vitest";

import { normaliseEol, readVariant, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-232 — the orchestrator, kiwi-coder and shared wave contracts state what SB15
// (2026-11-10, speckiwi 5.3.7) found unstated: the intake line's wave, how intake questions are
// decided, the ledger row and its one path, what to do with a split citation, which graph the waves
// lock holds, the node's own quick check, and the table-cell rule a deferred call must keep.
//
// Every SKILL.md is Korean, and so are waves-event.md and wave-decomposition.md in all three bundles;
// the codex and etc parallel-waves.md are English. codex and etc keep kiwi-coder §6.2 in
// references/extended-workflow.md, which their SKILL.md §6 names as its source of truth.

const BUNDLES = ["claude", "codex", "etc"] as const;
const ENGLISH: ReadonlySet<string> = new Set(["codex", "etc"]);

const shared = (bundle: string, file: string): string => normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/${file}`));
const skill = (bundle: string, name: string): string => normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${name}/SKILL.md`)));
const coderPhase3 = (bundle: string): string =>
  bundle === "claude" ? skill(bundle, "kiwi-coder") : normaliseEol(readVariant(`skills/${bundle}/kiwi-coder/references/extended-workflow.md`));

/** The text of one `### n.m` subsection, up to the next heading of level 2 or 3. */
function subsection(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^#{2,3} /.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** One numbered item of a list, up to the next item at the same depth. */
function item(text: string, n: number): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${n}. `));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^\d+\. /.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

describe("FR-FLOW-232 AC-1 — the intake line is a run-wide line, and intake questions are decided by the prose rule", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: §5.2 item 3 names wave "all", order 0 and target "all"`, () => {
      const third = item(subsection(skill(bundle, "kiwi-orchestrator"), /^### 5\.2 /), 3);
      for (const token of ['`wave: "all"`', "`order: 0`", '`target: "all"`']) expect(third, `${bundle}: ${token}`).toContain(token);
    });

    it(`${bundle}: §5.2 sends intake questions to the auto-option.md §3 prose rule`, () => {
      const body = subsection(skill(bundle, "kiwi-orchestrator"), /^### 5\.2 /);
      expect(body).toMatch(/게이트 어휘 밖/);
      expect(body).toContain("`auto-option.md` §3");
    });

    it(`${bundle}: waves-event.md §2.2 gives the intake decision line its run-wide wave`, () => {
      const body = subsection(shared(bundle, "waves-event.md"), /^### 2\.2 /);
      const row = body.split("\n").find((line) => line.includes('`origin: "intake"`') || line.includes("`origin: \"intake\"`")) ?? "";
      expect(row, `${bundle}: no line of §2.2 names the intake origin`).not.toBe("");
      expect(row).toContain('`wave: "all"`');
    });
  }
});

describe("FR-FLOW-232 AC-2 — §13.2 states the ledger row's shape and the one --ledger path", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: names issueId, the two wave spellings stored as an integer, and the same --ledger`, () => {
      const body = subsection(skill(bundle, "kiwi-orchestrator"), /^### 13\.2 /);
      expect(body).toContain("`issueId`");
      expect(body).toContain("`wave-<n>`");
      expect(body).toMatch(/정수로 (?:저장|바꿔)/);
      expect(body).toContain("같은 `--ledger`");
      // `wave close` refuses a missing ledger, so a wave that raised no issue needs the file too.
      expect(body).toMatch(/첫 wave 를 dispatch 하기 전에 원장 파일을 내용 `\[\]` 로 만든다/);
    });
  }
});

describe("FR-FLOW-232 AC-3 — a split citation that is a real dependency becomes a depends_on row", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: wave-decomposition §2 item 6 reads crossNodeCitations and proposes again`, () => {
      const sixth = item(section(shared(bundle, "wave-decomposition.md"), /^## 2\./), 6);
      expect(sixth).toContain("`crossNodeCitations`");
      expect(sixth).toContain("`depends_on`");
      expect(sixth).toMatch(/다시 propose 한다/);
    });
  }
});

describe("FR-FLOW-232 AC-4 — the waves lock holds the first graph; the latest redecompose line holds the current one", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: wave-decomposition §6 says which graph each holds`, () => {
      const body = section(shared(bundle, "wave-decomposition.md"), /^## 6\./);
      expect(body).toContain("`waves.lock.json`");
      expect(body).toMatch(/Phase 2 의 첫 판/);
      expect(body).toMatch(/최신 `redecompose` 줄/);
    });
  }
});

describe("FR-FLOW-232 AC-5 — a node's own verification_cmd is a quick check; landing and promotion keep the run's command", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: parallel-waves.md defines the node command beside the run's`, () => {
      const text = shared(bundle, "parallel-waves.md");
      expect(text).toMatch(ENGLISH.has(bundle) ? /node's own `verification_cmd`/ : /노드의 `verification_cmd`/);
      expect(text).toMatch(ENGLISH.has(bundle) ? /never decides landing/ : /착지를 판정하지 않는다/);
    });

    for (const [n, label] of [[10, "§10"], [12, "§12"], [14, "§14"]] as const) {
      it(`${bundle}: kiwi-orchestrator ${label} places the node command`, () => {
        const body = section(skill(bundle, "kiwi-orchestrator"), new RegExp(`^##\\s*${n}\\.\\s`));
        expect(body).toContain("노드의 `verification_cmd`");
      });
    }
  }
});

describe("FR-FLOW-232 AC-6 — kiwi-coder §6.2 keeps a deferred call applicable", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle}: names the table-cell characters, checks its own queue, and says unknown names are refused`, () => {
      const body = subsection(coderPhase3(bundle), /^### 6\.2 /);
      expect(body).toMatch(/`\|`.{0,40}줄바꿈/);
      expect(body).toContain("`speckiwi orchestrate replay plan`");
      expect(body).toContain("`inputRefusals`");
      expect(body).not.toMatch(/조용히 제거/);
      expect(body).toMatch(/스키마에 \*\*없는\*\* 이름은 .{0,20}거부/);
    });

    it(`${bundle}: the test evidence example references a file, and the summary example is one line`, () => {
      const body = subsection(coderPhase3(bundle), /^### 6\.2 /);
      expect(body).not.toMatch(/reference: "[^"]*#/);
      expect(body).toMatch(/reference: "tests\/x\.test\.ts(?::\d+)?"/);
      const example = body.split("\n").findIndex((line) => line.includes("summary 인코딩 예"));
      expect(example).toBeGreaterThan(-1);
      const next = body.split("\n")[example + 1] ?? "";
      expect(next.trim()).toMatch(/^".*"/);
    });
  }
});
