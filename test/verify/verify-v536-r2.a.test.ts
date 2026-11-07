import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { appendAcceptanceCriterion } from "../../src/core/mutation/check-ac.js";
import { installSkill, removeManagedKiwiSkills } from "../../src/core/skills/install-skill.js";
import type { ProjectRoot, RequirementRecord } from "../../src/core/types.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// verify-v536-r2 — independent round 2 over the delta since round 1:
// FR-NODE-277 AC-3 (legacy every-choice proof and its 8-text-file cap) and FR-MCP-072 AC-2
// (append position after the last criterion's indented content).

vi.setConfig({ testTimeout: 120_000 });

// ---------------------------------------------------------------------------------------------
// FR-NODE-277 AC-3
// ---------------------------------------------------------------------------------------------

const METADATA = ".speckiwi-skill-install.json";
type Ending = "lf" | "crlf";
function toEnding(bytes: Buffer, ending: Ending): Buffer {
  const lf = bytes.toString("latin1").replace(/\r\n/g, "\n");
  return Buffer.from(ending === "lf" ? lf : lf.replace(/\n/g, "\r\n"), "latin1");
}
async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}
async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile() && entry.name !== METADATA) found.push(full);
  }
  return found;
}
async function rewriteText(dir: string, ending: Ending): Promise<void> {
  for (const file of await filesUnder(dir)) {
    const bytes = await readFile(file);
    if (bytes.includes(0)) continue;
    await writeFile(file, toEnding(bytes, ending));
  }
}
async function predate(dir: string): Promise<void> {
  const file = path.join(dir, METADATA);
  const metadata = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  delete metadata.installedChecksumIgnoringLineEndings;
  await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

/** SKILL.md CRLF, references/guide.md LF, `extra` more LF text files, `binaries` NUL-holding files. */
async function installMixed(extra: number, binaries: number): Promise<{ dest: string; copy: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "v536-r2-eol-"));
  const dir = path.join(root, "skills", "claude", "kiwi-a");
  await mkdir(path.join(dir, "references"), { recursive: true });
  await mkdir(path.join(dir, "assets"), { recursive: true });
  const body = ["---", "name: kiwi-a", "description: test skill", "---", "", "# kiwi-a", "", "Normal operation requires speckiwi mcp.", ""].join("\n");
  await writeFile(path.join(dir, "SKILL.md"), toEnding(Buffer.from(body), "crlf"));
  await writeFile(path.join(dir, "references", "guide.md"), Buffer.from("guide\nsecond line\n"));
  for (let i = 0; i < extra; i += 1) await writeFile(path.join(dir, "references", `x-${i}.md`), Buffer.from(`x ${i}\nline\n`));
  for (let i = 0; i < binaries; i += 1) await writeFile(path.join(dir, "assets", `b-${i}.bin`), Buffer.from(`a\nb\u0000${i}\n`, "latin1"));
  const result = await installSkill({
    projectRoot: { root },
    agent: "claude",
    selector: "all",
    scope: "project",
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    dryRun: false
  });
  if (!result.ok) throw new Error(result.error.message);
  const dest = path.join(root, ".claude", "skills");
  const copy = path.join(dest, "kiwi-a");
  await predate(copy);
  return { dest, copy };
}
async function prune(dest: string) {
  return removeManagedKiwiSkills({ destinationRoot: dest, agent: "claude", keepNames: [], dryRun: false, reconcileSharedMirror: true });
}

