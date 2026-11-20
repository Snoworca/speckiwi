import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addRequirement, type AddRequirementInput } from "../../../src/core/mutation/add-requirement.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import * as statusCache from "../../../src/core/status-cache.js";
import { refreshSrsStatusCache } from "../../../src/core/status-cache.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-316 — automatic Requirement ID allocation skips a number an SRS document already
// mentions. Reproduced while writing FR-PARSE-051: its Rationale named the next number before the
// requirement existed, the caller-chosen check refused that number as in use, and the same call
// without a chosen id allocated it, so the earlier mention came to name the new block.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const HISTORY = path.join("docs", "spec", "91.completed-work-log.md");

function input(extra: Partial<AddRequirementInput> = {}): AddRequirementInput {
  return {
    type: "functional",
    scope: "ARCH",
    target: "v1.0.0",
    title: "Allocated",
    statement: "SpecKiwi SHALL keep the allocated requirement.",
    acceptanceCriteria: ["The requirement can be listed."],
    stability: "evolving",
    ...extra
  } as AddRequirementInput;
}

/** The fixture holds one block, FR-ARCH-001; `mention` is written into its Rationale. */
async function workspace(mention?: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  if (mention) {
    const file = path.join(rootPath, SPEC);
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("Mutation tests need a stable target.", `Mutation tests need a stable target. See ${mention}.`), "utf8");
  }
  return rootPath;
}

async function allocate(rootPath: string): Promise<{ id?: string; code?: string; message?: string }> {
  const result = await addRequirement(await resolveProjectRoot(rootPath), input());
  return { id: result.value?.requirementId, code: result.error?.code, message: result.error?.message };
}

afterEach(() => vi.restoreAllMocks());

describe("FR-NODE-316 AC-1 — a mentioned number is skipped", () => {
  // @req FR-NODE-316 AC-1
  it("skips the next number when a Rationale mentions it", async () => {
    expect((await allocate(await workspace("FR-ARCH-002"))).id).toBe("FR-ARCH-003");
  });

  // @req FR-NODE-316 AC-1
  it("skips a run of mentioned numbers", async () => {
    expect((await allocate(await workspace("FR-ARCH-002 and FR-ARCH-003"))).id).toBe("FR-ARCH-004");
  });

  // @req FR-NODE-316 AC-1
  it("counts a zero-padded spelling as the number it holds", async () => {
    expect((await allocate(await workspace("FR-ARCH-0002"))).id).toBe("FR-ARCH-003");
  });

  // @req FR-NODE-316 AC-1
  it("skips a number the completed-work history file mentions", async () => {
    const rootPath = await workspace();
    await writeFile(
      path.join(rootPath, HISTORY),
      ["# Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary | Reports |", "|---|---|---|---|---|---|", "| 2026-01-02 | v1.0.0 | ARCH | FR-ARCH-002 | an old row | |", ""].join("\n"),
      "utf8"
    );
    expect((await allocate(rootPath)).id).toBe("FR-ARCH-003");
  });

  // @req FR-NODE-316 AC-1
  it("skips a number a step document mentions", async () => {
    const rootPath = await workspace();
    const dir = path.join(rootPath, "docs", "spec", "steps", "lane-a");
    await mkdir(dir, { recursive: true });
    // A step document is the step's SRS file (FR-NODE-312 AC-1), not its intent.md.
    await writeFile(path.join(dir, "10.product-architecture.srs.md"), "# Step Architecture\n\nThis step will add FR-ARCH-002.\n", "utf8");
    expect((await allocate(rootPath)).id).toBe("FR-ARCH-003");
  });

  // @req FR-NODE-316 AC-1
  it("does not skip for a longer id that only starts with the number", async () => {
    expect((await allocate(await workspace("FR-ARCH-0020 and NFR-ARCH-002"))).id).toBe("FR-ARCH-002");
  });
});

