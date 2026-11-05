import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { todayStamp } from "../../src/core/date-stamp.js";
import { roadmapText } from "../core/roadmap/roadmap-fixture.js";
import { AS_OF, cli, cliJson, DEFAULT_ITEMS, roadmapFile, roadmapWorkspace, startRequirement } from "./roadmap-surface-fixture.js";

// IR-CLI-115 — `speckiwi roadmap list|show|check|add|update|sync`, whose `--json` output of list and
// show is the roadmap's JSON form at `schema: 1`.

interface DateRange {
  raw: string;
  from: string;
  to: string;
  precision: string;
}

interface ItemJson {
  id: string;
  title: string;
  kind: string;
  milestone: string | null;
  dependsOn: string[];
  targets: string[];
  requirements: string[];
  lifecycle: string;
  status: string;
  blocked: boolean;
  progress: { acceptanceCriteria: { total: number; checked: number }; percent: number | null };
  schedule: {
    asOf: string;
    planned: { start: DateRange | null; end: DateRange | null };
    actual: { start: DateRange | null; end: DateRange | null };
    baseline: Record<string, string>;
    replanCount: number;
    health: string;
    slipDays: number | null;
  };
  scope: { requirements: string[]; targets: string[] };
  history: Array<{ date: string; field: string; from: string; to: string; reason: string }>;
  line: number;
  purpose: string;
  owner?: string;
  actualDateCandidates?: Array<{ date: string; source: string; requirementId: string }>;
}

interface ListJson {
  schema: number;
  asOf: string;
  source: string | null;
  items: ItemJson[];
  page: { total: number; offset: number; returned: number; nextOffset: number | null };
}

interface ShowJson {
  schema: number;
  asOf: string;
  source: string | null;
  item: ItemJson;
}

interface CheckJson {
  source: string | null;
  passed: boolean;
  diagnostics: Array<{ code: string; severity: string; line?: number }>;
}

interface WriteJson {
  ok: boolean;
  value?: { id?: string; dryRun: boolean; written: boolean; changes?: Array<{ field: string; from: string; to: string }>; proposals?: Array<{ item: string; field: string; value: string }> };
  error?: { code: string; message: string };
}

const ids = (list: ListJson): string[] => list.items.map((item) => item.id);

async function listJson(root: string, ...args: string[]): Promise<ListJson> {
  const { code, json } = await cliJson<ListJson>(root, "list", "--as-of", AS_OF, ...args);
  expect(code).toBe(0);
  return json;
}

async function showJson(root: string, id: string, ...args: string[]): Promise<ShowJson> {
  const { code, json } = await cliJson<ShowJson>(root, "show", id, "--as-of", AS_OF, ...args);
  expect(code).toBe(0);
  return json;
}

