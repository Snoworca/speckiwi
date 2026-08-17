import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { attachInheritedOptionsHelp, buildCommand } from "../../src/cli/command.js";
import { registerDoctorCommand } from "../../src/cli/commands/doctor.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerSkillCommands } from "../../src/cli/commands/skills.js";
import { registerRepairCommands } from "../../src/cli/commands/repair.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { diagnoseHealth } from "../../src/core/health/doctor.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import {
  COUNT_PHRASES,
  collectCommandPaths,
  extractAnchorIds,
  extractAnchorLinks,
  extractFencedCommands,
  extractToolTokens,
  githubHeadingSlug,
  headingSlugs,
  lintDocument,
  type DocLintGroundTruth
} from "../support/doc-lint.js";

// @req REL-FLOW-003 — README.md's factual claims, checked against the symbols that own them.
//
// This is a sibling of test/release/tool-signature-parity.test.ts rather than an extension of it:
// that file's DOC_AND_SKILL_ROOTS drives a *token blocklist* over seven roots, so adding README.md
// there would only forbid four known-bad strings in it. The defect class that needed six manual
// audit rounds is the opposite shape — a claim that is well-formed but no longer true — and it
// needs the live commander tree, the tool registry, and the doctor check list as ground truth for
// one file. The technique (build the real tree in-process, compare, fail loud) is reused verbatim.

const README_PATH = path.join(process.cwd(), "README.md");

function fakeIo() {
  const stream = { write: () => true } as unknown as NodeJS.WriteStream;
  return { stdout: stream, stderr: stream };
}

/** The tree `main()` builds, assembled the same way and in the same order. */
function buildProgram(): Command {
  const io = fakeIo();
  const program = buildCommand({ io });
  registerReadCommands(program, { io });
  registerMutationCommands(program, { io });
  registerMcpCommand(program, { io });
  registerSkillCommands(program, { io });
  registerDoctorCommand(program, { io });
  registerRepairCommands(program, { io });
  registerOrchestrateCommands(program, { io });
  attachInheritedOptionsHelp(program);
  return program;
}

function registeredToolNames(): string[] {
  // `resource:<template>` entries share the handler map but are not tools.
  return Object.keys(createMcpServer({ root: process.cwd() }).tools).filter((name) => !name.startsWith("resource:"));
}

async function realGroundTruth(): Promise<DocLintGroundTruth> {
  const toolNames = registeredToolNames();
  const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd()));
  const report = await diagnoseHealth(workspace);
  return {
    commandPaths: collectCommandPaths(buildProgram()),
    toolNames: new Set(toolNames),
    counts: new Map([
      ["mcp-tools", toolNames.length],
      ["mcp-tools-orchestrate", toolNames.filter((name) => name.startsWith("orchestrate_")).length],
      ["mcp-tools-workflow", toolNames.filter((name) => name.startsWith("workflow_")).length],
      ["doctor-checks", report.checks.length]
    ])
  };
}

/** A ground truth small enough to reason about, so a fixture failure names one cause. */
const FIXTURE_TRUTH: DocLintGroundTruth = {
  commandPaths: new Set(["list", "workflow", "workflow task-check", "doctor"]),
  toolNames: new Set(["list_requirements", "workflow_pipeline_emit", "orchestrate_run_lock"]),
  counts: new Map([
    ["mcp-tools", 3],
    ["mcp-tools-orchestrate", 1],
    ["mcp-tools-workflow", 1],
    ["doctor-checks", 11]
  ])
};

function fence(language: string, ...body: string[]): string[] {
  return ["```" + language, ...body, "```"];
}

describe("REL-FLOW-003 AC-1 — fenced speckiwi lines resolve against the live commander tree", () => {
  it("reports a fabricated subcommand and leaves the real ones alone", () => {
    const document = [
      "# Fixture",
      ...fence("sh", "speckiwi list --status planned", "speckiwi workflow task-check <taskId> --json", "speckiwi frobnicate --json")
    ].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "command");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(5);
    expect(findings[0]?.token).toBe("frobnicate");
    expect(findings[0]?.detail).toContain("speckiwi frobnicate");
  });

  it("treats a placeholder or an option as an argument, not as a missing subcommand", () => {
    const document = fence("sh", "speckiwi doctor --json", "speckiwi workflow task-check <taskId>", "speckiwi list <ignored-arg>").join("\n");

    // Asserting the clean result alone would stay green under an extractor that reads nothing, so
    // the three lines are asserted to have actually been read first.
    expect(extractFencedCommands(document).map((entry) => entry.line)).toEqual([2, 3, 4]);
    expect(lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "command")).toEqual([]);
  });

  it("reports a subcommand that is real only under a different parent", () => {
    // `task-check` exists, but under `workflow`. A flat name test would call this fine.
    const document = fence("sh", "speckiwi task-check <taskId>").join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "command");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("task-check");
  });

  it("extracts a non-trivial number of command lines from the real README", async () => {
    const readme = await readFile(README_PATH, "utf8");
    // Anti-vacuity: an extractor that silently matched nothing would keep every command assertion
    // below green forever. 134 measured on 2026-08-17.
    expect(extractFencedCommands(readme).length).toBeGreaterThanOrEqual(130);
  });

  it("passes on the real README and fails on the same README with one fabricated subcommand", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const truth = await realGroundTruth();

    expect(lintDocument(readme, truth).filter((finding) => finding.check === "command")).toEqual([]);

    // The negative case AC-1 demands: today's 130/130 green proves nothing on its own.
    const mutated = [readme, "", ...fence("sh", "speckiwi frobnicate --json"), ""].join("\n");
    const mutatedFindings = lintDocument(mutated, truth).filter((finding) => finding.check === "command");
    expect(mutatedFindings).toHaveLength(1);
    expect(mutatedFindings[0]?.token).toBe("frobnicate");
  });

  it("names a top-level command that leaves the tree", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const truth = await realGroundTruth();
    // A rename is the historical shape of this defect: the docs keep the old name.
    const withoutValidate = new Set([...truth.commandPaths].filter((entry) => entry !== "validate" && !entry.startsWith("validate ")));

    const findings = lintDocument(readme, { ...truth, commandPaths: withoutValidate }).filter((finding) => finding.check === "command");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.token === "validate")).toBe(true);
  });
});

