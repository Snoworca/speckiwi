import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — the target rename core. The fixture registers both `5.2` and `5.2.0` so every
// rewrite site has a near-miss neighbour: renaming `5.2` must never touch `5.2.0`.

const INDEX = path.join("docs", "spec", "00.index.md");
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function edit(rootPath: string, relative: string, change: (text: string) => string): Promise<void> {
  // Fixtures follow the checkout newline style; edit in LF and write back in the file's own style.
  const file = path.join(rootPath, relative);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, change(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}

async function renameFixture(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  await edit(rootPath, INDEX, (text) =>
    text
      .replace("| Active Target | v1.0.0 |", "| Active Target | 5.2 |")
      .replace(
        "| v1.0.0 | release | active | Fixture release |",
        "| 5.2 | release | active | Short name, not 5.2.0 |\n| 5.2.0 | version | planned | Long name next to 5.2 |"
      )
      .replace(
        "## 4. Scope Map",
        "### Target: 5.2\n\n**Goal:** Ship the 5.2 work.\n\n### Target: 5.2.0\n\n**Goal:** Ship the 5.2.0 work.\n\n## 4. Scope Map"
      )
  );
  await edit(rootPath, SPEC, (text) => {
    const first = text.slice(text.indexOf("### FR-ARCH-001"));
    const second = first.replace("FR-ARCH-001 — Mutable requirement", "FR-ARCH-002 — Neighbour requirement").replace("| Target | v1.0.0 |", "| Target | 5.2.0 |");
    return `${text.replace("| Target | v1.0.0 |", "| Target | 5.2 |").replace("SpecKiwi must mutate this fixture requirement.", "SpecKiwi must mutate this fixture requirement for 5.2.")}\n${second}`;
  });
  return rootPath;
}

async function snapshot(rootPath: string): Promise<{ index: string; spec: string }> {
  return {
    index: (await readFile(path.join(rootPath, INDEX), "utf8")).replace(/\r\n/g, "\n"),
    spec: (await readFile(path.join(rootPath, SPEC), "utf8")).replace(/\r\n/g, "\n")
  };
}

async function errorCodes(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  const all = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
  return all.filter((item) => item.severity === "error").map((item) => `${item.code}:${item.message}`).sort();
}

describe("IR-CLI-112 renameTarget core", () => {
  // @req IR-CLI-112 AC-1
  it("AC-1: rewrites the Target Map row, Target fields, Active Target and goal heading, and reports each", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);

    const result = await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    expect(result.value.written).toBe(true);

    const after = await snapshot(rootPath);
    expect(after.index).toContain("| Active Target | 5.3 |");
    expect(after.index).toContain("| 5.3 | release | active | Short name, not 5.2.0 |");
    expect(after.index).toContain("### Target: 5.3\n");
    expect(after.spec).toContain("| Target | 5.3 |");

    const indexLines = after.index.split("\n");
    const specLines = after.spec.split("\n");
    const located = result.value.locations.map((item) => ({ kind: item.kind, file: item.file, after: item.after }));
    expect(located).toEqual(
      expect.arrayContaining([
        { kind: "target-map-row", file: "docs/spec/00.index.md", after: "| 5.3 | release | active | Short name, not 5.2.0 |" },
        { kind: "active-target", file: "docs/spec/00.index.md", after: "| Active Target | 5.3 |" },
        { kind: "target-goal-heading", file: "docs/spec/00.index.md", after: "### Target: 5.3" },
        { kind: "requirement-target", file: "docs/spec/10.product-architecture.srs.md", after: "| Target | 5.3 |" }
      ])
    );
    expect(result.value.locations).toHaveLength(4);
    // Every reported location names the line it rewrote, its old text, and its new text on disk.
    for (const item of result.value.locations) {
      const lines = item.file.endsWith("00.index.md") ? indexLines : specLines;
      expect(lines[item.line - 1]).toBe(item.after);
      expect(item.before).toBe(item.after.replace("5.3", "5.2"));
    }
    expect(result.value.locations.find((item) => item.kind === "requirement-target")?.requirementId).toBe("FR-ARCH-001");
  });

  // @req IR-CLI-112 AC-1
  it("AC-1: matches whole target names only, so renaming 5.2 leaves 5.2.0 and prose untouched", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);

    const after = await snapshot(rootPath);
    expect(after.index).toContain("| 5.2.0 | version | planned | Long name next to 5.2 |");
    expect(after.index).toContain("### Target: 5.2.0\n");
    expect(after.index).toContain("**Goal:** Ship the 5.2 work.");
    expect(after.spec).toContain("| Target | 5.2.0 |");
    expect(after.spec).toContain("fixture requirement for 5.2.");
    const parsed = await parseWorkspace(root);
    expect(parsed.index.targetGoals["5.3"]).toBe("Ship the 5.2 work.");
    expect(parsed.index.targetGoals["5.2.0"]).toBe("Ship the 5.2.0 work.");
    expect(parsed.records.find((record) => record.id === "FR-ARCH-002")?.target).toBe("5.2.0");
  });

  // @req IR-CLI-112 AC-1
  it("AC-1: renaming the longer name leaves the shorter one alone", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "5.2.0", to: "5.4.0", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    expect(result.value.locations.map((item) => item.kind).sort()).toEqual(["requirement-target", "target-goal-heading", "target-map-row"]);
    const after = await snapshot(rootPath);
    expect(after.index).toContain("| Active Target | 5.2 |");
    expect(after.index).toContain("| 5.2 | release | active |");
    expect(after.spec).toContain("| Target | 5.2 |");
    expect(after.spec).toContain("| Target | 5.4.0 |");
  });

  // @req IR-CLI-112 AC-2
  it("AC-2: refuses a new name that is already registered, with a diagnostic, writing nothing", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const before = await snapshot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.2.0", dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("SRS-E022");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-2
  it("AC-2: refuses an old name that is not registered, with a diagnostic, writing nothing", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const before = await snapshot(rootPath);
    const result = await renameTarget(root, { from: "5.2.1", to: "5.3", dryRun: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(result.diagnostics.map((item) => item.code)).toContain("SRS-W002");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: dry-run is the default, reports the same locations, and writes nothing", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const before = await snapshot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.3" });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    expect(result.value.dryRun).toBe(true);
    expect(result.value.written).toBe(false);
    expect(result.value.locations).toHaveLength(4);
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: validate reports no new errors after an applied rename", async () => {
    const rootPath = await renameFixture();
    const root = await resolveProjectRoot(rootPath);
    const before = await errorCodes(rootPath);
    expect((await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false })).ok).toBe(true);
    expect(await errorCodes(rootPath)).toEqual(before);
    expect(before).toEqual([]);
  });

  it("rejects an empty, unchanged, or non-token new name", async () => {
    const root = await resolveProjectRoot(await renameFixture());
    for (const to of ["", "  ", "5.2", "5 3", "a/b", "a|b"]) {
      const result = await renameTarget(root, { from: "5.2", to, dryRun: false });
      expect(result.ok, `to=${JSON.stringify(to)}`).toBe(false);
    }
  });
});

