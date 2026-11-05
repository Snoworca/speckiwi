import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 4, bundle d1.
// Every test here is meant to be red: it shows a place where the shipped skills, or the suites that
// guard them, do not hold an acceptance criterion. Nothing in the repository is changed; mutations run
// on a temporary copy that is removed afterwards.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
function skillText(root: string, skill: string): string {
  const files = [`${root}/${skill}/SKILL.md`, `${root}/${skill}/references/extended-workflow.md`];
  return files.filter((rel) => existsSync(path.join(REPO, rel))).map(read).join("\n");
}

/** One pseudocode function: from its `FUNCTION <name>(` line to the closing fence. */
function fn(text: string, name: string): string[] {
  const start = text.indexOf(`FUNCTION ${name}(`);
  if (start < 0) return [];
  const end = text.indexOf("\n```", start);
  return text.slice(start, end < 0 ? undefined : end).split("\n");
}
const code = (line: string): string => line.replace(/\s+#.*$/, "").trim();
const indent = (line: string): number => line.length - line.trimStart().length;

/** A resume call: it repeats neither --sds nor --req-filter (§5.4); the state recorded the run's filter. */
interface Run {
  argsSds: boolean;
  argsFilter: boolean;
  stateSds: boolean;
  stateFilter: boolean;
}
function evaluate(condition: string, run: Run): boolean | undefined {
  const js = condition
    .replace(/args\.sds_path/g, String(run.argsSds))
    .replace(/args\.req_filter/g, String(run.argsFilter))
    .replace(/state\.sds_path/g, String(run.stateSds))
    .replace(/state\.req_filter/g, String(run.stateFilter))
    .replace(/\bNOT\b/g, "!")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||");
  if (!/^[\s!()&|]*(?:(?:true|false)[\s!()&|]*)+$/.test(js)) return undefined;
  return Function(`return (${js});`)() as boolean;
}
function reached(lines: readonly string[], at: number, run: Run): boolean {
  const inline = /^IF (.*?):\s+\S/.exec(code(lines[at] as string))?.[1];
  if (inline !== undefined && evaluate(inline, run) === false) return false;
  let depth = indent(lines[at] as string);
  for (let index = at - 1; index >= 0 && depth > 0; index -= 1) {
    const line = lines[index] as string;
    if (line.trim() === "" || indent(line) >= depth) continue;
    depth = indent(line);
    const guard = code(line);
    if (guard === "ELSE:") {
      const opener = lines.slice(0, index).reverse().find((candidate) => indent(candidate) === depth && code(candidate).startsWith("IF "));
      const condition = /^IF (.*):$/.exec(code(opener ?? ""))?.[1];
      if (condition !== undefined && evaluate(condition, run) === true) return false;
      continue;
    }
    const condition = /^IF (.*):$/.exec(guard)?.[1];
    if (condition !== undefined && evaluate(condition, run) === false) return false;
  }
  return true;
}

const MISSING_ID_STOP = /HALT_ON_MISSING_IDS|NOT_FOUND|찾지 못/;

describe("FR-FLOW-211 AC-2 — a resumed --req-filter run stops on a named requirement that no longer exists", () => {
  for (const root of RENDERINGS) {
    // @req FR-FLOW-211 AC-2 — WHEN a requirement named by --req-filter does not exist, kiwi-pm SHALL stop
    // before kiwi-coder runs and name the ID. §5.4 lets a resume call omit --req-filter (the run set and
    // the filter come from pm-state), and a blocked/failed/pending run re-spawns kiwi-coder on resume.
    // The only existence check is `IF args.req_filter: HALT_ON_MISSING_IDS(args.req_filter)`, which reads
    // the invocation; the gate's by-ID read catches only mcp_unavailable. So an ID renamed or removed
    // between the first run and the resume reaches kiwi-coder unchecked (and T-final's `IF NOT req:
    // CONTINUE` then drops it without a word, against its own comment that boot already stopped).
    for (const stateSds of [false, true]) {
      const run: Run = { argsSds: false, argsFilter: false, stateSds, stateFilter: true };
      it(`${root}: resume of a --req-filter run (--sds ${stateSds ? "on" : "off"}) reaches a missing-ID stop before kiwi-coder`, () => {
        const text = skillText(root, "kiwi-pm");
        const main = fn(text, "MAIN");
        const spawn = main.findIndex((line) => line.includes("# T-run"));
        expect(spawn, `${root}: MAIN's T-run step`).toBeGreaterThan(0);
        const gate = fn(text, "APPLY_LIFECYCLE_GATE");
        const stops = [
          ...main.slice(0, spawn).flatMap((line, at) => (MISSING_ID_STOP.test(code(line)) && reached(main, at, run) ? [line.trim()] : [])),
          ...gate.flatMap((line, at) => (MISSING_ID_STOP.test(code(line)) && reached(gate, at, run) ? [line.trim()] : []))
        ];
        expect(stops, `${root}: no existence check of the recorded --req-filter IDs is reached on resume`).not.toEqual([]);
      });
    }
  }
});

// ---- Mutation runs on a temporary copy -------------------------------------------------------------
// Each mutation reintroduces a defect an AC forbids. Every suite under test/skills that names the skill
// is run on the copy; the mutation is killed only when some test fails that passes on the unmutated copy.

let sandbox = "";
const baseline = new Map<string, Set<string>>();

function suitesNaming(skill: string): string[] {
  const dir = path.join(sandbox, "test/skills");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".test.ts") && readFileSync(path.join(dir, file), "utf8").includes(skill))
    .map((file) => `test/skills/${file}`);
}
function failingTests(skill: string): Set<string> {
  const out = path.join(sandbox, `vitest-${skill}.json`);
  spawnSync(
    process.execPath,
    [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", ...suitesNaming(skill), "--root", sandbox, "--testTimeout", "60000", "--reporter=json", `--outputFile=${out}`],
    { cwd: sandbox, encoding: "utf8" }
  );
  const report = JSON.parse(readFileSync(out, "utf8")) as { testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }> };
  return new Set(report.testResults.flatMap((file) => file.assertionResults.filter((test) => test.status === "failed").map((test) => `${path.basename(file.name)} > ${test.fullName}`)));
}
/** The tests a mutation turns red: failing on the mutated copy, passing on the unmutated one. */
function killedBy(skill: string, files: readonly string[], from: string, to: string): string[] {
  const originals = files.map((rel) => readFileSync(path.join(sandbox, rel), "utf8"));
  const mutated = originals.map((text) => text.split(from).join(to));
  mutated.forEach((text, index) => expect(text, `the mutation changes ${files[index]}`).not.toBe(originals[index]));
  files.forEach((rel, index) => writeFileSync(path.join(sandbox, rel), mutated[index] as string));
  try {
    const before = baseline.get(skill) as Set<string>;
    return [...failingTests(skill)].filter((name) => !before.has(name));
  } finally {
    files.forEach((rel, index) => writeFileSync(path.join(sandbox, rel), originals[index] as string));
  }
}

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-r4-d1-"));
  for (const rel of ["skills", ".agents", "src", "test", "docs", "bin", "package.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts"]) {
    cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  }
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  for (const skill of ["kiwi-srs", "kiwi-prd"]) baseline.set(skill, failingTests(skill));
}, 600000);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

