import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SRS_RULES_FILENAME,
  RULES_DOCUMENT_FILENAME_PATTERN,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-086 — the bundled rules documents and the injected agent instruction block are English,
// and init migrates a previously injected Korean-headed block in place.
//
// Red-phase suite: one describe per acceptance criterion (AC-1..AC-8). Every behavioural case builds
// a real project in a temp directory and calls initProject, so the assertions read the actual file
// system result rather than an implementation-shaped mock.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-086):
//   - AC-1: the bundled authoring rules documents init installs contain no Hangul.
//   - AC-2: the translation preserves the normative content the runtime enforces.
//   - AC-3: no part of the injected block — heading and end marker included — contains Hangul.
//   - AC-4: AGENT_INSTRUCTION_VERSION is raised above the pre-change 1.6.
//   - AC-5: init recognises the previously injected Korean-headed block and replaces it in place.
//   - AC-6: consumer content outside the replaced block survives.
//   - AC-7: an already-English block is still recognised by the existing versioned path.
//   - AC-8: this repository's own agent files carry the English block.

/**
 * Any Hangul code point, not only precomposed syllables: syllables (AC00–D7A3), conjoining jamo
 * (1100–11FF, D7B0–D7FF, A960–A97F) and compatibility jamo (3130–318F). A superset of the
 * `[가-힣]` scan, so a translation that leaves a stray jamo behind is still caught.
 */
const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/u;
const HANGUL_PATTERN_GLOBAL = new RegExp(HANGUL_PATTERN.source, "gu");

/** The heading and end marker that init injected before this change; fixtures replay them verbatim. */
const KOREAN_AGENT_HEADING_PREFIX = "# SpecKiwi SRS 워크플로 v";
const KOREAN_AGENT_END_MARKER = "<!-- /SpecKiwi SRS 워크플로 -->";

/** The agent instruction version this change supersedes (FR-NODE-086 AC-4). */
const SUPERSEDED_AGENT_INSTRUCTION_VERSION = "1.6";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-en-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function initOnce(rootPath: string) {
  const result = await initProject(await resolveProjectRoot(rootPath), {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function hangulIn(content: string): string[] {
  return content.match(HANGUL_PATTERN_GLOBAL) ?? [];
}

/** The lines carrying Hangul, so a failure names the offending text instead of a bare count. */
function hangulLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => HANGUL_PATTERN.test(line));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) throw new Error("countOccurrences needs a non-empty needle");
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** The managed block, heading through end marker inclusive, delimited by the shipped constants. */
function extractManagedBlock(content: string, headingPrefix: string, endMarker: string): string | undefined {
  const start = content.indexOf(headingPrefix);
  if (start === -1) return undefined;
  const markerAt = content.indexOf(endMarker, start);
  if (markerAt === -1) return undefined;
  return content.slice(start, markerAt + endMarker.length);
}

/**
 * The consumer-owned text on either side of the managed block, normalised only at the block junction
 * and the file boundary — exactly the two places a same-language upgrade already rewrites today:
 * replaceAgentInstructionBlock joins `before.trimEnd()`, the snippet and `after.trimStart()` with
 * blank lines and appends a trailing newline. Every byte inside the two returned segments — blank
 * lines, indentation and pipes included — is compared verbatim, so any reflow of consumer content
 * still fails.
 */
function outsideBlock(content: string, headingPrefix: string, endMarker: string): { before: string; after: string } {
  const start = content.indexOf(headingPrefix);
  const markerAt = content.indexOf(endMarker, start === -1 ? 0 : start);
  if (start === -1 || markerAt === -1) throw new Error("fixture or result has no managed block to split on");
  return {
    before: content.slice(0, start).trimEnd(),
    after: content.slice(markerAt + endMarker.length).trim()
  };
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** Top-level `## N. Title` headings outside fenced code blocks, so embedded examples do not count. */
function topLevelSectionNumbers(document: string): number[] {
  const numbers: number[] = [];
  let inFence = false;
  for (const line of document.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^## (\d+)\. /.exec(line);
    if (match) numbers.push(Number(match[1]));
  }
  return numbers;
}

async function readInstalledSrsRules(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8");
}

describe("FR-NODE-086 AC-1 — the bundled rules documents init installs contain no Hangul", () => {
  it("FR-NODE-086 AC-1: the installed SRS-MD authoring rules document contains no Hangul", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const rules = await readInstalledSrsRules(rootPath);
    expect(hangulLines(rules).slice(0, 10), `${BUNDLED_SRS_RULES_FILENAME} must be English`).toEqual([]);
    expect(hangulIn(rules)).toEqual([]);
  });

  it("FR-NODE-086 AC-1: the installed SDS-MD authoring rules document contains no Hangul", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const rules = await readFile(path.join(rootPath, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "utf8");
    expect(hangulLines(rules).slice(0, 10), `${BUNDLED_SDS_RULES_FILENAME} must be English`).toEqual([]);
    expect(hangulIn(rules)).toEqual([]);
  });

  it("FR-NODE-086 AC-1: every rules document init leaves in docs/rule is English", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const rulesDir = path.join(rootPath, "docs", "rule");
    const installed = (await readdir(rulesDir)).filter((name) => RULES_DOCUMENT_FILENAME_PATTERN.test(name));
    expect(installed.sort()).toEqual([BUNDLED_SDS_RULES_FILENAME, BUNDLED_SRS_RULES_FILENAME].sort());
    for (const name of installed) {
      const content = await readFile(path.join(rulesDir, name), "utf8");
      expect(hangulLines(content).slice(0, 5), `${name} must be English`).toEqual([]);
    }
  });
});