describe("IR-CLI-115 AC-1 — roadmap list", () => {
  // @req IR-CLI-115 AC-1
  it("returns the items in document order with their computed status, blocked flag, progress and schedule", async () => {
    const root = await roadmapWorkspace();
    const list = await listJson(root);
    expect(ids(list)).toEqual(["RM-1", "RM-2", "RM-3", "RM-4"]);
    expect(list.items.map((item) => item.status)).toEqual(["in-progress", "planned", "paused", "idea"]);
    expect(list.items.map((item) => item.blocked)).toEqual([false, false, false, false]);
    expect(list.items[1]!.progress.acceptanceCriteria).toEqual({ total: 2, checked: 0 });
    expect(list.items[1]!.schedule.health).toBe("on-track");
  });

  // @req IR-CLI-115 AC-1
  it.each([
    [["--status", "planned"], ["RM-2"]],
    [["--status", "idea"], ["RM-4"]],
    [["--kind", "milestone"], ["RM-1"]],
    [["--kind", "feature"], ["RM-2", "RM-3", "RM-4"]],
    [["--target", "v1.0.0"], ["RM-1"]],
    [["--target", "v9.9.9"], []],
    [["--milestone", "RM-1"], ["RM-2", "RM-3"]],
    [["--kind", "feature", "--milestone", "RM-1", "--status", "paused"], ["RM-3"]]
  ])("filters by %j", async (filter, expected) => {
    const root = await roadmapWorkspace();
    const list = await listJson(root, ...filter);
    expect(ids(list)).toEqual(expected);
    expect(list.page.total).toBe(expected.length);
  });

  // @req IR-CLI-115 AC-1 — --target reads the item's own Targets, not the targets its features lend a milestone.
  it("filters --target by the item's own Targets", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "Bare milestone", fields: { Kind: "milestone" } },
      { n: 2, title: "Targeted feature", fields: { Milestone: "RM-1", Targets: "v1.0.0" } }
    ]);
    const all = await listJson(root);
    expect(all.items[0]!.scope.targets).toEqual(["v1.0.0"]);
    expect(ids(await listJson(root, "--target", "v1.0.0"))).toEqual(["RM-2"]);
  });

  // @req IR-CLI-115 AC-1
  it("pages by --limit and --offset with total, offset, returned and nextOffset", async () => {
    const root = await roadmapWorkspace();
    const first = await listJson(root, "--limit", "2");
    expect(ids(first)).toEqual(["RM-1", "RM-2"]);
    expect(first.page).toMatchObject({ total: 4, offset: 0, returned: 2, nextOffset: 2 });
    const second = await listJson(root, "--limit", "2", "--offset", "2");
    expect(ids(second)).toEqual(["RM-3", "RM-4"]);
    expect(second.page).toMatchObject({ total: 4, offset: 2, returned: 2, nextOffset: null });
    const filtered = await listJson(root, "--milestone", "RM-1", "--offset", "1");
    expect(ids(filtered)).toEqual(["RM-3"]);
    expect(filtered.page).toMatchObject({ total: 2, offset: 1, returned: 1, nextOffset: null });
  });

  // @req IR-CLI-115 AC-1 — a status or kind outside its set is a typo, not an empty answer.
  it.each([["--status", "started"], ["--kind", "epic"]])("refuses %s %s with a non-zero exit", async (flag, value) => {
    const root = await roadmapWorkspace();
    const { code } = await cli(root, "list", flag, value, "--json");
    expect(code).not.toBe(0);
  });
});

describe("IR-CLI-115 AC-2 — roadmap show", () => {
  // @req IR-CLI-115 AC-2
  it("returns one item with its scope requirement IDs, history, baseline, replanCount, health and slipDays", async () => {
    const root = await roadmapWorkspace();
    const shown = await showJson(root, "RM-2");
    expect(shown.item.id).toBe("RM-2");
    expect(shown.item.scope.requirements).toEqual(["FR-ARCH-001"]);
    expect(shown.item.history.map((row) => row.field)).toEqual(["Created", "Planned End"]);
    expect(shown.item.schedule.baseline["Planned End"]).toBe("2026-11-03");
    expect(shown.item.schedule.replanCount).toBe(1);
    expect(shown.item.schedule.health).toBe("on-track");
    const late = await cliJson<ShowJson>(root, "show", "RM-2", "--as-of", "2026-11-20");
    expect(late.json.item.schedule).toMatchObject({ health: "late", slipDays: 10 });
  });

  // @req IR-CLI-115 AC-2
  it("returns the actual-date candidates the SRS records before the as-of date", async () => {
    const root = await roadmapWorkspace();
    await startRequirement(root);
    const shown = await showJson(root, "RM-2");
    expect(shown.item.status).toBe("in-progress");
    expect(shown.item.actualDateCandidates).toEqual([
      { date: "2026-05-10", source: "completed-work", requirementId: "FR-ARCH-001", text: "Fixture parser coverage completed." },
      { date: "2026-06-01", source: "change-note", requirementId: "FR-ARCH-001", text: "Status -> in_progress" }
    ]);
    const early = await cliJson<ShowJson>(root, "show", "RM-2", "--as-of", "2026-05-20");
    expect(early.json.item.actualDateCandidates?.map((candidate) => candidate.date)).toEqual(["2026-05-10"]);
  });

  // @req IR-CLI-115 AC-2
  it("exits non-zero for an ID that names no item", async () => {
    const root = await roadmapWorkspace();
    expect((await cli(root, "show", "RM-9", "--json")).code).not.toBe(0);
    expect((await cli(root, "show", "RM-9")).code).not.toBe(0);
    const absent = await roadmapWorkspace(null);
    expect((await cli(absent, "show", "RM-1", "--json")).code).not.toBe(0);
  });
});

