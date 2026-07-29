import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { BUNDLED_SDS_RULES_FILENAME, BUNDLED_SDS_RULES_VERSION } from "../../../src/core/bootstrap/templates.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-076 — init installs the bundled SDS-MD rules document. RED suite (one
// case per AC). AC-1/AC-2 fail while init only ships the SRS-MD rules (the SDS
// rules the v1.6 snippet references are never installed), and AC-3 fails while
// the npm files whitelist omits the SDS rules path.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// FR-NODE-087 AC-7 — the installed path derives from the version constant, so a version bump
// cannot leave this assertion pinned to a file the tool no longer ships.
const SDS_RULES_REL = path.join("docs", "rule", BUNDLED_SDS_RULES_FILENAME);

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

  it("FR-NODE-076 AC-1: creates the bundled SDS rules document with the bundled content", async () => {
    const result = await initProject(await resolveProjectRoot(root), {});
    expect(result.ok).toBe(true);

    const rules = await readFile(path.join(root, SDS_RULES_REL), "utf8");
    expect(rules).toContain(`SDS-MD Authoring Rules v${BUNDLED_SDS_RULES_VERSION}`);
    expect(rules).toContain("Acceptance Contracts");
    expect(rules).toContain("design.md");
  });

  it("FR-NODE-076 AC-2: a pre-existing file is refreshed to the bundled content, and dryRun writes nothing", async () => {
    // FR-NODE-085 AC-1 supersedes the original "never overwrite a pre-existing file" clause of this
    // AC: the rules documents are tool-owned, so a plain init restores the bundled content over a
    // locally modified copy. What survives from FR-NODE-076 AC-2 is the dryRun half below.
    const custom = "# My local SDS rules\n";
    await mkdir(path.join(root, "docs", "rule"), { recursive: true });
    await writeFile(path.join(root, SDS_RULES_REL), custom, "utf8");
    const result = await initProject(await resolveProjectRoot(root), {});
    expect(result.ok).toBe(true);
    const refreshed = await readFile(path.join(root, SDS_RULES_REL), "utf8");
    expect(refreshed).not.toBe(custom);
    expect(refreshed).toContain(`SDS-MD Authoring Rules v${BUNDLED_SDS_RULES_VERSION}`);

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
    expect(manifest.files).toContain(`docs/rule/${BUNDLED_SDS_RULES_FILENAME}`);
  });
});
