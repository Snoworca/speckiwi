import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { previewRequirementId, assertExplicitRequirementId } from "../../src/core/id-generator.js";
import { loadRequirementRegistry } from "../../src/core/requirements.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("requirement ID generator", () => {
  it("previews the next deterministic sequence without writing files", async () => {
    const root = await createIdWorkspace();
    const before = await readTree(join(root, ".speckiwi"));
    const registry = await loadRequirementRegistry({ root });

    const result = previewRequirementId({ requirementType: "functional", scope: "agent-kernel.loop" }, registry);
    const after = await readTree(join(root, ".speckiwi"));

    expect(result).toMatchObject({
      ok: true,
      id: "FR-SPEKIW-LOOP-0004",
      generated: true,
      prefix: "FR",
      projectSegment: "SPEKIW",
      scopeSegment: "LOOP",
      sequence: 4,
      formattedSequence: "0004",
      collisionCount: 0
    });
    expect(after).toEqual(before);
  });

  it("maps requirement types to prefixes and scope segments", async () => {
    const root = await createIdWorkspace();
    const registry = await loadRequirementRegistry({ root });

    expect(previewRequirementId({ requirementType: "non_functional", scope: "agent-kernel.loop" }, registry)).toMatchObject({
      ok: true,
      id: "NFR-SPEKIW-LOOP-0001",
      prefix: "NFR"
    });
    expect(previewRequirementId({ requirementType: "interface", scope: "agent-kernel.streaming_api" }, registry)).toMatchObject({
      ok: true,
      id: "IR-SPEKIW-STREAPI-0001",
      scopeSegment: "STREAPI"
    });
  });

  it("honors explicit IDs and rejects duplicate explicit IDs", async () => {
    const root = await createIdWorkspace();
    const registry = await loadRequirementRegistry({ root });

    const unique = previewRequirementId(
      { requirementType: "functional", scope: "agent-kernel.loop", explicitId: "FR-CUSTOM-LOOP-0099" },
      registry
    );
    const duplicate = previewRequirementId(
      { requirementType: "functional", scope: "agent-kernel.loop", explicitId: "FR-SPEKIW-LOOP-0003" },
      registry
    );
    const duplicateBag = assertExplicitRequirementId("FR-SPEKIW-LOOP-0003", registry);

    expect(unique).toMatchObject({
      ok: true,
      id: "FR-CUSTOM-LOOP-0099",
      generated: false
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_REQUIREMENT_ID" },
      diagnostics: { summary: { errorCount: 1 } }
    });
    expect(duplicateBag.errors.map((diagnostic) => diagnostic.code)).toEqual(["DUPLICATE_REQUIREMENT_ID"]);
  });
});

async function createIdWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-id-"));
  tempRoots.push(root);
  await mkdir(join(root, ".speckiwi", "srs"), { recursive: true });
  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: spec-kiwi
  name: SpecKiwi
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: srs.loop
    type: srs
    path: srs/loop.yaml
    scope: agent-kernel.loop
scopes:
  - id: agent-kernel.loop
    name: Agent Kernel Loop
    type: module
links: []
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Overview
status: active
summary: ID fixture.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "dictionary.yaml"),
    `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms: {}
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "loop.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.loop
type: srs
scope: agent-kernel.loop
title: Loop SRS
status: active
requirements:
  - id: FR-SPEKIW-LOOP-0001
    type: functional
    title: Existing one
    status: active
    statement: The system shall keep the first existing requirement available.
    rationale: ID generation scans existing IDs.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Existing sequence one is scanned.
    relations: []
  - id: FR-SPEKIW-LOOP-0003
    type: functional
    title: Existing three
    status: active
    statement: The system shall advance beyond the highest existing requirement ID.
    rationale: ID generation uses the maximum sequence.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Existing sequence three is scanned.
    relations: []
`,
    "utf8"
  );
  return root;
}

async function readTree(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        entries[relative(root, path).split("\\").join("/")] = await readFile(path, "utf8");
      }
    }
  }

  await visit(root);
  return entries;
}