describe("IR-CLI-115 AC-3 — roadmap check", () => {
  // @req IR-CLI-115 AC-3
  it("prints the diagnostics and exits non-zero while an error exists", async () => {
    const root = await roadmapWorkspace([...DEFAULT_ITEMS, { n: 5, fields: { Kind: "epic" } }]);
    const { code, json } = await cliJson<CheckJson>(root, "check");
    expect(code).not.toBe(0);
    expect(json.passed).toBe(false);
    expect(json.diagnostics.map((item) => item.code)).toContain("ROADMAP-E004");
    const human = await cli(root, "check");
    expect(human.code).not.toBe(0);
    expect(human.stdout).toContain("ROADMAP-E004");
  });

  // @req IR-CLI-115 AC-3
  it("exits 0 with a warning only", async () => {
    const root = await roadmapWorkspace([...DEFAULT_ITEMS, { n: 5, fields: { Targets: "v9.9.9" } }]);
    const { code, json } = await cliJson<CheckJson>(root, "check");
    expect(code).toBe(0);
    expect(json.passed).toBe(true);
    expect(json.diagnostics.map((item) => item.code)).toEqual(["ROADMAP-W009"]);
  });

  // @req IR-CLI-115 AC-3
  it("reports no diagnostic when docs/roadmap.md does not exist, and list then returns zero items", async () => {
    const root = await roadmapWorkspace(null);
    const checked = await cliJson<CheckJson>(root, "check");
    expect(checked.code).toBe(0);
    expect(checked.json).toMatchObject({ source: null, passed: true, diagnostics: [] });
    const list = await listJson(root);
    expect(list.items).toEqual([]);
    expect(list.page).toMatchObject({ total: 0, returned: 0, nextOffset: null });
    expect(list.source).toBeNull();
  });
});