describe("REL-FLOW-003 AC-2 — anchors are checked against the explicit <a id> tags, not heading slugs", () => {
  it("accepts a link whose target exists only as an explicit anchor and rejects a missing one", () => {
    const document = [
      "<a id=\"en-requirements\"></a>",
      "",
      "## 1. Requirements",
      "",
      "See [Requirements](#en-requirements) and [Gone](#no-such-anchor).",
      "",
      "<p><a href=\"#en-requirements\">html link</a></p>"
    ].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "anchor");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("no-such-anchor");
    expect(findings[0]?.line).toBe(5);
  });

  it("does not treat a heading slug as an anchor", () => {
    // The measured trap: `## 1. Requirements` slugs to `1-requirements`, which is NOT an anchor here.
    expect(githubHeadingSlug("## 1. Requirements")).toBe("1-requirements");
    const document = ["## 1. Requirements", "", "See [it](#1-requirements)."].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "anchor");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("1-requirements");
  });

  it("resolves every real README link, and none of them would resolve under slug rules", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const anchors = extractAnchorIds(readme);
    const links = extractAnchorLinks(readme);

    expect(anchors.size).toBeGreaterThanOrEqual(29);
    expect(links.length).toBeGreaterThanOrEqual(26);
    expect(lintDocument(readme, await realGroundTruth()).filter((finding) => finding.check === "anchor")).toEqual([]);

    // The research probe's 26/26 false positives, asserted rather than remembered: a slug-based
    // checker shares no target at all with this repository's anchors, so picking the wrong ground
    // truth turns every link into a defect report.
    const slugs = headingSlugs(readme);
    expect(links.filter((link) => slugs.has(link.id))).toEqual([]);
  });
});

describe("REL-FLOW-003 AC-3 — MCP tool names are checked against the runtime registry", () => {
  it("rejects an unregistered exact name inside a table row", () => {
    const document = ["| Category | Tools |", "| --- | --- |", "| Read | `list_requirements`, `bogus_tool` |"].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "mcp-tool");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("bogus_tool");
    expect(findings[0]?.line).toBe(3);
  });

  it("treats a trailing * as prefix membership, so a family with members passes and an empty one fails", () => {
    const document = ["| Family | Root |", "| --- | --- |", "| `workflow_*` | accepted |", "| `bogus_*` | accepted |"].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH).filter((finding) => finding.check === "mcp-tool");
    // `workflow_*` is not a registered name; only a prefix test can accept it.
    expect(FIXTURE_TRUTH.toolNames.has("workflow_*")).toBe(false);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("bogus_*");
  });

  it("scopes the claim to table rows, which is the measured ground truth", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const tokens = extractToolTokens(readme);

    // 110 measured on 2026-08-17; a free-form scan of every backticked snake_case token instead
    // picks up `in_progress` and `terminal_review`, which are a Status value and a journal record.
    expect(tokens.length).toBeGreaterThanOrEqual(100);
    expect(tokens.map((token) => token.token)).not.toContain("in_progress");
    expect(tokens.map((token) => token.token)).not.toContain("terminal_review");
    // The prefix branch must be reachable on the real document, not only on a fixture: a token
    // shape the extractor skips makes the family rows unchecked while everything stays green.
    expect(tokens.map((token) => token.token)).toContain("workflow_*");
    expect(tokens.map((token) => token.token)).toContain("orchestrate_*");
    expect(lintDocument(readme, await realGroundTruth()).filter((finding) => finding.check === "mcp-tool")).toEqual([]);
  });

  it("fails the real README when a documented tool leaves the registry", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const truth = await realGroundTruth();
    const without = new Set([...truth.toolNames].filter((name) => name !== "supersede_requirement"));

    const findings = lintDocument(readme, { ...truth, toolNames: without }).filter((finding) => finding.check === "mcp-tool");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.token === "supersede_requirement")).toBe(true);
  });
});

