import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToolSummaryRows, syncAppendix, type ToolSummaryEntry } from "../../../src/core/mutation/sync-appendix.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-253 — the appendix §3.1 Tool Summary table is generated from the tool registry. The core
// takes the registry as an argument, so these cases run on a fixture registry and a fixture appendix.

const BEFORE_TABLE = [
  "# Appendix",
  "",
  "Intro paragraph that must stay byte for byte.",
  "",
  "## 3. MCP Tool Reference",
  "",
  "### 3.1 Tool Summary",
  "",
  "| Tool | Mutates Files | Purpose |",
  "|---|---:|---|"
];

const AFTER_TABLE = ["", "### 3.2 MCP Tool Input Shapes", "", "Hand-written shapes  stay as they are.", ""];

const FIXTURE_TOOLS: ToolSummaryEntry[] = [
  { name: "beta_read", description: "Reads `a. b` beta. Second sentence is dropped.", readOnly: true },
  { name: "alpha_write", description: "Writes alpha. Read-only? No.", readOnly: false }
];

const GENERATED_ROWS = ["| `alpha_write` | yes | Writes alpha. |", "| `beta_read` | no | Reads `a. b` beta. |"];

function appendixText(rows: readonly string[]): string {
  return [...BEFORE_TABLE, ...rows, ...AFTER_TABLE].join("\n");
}

async function workspaceWithAppendix(rows: readonly string[]): Promise<{ root: string; file: string }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const file = path.join(root, "docs", "spec", "90.appendix.md");
  await writeFile(file, appendixText(rows), "utf8");
  return { root, file };
}

describe("FR-NODE-253 AC-2 — generated Tool Summary rows", () => {
  // @req FR-NODE-253 AC-2
  it("renders one row per tool, `no` exactly when read-only, with the first sentence of the description", () => {
    expect(renderToolSummaryRows(FIXTURE_TOOLS)).toEqual(GENERATED_ROWS);
  });

  // @req FR-NODE-253 AC-2
  it("sorts by tool name with a locale-independent comparison", () => {
    const rows = renderToolSummaryRows([
      { name: "a_tool", description: "A.", readOnly: true },
      { name: "B_tool", description: "B.", readOnly: true },
      { name: "a-tool", description: "C.", readOnly: true }
    ]);
    // Code-unit order puts `B` (0x42) before `a` (0x61) and `-` (0x2D) before `_` (0x5F); a locale
    // collation puts `a_tool` first.
    expect(rows.map((row) => row.split("`")[1])).toEqual(["B_tool", "a-tool", "a_tool"]);
  });

  // @req FR-NODE-253 AC-2
  it("keeps a whole description that has no sentence end, and escapes a pipe so the row keeps three cells", () => {
    expect(renderToolSummaryRows([{ name: "x", description: "Picks a | b\nwithout an end", readOnly: false }])).toEqual([
      "| `x` | yes | Picks a \\| b without an end |"
    ]);
  });
});

describe("FR-NODE-253 AC-1 — check mode", () => {
  // @req FR-NODE-253 AC-1
  it("names every missing, extra and differing tool and writes nothing", async () => {
    const { root, file } = await workspaceWithAppendix(["| `beta_read` | yes | Old purpose. |", "| `gone_tool` | yes | Removed. |"]);
    const before = await readFile(file, "utf8");

    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      filePath: "docs/spec/90.appendix.md",
      changed: true,
      written: false,
      missing: ["alpha_write"],
      extra: ["gone_tool"],
      differing: ["beta_read"]
    });
    expect(result.mutation).toBeUndefined();
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-253 AC-1
  it("reports rows that match but stand out of order as a change", async () => {
    const { root } = await workspaceWithAppendix([...GENERATED_ROWS].reverse());
    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS });
    expect(result.value).toMatchObject({ changed: true, missing: [], extra: [], differing: [], outOfOrder: true });
  });

  // @req FR-NODE-253 AC-1
  it("refuses an appendix that has no Tool Summary table under the MCP Tool Reference section", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // @req FR-NODE-253 AC-1
  it("refuses a Tool Summary heading that sits under another section", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const file = path.join(root, "docs", "spec", "90.appendix.md");
    await writeFile(file, appendixText(GENERATED_ROWS).replace("### 3.1 Tool Summary", "## 4. Other\n\n### 3.1 Tool Summary"), "utf8");
    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  // @req FR-NODE-253 AC-1
  it("refuses a Tool Summary table whose header is not Tool, Mutates Files, Purpose", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const file = path.join(root, "docs", "spec", "90.appendix.md");
    await writeFile(file, appendixText(GENERATED_ROWS).replace("| Tool | Mutates Files | Purpose |", "| Tool | Purpose | Mutates Files |"), "utf8");
    const before = await readFile(file, "utf8");
    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(await readFile(file, "utf8")).toBe(before);
  });
});