describe("R2-A FR-NODE-277 AC-3 — the cap counts text files, not files", () => {
  // 8 text files + 2 binaries = 10 files; AC-3 says "at most 8 text files" are fully enumerated.
  it("legacy, mixed install of 8 text files and 2 binaries, text rewritten to CRLF: removed", async () => {
    const s = await installMixed(6, 2);
    await rewriteText(s.copy, "crlf");
    const outcome = await prune(s.dest);
    expect(outcome.removed).toContain(s.copy);
    expect(await exists(s.copy)).toBe(false);
  });

  // Wrong-removal direction under the full enumeration: one changed non-line-ending byte keeps it.
  it("legacy, 8 text files, every per-file choice tried, one edited byte: kept as locally-modified", async () => {
    const s = await installMixed(6, 0);
    await rewriteText(s.copy, "crlf");
    const guide = path.join(s.copy, "references", "guide.md");
    await writeFile(guide, Buffer.from((await readFile(guide)).toString("latin1").replace("guide", "guidE"), "latin1"));
    const outcome = await prune(s.dest);
    expect(outcome.kept.find((entry) => entry.path === s.copy)?.reason).toBe("locally-modified");
    expect(await exists(s.copy)).toBe(true);
  });

  // A lone CR is not a line ending; it must not be folded away.
  it("legacy, a lone CR inserted into an LF file: kept", async () => {
    const s = await installMixed(0, 0);
    const guide = path.join(s.copy, "references", "guide.md");
    await writeFile(guide, Buffer.from("guide\rsecond line\n"));
    const outcome = await prune(s.dest);
    expect(outcome.kept.find((entry) => entry.path === s.copy)?.reason).toBe("locally-modified");
  });
});

// ---------------------------------------------------------------------------------------------
// FR-MCP-072 AC-2
// ---------------------------------------------------------------------------------------------

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const HEAD = [
  "# Product Architecture", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ARCH |",
  "| Scope Name | Product Architecture |", "", "## 1. Scope Overview", "", "Mutation architecture scope.", "",
  "## 2. Scope Boundaries", "", "### In Scope", "", "- Markdown requirements", "", "### Out of Scope", "",
  "- External database", "", "## 3. Assumptions and Constraints", "", "- None", "", "## 4. Requirements", ""
];
const TAIL = ["## 5. Cross-scope Dependencies", "", "- None", ""];
const BLOCK_HEAD = (id: string): string[] => [
  `### ${id} — Block ${id}`, "", "| Field | Value |", "| --- | --- |", "| Type | functional |", "| Target | v1.0.0 |",
  "| Status | planned |", "| Priority | high |", "| Tags | fixture |", "| Risk | low |", "| Stability | stable |",
  "| Verification Method | test |", "| GitHub Issue | - |", "| Related Docs | - |", "", "#### Requirement", "",
  `SpecKiwi must mutate ${id}.`, "", "#### Rationale", "", "Mutation tests need a target.", "", "#### Acceptance Criteria", ""
];
const AFTER = ["#### Implementation Notes", "", "- src/core/mutation", ""];

async function workspace(lines: string[], crlf = false): Promise<{ root: ProjectRoot; specPath: string }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const specPath = path.join(rootPath, SPEC);
  const text = [...HEAD, ...lines, ...TAIL].join("\n");
  await writeFile(specPath, crlf ? text.replace(/\n/g, "\r\n") : text, "utf8");
  return { root: await resolveProjectRoot(rootPath), specPath };
}
async function records(root: ProjectRoot): Promise<Map<string, RequirementRecord>> {
  return new Map((await parseWorkspace(root)).records.map((record) => [record.id, record]));
}
async function errors(root: ProjectRoot): Promise<string[]> {
  const parsed = await parseWorkspace(root);
  return [...parsed.diagnostics, ...validateWorkspace(parsed).diagnostics].filter((d) => d.severity === "error").map((d) => `${d.code}:${d.message}`);
}
function acs(record: RequirementRecord | undefined): Array<[string, string, boolean]> {
  return (record?.acceptanceCriteria ?? []).map((c) => [c.id, c.text, c.checked]);
}

