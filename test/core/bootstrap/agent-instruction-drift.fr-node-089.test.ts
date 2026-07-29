import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  BUNDLED_SDS_RULES_FILENAME,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-089 — init repairs a managed agent instruction block that drifted from the shipped text.
//
// The skip condition used to be the block version alone, so any edit inside the block survived
// every future init. Raising the bundled rules version to 2.5.0 made that load-bearing: a block
// written before the bump cites an SDS rules path the tool no longer ships, and a version-only skip
// would keep every existing consumer on the dead path forever.

const AGENT_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-block-drift-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function initOnce(rootPath: string) {
  const result = await initProject(await resolveProjectRoot(rootPath), {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The managed block as it appears in a file, from the snippet's first line to the end marker. */
function managedBlock(content: string): string {
  const snippet = renderAgentInstructionSnippet();
  const heading = snippet.split("\n")[0] ?? "";
  const start = content.indexOf(heading);
  const end = content.indexOf(AGENT_INSTRUCTION_END_MARKER);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end + AGENT_INSTRUCTION_END_MARKER.length);
}

describe("FR-NODE-089 AC-1 — a drifted block is replaced even at the current version", () => {
  it("restores the shipped text when a sentence inside the block was edited by hand", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const filePath = path.join(rootPath, "CLAUDE.md");
    const original = await readFile(filePath, "utf8");
    const snippet = renderAgentInstructionSnippet();
    // Pick a sentence from inside the managed block and rewrite it, leaving the heading — and so
    // the version — untouched. This is exactly the drift the repository's own CLAUDE.md carried.
    const sentence = "Completed Work Log";
    expect(snippet).toContain(sentence);
    await writeFile(filePath, original.replace(sentence, "Completed Work Ledger"), "utf8");

    const output = await initOnce(rootPath);

    const repaired = await readFile(filePath, "utf8");
    expect(repaired).not.toContain("Completed Work Ledger");
    expect(managedBlock(repaired)).toBe(managedBlock(original));
    expect(output.updated).toContain(filePath);
    expect(output.skipped).not.toContain(filePath);
  });

  it("replaces a block that cites a rules path the tool no longer ships", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const filePath = path.join(rootPath, "AGENTS.md");
    const current = await readFile(filePath, "utf8");
    // A block written before the rules version bump names the old document.
    await writeFile(filePath, current.replace(BUNDLED_SDS_RULES_FILENAME, "SDS-MD-Rules-v1.0.0.md"), "utf8");

    await initOnce(rootPath);

    const repaired = await readFile(filePath, "utf8");
    expect(repaired).toContain(BUNDLED_SDS_RULES_FILENAME);
    expect(repaired).not.toContain("SDS-MD-Rules-v1.0.0.md");
  });
});

describe("FR-NODE-089 AC-2 — an already-current block is left alone", () => {
  it("skips a CRLF agent file too, so a Windows checkout is not rewritten on every init", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    // Line endings are transport, not content. Comparing them would make every init on a CRLF
    // checkout report an update and silently normalise the consumer's file to LF.
    for (const name of AGENT_FILES) {
      const filePath = path.join(rootPath, name);
      const lf = await readFile(filePath, "utf8");
      await writeFile(filePath, lf.replace(/\r?\n/g, "\r\n"), "utf8");
    }

    const output = await initOnce(rootPath);

    for (const name of AGENT_FILES) {
      const filePath = path.join(rootPath, name);
      expect(output.skipped, name).toContain(filePath);
      expect(output.updated, name).not.toContain(filePath);
      expect(await readFile(filePath, "utf8"), name).toContain("\r\n");
    }
  });

  it("skips both agent files on a repeated init and writes nothing", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const before = await Promise.all(
      AGENT_FILES.map((name) => readFile(path.join(rootPath, name), "utf8"))
    );

    const output = await initOnce(rootPath);

    for (const [index, name] of AGENT_FILES.entries()) {
      const filePath = path.join(rootPath, name);
      expect(output.skipped).toContain(filePath);
      expect(output.updated).not.toContain(filePath);
      expect(await readFile(filePath, "utf8")).toBe(before[index]);
    }
  });
});

describe("FR-NODE-089 AC-3 — the shipped snippet names the Completed Work Log history file", () => {
  it("carries the sentence the repository had been holding by hand", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain("docs/spec/91.completed-work-log.md");
  });
});

describe("FR-NODE-089 AC-4 — the snippet cites the installed SDS rules path", () => {
  it("derives the cited path from the bundled SDS rules constant", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain(`docs/rule/${BUNDLED_SDS_RULES_FILENAME}`);
  });
});

describe("FR-NODE-089 AC-5 — both agent files carry exactly the shipped block", () => {
  it("writes the same block into each file and preserves content outside it", async () => {
    const rootPath = await emptyRepo();
    for (const name of AGENT_FILES) {
      await writeFile(path.join(rootPath, name), "# Local Notes\n\nKeep this line.\n", "utf8");
    }

    await initOnce(rootPath);

    const snippet = renderAgentInstructionSnippet();
    for (const name of AGENT_FILES) {
      const content = await readFile(path.join(rootPath, name), "utf8");
      expect(managedBlock(content)).toBe(snippet.trimEnd());
      expect(content).toContain("Keep this line.");
    }
  });
});
