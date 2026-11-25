import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_VERSION, renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";

// @req FR-FLOW-234 — user request 2026-11-20: code comments off keeps @req ("@req 를 남기고 코멘트만
// 꺼야합니다"). One shared contract states what off means; every code-writing skill cites it.

const repo = (file: string) => path.resolve(import.meta.dirname, "../..", file);
const read = async (file: string) => (await readFile(repo(file), "utf8")).replace(/\r\n/g, "\n");
const TREES = ["claude", "codex", "etc"] as const;
const CONTRACT = "_shared/kiwi/code-comments.md";

/** The body under the heading whose text carries `(marker)`, up to the next heading of the same level. */
function section(text: string, marker: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{2,3}\s/.test(line) && line.includes(`(${marker})`));
  expect(start, `heading with (${marker})`).toBeGreaterThanOrEqual(0);
  const level = /^#+/.exec(lines[start] ?? "")?.[0].length ?? 2;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

describe("FR-FLOW-234 AC-1 AC-2 — the shared contract in each tree", () => {
  for (const tree of TREES) {
    // @req FR-FLOW-234 AC-1
    it(`${tree}: off omits explanatory comments and keeps the tags, the test citations and directives`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      expect(text).toContain("codeComments");
      expect(text).toContain("get_work_mode");
      const omit = section(text, "omit");
      for (const kind of ["JSDoc", "docstring", "TODO"]) expect(omit, kind).toContain(kind);
      expect(omit).not.toContain("@req");
      expect(omit).not.toContain("AC-<n>");
      const keep = section(text, "keep");
      for (const kept of ["@req", "kiwi-tdd", "<REQ-ID> AC-<n>", "eslint-disable", "shebang"]) expect(keep, kept).toContain(kept);
      // The @req bullet keeps the tag and says the tag line carries the tag only.
      const reqBullet = keep.split("\n").find((line) => line.includes("@req")) ?? "";
      expect(reqBullet).not.toMatch(/쓰지 않|not write|never write|omit/i);
    });

    // @req FR-FLOW-234 AC-1 — user request 2026-11-20: "ac 번호는 어떤 상황에서도 반드시 주석으로 남겨야 합니다".
    // User decision 2026-11-26: the experiment showed no effect, so the setting is a preference and no
    // saving is claimed.
    it(`${tree}: trace tags carry the AC numbers whatever the setting, and the setting is a preference claiming no effect`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      const korean = tree === "claude";
      const preamble = text.split("\n## ")[0] as string;
      expect(preamble).toMatch(korean ? /선호/ : /preference/i);
      expect(preamble).not.toMatch(/token|토큰|faster|속도|절감|save/i);
      const keep = section(text, "keep");
      const reqBullet = keep.split("\n").find((line) => line.includes("`@req <REQ-ID> AC-<n>")) ?? "";
      expect(reqBullet.startsWith(korean ? "- 추적 태그 `@req <REQ-ID> AC-<n>[ AC-<m>…]`" : "- The trace tag `@req <REQ-ID> AC-<n>[ AC-<m>…]`"), reqBullet.slice(0, 60)).toBe(true);
      expect(reqBullet).toContain(korean ? "설정과 관계없이" : "whatever the setting");
      expect(reqBullet).toContain("`@step <task-name>: AC-<n>");
      expect(keep).toContain(korean ? "어떤 상황에서도 빼지 않는다" : "never left out");
      expect(text).not.toMatch(/AC 번호(를|는)? ?(빼|생략)|AC 번호 없이 커밋|(omit|drop|leave out)\w* the AC|without (the |its )?AC/i);
    });

    // @req FR-FLOW-234 AC-1 — user 2026-11-21: "이것이 기본값으로 들어가게 하세요" (fill the vibe step tags before the commit).
    it(`${tree}: a vibe step fills its step tags with AC numbers before the synthesis that precedes the commit`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      const korean = tree === "claude";
      const reqBullet = section(text, "keep").split("\n").find((line) => line.includes("`@req <REQ-ID> AC-<n>")) ?? "";
      expect(reqBullet).not.toContain(korean ? "acceptance 줄이 아직 없으면" : "has no acceptance lines yet");
      expect(reqBullet).toContain(korean ? "그 task 를 싣는 커밋 전에" : "before the commit that lands the task");
      expect(reqBullet).toContain("docs/spec/steps/<task-name>/intent.md");
      // Every commit that carries the tagged code, not only the last one, and code no acceptance line covers gets a line.
      expect(reqBullet).toContain(korean ? "그 코드를 싣는 커밋마다" : "before any commit that carries such code");
      expect(reqBullet).toContain(korean ? "어느 줄에도 해당하지 않는" : "that no line covers yet");
      const fill = reqBullet.indexOf(korean ? "AC 번호를 채운 뒤" : "fill each `@step <task-name>:` tag with the AC numbers");
      const synth = reqBullet.indexOf(korean ? "step SRS 를 합성한다" : "then synthesize the step SRS");
      expect(fill, "fill sentence").toBeGreaterThan(0);
      expect(synth, "fill comes before the synthesis").toBeGreaterThan(fill);
      // The synthesizer never rewrites an existing step SRS, so a late fill needs the file removed first.
      expect(reqBullet).toContain("docs/spec/steps/<task-name>/<task-name>.srs.md");
      expect(reqBullet).toContain(korean ? "커밋되는 추적 태그에는 늘 AC 번호가 있다" : "every trace tag a commit carries has its AC numbers");
    });

    // @req FR-FLOW-234 AC-2
    it(`${tree}: existing comments stay, a comment the change made untrue may be fixed, and on is unchanged`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      const korean = tree === "claude";
      const existing = section(text, "existing");
      expect(existing).toContain(korean ? "이미 있는 주석은 지우지 않는다" : "Existing comments are not removed");
      expect(existing).toContain(korean ? "그 주석만 고치거나 지울 수 있다" : "may be corrected or removed, that comment only");
      expect(section(text, "on")).toContain(korean ? "1절은 적용하지 않는다" : "section 1 does not apply");
    });
  }
});