describe("FR-NODE-086 AC-2 — the translation preserves the normative content the runtime enforces", () => {
  it("FR-NODE-086 AC-2: the diagnostic codes in the installed rules document match the runtime registry exactly", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const rules = await readInstalledSrsRules(rootPath);

    const documented = [...new Set(rules.match(/SRS-[EW]\d+/g) ?? [])].sort();
    const registered = [...new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code))].sort();

    expect(documented.filter((code) => !registered.includes(code)), "rules document names codes the runtime does not define").toEqual([]);
    expect(registered.filter((code) => !documented.includes(code)), "runtime defines codes the rules document lost").toEqual([]);
    expect(documented).toEqual(registered);
  });

  it("FR-NODE-086 AC-2: the identifier and heading grammars survive verbatim", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const rules = await readInstalledSrsRules(rootPath);

    // The two regexes the parsing contract is stated in, plus the two shape templates above them.
    // FR-NODE-087 replaced the heading expression's open `[A-Z]{2,5}` prefix run with the closed
    // type set the runtime actually matches and gave it the marker slot §30.1/§30.2 write, so the
    // document now states the grammar a consumer's heading is really read by.
    expect(rules).toContain(
      "^###\\s+(~~)?((?:FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4})\\s+—\\s+(.+?)(~~)?\\s*(?:\\[(DISCARDED|DRAFT)(?:[^\\]]*)\\])?\\s*$"
    );
    expect(rules).toContain("^(FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4}$");
    expect(rules).toContain("### {RequirementID} — {Title}");
    expect(rules).toContain("{PREFIX}-{SCOPE}-{NNN}");
  });

  it("FR-NODE-086 AC-2: the prefix-to-type mapping survives", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const rules = await readInstalledSrsRules(rootPath);

    const mapping: ReadonlyArray<readonly [string, string]> = [
      ["FR", "functional"],
      ["NFR", "non_functional"],
      ["IR", "interface"],
      ["DR", "data"],
      ["SEC", "security"],
      ["PERF", "performance"],
      ["REL", "reliability"],
      ["OBS", "observability"],
      ["OPS", "operational"],
      ["MIG", "migration"],
      ["CON", "constraint"]
    ];
    for (const [prefix, type] of mapping) {
      expect(rules, `prefix ${prefix} must still map to ${type}`).toMatch(
        new RegExp(`\\|\\s*\`${prefix}\`\\s*\\|\\s*\`${type}\`\\s*\\|`)
      );
    }
  });

  it("FR-NODE-086 AC-2: the requirement block field names and section headings survive", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const rules = await readInstalledSrsRules(rootPath);

    // Metadata field names the mutation and query layers address by literal name.
    for (const field of [
      "Type",
      "Target",
      "Status",
      "Priority",
      "Tags",
      "Risk",
      "Stability",
      "Verification Method",
      "GitHub Issue",
      "Related Docs"
    ]) {
      expect(rules, `metadata field name ${field} must survive`).toContain(field);
    }

    // Canonical requirement section headings (src/core/mutation/internal.ts CANONICAL_SECTION_ORDER).
    for (const heading of [
      "#### Requirement",
      "#### Rationale",
      "#### Acceptance Criteria",
      "#### Verification Evidence",
      "#### Trace Links",
      "#### Research / Analysis",
      "#### Implementation Notes",
      "#### Change Notes"
    ]) {
      expect(rules, `section heading ${heading} must survive`).toContain(heading);
    }

    // Index structure names the parser resolves by heading and by metadata row.
    for (const name of [
      "Target Map",
      "Scope Map",
      "Status Summary",
      "Requirement Type Summary",
      "Completed Work Log",
      "Cross-scope Dependencies",
      "Active Target",
      "| Document Type | srs_index |",
      "| Document Type | scope_srs |"
    ]) {
      expect(rules, `index structure name ${name} must survive`).toContain(name);
    }
  });

  it("FR-NODE-086 AC-2: the section numbering survives unchanged", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const rules = await readInstalledSrsRules(rootPath);

    // 42 top-level sections numbered 0..41, contiguous and in order.
    const numbers = topLevelSectionNumbers(rules);
    expect(numbers).toEqual(Array.from({ length: 42 }, (_, index) => index));
  });
});

