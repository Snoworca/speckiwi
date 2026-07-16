import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-076 — init installs the bundled SDS-MD rules document. RED suite (one
// case per AC). AC-1/AC-2 fail while init only ships the SRS-MD rules (the SDS
// rules the v1.6 snippet references are never installed), and AC-3 fails while
// the npm files whitelist omits the SDS rules path.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SDS_RULES_REL = path.join("docs", "rule", "SDS-MD-Rules-v1.0.0.md");

const exists = (p: string): Promise<boolean> => access(p).then(() => true).catch(() => false);

describe("FR-NODE-076 init installs the bundled SDS-MD rules document", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-076-"));
    await mkdir(path.join(root, ".git"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("FR-NODE-076 AC-1: creates docs/rule/SDS-MD-Rules-v1.0.0.md with the bundled content", async () => {
    const result = await initProject(await resolveProjectRoot(root), {});
    expect(result.ok).toBe(true);

    const rules = await readFile(path.join(root, SDS_RULES_REL), "utf8");
    expect(rules).toContain("SDS-MD Authoring Rules v1.0.0");
    expect(rules).toContain("Acceptance Contracts");
    expect(rules).toContain("design.md");
  });

  it("FR-NODE-076 AC-2: writeIfMissing keeps a pre-existing file, and dryRun writes nothing", async () => {
    // Pre-existing file is never overwritten.
    const custom = "# My local SDS rules\n";
    await mkdir(path.join(root, "docs", "rule"), { recursive: true });
    await writeFile(path.join(root, SDS_RULES_REL), custom, "utf8");
    const result = await initProject(await resolveProjectRoot(root), {});
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, SDS_RULES_REL), "utf8")).toBe(custom);

    // dryRun on an empty repo writes nothing.
    const dryRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-076-dry-"));
    try {
      await mkdir(path.join(dryRoot, ".git"), { recursive: true });
      const dry = await initProject(await resolveProjectRoot(dryRoot), { dryRun: true });
      expect(dry.ok).toBe(true);
      expect(await exists(path.join(dryRoot, SDS_RULES_REL))).toBe(false);
    } finally {
      await rm(dryRoot, { recursive: true, force: true });
    }
  });

  it("FR-NODE-076 AC-3: the npm files whitelist includes the SDS rules document", async () => {
    const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(manifest.files).toContain("docs/rule/SDS-MD-Rules-v1.0.0.md");
  });
});