describe("FR-NODE-316 AC-2 AC-3 — every allocation path reads the same rule", () => {
  // @req FR-NODE-316 AC-3
  it("the status cache's candidate is not used when an SRS document mentions it", async () => {
    const rootPath = await workspace("FR-ARCH-002");
    const root = await resolveProjectRoot(rootPath);
    expect((await refreshSrsStatusCache(root)).ok).toBe(true);
    const cached = await statusCache.allocateRequirementIdFromStatusCache(root, await parseWorkspace(root), "functional", "ARCH");
    expect(cached.id).toBe("FR-ARCH-002");
    const result = await addRequirement(root, input());
    expect(result.value?.requirementId).toBe("FR-ARCH-003");
    // The cache's candidate is set aside where it is read, and the result says so.
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W065", details: expect.objectContaining({ reason: "cached-id-collision", requirementId: "FR-ARCH-002" }) })]));
  });

  // @req FR-NODE-316 AC-3
  it("a number mentioned between allocation and the write moves the id on", async () => {
    const rootPath = await workspace();
    const real = statusCache.allocateRequirementIdFromStatusCache;
    vi.spyOn(statusCache, "allocateRequirementIdFromStatusCache").mockImplementation(async (...args) => {
      // Another writer names FR-ARCH-002 after this call read the documents and before it writes.
      const file = path.join(rootPath, SPEC);
      await writeFile(file, (await readFile(file, "utf8")).replace("Mutation tests need a stable target.", "Mutation tests need a stable target. Reserved FR-ARCH-002."), "utf8");
      await real(...args);
      return { id: null, diagnostics: [] };
    });
    expect((await allocate(rootPath)).id).toBe("FR-ARCH-003");
  });

  // @req FR-NODE-316 AC-2
  it("a type migration's new id skips a mentioned number too", async () => {
    const rootPath = await workspace("FR-ARCH-002");
    const migrated = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "type", value: "interface", dryRun: true });
    expect(migrated.ok, JSON.stringify(migrated.error)).toBe(true);
    expect((migrated.value as { newId?: string }).newId).toBe("IR-ARCH-001");
    const file = path.join(rootPath, SPEC);
    await writeFile(file, (await readFile(file, "utf8")).replace("Mutation tests need a stable target.", "Mutation tests need a stable target. Later IR-ARCH-001."), "utf8");
    const moved = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "type", value: "interface", dryRun: true });
    expect((moved.value as { newId?: string }).newId).toBe("IR-ARCH-002");
  });
});

describe("FR-NODE-316 AC-4 — a full series is refused", () => {
  // @req FR-NODE-316 AC-4
  it("refuses with GENERATED_ID_COLLISION naming the series and writes nothing", async () => {
    const rootPath = await workspace();
    const file = path.join(rootPath, SPEC);
    const before = (await readFile(file, "utf8")).replace("### FR-ARCH-001 — Mutable requirement", "### FR-ARCH-9999 — Mutable requirement");
    await writeFile(file, before, "utf8");
    const result = await allocate(rootPath);
    expect(result.id).toBeUndefined();
    expect(result.code).toBe("GENERATED_ID_COLLISION");
    expect(result.message).toContain("FR-ARCH");
    // Only numbers above the series maximum are searched, so the message must not claim more.
    expect(result.message).toContain("above the series maximum");
    expect(result.message).not.toContain("every number up to 9999");
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-316 AC-4
  it("a type migration into a full series is refused the same way", async () => {
    const rootPath = await workspace();
    const file = path.join(rootPath, SPEC);
    await writeFile(file, `${await readFile(file, "utf8")}\n### IR-ARCH-9999 — Full series\n\n| Field | Value |\n| --- | --- |\n| Type | interface |\n| Target | v1.0.0 |\n| Status | planned |\n\n#### Requirement\n\nFull.\n\n#### Acceptance Criteria\n\n- [ ] AC-1: full\n`, "utf8");
    const result = await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", field: "type", value: "interface", dryRun: true });
    expect(result.error?.code).toBe("GENERATED_ID_COLLISION");
    expect(result.error?.message).toContain("above the series maximum");
  });
});

describe("FR-NODE-316 AC-5 — without mentions nothing changes", () => {
  // @req FR-NODE-316 AC-5
  it("core allocates the next number above the series maximum", async () => {
    expect((await allocate(await workspace())).id).toBe("FR-ARCH-002");
  });

  // @req FR-NODE-316 AC-5
  it("the status-cache path allocates the same id", async () => {
    const rootPath = await workspace();
    expect((await refreshSrsStatusCache(await resolveProjectRoot(rootPath))).ok).toBe(true);
    expect((await allocate(rootPath)).id).toBe("FR-ARCH-002");
  });

  // @req FR-NODE-316 AC-5
  it("MCP and CLI allocate the same id for the same mentioned documents", async () => {
    const viaMcp = (await createMcpServer({ root: await workspace("FR-ARCH-002") }).callTool("add_requirement", {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Via MCP",
      requirement: "SpecKiwi SHALL keep the MCP requirement.",
      acceptanceCriteria: ["The requirement can be listed."]
    })) as { value?: { requirementId?: string } };
    const cliRoot = await workspace("FR-ARCH-002");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(
      ["--root", cliRoot, "add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Via CLI", "--statement", "SpecKiwi SHALL keep the CLI requirement.", "--ac", "The requirement can be listed.", "--json"],
      streams
    );
    const viaCli = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { value?: { requirementId?: string } };
    expect(viaMcp.value?.requirementId).toBe("FR-ARCH-003");
    expect(viaCli.value?.requirementId).toBe("FR-ARCH-003");
  });
});