describe("IR-CLI-115 AC-4 — roadmap add, update and sync take their inputs as options", () => {
  // @req IR-CLI-115 AC-4
  it("add writes an item from every metadata option, and --dry-run writes nothing", async () => {
    const root = await roadmapWorkspace();
    const before = await readFile(roadmapFile(root), "utf8");
    const options = [
      "--kind", "feature",
      "--title", "Feature C",
      "--purpose", "Why it matters.",
      "--milestone", "RM-1",
      "--targets", "v1.0.0",
      "--requirements", "FR-ARCH-001",
      "--prd", "-",
      "--depends-on", "RM-2,RM-3",
      "--owner", "beom",
      "--issue", "#12,#13",
      "--planned-start", "2026-11",
      "--planned-end", "2026-Q4",
      "--actual-start", "2026-11-04",
      "--lifecycle", "open",
      "--reason", "planned in review"
    ];
    const dry = await cliJson<WriteJson>(root, "add", ...options, "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.json.value).toMatchObject({ id: "RM-5", dryRun: true, written: false });
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);

    const wrote = await cliJson<WriteJson>(root, "add", ...options);
    expect(wrote.code).toBe(0);
    expect(wrote.json.value).toMatchObject({ id: "RM-5", written: true });
    const item = (await showJson(root, "RM-5")).item;
    expect(item).toMatchObject({
      title: "Feature C",
      kind: "feature",
      milestone: "RM-1",
      targets: ["v1.0.0"],
      requirements: ["FR-ARCH-001"],
      dependsOn: ["RM-2", "RM-3"],
      lifecycle: "open",
      purpose: "Why it matters."
    });
    expect(item.schedule.planned.start?.raw).toBe("2026-11");
    expect(item.schedule.planned.end?.raw).toBe("2026-Q4");
    expect(item.schedule.actual.start?.raw).toBe("2026-11-04");
    expect(item.history.map((row) => [row.field, row.reason])).toEqual([["Created", "planned in review"]]);
    const text = await readFile(roadmapFile(root), "utf8");
    expect(text).toContain("| Owner | beom |");
    expect(text).toContain("| GitHub Issue | #12, #13 |");
  });

  // @req IR-CLI-115 AC-4
  it("add --from-target creates the item of a registered target", async () => {
    const root = await roadmapWorkspace(null);
    const wrote = await cliJson<WriteJson>(root, "add", "--kind", "milestone", "--title", "Ship v1", "--from-target", "v1.0.0", "--reason", "import");
    expect(wrote.code).toBe(0);
    expect(wrote.json.value).toMatchObject({ id: "RM-1", written: true });
    const item = (await showJson(root, "RM-1")).item;
    expect(item.targets).toEqual(["v1.0.0"]);
    expect(item.purpose).toBe("Establish parser baseline.");
  });

  // @req IR-CLI-115 AC-4
  it("add refuses a missing required option and a refused write with a non-zero exit, writing nothing", async () => {
    const root = await roadmapWorkspace(null);
    expect((await cli(root, "add", "--kind", "feature", "--title", "No reason", "--json")).code).not.toBe(0);
    expect((await cli(root, "add", "--kind", "feature", "--title", "Bad", "--from-target", "v9.9.9", "--reason", "r", "--json")).code).not.toBe(0);
    expect(existsSync(roadmapFile(root))).toBe(false);
  });

  // @req IR-CLI-115 AC-4
  it("update changes each field its options name, with one history row each", async () => {
    const root = await roadmapWorkspace();
    const updated = await cliJson<WriteJson>(
      root,
      "update", "RM-4",
      "--title", "A plan",
      "--milestone", "RM-1",
      "--targets", "v1.0.0",
      "--requirements", "FR-ARCH-001",
      "--depends-on", "RM-2",
      "--owner", "kim",
      "--issue", "#7",
      "--planned-start", "2026-12",
      "--planned-end", "2026-12-20",
      "--actual-start", "2026-12-01",
      "--actual-end", "2026-12-02",
      "--lifecycle", "paused",
      "--reason", "decided"
    );
    expect(updated.code).toBe(0);
    expect(updated.json.value?.changes?.map((change) => change.field)).toEqual([
      "Title", "Milestone", "Targets", "Requirements", "Depends On", "Owner", "GitHub Issue",
      "Planned Start", "Planned End", "Actual Start", "Actual End", "Lifecycle"
    ]);
    const item = (await showJson(root, "RM-4")).item;
    expect(item).toMatchObject({ title: "A plan", milestone: "RM-1", targets: ["v1.0.0"], requirements: ["FR-ARCH-001"], dependsOn: ["RM-2"], lifecycle: "paused" });
    expect(item.history).toHaveLength(13);
  });

  // @req IR-CLI-115 AC-4
  it("update takes --prd and --dry-run, and refuses a schedule change without --reason", async () => {
    const root = await roadmapWorkspace();
    const before = await readFile(roadmapFile(root), "utf8");
    const dry = await cliJson<WriteJson>(root, "update", "RM-2", "--planned-end", "2026-11-20", "--reason", "slip", "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.json.value).toMatchObject({ dryRun: true, written: false, changes: [{ field: "Planned End", from: "2026-11-10", to: "2026-11-20" }] });
    const refused = await cli(root, "update", "RM-2", "--planned-end", "2026-11-20", "--json");
    expect(refused.code).not.toBe(0);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
    const prd = await cliJson<WriteJson>(root, "update", "RM-2", "--prd", "docs/prd/2026-11-01.alpha.prd.md");
    expect(prd.json.value?.changes).toEqual([{ field: "PRD", from: "-", to: "docs/prd/2026-11-01.alpha.prd.md" }]);
  });

  // @req IR-CLI-115 AC-4
  it("sync writes nothing unless --apply is given, and --item limits it to one item", async () => {
    const root = await roadmapWorkspace();
    await startRequirement(root);
    const before = await readFile(roadmapFile(root), "utf8");
    const proposed = await cliJson<WriteJson>(root, "sync", "--as-of", AS_OF);
    expect(proposed.code).toBe(0);
    expect(proposed.json.value).toMatchObject({ dryRun: true, written: false });
    expect(proposed.json.value?.proposals?.map((proposal) => [proposal.item, proposal.field, proposal.value])).toEqual([
      ["RM-1", "Actual Start", AS_OF],
      ["RM-2", "Actual Start", AS_OF]
    ]);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);

    const one = await cliJson<WriteJson>(root, "sync", "--as-of", AS_OF, "--item", "RM-2", "--apply");
    expect(one.code).toBe(0);
    expect(one.json.value).toMatchObject({ dryRun: false, written: true });
    expect(one.json.value?.proposals?.map((proposal) => proposal.item)).toEqual(["RM-2"]);
    const after = await listJson(root);
    expect(after.items.map((item) => item.schedule.actual.start?.raw ?? null)).toEqual([null, AS_OF, null, null]);
  });
});

