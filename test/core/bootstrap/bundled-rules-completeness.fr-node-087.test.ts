import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import {
  BUNDLED_RULES_VERSION,
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SDS_RULES_VERSION,
  BUNDLED_SRS_RULES_FILENAME,
  loadBundledRulesDocument,
  loadBundledSdsRulesDocument,
  renderIndexRulesRow
} from "../../../src/core/bootstrap/templates.js";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-087 — the bundled authoring rules document must document every syntax the runtime writes.
//
// The installed v1.0.0 rules forbade heading emphasis and never mentioned the `[DISCARDED]` /
// `[DRAFT]` markers or the `checked_compatible` relation, while `update_status`, `update_stability`
// and `add_compatibility_check` write exactly those. A consumer following the installed rules would
// revert tool-written markers by hand and break the marker-to-status coupling the mutations keep.
//
// The assertions below read the document the tool actually ships and installs, not a fixture, so a
// future edit that drops a section is caught where a consumer would feel it.

let rulesText: string | undefined;

async function bundledRules(): Promise<string> {
  rulesText ??= await loadBundledRulesDocument();
  return rulesText;
}

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-bundled-rules-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

describe("FR-NODE-087 AC-1 — checked_compatible is a listed relation", () => {
  it("lists checked_compatible in the Relation Values table", async () => {
    const text = await bundledRules();
    const row = text
      .split(/\r?\n/)
      .find((line) => /^\|\s*`checked_compatible`\s*\|/.test(line.trim()));

    // A relation the tool writes but the rules do not list reads to a consumer as an illegal value.
    expect(row).toBeDefined();
    expect(row).toMatch(/\S/);
  });
});

describe("FR-NODE-087 AC-2 — the checked_compatible Notes grammar is specified", () => {
  it("names every recognised Notes key the tokeniser accepts", async () => {
    const text = await bundledRules();
    for (const key of ["fpv", "self", "peer", "checked-at"]) {
      expect(text).toContain(`\`${key}\``);
    }
  });

  it("states the semanticSha normalisation the runtime hashes", async () => {
    const text = await bundledRules();
    expect(text).toContain("semanticSha");
    // The normalisation is what makes two independently computed pins comparable, so the document
    // has to state it rather than merely name the field.
    expect(text.toLowerCase()).toContain("normaliz");
  });
});