describe("FR-NODE-086 AC-3 — no part of the injected block contains Hangul", () => {
  it("FR-NODE-086 AC-3: the heading prefix and the end marker constants are English", () => {
    expect(hangulIn(AGENT_INSTRUCTION_HEADING_PREFIX), "the injected heading must be English").toEqual([]);
    expect(hangulIn(AGENT_INSTRUCTION_END_MARKER), "the injected end marker must be English").toEqual([]);
  });

  it("FR-NODE-086 AC-3: the rendered snippet contains no Hangul", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(hangulLines(snippet), "the rendered agent instruction block must be English").toEqual([]);
    expect(snippet.startsWith(AGENT_INSTRUCTION_HEADING_PREFIX)).toBe(true);
    expect(snippet.trimEnd().endsWith(AGENT_INSTRUCTION_END_MARKER)).toBe(true);
  });

  it("FR-NODE-086 AC-3: the block init writes into both agent files is English from heading through end marker", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    for (const agentFile of ["AGENTS.md", "CLAUDE.md"] as const) {
      const content = await readFile(path.join(rootPath, agentFile), "utf8");
      const block = extractManagedBlock(content, AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_END_MARKER);
      expect(block, `${agentFile} must carry a managed block delimited by the shipped constants`).toBeDefined();
      expect(hangulLines(block ?? ""), `${agentFile} block must be English`).toEqual([]);
      // The boundaries are part of the block, so the Korean forms must be gone from the file entirely.
      expect(content).not.toContain(KOREAN_AGENT_HEADING_PREFIX);
      expect(content).not.toContain(KOREAN_AGENT_END_MARKER);
    }
  });
});

