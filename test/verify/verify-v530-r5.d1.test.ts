import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..211 (5.3.0), round 5, bundle d1.
// Each mutation reintroduces, inside the section that states a rule, an exception or alternative the
// AC forbids. Every suite under test/skills that names the skill is run on a temporary copy; the
// mutation is killed only when some test fails that passes on the unmutated copy. Nothing in the
// repository is changed; the copy is removed afterwards.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
function killedBy(skill: string, rel: string, from: string, to: string): string[] {
  const file = path.join(sandbox, rel);
  const original = readFileSync(file, "utf8");
  // Keep the file's own line endings so that only the mutated text differs.
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const [site, replacement] = [from, to].map((text) => text.replace(/\n/g, eol)) as [string, string];
  expect(original.split(site).length - 1, `the mutation site occurs once in ${rel}`).toBe(1);
  writeFileSync(file, original.split(site).join(replacement));
  try {
    const before = baseline.get(skill) as Set<string>;
    return [...failingTests(skill)].filter((name) => !before.has(name));
  } finally {
    writeFileSync(file, original);
  }
}

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-r5-d1-"));
  for (const rel of ["skills", ".agents", "src", "test", "docs", "bin", "package.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts"]) {
    cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  }
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  for (const skill of ["kiwi-srs", "kiwi-prd", "kiwi-pm"]) baseline.set(skill, failingTests(skill));
}, 1200000);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

const SRS = "skills/claude/kiwi-srs/SKILL.md";

describe("FR-FLOW-208 AC-2 — §11.1 keep/drop cannot carve FR-PARSE-045 warnings out of the kept findings", () => {
  // @req FR-FLOW-208 AC-2 — THE verification SHALL keep each FR-PARSE-045 warning on a requirement the
  // run added or changed, and the loop SHALL NOT pass while one remains. The mutation leaves the
  // pinned clause in the §11.1 tool-diagnostic keep row and appends an exception to that same row.
  it("claude §11.1: an exception appended to the FR-PARSE-045 keep row is caught", () => {
    expect(
      killedBy(
        "kiwi-srs",
        SRS,
        "FR-PARSE-045 경고(이미 있던 것도, 핵심 규칙 블록 FR-FLOW-208) |",
        "FR-PARSE-045 경고(이미 있던 것도, 핵심 규칙 블록 FR-FLOW-208) — 단 `--auto` 실행에서는 이번 실행 전부터 있던 경고를 drop 한다 |"
      )
    ).not.toEqual([]);
  }, 1200000);

  // @req FR-FLOW-208 AC-2 — the same exception written as its own §11.1 drop row.
  it("claude §11.1: a drop row for FR-PARSE-045 warnings already on the requirement is caught", () => {
    expect(
      killedBy(
        "kiwi-srs",
        SRS,
        "| **drop** | 증거 없음 — 사유와 함께 보고만 한다 |",
        "| **drop** | 이번 실행 전부터 그 요구에 있던 FR-PARSE-045 경고 — 사유와 함께 보고만 한다 | 산문에만 적은 옛 의존 |\n| **drop** | 증거 없음 — 사유와 함께 보고만 한다 |"
      )
    ).not.toEqual([]);
  }, 1200000);
});

describe("FR-FLOW-209 AC-1 — kiwi-srs prescribes no citation form prd coverage does not count", () => {
  // @req FR-FLOW-209 AC-1 — a Rationale citing a PRD item in exactly the form a rendering prescribes
  // SHALL be counted. The mutation keeps the prescribed `AC-n ← PRD-m` in the §9.1 author context and
  // adds an alternative without the `PRD-` prefix, which coverage does not read as a citation.
  it("claude §9.1: an alternative citation form `AC-n ← m` beside the prescribed one is caught", () => {
    expect(
      killedBy(
        "kiwi-srs",
        SRS,
        "Rationale 에 인용한 PRD 항목(`AC-n ← PRD-m`)이나 `fills:` 근거를 적는다(핵심 규칙 블록)",
        "Rationale 에 인용한 PRD 항목(`AC-n ← PRD-m`)이나 `fills:` 근거를 적는다(핵심 규칙 블록) — 항목 번호만 `AC-n ← m` 으로 적어도 된다"
      )
    ).not.toEqual([]);
  }, 1200000);
});

describe("FR-FLOW-210 AC-1 — kiwi-prd §3 cannot merge a design document's sentences into one item", () => {
  // @req FR-FLOW-210 AC-1 — one PRD item per normative sentence, and SHALL NOT merge two into one item.
  // The mutation adds a §3 bullet that makes one item per section of a design document, quoting the
  // section whole, without using the word the FR-FLOW-210 suite looks for (규범).
  it("claude §3: a bullet making one item per section of a design document is caught", () => {
    expect(
      killedBy(
        "kiwi-prd",
        "skills/claude/kiwi-prd/SKILL.md",
        "규범 문장 둘을 한 항목에 합치지 않는다.\n",
        "규범 문장 둘을 한 항목에 합치지 않는다.\n- 설계 문서는 절마다 항목 하나를 만들고 그 절을 통째로 인용 블록으로 옮긴다.\n"
      )
    ).not.toEqual([]);
  }, 1200000);
});

describe("FR-FLOW-211 AC-2 — kiwi-pm §1.1 cannot let a missing --req-filter ID through", () => {
  // @req FR-FLOW-211 AC-2 — WHEN a requirement named by --req-filter does not exist, kiwi-pm SHALL stop
  // before kiwi-coder runs and name the ID. The mutation adds a §1.1 bullet that, under --auto, drops
  // the missing IDs and runs kiwi-coder on the rest, worded without any of the suite's site tokens.
  it("claude §1.1: a bullet that runs kiwi-coder on the rest when an ID is not found is caught", () => {
    expect(
      killedBy(
        "kiwi-pm",
        "skills/claude/kiwi-pm/SKILL.md",
        "- **`--sds <path>` (별칭 `SDS_PATH=<path>`)**",
        "- `--auto` 에서는 찾지 못한 ID 를 빼고 남은 요구로 kiwi-coder 를 띄운다.\n- **`--sds <path>` (별칭 `SDS_PATH=<path>`)**"
      )
    ).not.toEqual([]);
  }, 1200000);
});