describe("FR-FLOW-234 AC-3 — every code-writing skill reads the setting and cites the contract", () => {
  const SKILLS = ["kiwi-coder", "kiwi-tdd", "kiwi-hot-fix", "kiwi-bug-repro", "kiwi-step", "kiwi-review-fix-loop", "kiwi-orchestrator", "kiwi-wave-master"];
  for (const tree of TREES) {
    // @req FR-FLOW-234 AC-3
    it(`${tree}: the skills and the parallel-waves worker instruction cite it`, async () => {
      for (const skill of SKILLS) {
        const text = await read(`skills/${tree}/${skill}/SKILL.md`);
        expect(text, skill).toContain(CONTRACT);
        expect(text, skill).toContain("codeComments");
      }
      const waves = await read(`skills/${tree}/_shared/kiwi/parallel-waves.md`);
      expect(waves).toContain(CONTRACT);
    });

    // @req FR-FLOW-234 AC-3
    it(`${tree}: the review loop raises no missing-comment finding and its fixer adds none when off`, async () => {
      const text = await read(`skills/${tree}/kiwi-review-fix-loop/SKILL.md`);
      const line = text.split("\n").find((candidate) => candidate.includes("codeComments") && candidate.includes(CONTRACT)) ?? "";
      expect(line).toMatch(/finding/);
      expect(line).toMatch(/fixer/);
    });
  }
});