describe("FR-NODE-087 AC-3 — the discarded heading marker is specified", () => {
  it("shows the strikethrough plus [DISCARDED] heading the mutation writes", async () => {
    const text = await bundledRules();
    expect(text).toContain("[DISCARDED]");
    expect(text).toContain("~~");
  });

  it("states that the marker is removed when the requirement leaves the discarded status", async () => {
    const text = await bundledRules();
    const section = sectionText(text, /^###\s+30\.1\s/, /^###\s+30\.2\s/);
    expect(section).not.toBe("");
    // Without the removal rule a consumer would leave a revived requirement struck through.
    expect(section.toLowerCase()).toMatch(/remove/);
  });
});

describe("FR-NODE-087 AC-4 — the draft heading marker is specified", () => {
  it("shows the [DRAFT — pending decision] heading the mutation writes", async () => {
    const text = await bundledRules();
    expect(text).toContain("[DRAFT — pending decision]");
  });

  it("states that the draft marker carries no strikethrough and is removed on leaving draft", async () => {
    const text = await bundledRules();
    const section = sectionText(text, /^###\s+30\.2\s/, /^###\s+30\.3\s/);
    expect(section).not.toBe("");
    expect(section.toLowerCase()).toContain("strikethrough");
    expect(section.toLowerCase()).toMatch(/remove/);
  });
});

describe("FR-NODE-087 AC-5 — the single-requirement mutation rule is stated", () => {
  it("states that a mutation targets exactly one Requirement ID", async () => {
    const text = await bundledRules();
    const section = sectionText(text, /^###\s+30\.3\s/, /^###\s+30\.4\s/);
    expect(section).not.toBe("");
    expect(section.toLowerCase()).toContain("single requirement id");
  });

  it("names the three mutation tool kinds the schemas declare", async () => {
    const text = await bundledRules();
    for (const kind of ["req-scoped", "log-append", "workspace"]) {
      expect(text).toContain(`\`${kind}\``);
    }
  });
});

describe("FR-NODE-087 AC-6 — marker policy and version identification are stated", () => {
  it("states the non-standard heading marker policy", async () => {
    const text = await bundledRules();
    const section = sectionText(text, /^###\s+30\.4\s/, /^###\s+30\.5\s/);
    expect(section).not.toBe("");
    expect(section.toLowerCase()).toContain("marker");
  });

  it("states how the governing rules version is identified", async () => {
    const text = await bundledRules();
    const section = sectionText(text, /^###\s+30\.5\s/, /^##\s+31\./);
    expect(section).not.toBe("");
    expect(section).toContain("Rules");
    expect(section).toContain("SRS-MD-Rules-v");
  });
});

describe("FR-NODE-087 AC-7 — the shipped version derives from one constant per document", () => {
  it("declares both bundled rules versions as 2.5.0", () => {
    expect(BUNDLED_RULES_VERSION).toBe("2.5.0");
    expect(BUNDLED_SDS_RULES_VERSION).toBe("2.5.0");
  });

  it("derives both bundled file names from their version constant", () => {
    expect(BUNDLED_SRS_RULES_FILENAME).toBe(`SRS-MD-Rules-v${BUNDLED_RULES_VERSION}.md`);
    expect(BUNDLED_SDS_RULES_FILENAME).toBe(`SDS-MD-Rules-v${BUNDLED_SDS_RULES_VERSION}.md`);
  });

  it("derives the index Rules pointer from the same constant", () => {
    expect(renderIndexRulesRow()).toContain(BUNDLED_SRS_RULES_FILENAME);
    expect(renderIndexRulesRow()).toContain(`v${BUNDLED_RULES_VERSION}`);
  });

  it("installs both documents under their derived names and no other rules file", async () => {
    const rootPath = await emptyRepo();
    const result = await initProject(await resolveProjectRoot(rootPath), {});
    expect(result.ok).toBe(true);

    const installed = (await readdir(path.join(rootPath, "docs", "rule"))).sort();
    expect(installed).toEqual([BUNDLED_SDS_RULES_FILENAME, BUNDLED_SRS_RULES_FILENAME].sort());

    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain(renderIndexRulesRow());
  });
});

describe("FR-NODE-087 AC-8 — the package whitelist names both bundled documents", () => {
  it("lists each bundled rules document path, so a packaged install resolves it", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as { files?: string[] };
    expect(manifest.files).toContain(`docs/rule/${BUNDLED_SRS_RULES_FILENAME}`);
    expect(manifest.files).toContain(`docs/rule/${BUNDLED_SDS_RULES_FILENAME}`);
  });

  it("loads each bundled document from disk rather than falling back to a stub", async () => {
    // The loaders carry an ENOENT fallback that returns a one-line placeholder. A whitelist that
    // named the wrong path would ship that placeholder silently, so length is the tell.
    expect((await loadBundledRulesDocument()).length).toBeGreaterThan(1000);
    expect((await loadBundledSdsRulesDocument()).length).toBeGreaterThan(1000);
  });
});

describe("FR-NODE-087 AC-9 — every runtime claim the document makes is true", () => {
  it("cites no diagnostic code that the registry does not define", async () => {
    const text = await bundledRules();
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));
    const cited = new Set(text.match(/SRS-[EW]\d{3}/g) ?? []);

    const unknown = [...cited].filter((code) => !registered.has(code)).sort();
    expect(unknown).toEqual([]);
  });
});

/** The lines between a starting heading and the next heading that ends the section. */
function sectionText(text: string, start: RegExp, end: RegExp): string {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex((line) => start.test(line));
  if (from === -1) return "";
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => end.test(line));
  return (to === -1 ? rest : rest.slice(0, to)).join("\n");
}

describe("FR-NODE-087 AC-9 — the marker rules the document states are the ones the runtime keeps", () => {
  it("keeps the draft marker across a status transition, as §30.2 requires", async () => {
    const { copyFixtureWorkspace } = await import("../../fixtures/fixture-utils.js");
    const { updateStability } = await import("../../../src/core/mutation/update-stability.js");
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");
    const { readFile } = await import("node:fs/promises");

    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const id = /^###\s+(?:~~)?([A-Z]+-[A-Z0-9-]+-\d+)/m.exec(await readFile(specPath, "utf8"))?.[1];
    expect(id).toBeDefined();

    const draft = await updateStability(root, { id: id!, stability: "draft", reason: "pending decision" });
    expect(draft.ok).toBe(true);
    expect(await readFile(specPath, "utf8")).toContain("[DRAFT — pending decision]");

    // A status change says nothing about stability. Dropping the marker here would leave the heading
    // and the Stability row disagreeing, with no mutation able to put the marker back.
    const moved = await updateStatus(root, { id: id!, status: "in_progress" });
    expect(moved.ok).toBe(true);

    const after = await readFile(specPath, "utf8");
    expect(after).toContain("[DRAFT — pending decision]");
    expect(after).toContain("| Stability | draft |");
    expect(after).toContain("| Status | in_progress |");
  });
});
