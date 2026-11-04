import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { checkPrd, parsePrd, PRD_DIAGNOSTIC_CODES } from "../../../src/core/prd/index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { buildPrd, DEFAULT_ITEMS, DEFAULT_USER_BLOCKS, type FixtureItem } from "./prd-fixture.js";

const PATH = "docs/prd/2026-11-04.reset.prd.md";

function codes(text: string | Uint8Array): string[] {
  return checkPrd(parsePrd(text, PATH)).map((item) => item.code);
}

function withItem(index: number, patch: Partial<FixtureItem>): FixtureItem[] {
  return DEFAULT_ITEMS.map((item, position) => (position === index ? { ...item, ...patch, rows: { ...item.rows, ...(patch.rows ?? {}) } } : item));
}

describe("FR-NODE-240 PRD check", () => {
  it("passes a PRD written in the kiwi-prd grammar", () => {
    expect(checkPrd(parsePrd(buildPrd(), PATH))).toEqual([]);
  });

  it("passes the committed kiwi-prd example and counts its items as the skill's prd-quote command does", async () => {
    const doc = parsePrd(await readFile("test/fixtures/prd/rbac.prd.md", "utf8"), "docs/prd/rbac.prd.md");
    expect(checkPrd(doc)).toEqual([]);
    expect(doc.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4", "PRD-5", "PRD-6", "PRD-7", "PRD-8"]);
  });

  // @req FR-NODE-240 AC-1
  it("reports a gap and a duplicate in PRD-<n> numbering, each with its own code", () => {
    const gap = codes(buildPrd({ items: withItem(3, { number: 5 }) }));
    expect(gap).toContain(PRD_DIAGNOSTIC_CODES.numberingGap);
    expect(gap).not.toContain(PRD_DIAGNOSTIC_CODES.numberingDuplicate);
    const duplicate = codes(buildPrd({ items: withItem(1, { number: 1 }) }));
    expect(duplicate).toContain(PRD_DIAGNOSTIC_CODES.numberingDuplicate);
    expect(PRD_DIAGNOSTIC_CODES.numberingGap).not.toBe(PRD_DIAGNOSTIC_CODES.numberingDuplicate);
  });

  // @req FR-NODE-240 AC-1
  it("reports a numbering fault for exactly the item headings the skill's prd-quote command rejects", async () => {
    const text = buildPrd();
    const skill = await readFile("skills/claude/kiwi-prd/SKILL.md", "utf8");
    const command = skill.split("\n").filter((line) => line.startsWith('node -e "'))[1]!;
    const script = command.slice('node -e "'.length, command.lastIndexOf('" docs/prd/'));
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-prd-quote-"));
    const headings = [
      ["### PRD-1 Title", true],
      ["### PRD-1 - Title", true],
      ["### PRD-1 —  ", true],
      ["### PRD-01 — 재설정 목적", false],
      ["### PRD-1", false],
      ["### PRD-1— 재설정 목적", false],
      ["### PRD-1a — 재설정 목적", false]
    ] as const;
    for (const [heading, skillAccepts] of headings) {
      const variant = text.replace("### PRD-1 — 재설정 목적", heading);
      const file = path.join(dir, "variant.prd.md");
      await writeFile(file, variant, "utf8");
      const run = spawnSync(process.execPath, ["-e", script, file], { encoding: "utf8" });
      expect(run.stdout.includes("PRD-1 numbering"), heading).toBe(!skillAccepts);
      const found = codes(variant).includes(PRD_DIAGNOSTIC_CODES.numberingGap);
      expect(found, heading).toBe(!skillAccepts);
    }
    await rm(dir, { recursive: true, force: true });
    expect(parsePrd(text.replace("### PRD-1 — 재설정 목적", "### PRD-1 - Title"), PATH).items[0]!.title).toBe("Title");
    const misnumbered = parsePrd(text.replace("### PRD-2 — Reset link", "### PRD-1a — Reset link"), PATH);
    expect(misnumbered.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-1a", "PRD-3", "PRD-4"]);
    const twoMalformed = codes(text.replace("### PRD-1 — 재설정 목적", "### PRD-1").replace("### PRD-2 — Reset link", "### PRD-2"));
    expect(twoMalformed).not.toContain(PRD_DIAGNOSTIC_CODES.numberingDuplicate);
  });

  // @req FR-NODE-240 AC-1
  it("hashes the bytes as the skill's prd-hash does, also when the User Request holds a byte that is not UTF-8", () => {
    const text = buildPrd();
    const bytes = Buffer.from(text, "utf8");
    const at = bytes.indexOf(Buffer.from("Password reset", "utf8"));
    const raw = Buffer.concat([bytes.subarray(0, at), Buffer.from([0xe9]), bytes.subarray(at)]);
    const folded = raw.toString("latin1");
    const start = folded.indexOf("\n## 1. User Request") + 1;
    const end = folded.indexOf("\n## ", start) + 1;
    const skillHash = createHash("sha256").update(folded.slice(start, end), "latin1").digest("hex");
    const sealed = Buffer.from(raw.toString("latin1").replace(/\| Request SHA256 \| [0-9a-f]{64} \|/, `| Request SHA256 | ${skillHash} |`), "latin1");
    expect(codes(sealed)).not.toContain(PRD_DIAGNOSTIC_CODES.requestSha);
    expect(parsePrd(sealed, PATH).pointer).toBe(`${PATH}@sha256:${createHash("sha256").update(sealed).digest("hex")}`);
  });

  // @req FR-NODE-240 AC-1
  it("reports a Kind outside its list", () => {
    expect(codes(buildPrd({ items: withItem(1, { rows: { Kind: "feature" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.kind);
  });

  // @req FR-NODE-240 AC-1
  it("reports an Exclusion Class outside its list, missing on an exclusion, or present on another kind", () => {
    expect(codes(buildPrd({ items: withItem(2, { rows: { "Exclusion Class": "later" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.exclusionClass);
    const withoutClass = DEFAULT_ITEMS.map((item, position) =>
      position === 2 ? { ...item, rows: { Kind: "exclusion", Source: "U-2", State: "confirmed" } } : item
    );
    expect(codes(buildPrd({ items: withoutClass }))).toContain(PRD_DIAGNOSTIC_CODES.exclusionClass);
    expect(codes(buildPrd({ items: withItem(1, { rows: { "Exclusion Class": "superseded" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.exclusionClass);
  });

  // @req FR-NODE-240 AC-1
  it("reports a Source naming no U-<n> block", () => {
    const found = codes(buildPrd({ items: withItem(1, { rows: { Source: "U-9" } }) }));
    expect(found).toContain(PRD_DIAGNOSTIC_CODES.source);
    expect(found).not.toContain(PRD_DIAGNOSTIC_CODES.quote);
  });

  // @req FR-NODE-240 AC-1
  it("reports a quote absent from its source block, including the agent's question in an answer block", () => {
    expect(codes(buildPrd({ items: withItem(1, { quote: "expire after one day" }) }))).toContain(PRD_DIAGNOSTIC_CODES.quote);
    expect(codes(buildPrd({ items: withItem(2, { quote: "소셜 로그인도 포함할까요?" }) }))).toContain(PRD_DIAGNOSTIC_CODES.quote);
    expect(codes(buildPrd({ items: withItem(1, { quote: undefined }) }))).toContain(PRD_DIAGNOSTIC_CODES.quote);
  });

  // @req FR-NODE-240 AC-1
  it("reports a Request SHA256 mismatch when a user block changes after the hash was written", () => {
    const text = buildPrd();
    expect(codes(text)).not.toContain(PRD_DIAGNOSTIC_CODES.requestSha);
    const tampered = text.replace("비밀번호 재설정 링크를 추가해 주세요.", "비밀번호 재설정 링크를 추가해 주세요!");
    expect(codes(tampered)).toContain(PRD_DIAGNOSTIC_CODES.requestSha);
    expect(codes(buildPrd({ requestSha: "-" }))).toContain(PRD_DIAGNOSTIC_CODES.requestSha);
  });

  // @req FR-NODE-240 AC-1
  it("hashes the User Request section with CRLF folded to LF, as the kiwi-prd prd-hash command does", () => {
    expect(codes(buildPrd().replace(/\n/g, "\r\n"))).not.toContain(PRD_DIAGNOSTIC_CODES.requestSha);
  });

  // @req FR-NODE-240 AC-1
  it("reports a Requirement ID, a SHALL statement or an AC line outside the user's words, and leaves the user's words alone", () => {
    expect(codes(buildPrd({ items: withItem(0, { body: "FR-AUTH-001 에서 다룬다." }) }))).toContain(PRD_DIAGNOSTIC_CODES.requirementGrammar);
    expect(codes(buildPrd({ items: withItem(0, { body: "The system SHALL send a link." }) }))).toContain(PRD_DIAGNOSTIC_CODES.requirementGrammar);
    expect(codes(buildPrd({ items: withItem(0, { body: "- [ ] AC-1: link works" }) }))).toContain(PRD_DIAGNOSTIC_CODES.requirementGrammar);
    // A proposal's quote is the agent's words, so it is checked too.
    expect(codes(buildPrd({ items: withItem(3, { quote: "The system SHALL limit requests." }) }))).toContain(PRD_DIAGNOSTIC_CODES.requirementGrammar);
    const userWords = ["### U-1 — 2026-11-04 request\n\n> 비밀번호 재설정 링크를 추가해 주세요. FR-AUTH-001 SHALL stay.\n> Password reset email must expire after one hour.\n", DEFAULT_USER_BLOCKS[1]!];
    const quoted = withItem(0, { quote: "FR-AUTH-001 SHALL stay." });
    expect(codes(buildPrd({ userBlocks: userWords, items: quoted, approval: "SHALL 로 써도 승인합니다" }))).toEqual([]);
  });

  it("reports the remaining kiwi-prd gate checks: State, proposal Reason and Effect, a missing intent, an item outside Items", () => {
    expect(codes(buildPrd({ items: withItem(1, { rows: { State: "done" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.state);
    expect(codes(buildPrd({ items: withItem(3, { rows: { Reason: "" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.proposal);
    expect(codes(buildPrd({ items: withItem(3, { rows: { Effect: "maybe" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.proposal);
    expect(codes(buildPrd({ items: withItem(0, { rows: { Kind: "goal" } }) }))).toContain(PRD_DIAGNOSTIC_CODES.noIntent);
    expect(codes(buildPrd({ extraAfterItems: "## 2.5 Notes\n\n### PRD-9 — stray\n" }))).toContain(PRD_DIAGNOSTIC_CODES.itemOutsideItems);
  });

  it("accepts an inferred-intent proposal in place of an intent only for an --auto unapproved PRD", () => {
    const inferred = withItem(0, { rows: { Kind: "proposal", Source: "", State: "proposed", Reason: "inferred intent: self-service", Effect: "in-scope" }, quote: undefined });
    expect(codes(buildPrd({ items: inferred, status: "unapproved", approved: "--auto" }))).not.toContain(PRD_DIAGNOSTIC_CODES.noIntent);
    expect(codes(buildPrd({ items: inferred }))).toContain(PRD_DIAGNOSTIC_CODES.noIntent);
  });

  it("gives every diagnostic a distinct code, a PRD file path and a line", () => {
    expect(new Set(Object.values(PRD_DIAGNOSTIC_CODES)).size).toBe(Object.values(PRD_DIAGNOSTIC_CODES).length);
    const found = checkPrd(parsePrd(buildPrd({ items: withItem(1, { rows: { Kind: "feature" } }) }), PATH));
    expect(found[0]).toMatchObject({ severity: "error", filePath: PATH });
    expect(found[0]!.line).toBeGreaterThan(0);
  });
});

describe("FR-NODE-240 PRD parser boundaries", () => {
  // @req FR-NODE-240 AC-2
  it("keeps PRD items out of the requirement queries when a PRD sits in the workspace", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(root, "docs", "prd"), { recursive: true });
    await writeFile(path.join(root, PATH), buildPrd(), "utf8");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    expect(workspace.records.length).toBeGreaterThan(0);
    expect(workspace.records.filter((record) => record.id.startsWith("PRD-") || record.filePath.includes("docs/prd"))).toEqual([]);
    expect(workspace.diagnostics.filter((item) => item.filePath?.includes("docs/prd"))).toEqual([]);
  });

  // @req FR-NODE-240 AC-2
  it("imports the shared markdown table parser instead of a second implementation", async () => {
    const source = await readFile("src/core/prd/parse.ts", "utf8");
    expect(source).toMatch(/from "\.\.\/parser\/table\.js"/);
    expect(source).not.toMatch(/split\("\|"\)|isSeparator/);
  });

  // @req FR-NODE-240 AC-2
  it("reads metadata rows through the table parser, so a padded or aligned table reads the same", () => {
    const text = buildPrd().replace("| Kind | in-scope |", "|   Kind   |   in-scope   |").replace("|---|---|\n| Kind | in-scope", "| :--- | ---: |\n| Kind | in-scope");
    const doc = parsePrd(text, PATH);
    expect(doc.items[1]!.kind).toBe("in-scope");
  });
});

const FENCE = "```";

async function skillVerdict(text: string): Promise<boolean> {
  const skill = await readFile("skills/claude/kiwi-prd/SKILL.md", "utf8");
  const scripts = skill
    .split("\n")
    .filter((line) => line.startsWith('node -e "'))
    .map((line) => line.slice('node -e "'.length, line.lastIndexOf('" docs/prd/')));
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-prd-gate-"));
  const file = path.join(dir, "variant.prd.md");
  await writeFile(file, text, "utf8");
  const passed = scripts.every((script) => spawnSync(process.execPath, ["-e", script, file], { encoding: "utf8" }).status === 0);
  await rm(dir, { recursive: true, force: true });
  return passed;
}

function withRequestSha(text: string): string {
  const folded = text.replace(/\r\n/g, "\n");
  const start = folded.indexOf("\n## 1. User Request") + 1;
  const end = folded.indexOf("\n## ", start) + 1;
  const sha = createHash("sha256").update(folded.slice(start, end), "utf8").digest("hex");
  return text.replace(/\| Request SHA256 \| [^|]* \|/, `| Request SHA256 | ${sha} |`);
}

describe("FR-NODE-240 PRD section boundaries against the skill's gate", () => {
  const base = buildPrd();
  const variants: Array<[string, string]> = [
    ["a fenced `## ` line in an item body", base.replace("사용자가 스스로 비밀번호를 복구한다.", `사용자가 스스로 비밀번호를 복구한다.\n\n${FENCE}\n## Example\n${FENCE}`)],
    ["a fenced `## ` line in the Approval section", base.replace("## 3. Approval\n", `## 3. Approval\n\n${FENCE}\n## Example\n${FENCE}\n`)],
    ["a fenced `## ` line before the header table", base.replace("> 이 문서는 kiwi-prd 만 쓴다. 검증·개선 루프는 읽기만 한다.\n", `> 이 문서는 kiwi-prd 만 쓴다. 검증·개선 루프는 읽기만 한다.\n\n${FENCE}\n## Example\n${FENCE}\n`)],
    ["a fenced `## ` line in a user block outside its quote", withRequestSha(base.replace("### U-2 — 2026-11-04 answer\n", `### U-2 — 2026-11-04 answer\n\n${FENCE}\n## Example\n${FENCE}\n`))]
  ];

  // @req FR-NODE-240 AC-1
  it.each(variants)("passes or fails %s exactly as kiwi-prd's prd-hash and prd-quote do", async (_name, text) => {
    const toolPasses = checkPrd(parsePrd(text, PATH)).length === 0;
    expect(toolPasses).toBe(await skillVerdict(text));
  });
});