describe("IR-CLI-115 AC-5 — --as-of", () => {
  // @req IR-CLI-115 AC-5
  it.each(["list", "show", "sync"])("%s accepts --as-of and echoes it", async (command) => {
    const root = await roadmapWorkspace();
    const args = command === "show" ? ["show", "RM-2"] : [command];
    const { code, json } = await cliJson<{ asOf?: string; value?: { asOf: string } }>(root, ...args, "--as-of", "2026-12-31");
    expect(code).toBe(0);
    expect(json.asOf ?? json.value?.asOf).toBe("2026-12-31");
  });

  // @req IR-CLI-115 AC-5
  it.each([
    ["list", "2026-11"],
    ["list", "20261105"],
    ["list", "2026-02-30"],
    ["show", "2026-Q4"],
    ["show", "2026-13-01"],
    ["sync", "2026/11/05"],
    ["sync", "2026-02-30"]
  ])("%s rejects --as-of %s with a non-zero exit", async (command, value) => {
    const root = await roadmapWorkspace();
    const before = await readFile(roadmapFile(root), "utf8");
    const args = command === "show" ? ["show", "RM-2"] : [command];
    expect((await cli(root, ...args, "--as-of", value, "--json")).code).not.toBe(0);
    expect((await cli(root, ...args, "--as-of", value)).code).not.toBe(0);
    if (command === "sync") expect((await cli(root, "sync", "--as-of", value, "--apply", "--json")).code).not.toBe(0);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  });

  // @req IR-CLI-115 AC-5
  it.each(["list", "show", "sync"])("%s defaults --as-of to today", async (command) => {
    const root = await roadmapWorkspace();
    const args = command === "show" ? ["show", "RM-2"] : [command];
    const { json } = await cliJson<{ asOf?: string; value?: { asOf: string } }>(root, ...args);
    expect(json.asOf ?? json.value?.asOf).toBe(todayStamp());
  });
});

describe("IR-CLI-115 AC-6 — the JSON form at schema 1", () => {
  const ITEM_KEYS = ["id", "title", "kind", "milestone", "dependsOn", "targets", "requirements", "lifecycle", "status", "blocked", "progress", "schedule", "history", "line"];

  // @req IR-CLI-115 AC-6
  it("carries schema 1, asOf, source and the item fields in list and show", async () => {
    const root = await roadmapWorkspace();
    const bytes = await readFile(roadmapFile(root));
    const { createHash } = await import("node:crypto");
    const source = `docs/roadmap.md@sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const list = await listJson(root);
    const shown = await showJson(root, "RM-2");
    for (const answer of [list, shown]) expect(answer).toMatchObject({ schema: 1, asOf: AS_OF, source });
    for (const item of [...list.items, shown.item]) {
      for (const key of ITEM_KEYS) expect(item, `${item.id}.${key}`).toHaveProperty(key);
    }
    const rm2 = list.items[1]!;
    expect(rm2.schedule.planned).toEqual({
      start: { raw: "2026-11", from: "2026-11-01", to: "2026-11-30", precision: "month" },
      end: { raw: "2026-11-10", from: "2026-11-10", to: "2026-11-10", precision: "day" }
    });
    expect(rm2.schedule.actual).toEqual({ start: null, end: null });
    expect(rm2.line).toBe(roadmapText(...DEFAULT_ITEMS).split("\n").indexOf("### RM-2 — Feature A") + 1);
    expect(shown.item).toMatchObject({ ...rm2, actualDateCandidates: [] });
  });

  // @req IR-CLI-115 AC-6
  it("gives byte-identical output for the same inputs and --as-of", async () => {
    const root = await roadmapWorkspace();
    for (const args of [["list", "--as-of", AS_OF, "--json"], ["show", "RM-1", "--as-of", AS_OF, "--json"], ["list", "--status", "planned", "--as-of", AS_OF, "--json"]]) {
      const first = await cli(root, ...args);
      const second = await cli(root, ...args);
      expect(first.code).toBe(0);
      expect(second.stdout).toBe(first.stdout);
    }
  });
});