describe("R2-B FR-MCP-072 AC-2 — append position", () => {
  it("indented code block with blank lines inside, under the last criterion: new AC after the whole block", async () => {
    const ac = [
      "- [x] AC-1: One.",
      "- [ ] AC-2: Two, with an example:",
      "",
      "      speckiwi show FR-ARCH-001",
      "",
      "      speckiwi validate",
      ""
    ];
    const { root, specPath } = await workspace([...BLOCK_HEAD("FR-ARCH-001"), ...ac, ...AFTER, ...BLOCK_HEAD("FR-ARCH-002"), "- [ ] AC-1: Other.", "", ...AFTER]);
    expect(await errors(root)).toEqual([]);
    const before = acs((await records(root)).get("FR-ARCH-001"));
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Three." });
    expect(result.ok, result.error?.message).toBe(true);
    const lines = (await readFile(specPath, "utf8")).split("\n");
    const start = lines.indexOf("- [ ] AC-2: Two, with an example:");
    expect(lines.slice(start, start + 9)).toEqual([
      "- [ ] AC-2: Two, with an example:", "", "      speckiwi show FR-ARCH-001", "", "      speckiwi validate", "- [ ] AC-3: Three.", "", "#### Implementation Notes", ""
    ]);
    const after = await records(root);
    expect(acs(after.get("FR-ARCH-001"))).toEqual([...before, ["AC-3", "Three.", false]]);
    expect(acs(after.get("FR-ARCH-002"))).toEqual([["AC-1", "Other.", false]]);
    expect(await errors(root)).toEqual([]);
  });

  it("loose list (blank lines between criteria): new AC after the last criterion, the next heading intact", async () => {
    const ac = ["- [x] AC-1: One.", "", "- [ ] AC-2: Two.", "", "- [ ] AC-3: Three.", ""];
    const { root, specPath } = await workspace([...BLOCK_HEAD("FR-ARCH-001"), ...ac, ...AFTER]);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Four." });
    expect(result.ok, result.error?.message).toBe(true);
    const lines = (await readFile(specPath, "utf8")).split("\n");
    const start = lines.indexOf("- [ ] AC-3: Three.");
    expect(lines.slice(start, start + 4)).toEqual(["- [ ] AC-3: Three.", "- [ ] AC-4: Four.", "", "#### Implementation Notes"]);
    expect(acs((await records(root)).get("FR-ARCH-001")).map((c) => c[0])).toEqual(["AC-1", "AC-2", "AC-3", "AC-4"]);
    expect(await errors(root)).toEqual([]);
  });

  it("criteria are the last section of the block and the next block heading follows: the AC lands in the right block", async () => {
    const { root, specPath } = await workspace([
      ...BLOCK_HEAD("FR-ARCH-001"), "- [ ] AC-1: One.", "  - detail of AC-1", "",
      ...BLOCK_HEAD("FR-ARCH-002"), "- [ ] AC-1: Other.", ""
    ]);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Two." });
    expect(result.ok, result.error?.message).toBe(true);
    const lines = (await readFile(specPath, "utf8")).split("\n");
    const start = lines.indexOf("- [ ] AC-1: One.");
    expect(lines.slice(start, start + 5)).toEqual(["- [ ] AC-1: One.", "  - detail of AC-1", "- [ ] AC-2: Two.", "", "### FR-ARCH-002 — Block FR-ARCH-002"]);
    const after = await records(root);
    expect(acs(after.get("FR-ARCH-001")).map((c) => c[0])).toEqual(["AC-1", "AC-2"]);
    expect(acs(after.get("FR-ARCH-002"))).toEqual([["AC-1", "Other.", false]]);
  });

  it("CRLF file with nested detail: the new AC follows the detail and the file stays CRLF only", async () => {
    const { root, specPath } = await workspace([...BLOCK_HEAD("FR-ARCH-001"), "- [ ] AC-1: One.", "  - detail a", "  - detail b", "", ...AFTER], true);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Two." });
    expect(result.ok, result.error?.message).toBe(true);
    const text = await readFile(specPath, "utf8");
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    const lines = text.split("\r\n");
    const start = lines.indexOf("- [ ] AC-1: One.");
    expect(lines.slice(start, start + 4)).toEqual(["- [ ] AC-1: One.", "  - detail a", "  - detail b", "- [ ] AC-2: Two."]);
    expect(await errors(root)).toEqual([]);
  });

  it("a whitespace-only line between the last criterion and the next heading: inserted before it, heading intact", async () => {
    const { root, specPath } = await workspace([...BLOCK_HEAD("FR-ARCH-001"), "- [ ] AC-1: One.", "   ", ...AFTER]);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Two." });
    expect(result.ok, result.error?.message).toBe(true);
    const lines = (await readFile(specPath, "utf8")).split("\n");
    const start = lines.indexOf("- [ ] AC-1: One.");
    expect(lines.slice(start, start + 4)).toEqual(["- [ ] AC-1: One.", "- [ ] AC-2: Two.", "   ", "#### Implementation Notes"]);
    expect(await errors(root)).toEqual([]);
  });
});
