import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { renderToolSchemas } from "../../../src/mcp/schemas.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-176 — supersede mints the successor with the caller's requirement type.
//
// `supersedeRequirement` hardcoded `type: "functional"` into its T1 add_requirement call and its input
// interface had no `type` field at all, so the operation could only ever mint functional successors.
// The CLI meanwhile declares `--type <type>` — in the command AND in the ToolSpec registry — and never
// passed it, so the flag was documented, accepted, and dropped.
//
// The consequence is wrong data rather than a refused run: a superseded `interface` requirement got a
// successor typed `functional`, carrying the `FR-` prefix instead of `IR-` in an ID that is never
// renumbered afterwards. It is reachable in the one case that matters most — supersede is the only
// route by which a `verified` requirement can be discarded at all.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const FIXTURE_TARGET = "v1.0.0";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/**
 * Seeds one `interface` requirement in the fixture and returns its minted ID. Every case supersedes a
 * requirement of this shape, so the successor's type is the only thing varying between them.
 */
async function seedInterfaceRequirement(rootPath: string, title: string): Promise<string> {
  const root = await resolveProjectRoot(rootPath);
  const added = await addRequirement(root, {
    type: "interface",
    scope: "ARCH",
    target: FIXTURE_TARGET,
    title,
    statement: `SpecKiwi shall expose the ${title} surface.`,
    acceptanceCriteria: ["The surface exists."]
  });
  expect(added.ok, JSON.stringify(added.error)).toBe(true);
  const id = added.value?.requirementId;
  // The premise of every case below. Without an interface requirement to supersede there is nothing
  // here that could distinguish the caller's type from the hardcoded one.
  expect(id, "the seeded requirement must be an interface requirement").toMatch(/^IR-ARCH-\d+$/);
  return id as string;
}

/** The `| Type | … |` cell of `id` as written to disk, or undefined when the block is absent. */
async function typeRowOf(rootPath: string, id: string): Promise<string | undefined> {
  const text = await readFile(path.join(rootPath, ARCH_DOC), "utf8");
  const start = text.indexOf(`### ${id} `);
  if (start < 0) return undefined;
  const next = text.indexOf("\n### ", start + 1);
  const block = text.slice(start, next >= 0 ? next : undefined);
  return /\|\s*Type\s*\|\s*([^|]+?)\s*\|/.exec(block)?.[1];
}

describe("FR-NODE-176 — the successor's type is the caller's", () => {
  it("AC-1: superseding an interface requirement with type interface mints an IR- successor", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const oldId = await seedInterfaceRequirement(rootPath, "Typed successor carrier");
    const root = await resolveProjectRoot(rootPath);

    const result = await supersedeRequirement(root, {
      oldId,
      scope: "ARCH",
      target: FIXTURE_TARGET,
      type: "interface",
      title: "Typed successor carrier v2",
      statement: "SpecKiwi shall expose the typed successor carrier surface.",
      acceptanceCriteria: ["The surface exists."]
    });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    // The ID prefix is the part that cannot be repaired later: requirement IDs are never renumbered.
    expect(result.value?.newId, "the successor took the default type, not the caller's").toMatch(/^IR-ARCH-\d+$/);
    expect(await typeRowOf(rootPath, result.value!.newId!)).toBe("interface");
  });

  it("AC-2: the same supersede with no type still mints a functional successor", async () => {
    // Same fixture, same seeded interface requirement, same call — only the type omitted. That makes
    // this a control for AC-1 rather than a separate story: whatever differs is the type argument.
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const oldId = await seedInterfaceRequirement(rootPath, "Default successor carrier");
    const root = await resolveProjectRoot(rootPath);

    const result = await supersedeRequirement(root, {
      oldId,
      scope: "ARCH",
      target: FIXTURE_TARGET,
      title: "Default successor carrier v2",
      statement: "SpecKiwi shall expose the default successor carrier surface.",
      acceptanceCriteria: ["The surface exists."]
    });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.newId, "omitting the type changed the default").toMatch(/^FR-ARCH-\d+$/);
    expect(await typeRowOf(rootPath, result.value!.newId!)).toBe("functional");
  });

  it("AC-3: speckiwi supersede --type interface reaches the operation", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const oldId = await seedInterfaceRequirement(rootPath, "CLI successor carrier");

    const run = io();
    const code = await main(
      [
        "--root",
        rootPath,
        "supersede",
        "--old",
        oldId,
        "--new-title",
        "CLI successor carrier v2",
        "--new-statement",
        "SpecKiwi shall expose the CLI successor carrier surface.",
        "--scope",
        "ARCH",
        "--type",
        "interface",
        "--target",
        FIXTURE_TARGET,
        "--ac",
        "The surface exists.",
        "--apply",
        "--json"
      ],
      run
    );

    const payload = `${drain(run.stdout)}${drain(run.stderr)}`;
    expect(code, payload).toBe(0);
    const newId = (JSON.parse(payload) as { value?: { newId?: string } }).value?.newId;
    expect(newId, "the CLI accepted --type and dropped it before the operation").toMatch(/^IR-ARCH-\d+$/);
    expect(await typeRowOf(rootPath, newId as string)).toBe("interface");
  });

  it("AC-4: the MCP supersede_requirement tool mints the same successor an operator would", async () => {
    // This case asserted only that the schema declared `type`. An audit deleted the handler's
    // pass-through — restoring the very defect on the MCP surface — and all four cases stayed green,
    // because nothing here invoked the handler. A declared argument the handler drops is exactly the
    // shape of the CLI defect this requirement exists to fix, so the tool is now actually called.
    const schema = renderToolSchemas()["supersede_requirement"];
    expect(schema, "supersede_requirement must be a registered MCP tool").toBeDefined();
    const type = schema!["type"];
    expect(type, "an agent cannot ask for the type an operator can").toBeDefined();
    // Optional, so an existing caller that sends no type keeps working — the AC-2 default over MCP.
    expect(type!.safeParse(undefined).success, "the argument must stay optional").toBe(true);

    const rootPath = await copyFixtureWorkspace("mutation-target");
    const oldId = await seedInterfaceRequirement(rootPath, "MCP successor carrier");
    const server = createMcpServer({ root: rootPath });

    const result = await server.callTool("supersede_requirement", {
      oldId,
      scope: "ARCH",
      target: FIXTURE_TARGET,
      type: "interface",
      title: "MCP successor carrier v2",
      statement: "SpecKiwi shall expose the MCP successor carrier surface.",
      acceptanceCriteria: ["The surface exists."]
    });

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const newId = (result as { ok: true; value: { newId?: string } }).value.newId;
    expect(newId, "the handler declared the type and dropped it before the operation").toMatch(/^IR-ARCH-\d+$/);
    expect(await typeRowOf(rootPath, newId as string)).toBe("interface");
  });
});
