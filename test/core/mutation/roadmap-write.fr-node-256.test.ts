import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { addRoadmapItem, commitRoadmapWrite, updateRoadmapItem } from "../../../src/core/mutation/roadmap-items.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { checkRoadmap } from "../../../src/core/roadmap/compute-roadmap.js";
import { readRoadmap, readRoadmapFile, roadmapSourcesOf } from "../../../src/core/roadmap/load-roadmap.js";
import { parseRoadmap } from "../../../src/core/roadmap/parse-roadmap.js";
import { ROADMAP_FIELDS } from "../../../src/core/roadmap/roadmap-grammar.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { roadmapText, sources } from "../roadmap/roadmap-fixture.js";

// FR-NODE-256 — roadmap add and update: the only writers of docs/roadmap.md, under the SRS lock,
// through a patch plan, with a Change History row for every change.

const DATE = "2026-11-05";

async function workspace(roadmap?: string): Promise<{ rootPath: string; file: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, "docs", "roadmap.md");
  if (roadmap !== undefined) await writeFile(file, roadmap, "utf8");
  return { rootPath, file };
}

async function text(file: string): Promise<string> {
  return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

function historyRows(document: string, id: string): string[] {
  const start = document.indexOf(`### ${id} — `);
  const next = document.indexOf("\n### RM-", start + 1);
  const block = document.slice(start, next < 0 ? undefined : next);
  return block.split("\n").filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));
}

describe("FR-NODE-256 AC-1 — add allocates the next number and creates the file", () => {
  // @req FR-NODE-256 AC-1
  it("creates docs/roadmap.md with its banner and document table and writes every row with `-` for an unset value", async () => {
    const { rootPath, file } = await workspace();
    const result = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "milestone", title: "First milestone", plannedEnd: "2026-Q4", reason: "kickoff", date: DATE });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ id: "RM-1", written: true, created: true });
    const written = await text(file);
    expect(written).toContain("# Roadmap");
    expect(written).toContain("| Document Type | roadmap |");
    expect(written).toContain("## 1. Items");
    expect(written).toContain("not a requirement source");
    const item = parseRoadmap(written, sources()).document.items[0]!;
    expect(item.id).toBe("RM-1");
    expect(Object.keys(item.fields).sort()).toEqual([...ROADMAP_FIELDS].sort());
    expect(item.fields.Kind?.value).toBe("milestone");
    expect(item.fields["Planned End"]?.value).toBe("2026-Q4");
    expect(item.fields.Owner?.value).toBe("-");
    expect(item.fields.Targets?.value).toBe("-");
    expect(item.fields.Lifecycle?.value).toBe("open");
    expect(historyRows(written, "RM-1")).toEqual([`| ${DATE} | Created | - | - | kickoff |`]);
    const workspaceSources = await roadmapSourcesOf(await parseWorkspace(await resolveProjectRoot(rootPath)));
    expect(checkRoadmap(written, workspaceSources).diagnostics).toEqual([]);
  });

  // @req FR-NODE-256 AC-1
  it("allocates the number after the highest existing one and appends the item", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }, { n: 2 }, { n: 3 }));
    const result = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "Fourth", reason: "next", date: DATE });
    expect(result.value?.id).toBe("RM-4");
    expect(parseRoadmap(await text(file), sources()).document.items.map((item) => item.id)).toEqual(["RM-1", "RM-2", "RM-3", "RM-4"]);
    // After the highest number, not after the count: a gap left by a hand edit is never filled. The new
    // RM-6 is itself out of sequence there, so AC-6 refuses the write, naming the number it allocated.
    const gapped = await workspace(roadmapText({ n: 1 }, { n: 2 }, { n: 5 }));
    const next = await addRoadmapItem(await resolveProjectRoot(gapped.rootPath), { kind: "feature", title: "Sixth", reason: "next", date: DATE });
    expect(next.error?.code).toBe("MUTATION_DENIED");
    expect(next.error?.diagnostics?.map((item) => item.message)).toEqual([expect.stringContaining("RM-6 is out of sequence")]);
  });

  // @req FR-NODE-256 AC-1
  it("is not created by speckiwi init", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "speckiwi-roadmap-init-"));
    await mkdir(path.join(rootPath, ".git"));
    const init = await initProject(await resolveProjectRoot(rootPath), {});
    expect(init.ok).toBe(true);
    expect(existsSync(path.join(rootPath, "docs", "spec", "00.index.md"))).toBe(true);
    expect(existsSync(path.join(rootPath, "docs", "roadmap.md"))).toBe(false);
  });
});