// The direction text the FR-FLOW-208 r3 fix wrote, and an exception that reverses it for the case r3 found.
const DIRECTION_9_2 = "(기존 REQ 가 NEW-ID 에 기대면 기존 REQ → NEW-ID)";
const REVERSED_9_2 = "(기존 REQ 가 NEW-ID 에 기대도 신규 REQ 를 id 로, 기존 REQ 를 reference 로 적는다)";
const DIRECTION_0_18 = "`depends_on` 은 신규·기존과 무관하게 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208).";
const REVERSED_0_18 = "`depends_on` 은 의존하는 요구 → 의존받는 요구(`id: {의존하는 REQ} → reference: {의존받는 REQ}`) 방향이다(FR-FLOW-208) — 단 신규 REQ 가 끼면 신규 REQ 를 id 에 둔다.";

describe("FR-FLOW-208 AC-1 — the suites turn red when kiwi-srs writes depends_on from the new requirement again", () => {
  // @req FR-FLOW-208 AC-1 — each dependency is written "from the dependent requirement to the one it
  // depends on". The mutation keeps the phrase "의존하는 요구 → 의존받는 요구" on the §9.2 line and adds an
  // exception that writes an existing requirement's dependency on a new one as new → existing (the
  // reversal verify r3 found). The direction check only asks that a direction line contain the phrase.
  it("claude §9.2: an exception that writes NEW-ID → existing for an existing requirement that depends on the new one is caught", () => {
    expect(killedBy("kiwi-srs", ["skills/claude/kiwi-srs/SKILL.md"], DIRECTION_9_2, REVERSED_9_2)).not.toEqual([]);
  }, 600000);

  // @req FR-FLOW-208 AC-1 — the same reversal in the codex rendering and its mirror (kept in step, so the mirror check stays green).
  it("codex + mirror §9.2: the same reversal is caught", () => {
    expect(
      killedBy(
        "kiwi-srs",
        ["skills/codex/kiwi-srs/references/extended-workflow.md", ".agents/skills/kiwi-srs/references/extended-workflow.md"],
        DIRECTION_9_2,
        REVERSED_9_2
      )
    ).not.toEqual([]);
  }, 600000);

  // @req FR-FLOW-208 AC-1 — the §0.18 direction SSOT: "신규·기존과 무관하게" dropped and the new requirement put first whenever one is involved.
  it("claude §0.18: an exception that puts the new requirement on the id side of depends_on is caught", () => {
    expect(killedBy("kiwi-srs", ["skills/claude/kiwi-srs/SKILL.md"], DIRECTION_0_18, REVERSED_0_18)).not.toEqual([]);
  }, 600000);
});

const SPLIT_RULE_END = "규범 문장 둘을 한 항목에 합치지 않는다.\n";
const MERGE_EXCEPTION = "규범 문장 둘을 한 항목에 합치지 않는다.\n- 단 같은 절의 규범 문장은 한 항목에 묶어 그 절을 인용한다.\n";

describe("FR-FLOW-210 AC-1 — the suites turn red when kiwi-prd merges normative sentences again", () => {
  for (const rel of ["skills/claude/kiwi-prd/SKILL.md", "skills/etc/kiwi-prd/SKILL.md"]) {
    // @req FR-FLOW-210 AC-1 — THE skill SHALL NOT merge two normative sentences into one item. The
    // mutation leaves the pinned rule line in place and adds the next §3 bullet allowing exactly that
    // merge; the FR-FLOW-210 suite checks only that the rule line exists and follows the quote rule.
    it(`${rel}: a §3 bullet that merges a section's normative sentences into one item is caught`, () => {
      expect(killedBy("kiwi-prd", [rel], SPLIT_RULE_END, MERGE_EXCEPTION)).not.toEqual([]);
    }, 600000);
  }
});