describe("REL-FLOW-003 AC-4 — counts are derived from the set they describe", () => {
  it("accepts a count that matches its enumerator and rejects one that does not", () => {
    const matching = "**3 tools ship in total.**";
    const drifted = "**4 tools ship in total.**";

    expect(lintDocument(matching, FIXTURE_TRUTH).filter((finding) => finding.check === "count")).toEqual([]);
    const findings = lintDocument(drifted, FIXTURE_TRUTH).filter((finding) => finding.check === "count");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("4");
    expect(findings[0]?.detail).toContain("3");
    expect(findings[0]?.token).toBe("mcp-tools");
  });

  it("registers each phrase explicitly, with no free-form inference", () => {
    // A sentence with a number and the noun but no registered phrase is not a claim this check owns.
    expect(lintDocument("SpecKiwi ships 99 tools for agents.", FIXTURE_TRUTH).filter((finding) => finding.check === "count")).toEqual([]);
    expect(COUNT_PHRASES.length).toBeGreaterThanOrEqual(10);
    for (const phrase of COUNT_PHRASES) {
      expect(FIXTURE_TRUTH.counts.has(phrase.enumerator)).toBe(true);
    }
  });

  it("keeps every registered phrase live in the real README", async () => {
    const readme = await readFile(README_PATH, "utf8");
    // A phrase that stops matching covers nothing while staying green — the exact failure mode of
    // the recorded 30/29/28 three-way disagreement. An empty registry would satisfy the loop
    // vacuously, so the registry size is asserted here too and not only one test above.
    expect(COUNT_PHRASES.length).toBeGreaterThanOrEqual(10);
    for (const phrase of COUNT_PHRASES) {
      const pattern = new RegExp(phrase.pattern.source, phrase.pattern.flags.includes("g") ? phrase.pattern.flags : `${phrase.pattern.flags}g`);
      expect([...readme.matchAll(pattern)].length, `${phrase.id} matches nothing in README.md`).toBeGreaterThanOrEqual(1);
    }
  });

  it("passes on the real README and fails when one enumerator moves", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const truth = await realGroundTruth();

    expect(lintDocument(readme, truth).filter((finding) => finding.check === "count")).toEqual([]);

    for (const enumerator of ["mcp-tools", "mcp-tools-orchestrate", "mcp-tools-workflow", "doctor-checks"]) {
      const moved = new Map(truth.counts);
      moved.set(enumerator, (moved.get(enumerator) ?? 0) + 1);
      const findings = lintDocument(readme, { ...truth, counts: moved }).filter((finding) => finding.check === "count");
      expect(findings.length, `${enumerator} drifted without a finding`).toBeGreaterThan(0);
      expect(findings.every((finding) => finding.token === enumerator)).toBe(true);
    }
  });
});

describe("REL-FLOW-003 AC-5 — the escape hatch is written in the document", () => {
  it("exempts the next fenced block", () => {
    const withMarker = ["<!-- doc-lint: ignore -->", ...fence("sh", "speckiwi frobnicate --json")].join("\n");
    const withoutMarker = fence("sh", "speckiwi frobnicate --json").join("\n");

    expect(lintDocument(withMarker, FIXTURE_TRUTH)).toEqual([]);
    expect(lintDocument(withoutMarker, FIXTURE_TRUTH)).toHaveLength(1);
  });

  it("exempts the next line only, not the rest of the document", () => {
    const document = [
      "<!-- doc-lint: ignore -->",
      "| Read | `bogus_tool` |",
      "| Read | `other_bogus_tool` |"
    ].join("\n");

    const findings = lintDocument(document, FIXTURE_TRUTH);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.token).toBe("other_bogus_tool");
    expect(findings[0]?.line).toBe(3);
  });

  it("skips a non-shell illustration fence and checks the same content in a shell fence", () => {
    const illustration = fence("text", "speckiwi frobnicate --json").join("\n");
    const shell = fence("sh", "speckiwi frobnicate --json").join("\n");

    expect(lintDocument(illustration, FIXTURE_TRUTH)).toEqual([]);
    expect(lintDocument(shell, FIXTURE_TRUTH)).toHaveLength(1);
  });

  it("does not silently exempt the real README", async () => {
    const readme = await readFile(README_PATH, "utf8");
    // If a future round quiets a real defect with the marker, this count moves and the diff shows it.
    expect((readme.match(/<!--\s*doc-lint:\s*ignore\s*-->/g) ?? []).length).toBe(0);
  });
});

describe("REL-FLOW-003 — the whole document is clean", () => {
  it("finds nothing in README.md", async () => {
    const readme = await readFile(README_PATH, "utf8");
    const truth = await realGroundTruth();

    // A clean result is only meaningful once the ground truth is known to be populated: an empty
    // command set, an empty registry, or a missing enumerator each produce the same green.
    expect(truth.commandPaths.size).toBeGreaterThanOrEqual(150);
    expect(truth.toolNames.size).toBe(100);
    expect([...truth.counts.values()].every((count) => count > 0)).toBe(true);

    expect(lintDocument(readme, truth)).toEqual([]);
  });
});