describe("FR-FLOW-020 AC-1 AC-2 AC-4 — the tag format carries AC numbers", () => {
  const CODER = "kiwi-coder/SKILL.md";
  /** The backtick span in a §0.17.n row that starts with the given prefix. */
  const span = (text: string, row: string, prefix: string): RegExp => {
    const line = text.split("\n").find((candidate) => candidate.startsWith(`| ${row} |`)) ?? "";
    const found = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "").find((body) => body.startsWith(prefix));
    expect(found, `${row} regex starting ${prefix}`).toBeDefined();
    return new RegExp(found ?? "");
  };

  for (const tree of TREES) {
    // @req FR-FLOW-020 AC-1
    it(`${tree}: the §0.17.3 tag regex takes AC tokens and still refuses a code line or a tag without AC`, async () => {
      const tag = span(await read(`skills/${tree}/${CODER}`), "§0.17.3", "^\\s*(");
      for (const ok of ["// @req FR-X-001 AC-1", "# @req FR-X-001 AC-1 AC-3", " * @req FR-X-001 AC-2 (legacy)", "  // @req IR-CLI-121 AC-12 */"]) expect(tag.test(ok), ok).toBe(true); // @req-lint: ignore — sample tag lines for the regex
      for (const bad of ["// @req FR-X-001", "let x=1; // @req FR-X-001 AC-1", "// @req FR-X-001 FR-Y-002 AC-1", "// @req FR-X-001 AC-"]) expect(tag.test(bad), bad).toBe(false); // @req-lint: ignore — sample tag lines for the regex
    });

    // @req FR-FLOW-020 AC-1
    it(`${tree}: the §0.17.5 dedupe regex reads the REQ-ID and its AC numbers from a loose line, and a missing AC goes on a new line`, async () => {
      const text = await read(`skills/${tree}/${CODER}`);
      const lenient = span(text, "§0.17.5", "@req\\s+(");
      const match = lenient.exec("/** @req FR-X-001 AC-1 AC-2 @param y */"); // @req-lint: ignore — sample tag line for the regex
      expect(match?.[1]).toBe("FR-X-001");
      expect((match?.[2] ?? "").trim().split(/\s+/)).toEqual(["AC-1", "AC-2"]);
      const row = text.split("\n").find((candidate) => candidate.startsWith("| §0.17.5 |")) ?? "";
      expect(row).toContain("(REQ-ID, AC 번호) 쌍");
      expect(row).toContain("새 줄");
    });

    // @req FR-FLOW-020 AC-2 AC-4
    it(`${tree}: kiwi-tdd writes the step tag with AC numbers and reconciles it to @req with AC numbers`, async () => {
      const text = await read(`skills/${tree}/kiwi-tdd/SKILL.md`);
      expect(text).toContain("`@step <task-name>: AC-<n>");
      expect(text).toContain("`@req <REQ-ID> AC-<n>");
    });
  }
});

describe("FR-FLOW-234 AC-4 — the root instruction block 1.13", () => {
  const OFF_LINE =
    "When `get_work_mode` reports `codeComments: off`, write no explanatory comment in code you write or change: keep the trace tags with the AC numbers the code implements (`@req <REQ-ID> AC-<n>`, or `@step <task-name>: AC-<n>` for step work; the tag alone on its line), the `<REQ-ID> AC-<n>` citations on test lines and the directive comments a language or tool needs, and leave existing comments in place. Trace tags carry those AC numbers whatever the setting. Change the setting (`speckiwi comments on|off`) only when the user asks.";

  // @req FR-FLOW-234 AC-4
  // The block has moved on since 1.13 (FR-NODE-327 raised it to 1.14); the rule stays in the current block.
  it("raised the block past 1.12 and carries the off rule", () => {
    expect(AGENT_INSTRUCTION_VERSION).not.toBe("1.12");
    expect(renderAgentInstructionSnippet().split("\n")).toContain(OFF_LINE);
  });

  // @req FR-FLOW-234 AC-4
  it("item 7 has a vibe step write its acceptance lines and fill its step tags before the synthesis", () => {
    const vibe = renderAgentInstructionSnippet().split("\n").find((line) => /^\d+\. When the mode is `vibe`/.test(line)) ?? "";
    const fill = vibe.indexOf("fill each `@step <task-name>:` tag with the AC numbers its code implements");
    expect(fill, "fill clause").toBeGreaterThan(vibe.indexOf("before the commit that lands the task"));
    expect(vibe).toContain("before that synthesis, and before any earlier commit that carries the task's code, write the step's acceptance lines in its `intent.md`");
    expect(vibe).toContain("one for any tagged code no line covers yet");
    expect(vibe).toContain("never rewrites an existing step SRS");
  });

  // @req FR-FLOW-234 AC-4
  it("names speckiwi comments among the CLI-only SRS mutations", () => {
    const cliOnly = renderAgentInstructionSnippet().split("\n").find((line) => line.includes("may use the CLI:")) ?? "";
    expect(cliOnly).toContain("`speckiwi rename-target`");
    expect(cliOnly).toContain("`speckiwi comments`");
  });

  // @req FR-FLOW-234 AC-4
  it.each(["CLAUDE.md", "AGENTS.md"])("the repository's own %s carries the current block with the off rule", async (file) => {
    const text = await read(file);
    expect(text).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(text).toContain(OFF_LINE);
    expect(text).toContain("fill each `@step <task-name>:` tag with the AC numbers its code implements");
  });
});