// The second fixture adds every place a target name is recorded outside the four AC-1 sites:
// a step requirement, an appendix goal, the Release Residue register, and the Completed Work Log
// both inline and in its split history file. Each carries a 5.2.0 neighbour row.
const APPENDIX = path.join("docs", "spec", "90.appendix.md");
const HISTORY = path.join("docs", "spec", "91.completed-work-log.md");
const STEP = path.join("docs", "spec", "steps", "probe-step", "probe.srs.md");

async function readLf(rootPath: string, relative: string): Promise<string> {
  return (await readFile(path.join(rootPath, relative), "utf8")).replace(/\r\n/g, "\n");
}

async function extendedFixture(): Promise<string> {
  const rootPath = await renameFixture();
  await edit(rootPath, INDEX, (text) =>
    text
      .replace(
        "| Date | Target | Scope | Requirement IDs | Summary |\n|---|---|---|---|---|",
        "| Date | Target | Scope | Requirement IDs | Summary |\n|---|---|---|---|---|\n| 2026-11-01 | 5.2 | ARCH | FR-ARCH-001 | Inline 5.2 work. |\n| 2026-11-02 | 5.2.0 | ARCH | FR-ARCH-002 | Inline 5.2.0 work. |"
      )
      .concat(
        "\n## 6. Release Residue\n\nRows accepted without a criterion.\n\n| Target | Requirement | Criterion | Reason |\n| --- | --- | --- | --- |\n| 5.2 | FR-ARCH-001 | AC-2 | Deferred from 5.2. |\n| 5.2.0 | FR-ARCH-002 | AC-2 | Deferred from 5.2.0. |\n"
      )
  );
  await writeFile(
    path.join(rootPath, HISTORY),
    "> History.\n\n## 5. Completed Work Log\n\n| Date | Target | Scope | Requirement IDs | Summary |\n|---|---|---|---|---|\n| 2026-10-01 | 5.2 | ARCH | FR-ARCH-001 | Older 5.2 work. |\n| 2026-10-02 | 5.2.0 | ARCH | FR-ARCH-002 | Older 5.2.0 work. |\n",
    "utf8"
  );
  await writeFile(path.join(rootPath, APPENDIX), "# Appendix\n\n### Target: 5.2\n\n**Goal:** Appendix goal for 5.2.\n\n### Target: 5.2.0\n\n**Goal:** Appendix goal for 5.2.0.\n", "utf8");
  const spec = await readLf(rootPath, SPEC);
  const block = spec.slice(spec.indexOf("### FR-ARCH-001"), spec.indexOf("### FR-ARCH-002"));
  await mkdir(path.dirname(path.join(rootPath, STEP)), { recursive: true });
  await writeFile(
    path.join(rootPath, STEP),
    `# Probe step\n\n## 4. Requirements\n\n${block.replace("FR-ARCH-001 — Mutable requirement", "FR-ARCH-901 — Step requirement")}\n${block
      .replace("FR-ARCH-001 — Mutable requirement", "FR-ARCH-902 — Step neighbour")
      .replace("| Target | 5.2 |", "| Target | 5.2.0 |")}`,
    "utf8"
  );
  return rootPath;
}