describe("FR-NODE-253 AC-1 — write and dry-run", () => {
  // @req FR-NODE-253 AC-1
  it("--write rewrites only the table rows and leaves every other byte unchanged", async () => {
    const { root, file } = await workspaceWithAppendix(["| `beta_read` | yes | Old purpose. |", "| `gone_tool` | yes | Removed. |"]);

    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ changed: true, written: true });
    expect(await readFile(file, "utf8")).toBe(appendixText(GENERATED_ROWS));
  });

  // @req FR-NODE-253 AC-1
  it("--write keeps CRLF line endings outside and inside the table", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const file = path.join(root, "docs", "spec", "90.appendix.md");
    await writeFile(file, appendixText(["| `gone_tool` | yes | Removed. |"]).replace(/\n/g, "\r\n"), "utf8");

    await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true });

    expect(await readFile(file, "utf8")).toBe(appendixText(GENERATED_ROWS).replace(/\n/g, "\r\n"));
  });

  // @req FR-NODE-253 AC-1
  it("--write fills an empty table", async () => {
    const { root, file } = await workspaceWithAppendix([]);
    await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true });
    expect(await readFile(file, "utf8")).toBe(appendixText(GENERATED_ROWS));
  });

  // @req FR-NODE-253 AC-1
  it("--dry-run reports the patch without writing", async () => {
    const { root, file } = await workspaceWithAppendix(["| `beta_read` | no | Reads `a. b` beta. |"]);
    const before = await readFile(file, "utf8");

    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true, dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ changed: true, written: false, missing: ["alpha_write"] });
    expect(result.mutation).toMatchObject({ dryRun: true, written: false, preview: ["| `alpha_write` | yes | Writes alpha. |"] });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-253 AC-1
  it("--dry-run's patch holds only the rows that change, not the rows the file already has right", async () => {
    const { root } = await workspaceWithAppendix(["| `alpha_write` | yes | Writes alpha. |"]);
    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true, dryRun: true });
    expect(result.mutation?.preview).toEqual(["| `beta_read` | no | Reads `a. b` beta. |"]);
  });
});

describe("FR-NODE-253 AC-4 — lock and no-op", () => {
  // @req FR-NODE-253 AC-4
  it("a run whose generated rows equal the file's rows reports changed: false and leaves the bytes unchanged", async () => {
    const { root, file } = await workspaceWithAppendix(GENERATED_ROWS);
    const before = await stat(file);

    const result = await syncAppendix(await resolveProjectRoot(root), { tools: FIXTURE_TOOLS, write: true });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ changed: false, written: false, missing: [], extra: [], differing: [], outOfOrder: false });
    expect(await readFile(file, "utf8")).toBe(appendixText(GENERATED_ROWS));
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  // @req FR-NODE-253 AC-4
  it("the write takes the SRS mutation lock: a held lock refuses it and --ignore-lock gets it through", async () => {
    const { root, file } = await workspaceWithAppendix([]);
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "another-session",
        operation: "add_requirement",
        requestId: "held",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      })}\n`,
      "utf8"
    );
    const projectRoot = await resolveProjectRoot(root);

    const blocked = await syncAppendix(projectRoot, { tools: FIXTURE_TOOLS, write: true });
    expect(blocked.ok).toBe(false);
    expect(await readFile(file, "utf8")).toBe(appendixText([]));

    const bypassed = await syncAppendix(projectRoot, { tools: FIXTURE_TOOLS, write: true, ignoreLock: true });
    expect(bypassed.ok).toBe(true);
    expect(await readFile(file, "utf8")).toBe(appendixText(GENERATED_ROWS));
  });
});
