import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { BUNDLED_RULES_VERSION, renderIndexTemplate } from "../../../src/core/bootstrap/templates.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-085 — init refreshes the bundled rules documents by default, without the force flag.
//
// Red-phase suite: one describe per acceptance criterion (AC-1..AC-6). Every case builds a real
// project in a temp directory and calls initProject, so the assertions read the actual file system
// result rather than an implementation-shaped mock.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-085):
//   - AC-1: a plain init overwrites drifted rules documents with the bundled content and reports
//           them as refreshed (`updated`), not `skipped`.
//   - AC-2: a plain init removes rules files carrying a version other than the bundled one.
//   - AC-3: files in docs/rule that do not match the tool's rules-file naming pattern survive.
//   - AC-4: the index, the scope SRS, the appendix and the step state file stay byte-identical.
//   - AC-5: a stale rules pointer in the index metadata is raised to the bundled version.
//   - AC-6: filename, index pointer and bundled version all derive from one version constant.

const RULES_DIR = ["docs", "rule"] as const;
const SRS_RULES_NAME = `SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`;
const SDS_RULES_NAME = "SDS-MD-Rules-v1.0.0.md";

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-rules-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function initOnce(rootPath: string) {
  const result = await initProject(await resolveProjectRoot(rootPath), {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function rulesPath(rootPath: string, name: string): string {
  return path.join(rootPath, ...RULES_DIR, name);
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

/** Matches an output path entry regardless of the realpath-normalised prefix initProject reports. */
function containsPathEndingWith(entries: readonly string[], suffix: string): boolean {
  return entries.some((entry) => entry.endsWith(suffix));
}

describe("FR-NODE-085 AC-1 — a plain init refreshes drifted rules documents", () => {
  it("FR-NODE-085 AC-1: restores the bundled SRS rules content over a locally modified copy without --force", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const bundled = await readFile(rulesPath(rootPath, SRS_RULES_NAME), "utf8");
    await writeFile(rulesPath(rootPath, SRS_RULES_NAME), "# tampered rules\n", "utf8");

    await initOnce(rootPath);

    expect(await readFile(rulesPath(rootPath, SRS_RULES_NAME), "utf8")).toBe(bundled);
  });

  it("FR-NODE-085 AC-1: restores the bundled SDS rules content over a locally modified copy without --force", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const bundled = await readFile(rulesPath(rootPath, SDS_RULES_NAME), "utf8");
    await writeFile(rulesPath(rootPath, SDS_RULES_NAME), "# tampered sds rules\n", "utf8");

    await initOnce(rootPath);

    expect(await readFile(rulesPath(rootPath, SDS_RULES_NAME), "utf8")).toBe(bundled);
  });

  it("FR-NODE-085 AC-1: reports a refreshed rules document as updated rather than skipped", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    await writeFile(rulesPath(rootPath, SRS_RULES_NAME), "# tampered rules\n", "utf8");

    const output = await initOnce(rootPath);

    expect(containsPathEndingWith(output.updated, path.join(...RULES_DIR, SRS_RULES_NAME))).toBe(true);
    expect(containsPathEndingWith(output.skipped, path.join(...RULES_DIR, SRS_RULES_NAME))).toBe(false);
  });
});

describe("FR-NODE-085 AC-2 — a plain init removes stale versioned rules files", () => {
  it("FR-NODE-085 AC-2: deletes an SRS rules file whose version differs from the bundled one", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const stale = rulesPath(rootPath, "SRS-MD-Rules-v0.9.0.md");
    await writeFile(stale, "# SRS-MD Authoring Rules v0.9.0\n", "utf8");

    const output = await initOnce(rootPath);

    expect(await readIfPresent(stale)).toBeUndefined();
    expect(containsPathEndingWith(output.removed, path.join(...RULES_DIR, "SRS-MD-Rules-v0.9.0.md"))).toBe(true);
    // The bundled-version document must survive the prune.
    expect(await readIfPresent(rulesPath(rootPath, SRS_RULES_NAME))).toBeDefined();
  });

  it("FR-NODE-085 AC-2: deletes an SDS rules file whose version differs from the bundled one", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const stale = rulesPath(rootPath, "SDS-MD-Rules-v0.9.0.md");
    await writeFile(stale, "# SDS-MD Authoring Rules v0.9.0\n", "utf8");

    await initOnce(rootPath);

    expect(await readIfPresent(stale)).toBeUndefined();
    expect(await readIfPresent(rulesPath(rootPath, SDS_RULES_NAME))).toBeDefined();
  });
});

describe("FR-NODE-085 AC-3 — a plain init preserves consumer-owned files in the rules directory", () => {
  it("FR-NODE-085 AC-3: keeps documents that do not match the rules-file naming pattern", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);
    const houseStyle = rulesPath(rootPath, "our-house-style.md");
    // A near miss: the tool's prefix without the versioned filename shape.
    const draft = rulesPath(rootPath, "SRS-MD-Rules-draft.md");
    await writeFile(houseStyle, "# House style\n", "utf8");
    await writeFile(draft, "# Draft notes\n", "utf8");

    const output = await initOnce(rootPath);

    expect(await readIfPresent(houseStyle)).toBe("# House style\n");
    expect(await readIfPresent(draft)).toBe("# Draft notes\n");
    expect(containsPathEndingWith(output.removed, "our-house-style.md")).toBe(false);
    expect(containsPathEndingWith(output.removed, "SRS-MD-Rules-draft.md")).toBe(false);
    const remaining = await readdir(path.join(rootPath, ...RULES_DIR));
    expect(remaining).toContain("our-house-style.md");
    expect(remaining).toContain("SRS-MD-Rules-draft.md");
  });
});