describe("IR-CLI-112 renameTarget beyond the index head", () => {
  // @req IR-CLI-112 AC-1
  it("AC-1: rewrites a step requirement's Target field and an appendix goal heading", async () => {
    const rootPath = await extendedFixture();
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");

    const step = await readLf(rootPath, STEP);
    expect(step).toContain("| Target | 5.3 |");
    expect(step).toContain("| Target | 5.2.0 |");
    const appendix = await readLf(rootPath, APPENDIX);
    expect(appendix).toContain("### Target: 5.3\n");
    expect(appendix).toContain("### Target: 5.2.0\n");
    const stepPath = STEP.split(path.sep).join("/");
    expect(result.value.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "requirement-target", file: stepPath, requirementId: "FR-ARCH-901", after: "| Target | 5.3 |" }),
        expect.objectContaining({ kind: "target-goal-heading", file: "docs/spec/90.appendix.md", after: "### Target: 5.3" })
      ])
    );
    const parsed = await parseWorkspace(root);
    expect(parsed.stepRecords?.find((record) => record.id === "FR-ARCH-901")?.target).toBe("5.3");
    expect(parsed.stepRecords?.find((record) => record.id === "FR-ARCH-902")?.target).toBe("5.2.0");
  });

  // @req IR-CLI-112 AC-5
  it("AC-5: rewrites the Release Residue rows and both Completed Work Log tables, whole names only", async () => {
    const rootPath = await extendedFixture();
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");

    const index = await readLf(rootPath, INDEX);
    const history = await readLf(rootPath, HISTORY);
    expect(index).toContain("| 5.3 | FR-ARCH-001 | AC-2 | Deferred from 5.2. |");
    expect(index).toContain("| 5.2.0 | FR-ARCH-002 | AC-2 | Deferred from 5.2.0. |");
    expect(index).toContain("| 2026-11-01 | 5.3 | ARCH | FR-ARCH-001 | Inline 5.2 work. |");
    expect(index).toContain("| 2026-11-02 | 5.2.0 | ARCH | FR-ARCH-002 | Inline 5.2.0 work. |");
    expect(history).toContain("| 2026-10-01 | 5.3 | ARCH | FR-ARCH-001 | Older 5.2 work. |");
    expect(history).toContain("| 2026-10-02 | 5.2.0 | ARCH | FR-ARCH-002 | Older 5.2.0 work. |");

    const kinds = result.value.locations.map((item) => `${item.kind}@${item.file}`);
    expect(kinds).toContain("release-residue-row@docs/spec/00.index.md");
    expect(kinds).toContain("completed-work-row@docs/spec/00.index.md");
    expect(kinds).toContain("completed-work-row@docs/spec/91.completed-work-log.md");
    // Every 5.2 reference the parser reads now names 5.3.
    const parsed = await parseWorkspace(root);
    expect(parsed.index.completedWork.filter((entry) => entry.target === "5.2")).toEqual([]);
    expect(parsed.index.completedWork.filter((entry) => entry.target === "5.3")).toHaveLength(2);
  });

  // @req IR-CLI-112 AC-5
  it("AC-5: validate reports no new errors or SRS-W012 warnings after the rename", async () => {
    const rootPath = await extendedFixture();
    const root = await resolveProjectRoot(rootPath);
    const before = await errorCodes(rootPath);
    expect((await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false })).ok).toBe(true);
    expect(await errorCodes(rootPath)).toEqual(before);
    const parsed = await parseWorkspace(root);
    const warnings = [...parsed.diagnostics, ...validateWorkspace(parsed).diagnostics].filter((item) => item.code === "SRS-W012");
    expect(warnings).toEqual([]);
  });
});

describe("IR-CLI-112 renameTarget reads residue rows as release readiness does", () => {
  // @req IR-CLI-112 AC-5
  it("AC-5: rewrites residue rows that omit the optional leading or trailing pipe", async () => {
    const rootPath = await renameFixture();
    await edit(rootPath, INDEX, (text) =>
      text.concat(
        "\n## 6. Release Residue\n\n| Target | Requirement | Criterion | Reason |\n| --- | --- | --- | --- |\n5.2 | FR-ARCH-001 | AC-1 | No leading pipe. |\n| 5.2 | FR-ARCH-001 | AC-2 | No trailing pipe\n5.2.0 | FR-ARCH-002 | AC-1 | Neighbour. |\n"
      )
    );
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    const index = (await snapshot(rootPath)).index;
    expect(index).toContain("\n5.3 | FR-ARCH-001 | AC-1 | No leading pipe. |\n");
    expect(index).toContain("\n| 5.3 | FR-ARCH-001 | AC-2 | No trailing pipe\n");
    expect(index).toContain("\n5.2.0 | FR-ARCH-002 | AC-1 | Neighbour. |\n");
    expect(result.value.locations.filter((item) => item.kind === "release-residue-row")).toHaveLength(2);
  });
});