describe("FR-NODE-086 AC-4 — the agent instruction version is raised", () => {
  it("FR-NODE-086 AC-4: AGENT_INSTRUCTION_VERSION is higher than the superseded 1.6", () => {
    expect(
      compareVersions(AGENT_INSTRUCTION_VERSION, SUPERSEDED_AGENT_INSTRUCTION_VERSION),
      `AGENT_INSTRUCTION_VERSION ${AGENT_INSTRUCTION_VERSION} must be above ${SUPERSEDED_AGENT_INSTRUCTION_VERSION}`
    ).toBeGreaterThan(0);
  });

  it("FR-NODE-086 AC-4: the injected heading carries the raised version so the two blocks differ by version alone", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const content = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(content).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(content).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${SUPERSEDED_AGENT_INSTRUCTION_VERSION}`);
  });
});

describe("FR-NODE-086 AC-5 — init replaces a previously injected Korean-headed block in place", () => {
  it("FR-NODE-086 AC-5: a repository initialised before this change ends with exactly one block", async () => {
    const rootPath = await emptyRepo();
    const seeded = [
      "# Existing Agent Notes",
      "",
      "Consumer prose above the managed block.",
      "",
      `${KOREAN_AGENT_HEADING_PREFIX}1.6`,
      "",
      "Previously injected instructions.",
      "",
      KOREAN_AGENT_END_MARKER,
      "",
      "# Local Section",
      "",
      "Keep this section.",
      ""
    ].join("\n");
    await writeFile(path.join(rootPath, "AGENTS.md"), seeded, "utf8");
    await writeFile(path.join(rootPath, "CLAUDE.md"), seeded, "utf8");

    await initOnce(rootPath);

    for (const agentFile of ["AGENTS.md", "CLAUDE.md"] as const) {
      const content = await readFile(path.join(rootPath, agentFile), "utf8");
      expect(countOccurrences(content, KOREAN_AGENT_HEADING_PREFIX), `${agentFile} must keep no Korean heading`).toBe(0);
      expect(countOccurrences(content, KOREAN_AGENT_END_MARKER), `${agentFile} must keep no Korean end marker`).toBe(0);
      expect(countOccurrences(content, AGENT_INSTRUCTION_HEADING_PREFIX), `${agentFile} must carry exactly one block`).toBe(1);
      expect(countOccurrences(content, AGENT_INSTRUCTION_END_MARKER), `${agentFile} must carry exactly one end marker`).toBe(1);
      expect(content).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
      expect(content).not.toContain("Previously injected instructions.");
    }
  });

  it("FR-NODE-086 AC-5: the replacement also works on a CRLF file, as this repository's own agent files are", async () => {
    const rootPath = await emptyRepo();
    const seeded = [
      "# Existing Agent Notes",
      "",
      "Consumer prose above the managed block.",
      "",
      `${KOREAN_AGENT_HEADING_PREFIX}1.6`,
      "",
      "Previously injected instructions.",
      "",
      KOREAN_AGENT_END_MARKER,
      "",
      "# Local Section",
      "",
      "Keep this section.",
      ""
    ].join("\r\n");
    await writeFile(path.join(rootPath, "AGENTS.md"), seeded, "utf8");

    await initOnce(rootPath);

    const content = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(countOccurrences(content, KOREAN_AGENT_HEADING_PREFIX)).toBe(0);
    expect(countOccurrences(content, KOREAN_AGENT_END_MARKER)).toBe(0);
    expect(countOccurrences(content, AGENT_INSTRUCTION_HEADING_PREFIX)).toBe(1);
    expect(countOccurrences(content, AGENT_INSTRUCTION_END_MARKER)).toBe(1);
    expect(content).toContain("# Local Section");
    expect(content).toContain("Keep this section.");
  });

  it("FR-NODE-086 AC-5: a second init after the migration changes nothing further", async () => {
    const rootPath = await emptyRepo();
    await writeFile(
      path.join(rootPath, "AGENTS.md"),
      [`${KOREAN_AGENT_HEADING_PREFIX}1.6`, "", "Previously injected instructions.", "", KOREAN_AGENT_END_MARKER, ""].join("\n"),
      "utf8"
    );

    await initOnce(rootPath);
    const migrated = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    await initOnce(rootPath);
    const again = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");

    expect(again).toBe(migrated);
    expect(countOccurrences(again, AGENT_INSTRUCTION_HEADING_PREFIX)).toBe(1);
  });
});

describe("FR-NODE-086 AC-6 — consumer content outside the replaced block survives", () => {
  it("FR-NODE-086 AC-6: the text before and after the Korean block is byte-identical after the migration", async () => {
    const rootPath = await emptyRepo();
    const seeded = [
      "# Existing Agent Notes",
      "",
      "Consumer prose above the managed block.",
      "",
      "- a bullet with `inline code` and a | pipe",
      "",
      `${KOREAN_AGENT_HEADING_PREFIX}1.6`,
      "",
      "Previously injected instructions.",
      "",
      KOREAN_AGENT_END_MARKER,
      "",
      "# Local Section",
      "",
      "Keep this section.",
      "",
      "## Nested detail",
      "",
      "    indented block that must not be reflowed",
      ""
    ].join("\n");
    await writeFile(path.join(rootPath, "AGENTS.md"), seeded, "utf8");

    await initOnce(rootPath);

    const content = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    // Precondition: the migration actually happened.
    expect(countOccurrences(content, KOREAN_AGENT_HEADING_PREFIX)).toBe(0);
    expect(countOccurrences(content, AGENT_INSTRUCTION_HEADING_PREFIX)).toBe(1);

    const before = outsideBlock(seeded, KOREAN_AGENT_HEADING_PREFIX, KOREAN_AGENT_END_MARKER);
    const after = outsideBlock(content, AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_END_MARKER);
    expect(after.before).toBe(before.before);
    expect(after.after).toBe(before.after);
  });
});

describe("FR-NODE-086 AC-7 — an already-English block is recognised by the existing versioned path", () => {
  it("FR-NODE-086 AC-7: a file already carrying the current block is skipped, not rewritten", async () => {
    const rootPath = await emptyRepo();
    const current = `${renderAgentInstructionSnippet()}\n`;
    await writeFile(path.join(rootPath, "AGENTS.md"), current, "utf8");

    const output = await initOnce(rootPath);

    const content = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(content).toBe(current);
    expect(output.skipped.some((entry) => entry.endsWith("AGENTS.md"))).toBe(true);
    expect(countOccurrences(content, AGENT_INSTRUCTION_HEADING_PREFIX)).toBe(1);
  });

  it("FR-NODE-086 AC-7: an older English block is replaced in place, leaving exactly one block", async () => {
    const rootPath = await emptyRepo();
    const older = renderAgentInstructionSnippet({ version: "0.1" });
    const seeded = ["# Existing Agent Notes", "", "Consumer prose.", "", older, "", "# Local Section", "", "Keep this.", ""].join("\n");
    await writeFile(path.join(rootPath, "AGENTS.md"), seeded, "utf8");

    await initOnce(rootPath);

    const content = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(countOccurrences(content, AGENT_INSTRUCTION_HEADING_PREFIX), "the versioned path must replace, not append").toBe(1);
    expect(countOccurrences(content, AGENT_INSTRUCTION_END_MARKER)).toBe(1);
    expect(content).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(content).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}0.1`);
    expect(content).toContain("# Local Section");
    expect(content).toContain("Consumer prose.");
    expect(hangulLines(content)).toEqual([]);
  });
});

describe("FR-NODE-086 AC-8 — this repository's own agent files carry the English block", () => {
  it.each(["AGENTS.md", "CLAUDE.md"])("FR-NODE-086 AC-8: %s carries the English block and no Hangul", async (agentFile) => {
    // The on-disk casing is authoritative: this repository stores the agents file lower-cased, and a
    // case-insensitive file system would otherwise hide a mismatch.
    const entries = await readdir(REPO_ROOT);
    const actual = entries.find((entry) => entry.toLowerCase() === agentFile.toLowerCase());
    expect(actual, `${agentFile} must exist at the repository root`).toBeDefined();

    const content = await readFile(path.join(REPO_ROOT, actual ?? agentFile), "utf8");
    const block = extractManagedBlock(content, AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_END_MARKER);
    expect(block, `${actual} must carry the English managed block`).toBeDefined();
    expect(content).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(content).not.toContain(KOREAN_AGENT_HEADING_PREFIX);
    expect(content).not.toContain(KOREAN_AGENT_END_MARKER);
    expect(hangulLines(content), `${actual} must be English`).toEqual([]);
  });
});