describe("FR-NODE-256 AC-2 — add from a target", () => {
  // @req FR-NODE-256 AC-2
  it("creates an item whose Targets is the target and whose Purpose is `-`, so the goal is borrowed", async () => {
    const { rootPath, file } = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const result = await addRoadmapItem(root, { kind: "milestone", title: "Release 1", fromTarget: "v1.0.0", reason: "imported", date: DATE });
    expect(result.ok).toBe(true);
    const item = parseRoadmap(await text(file), sources()).document.items[0]!;
    expect(item.fields.Targets?.value).toBe("v1.0.0");
    expect(item.sections.Purpose?.text).toBe("-");
    const read = await readRoadmap(root, { asOf: DATE });
    expect(read.ok && read.value.items[0]?.purposeSource).toBe("target");
  });

  // @req FR-NODE-256 AC-2
  it("refuses an unregistered target and writes nothing", async () => {
    const { rootPath, file } = await workspace();
    const result = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "milestone", title: "Ghost", fromTarget: "9.9.9", reason: "imported", date: DATE });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(existsSync(file)).toBe(false);
  });
});

describe("FR-NODE-256 AC-3 — one history row per changed field, and no-op for equal values", () => {
  // @req FR-NODE-256 AC-3
  it("appends one row per changed field with the date, the field, the previous and new value and the reason", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { "Planned End": "2026-11-20" } }));
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", plannedEnd: "2026-12-01", owner: "kim", reason: "review slipped", date: DATE });
    expect(result.ok).toBe(true);
    expect(result.value?.changes).toEqual([
      { field: "Owner", from: "-", to: "kim" },
      { field: "Planned End", from: "2026-11-20", to: "2026-12-01" }
    ]);
    const written = await text(file);
    expect(written).toContain("| Planned End | 2026-12-01 |");
    expect(written).toContain("| Owner | kim |");
    expect(historyRows(written, "RM-1")).toEqual([
      "| 2026-11-01 | Created | - | - | fixture |",
      `| ${DATE} | Owner | - | kim | review slipped |`,
      `| ${DATE} | Planned End | 2026-11-20 | 2026-12-01 | review slipped |`
    ]);
    expect(checkRoadmap(written, sources()).diagnostics.filter((item) => item.code === "ROADMAP-W016")).toEqual([]);
  });

  // @req FR-NODE-256 AC-3
  it("records a title change as a Title row", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, title: "Old name" }));
    await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", title: "New name", date: DATE });
    const written = await text(file);
    expect(written).toContain("### RM-1 — New name");
    expect(historyRows(written, "RM-1")).toContain(`| ${DATE} | Title | Old name | New name | - |`);
  });

  // @req FR-NODE-256 AC-3
  it("returns a no-op and writes nothing when every given value equals the current one", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1, fields: { Targets: "v1.0.0,2.0.0", "Planned End": "2026-11-20" } }));
    const before = await readFile(file, "utf8");
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", targets: ["v1.0.0", "2.0.0"], plannedEnd: "2026-11-20", date: DATE });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: false, changes: [] });
    expect(result.mutation).toMatchObject({ written: false, operations: [] });
    expect(await readFile(file, "utf8")).toBe(before);
  });
});

describe("FR-NODE-256 AC-4 — a plan change needs a reason", () => {
  // @req FR-NODE-256 AC-4
  it("refuses a change of each schedule, lifecycle, milestone and targets field without a reason", async () => {
    const changes = [
      { plannedStart: "2026-11-02" },
      { plannedEnd: "2026-11-30" },
      { actualStart: "2026-11-03" },
      { actualEnd: "2026-11-04" },
      { lifecycle: "paused" as const },
      { milestone: "RM-2" },
      { targets: ["v1.0.0"] }
    ];
    for (const change of changes) {
      const { rootPath, file } = await workspace(roadmapText({ n: 1 }, { n: 2, fields: { Kind: "milestone" } }));
      const before = await readFile(file, "utf8");
      const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", ...change, date: DATE });
      expect(result.ok, JSON.stringify(change)).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(await readFile(file, "utf8")).toBe(before);
    }
  });

  // @req FR-NODE-256 AC-4
  it("lets another field change without a reason and records `-` as its reason", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", owner: "lee", date: DATE });
    expect(result.ok).toBe(true);
    expect(historyRows(await text(file), "RM-1")).toContain(`| ${DATE} | Owner | - | lee | - |`);
  });
});

