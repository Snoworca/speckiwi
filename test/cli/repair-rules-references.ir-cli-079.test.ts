import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../src/core/bootstrap/templates.js";
import { toolSpecs } from "../../src/mcp/schemas.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-079 — `speckiwi repair rules-references diagnose|apply`.
//
// The repair sits in the `repair` subtree, which is deliberately outside the registry-derived
// `commands` catalog: the catalog's cliName equality is asserted against a program built from the read
// and mutation trees only, exactly as `repair requirement-id-collisions` already is.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const STALE_LINK = "[SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md)";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function workspaceWithDanglingReference(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(path.join(root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  const specPath = path.join(root, SPEC_FILE);
  await writeFile(
    specPath,
    (await readFile(specPath, "utf8"))
      .replace("| Status | planned |", "| Status | verified |")
      .replace("| Related Docs | [Index](./00.index.md) |", `| Related Docs | ${STALE_LINK} |`),
    "utf8"
  );
  return root;
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(path.relative(root, full).replace(/\\/g, "/"), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}

describe("IR-CLI-079 AC-1 — diagnose reports and writes nothing", () => {
  it("exits 0, names the finding, and leaves the tree byte-identical", async () => {
    const root = await workspaceWithDanglingReference();
    const before = await snapshot(root);

    const streams = io();
    const code = await main(["--root", root, "repair", "rules-references", "diagnose", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code, out).toBe(0);
    const parsed = JSON.parse(out) as { ok: boolean; value?: { applied?: boolean; findings?: unknown[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.applied).toBe(false);
    expect(parsed.value?.findings).toHaveLength(1);
    expect(out).toContain("FR-ARCH-001");

    const after = await snapshot(root);
    for (const [rel, content] of after) expect(content, `diagnose must not modify ${rel}`).toBe(before.get(rel));
  });
});

describe("IR-CLI-079 AC-2 — apply performs the repair, and a failure exits 5", () => {
  it("rewrites the reference and exits 0", async () => {
    const root = await workspaceWithDanglingReference();

    const streams = io();
    const code = await main(["--root", root, "repair", "rules-references", "apply", "--json"], streams);

    expect(code, drain(streams.stdout)).toBe(0);
    const spec = await readFile(path.join(root, SPEC_FILE), "utf8");
    expect(spec).not.toContain("SRS-MD-Rules-v1.0.0.md");
    expect(spec).toContain(BUNDLED_SRS_RULES_FILENAME);
  });

  it("exits 5 when another session holds the SRS mutation lock", async () => {
    const root = await workspaceWithDanglingReference();
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

    const streams = io();
    const code = await main(["--root", root, "repair", "rules-references", "apply", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(5);
    expect(out).toContain("SRS_LOCKED");
    // A refused run changes nothing.
    expect(await readFile(path.join(root, SPEC_FILE), "utf8")).toContain("SRS-MD-Rules-v1.0.0.md");
  });
});

describe("IR-CLI-079 AC-3 — the repair subtree carries no MCP tool", () => {
  it("exposes no registry entry and no server tool that performs this repair", async () => {
    // The `repair` subtree is outside the registry's cliName set by design, so the catalog must not
    // list these leaves — asserting the opposite would contradict the architecture the collision
    // repair already follows.
    expect(toolSpecs.some((spec) => spec.cliName === "rules-references")).toBe(false);
    expect(toolSpecs.some((spec) => spec.coreFn === "repairRulesReferences")).toBe(false);

    // And nothing on the live MCP surface drives it. Checking the instantiated server rather than the
    // registry matters: a registry that merely omits the name proves nothing about the server.
    expect(Object.keys(toolSchemas).filter((name) => /rules.?reference/i.test(name))).toEqual([]);

    // The command really is reachable, so the absence above is a policy choice and not a missing wire.
    const root = await workspaceWithDanglingReference();
    const streams = io();
    expect(await main(["--root", root, "repair", "rules-references", "diagnose", "--json"], streams)).toBe(0);
  });
});