describe("FR-NODE-085 AC-4 — a plain init never rewrites authored requirement documents", () => {
  it("FR-NODE-085 AC-4: leaves the index, scope SRS, appendix and step state byte-identical", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const specDir = path.join(rootPath, "docs", "spec");
    const authored = {
      index: path.join(specDir, "00.index.md"),
      scope: path.join(specDir, "10.product-architecture.srs.md"),
      appendix: path.join(specDir, "90.appendix.md"),
      state: path.join(specDir, "steps", "state.md")
    };

    // Author real content on top of the scaffold. The index keeps the bundled rules pointer, so
    // AC-5 has nothing to raise here and the whole file must survive untouched.
    const authoredIndex = `${renderIndexTemplate()}\n| 2026-07-29 | v1.0.0 | ARCH | FR-ARCH-001 | Authored by the consumer | - |\n`;
    await writeFile(authored.index, authoredIndex, "utf8");
    const authoredScope = [
      "# Product Architecture",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | scope_srs |",
      "| Scope | ARCH |",
      "| Scope Name | Product Architecture |",
      "",
      "## 4. Requirements",
      "",
      "### FR-ARCH-001 — Consumer authored requirement",
      "",
      "The system SHALL keep this authored requirement across a plain init.",
      ""
    ].join("\n");
    await writeFile(authored.scope, authoredScope, "utf8");
    const authoredAppendix = "# SRS Appendix\n\nConsumer authored appendix content.\n";
    await writeFile(authored.appendix, authoredAppendix, "utf8");
    const authoredState = [
      "# Step State",
      "",
      "Mode: tdd",
      "Active Task: consumer-step",
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| consumer-step | in_progress | - | ARCH | FR-ARCH-001 | 2026-07-29 | 2026-07-29 |",
      ""
    ].join("\n");
    await writeFile(authored.state, authoredState, "utf8");

    await initOnce(rootPath);

    expect(await readFile(authored.index, "utf8")).toBe(authoredIndex);
    expect(await readFile(authored.scope, "utf8")).toBe(authoredScope);
    expect(await readFile(authored.appendix, "utf8")).toBe(authoredAppendix);
    expect(await readFile(authored.state, "utf8")).toBe(authoredState);
    // The authored requirement must still be findable by ID.
    expect(await readFile(authored.scope, "utf8")).toContain("FR-ARCH-001");
  });
});

describe("FR-NODE-085 AC-5 — a plain init raises a stale rules pointer in the index", () => {
  it("FR-NODE-085 AC-5: updates the index Rules metadata row to the bundled version and keeps authored content", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const staleIndex = `${renderIndexTemplate()
      .split("\n")
      .map((line) =>
        line.startsWith("| Rules |")
          ? "| Rules | [SRS-MD Authoring Rules v0.9.0](../rule/SRS-MD-Rules-v0.9.0.md) |"
          : line
      )
      .join("\n")}\n| 2026-07-29 | v1.0.0 | ARCH | FR-ARCH-001 | Authored by the consumer | - |\n`;
    await writeFile(indexPath, staleIndex, "utf8");

    await initOnce(rootPath);

    const updated = await readFile(indexPath, "utf8");
    const rulesRow = updated.split("\n").find((line) => line.startsWith("| Rules |"));
    expect(rulesRow, "the index must still carry a Rules metadata row").toBeDefined();
    expect(rulesRow).toContain(`SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`);
    expect(rulesRow).not.toContain("SRS-MD-Rules-v0.9.0.md");
    // The pointer refresh must be surgical: authored rows and sections survive.
    expect(updated).toContain("| 2026-07-29 | v1.0.0 | ARCH | FR-ARCH-001 | Authored by the consumer | - |");
    expect(updated).toContain("## 3. Target Map");
    expect(updated).toContain("## 7. Completed Work Log");
  });
});

describe("FR-NODE-085 AC-6 — the rules filename, the index pointer and the bundled version share one constant", () => {
  it("FR-NODE-085 AC-6: the installed filename and the index pointer are both derived from BUNDLED_RULES_VERSION", async () => {
    const rootPath = await emptyRepo();
    await initOnce(rootPath);

    expect(await readIfPresent(rulesPath(rootPath, SRS_RULES_NAME))).toBeDefined();
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain(`SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`);
  });

  it("FR-NODE-085 AC-6: no rules-refresh source file hardcodes a versioned rules filename literal", async () => {
    // A behavioural test cannot vary a compile-time constant, so derivation is asserted
    // structurally: raising BUNDLED_RULES_VERSION must not be able to leave a literal filename
    // behind in the modules that install, point at, or diagnose the rules document.
    const sources = ["bootstrap/templates.ts", "bootstrap/init-project.ts", "health/doctor.ts"] as const;
    const literal = /SRS-MD-Rules-v\d+\.\d+\.\d+/g;

    for (const relative of sources) {
      const filePath = fileURLToPath(new URL(`../../../src/core/${relative}`, import.meta.url));
      const source = await readFile(filePath, "utf8");
      const hits = source.match(literal) ?? [];
      expect(hits, `${relative} must build the rules filename from BUNDLED_RULES_VERSION, found ${hits.join(", ")}`).toEqual(
        []
      );
    }
  });
});