describe("FR-NODE-256 AC-5 — lock, patch plan, dry-run and envelope", () => {
  // @req FR-NODE-256 AC-5
  it("returns the planned operations in the mutation envelope and writes nothing under dry-run", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
    const before = await readFile(file, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const update = await updateRoadmapItem(root, { id: "RM-1", owner: "kim", dryRun: true, date: DATE });
    expect(update.ok).toBe(true);
    expect(update.value).toMatchObject({ dryRun: true, written: false });
    expect(update.mutation).toMatchObject({ kind: "update_roadmap_item", filePath: "docs/roadmap.md", dryRun: true, written: false });
    expect(update.mutation?.operations.map((operation) => operation.type).sort()).toEqual(["insertLines", "replaceLine"]);
    expect(update.mutation?.preview).toContain("| Owner | kim |");
    const add = await addRoadmapItem(root, { kind: "feature", title: "Dry", reason: "r", dryRun: true, date: DATE });
    expect(add.mutation).toMatchObject({ kind: "add_roadmap_item", dryRun: true, written: false });
    expect(add.mutation?.preview).toContain("### RM-2 — Dry");
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-256 AC-5
  it("does not create the file under dry-run", async () => {
    const { rootPath, file } = await workspace();
    const add = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "Dry", reason: "r", dryRun: true, date: DATE });
    expect(add.ok && add.mutation?.preview).toContain("# Roadmap");
    expect(existsSync(file)).toBe(false);
  });

  // @req FR-NODE-256 AC-5
  it("writes nothing while another mutation holds the SRS lock", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    const now = Date.now();
    await writeFile(
      path.join(rootPath, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
      "utf8"
    );
    const before = await readFile(file, "utf8");
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", owner: "kim", date: DATE });
    expect(result).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req FR-NODE-256 AC-5
  it("refuses when the file changed after it was read", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
    const root = await resolveProjectRoot(rootPath);
    const read = (await readRoadmapFile(root))!;
    await writeFile(file, `${await readFile(file, "utf8")}\n<!-- edited meanwhile -->\n`, "utf8");
    const owner = read.lines.findIndex((line) => line.startsWith("| Owner |")) + 1;
    const output = { id: "RM-1", dryRun: false, written: false, created: false, changes: [] };
    const result = await commitRoadmapWrite("update_roadmap_item", read, [{ type: "replaceLine", line: owner, original: read.lines[owner - 1]!, replacement: "| Owner | kim |" }], sources(), output, {
      dryRun: false,
      create: false
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("STALE_PATCH");
    expect(await text(file)).toContain("<!-- edited meanwhile -->");
    expect(await text(file)).not.toContain("| Owner | kim |");
  });

  // @req FR-NODE-256 AC-5
  it("refuses an add when the file appears after it was found missing", async () => {
    const { rootPath, file } = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const virtual = { path: file, relativePath: "docs/roadmap.md", text: "", lines: [""], newline: "\n" as const };
    await writeFile(file, "# someone else's roadmap\n", "utf8");
    const output = { id: "RM-1", dryRun: false, written: false, created: true, changes: [] };
    const result = await commitRoadmapWrite("add_roadmap_item", virtual, [{ type: "appendLines", lines: ["# Roadmap", ""] }], sources(), output, { dryRun: false, create: true });
    expect(result.error?.code).toBe("STALE_PATCH");
    expect(await text(file)).toBe("# someone else's roadmap\n");
    expect(root.root).toBe(rootPath);
  });
});

describe("FR-NODE-256 AC-6 — values that would break the document", () => {
  // @req FR-NODE-256 AC-6
  it("refuses a table value with a pipe or a line break", async () => {
    for (const input of [{ owner: "a | b" }, { owner: "a\nb" }, { targets: ["v1.0.0 | x"] }, { reason: "x | y", plannedEnd: "2026-12-01" }]) {
      const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
      const before = await readFile(file, "utf8");
      const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", ...input, date: DATE });
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(await readFile(file, "utf8")).toBe(before);
    }
    const { rootPath, file } = await workspace();
    const title = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "Two\nlines", reason: "r", date: DATE });
    expect(title.error?.code).toBe("USAGE");
    // add writes no history cell for a field, so the metadata row renderer is the only guard here.
    for (const input of [{ owner: "a | b" }, { targets: ["v1.0.0\n| Status | done |"] }]) {
      const added = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "T", reason: "r", date: DATE, ...input });
      expect(added.error?.code, JSON.stringify(input)).toBe("USAGE");
    }
    expect(existsSync(file)).toBe(false);
  });

  // @req FR-NODE-256 AC-6
  it("refuses a purpose that opens a heading, a fence or a table", async () => {
    for (const purpose of ["Intro\n### RM-9 — forged", "Intro\n```", "Intro\n| Status | done |"]) {
      const { rootPath, file } = await workspace();
      const result = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "T", purpose, reason: "r", date: DATE });
      expect(result.ok, purpose).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(existsSync(file)).toBe(false);
    }
    const { rootPath, file } = await workspace();
    const prose = await addRoadmapItem(await resolveProjectRoot(rootPath), { kind: "feature", title: "T", purpose: "First line.\nSecond line.", reason: "r", date: DATE });
    expect(prose.ok).toBe(true);
    expect(parseRoadmap(await text(file), sources()).document.items[0]?.sections.Purpose?.text).toBe("First line.\nSecond line.");
  });

  // @req FR-NODE-256 AC-6
  it("refuses a write that adds a roadmap error and returns the warnings of a write it allows", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }));
    const before = await readFile(file, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const bad = await updateRoadmapItem(root, { id: "RM-1", plannedEnd: "2026-13-01", reason: "typo", date: DATE });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("MUTATION_DENIED");
    expect(bad.error?.diagnostics?.map((item) => item.code)).toEqual(["ROADMAP-E005"]);
    const cycle = await updateRoadmapItem(root, { id: "RM-1", dependsOn: ["RM-1"], date: DATE });
    expect(cycle.error?.diagnostics?.map((item) => item.code)).toEqual(["ROADMAP-E008"]);
    expect(await readFile(file, "utf8")).toBe(before);
    const warned = await updateRoadmapItem(root, { id: "RM-1", targets: ["9.9.9"], reason: "future target", date: DATE });
    expect(warned.ok).toBe(true);
    expect(warned.diagnostics.map((item) => item.code)).toContain("ROADMAP-W009");
  });

  // @req FR-NODE-256 AC-6
  it("allows a write to a document that already has an error, when the write adds none", async () => {
    const { rootPath } = await workspace(roadmapText({ n: 1, fields: { Kind: "epic" } }));
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-1", owner: "kim", date: DATE });
    expect(result.ok).toBe(true);
  });
});

describe("FR-NODE-256 AC-7 — items are never deleted, reused or renumbered", () => {
  // @req FR-NODE-256 AC-7
  it("closes an item by cancelling it, keeps it in the document and never reuses its number", async () => {
    const { rootPath, file } = await workspace(roadmapText({ n: 1 }, { n: 2 }));
    const root = await resolveProjectRoot(rootPath);
    const cancel = await updateRoadmapItem(root, { id: "RM-2", lifecycle: "cancelled", reason: "dropped", date: DATE });
    expect(cancel.ok).toBe(true);
    const add = await addRoadmapItem(root, { kind: "feature", title: "After", reason: "r", date: DATE });
    expect(add.value?.id).toBe("RM-3");
    const items = parseRoadmap(await text(file), sources()).document.items;
    expect(items.map((item) => [item.id, item.fields.Lifecycle?.value])).toEqual([
      ["RM-1", "open"],
      ["RM-2", "cancelled"],
      ["RM-3", "open"]
    ]);
  });

  // @req FR-NODE-256 AC-7
  it("refuses an update to an item that does not exist", async () => {
    const { rootPath } = await workspace(roadmapText({ n: 1 }));
    const result = await updateRoadmapItem(await resolveProjectRoot(rootPath), { id: "RM-5", owner: "kim", date: DATE });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
