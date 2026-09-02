import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { main } from "../../src/cli/index.js";
import { renderSdsDesignTemplate, BUNDLED_SRS_RULES_FILENAME } from "../../src/core/bootstrap/templates.js";
import { toDateStamp, todayStamp } from "../../src/core/date-stamp.js";
import { addCompletedWork } from "../../src/core/mutation/add-completed-work.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { appendSectionNote } from "../../src/core/mutation/append-section-note.js";
import { claimStep } from "../../src/core/mutation/claim-step.js";
import { editRequirementTableRows } from "../../src/core/mutation/edit-requirement.js";
import { renderRequirementBlock } from "../../src/core/mutation/render-requirement.js";
import { repairRulesReferences } from "../../src/core/mutation/repair-rules-references.js";
import { retarget } from "../../src/core/mutation/retarget.js";
import { updateStability } from "../../src/core/mutation/update-stability.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { updateStepState } from "../../src/core/mutation/update-step-state.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-205 — every YYYY-MM-DD stamp a mutation produces for an SRS, SDS or step-state document
// comes from one shared helper that returns the WRITER'S LOCAL calendar date.
//
// The defect this pins: `todayIso()` was duplicated in twelve modules as
// `new Date().toISOString().slice(0, 10)`, which is UTC. In KST (UTC+9) every note written between
// 00:00 and 09:00 local was stamped with the previous day, so a note and the Change Note of the same
// session disagreed by one day inside one requirement block (plan docs/plan/3.0/23.note-date-stamp-utc.md).
//
// Clock determinism: BOTH the instant and the timezone are injected at RUNTIME. Node on this platform
// ignores a `TZ` set before the process starts and honours only an assignment to `process.env.TZ`, so
// a case that leaned on a startup `TZ` would silently measure the machine's own zone. And a case that
// injected the instant alone would stay green on a UTC machine, where the UTC and the local answer
// coincide — so the zone is part of the injection, never part of the environment.

const KST = "Asia/Seoul";
/** 2026-08-30 22:30 UTC == 2026-08-31 07:30 KST — inside the 00:00~09:00 KST window that splits. */
const SPLIT_INSTANT = "2026-08-30T22:30:00Z";
const KST_DATE = "2026-08-31";
const UTC_DATE = "2026-08-30";
/** A second, unrelated instant: `todayStamp` must move with the clock, not return a fixed answer. */
const OTHER_INSTANT = "2026-02-28T22:30:00Z";
const OTHER_KST_DATE = "2026-03-01";

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Runs `body` with the process timezone forced to `tz`, restoring it afterwards. */
async function withTimezone<T>(tz: string, body: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Runs `body` with `new Date()` and `Date.now()` pinned to `iso`, restoring the real clock afterwards. */
async function withFrozenClock<T>(iso: string, body: () => Promise<T> | T): Promise<T> {
  const fixed = new Date(iso).getTime();
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static override now(): number {
      return fixed;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = FrozenDate as unknown as DateConstructor;
  try {
    return await body();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

/** Runs `body` at `instant` in Asia/Seoul — the window where a UTC stamp and a local stamp differ. */
function inKstSplitWindow<T>(body: () => Promise<T> | T, instant = SPLIT_INSTANT): Promise<T> {
  return withTimezone(KST, () => withFrozenClock(instant, body));
}

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Reads whatever a finished run wrote to one of the streams above. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

type BoundaryAxis = "day-window" | "month" | "year" | "year-padding" | "leap" | "dst";

/**
 * AC-1 boundaries. Every row is an injected instant, not a hand-check.
 *
 * The DST rows sit next to LOCAL MIDNIGHT on purpose. Four earlier rows straddled the transitions at
 * 01:00-03:30 local, where being an hour wrong about the offset does not move the calendar day at all
 * — a helper that ignored DST entirely passed them. Each row below flips the day for a helper stuck on
 * one fixed offset, and the four together cover both directions, so no single fixed offset survives.
 */
const BOUNDARY_CASES: ReadonlyArray<{
  label: string;
  axis: BoundaryAxis;
  zone: string;
  instant: string;
  expected: string;
}> = [
  { label: "KST 00:00 sharp — the first minute of the local day", axis: "day-window", zone: KST, instant: "2026-08-30T15:00:00Z", expected: "2026-08-31" },
  { label: "KST 08:59:59 — the last second before UTC catches up", axis: "day-window", zone: KST, instant: "2026-08-30T23:59:59Z", expected: "2026-08-31" },
  { label: "KST 09:00:00 — the second UTC agrees again", axis: "day-window", zone: KST, instant: "2026-08-31T00:00:00Z", expected: "2026-08-31" },
  { label: "month roll: KST is already the 1st while UTC is the 31st", axis: "month", zone: KST, instant: "2026-08-31T15:00:00Z", expected: "2026-09-01" },
  { label: "YEAR roll: KST is already 2027 while UTC is still 2026", axis: "year", zone: KST, instant: "2026-12-31T15:00:00Z", expected: "2027-01-01" },
  { label: "year roll, last second of it", axis: "year", zone: KST, instant: "2026-12-31T23:59:59Z", expected: "2027-01-01" },
  { label: "a sub-1000 year keeps four digits", axis: "year-padding", zone: "UTC", instant: "0999-06-15T12:00:00Z", expected: "0999-06-15" },
  { label: "leap day: the 28th rolls to the 29th in a leap year", axis: "leap", zone: KST, instant: "2028-02-28T15:00:00Z", expected: "2028-02-29" },
  { label: "leap day: the 29th rolls to March", axis: "leap", zone: KST, instant: "2028-02-29T15:00:00Z", expected: "2028-03-01" },
  { label: "non-leap February rolls straight to March", axis: "leap", zone: KST, instant: "2027-02-28T15:00:00Z", expected: "2027-03-01" },
  { label: "DST: summer midnight — a helper stuck on the winter offset lands on the previous day", axis: "dst", zone: "America/New_York", instant: "2026-07-01T04:00:00Z", expected: "2026-07-01" },
  { label: "DST: winter, just before midnight — a helper stuck on the summer offset lands on the next day", axis: "dst", zone: "America/New_York", instant: "2026-01-15T04:30:00Z", expected: "2026-01-14" },
  { label: "DST: spring-forward day, before the jump, just before local midnight", axis: "dst", zone: "America/New_York", instant: "2026-03-08T04:30:00Z", expected: "2026-03-07" },
  { label: "DST: fall-back day, just after local midnight", axis: "dst", zone: "America/New_York", instant: "2026-11-01T04:30:00Z", expected: "2026-11-01" }
];

describe("FR-NODE-205 — the document date stamp follows the writer's local calendar date", () => {
  it("AC-1: toDateStamp returns the LOCAL calendar date of the given instant (KST 07:30 → the KST day)", async () => {
    const stamp = await withTimezone(KST, () => toDateStamp(new Date(SPLIT_INSTANT)));
    expect(stamp).toBe(KST_DATE);
  });

  it("AC-1: the same instant under TZ=UTC yields the UTC day — the helper reads the zone, not a constant", async () => {
    const stamp = await withTimezone("UTC", () => toDateStamp(new Date(SPLIT_INSTANT)));
    expect(stamp).toBe(UTC_DATE);
  });

  it("AC-1: a negative-offset zone moves the stamp backwards for the same instant", async () => {
    // 2026-08-30T22:30:00Z is 2026-08-30 18:30 in America/New_York (UTC-4 in August).
    const stamp = await withTimezone("America/New_York", () => toDateStamp(new Date(SPLIT_INSTANT)));
    expect(stamp).toBe(UTC_DATE);
  });

  it("AC-1: the stamp is zero-padded to YYYY-MM-DD for single-digit months and days", async () => {
    const stamp = await withTimezone("UTC", () => toDateStamp(new Date("2026-01-02T00:00:00Z")));
    expect(stamp).toBe("2026-01-02");
  });

  it.each(BOUNDARY_CASES.map((row) => [row.label, row] as const))(
    "AC-1 boundary — %s",
    async (_label, row) => {
      const stamp = await withTimezone(row.zone, () => toDateStamp(new Date(row.instant)));
      expect(stamp).toBe(row.expected);
    }
  );

  it("AC-1 boundary: every axis the AC names still has at least one case", () => {
    // Without this, a row can be deleted quietly: the axis it was the sole guard for simply stops
    // being measured and the suite reports one fewer green case. The counts are the shipped ones.
    const byAxis = new Map<BoundaryAxis, number>();
    for (const row of BOUNDARY_CASES) byAxis.set(row.axis, (byAxis.get(row.axis) ?? 0) + 1);
    expect([...byAxis.keys()].sort()).toEqual(["day-window", "dst", "leap", "month", "year", "year-padding"]);
    expect(byAxis.get("day-window")).toBeGreaterThanOrEqual(3);
    expect(byAxis.get("month")).toBeGreaterThanOrEqual(1);
    expect(byAxis.get("year")).toBeGreaterThanOrEqual(2);
    expect(byAxis.get("year-padding")).toBeGreaterThanOrEqual(1);
    expect(byAxis.get("leap")).toBeGreaterThanOrEqual(3);
    expect(byAxis.get("dst")).toBeGreaterThanOrEqual(4);
    expect(BOUNDARY_CASES.length).toBeGreaterThanOrEqual(14);
  });

  it("AC-1 boundary: the year roll is a case UTC gets WRONG — the two answers must differ there", async () => {
    // The control for the year axis. Without this the year cases above could be satisfied by a helper
    // that read the year in UTC, if the injected instants never straddled a year.
    const local = await withTimezone(KST, () => toDateStamp(new Date("2026-12-31T15:00:00Z")));
    const utc = await withTimezone("UTC", () => toDateStamp(new Date("2026-12-31T15:00:00Z")));
    expect(local).toBe("2027-01-01");
    expect(utc).toBe("2026-12-31");
    expect(local.slice(0, 4)).not.toBe(utc.slice(0, 4));
  });

  it("AC-2: todayStamp() equals toDateStamp(new Date()) under the injected clock", async () => {
    const [now, today] = await inKstSplitWindow(() => [toDateStamp(new Date()), todayStamp()] as const);
    expect(today).toBe(now);
    expect(today).toBe(KST_DATE);
  });

  it("AC-2: todayStamp() MOVES with the clock — two injected instants give two different answers", async () => {
    const first = await inKstSplitWindow(() => todayStamp());
    const second = await inKstSplitWindow(() => todayStamp(), OTHER_INSTANT);
    // A `todayStamp` that ignored the clock and returned a constant would satisfy either case alone.
    expect(first).toBe(KST_DATE);
    expect(second).toBe(OTHER_KST_DATE);
    expect(first).not.toBe(second);
  });

  it("AC-3: the note stamp and the defaulted Change Note date agree inside the KST 00:00~09:00 window", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    await inKstSplitWindow(async () => {
      const note = await appendSectionNote(root, {
        id: "FR-ARCH-001",
        section: "implementation_notes",
        text: "same-session note"
      });
      expect(note.ok).toBe(true);
      const streams = io();
      const code = await main(
        ["--root", rootPath, "add-change-note", "FR-ARCH-001", "--change", "Edited", "--reason", "same session"],
        streams
      );
      expect(code).toBe(0);
    });

    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    const noteStamp = /- \[(\d{4}-\d{2}-\d{2})\] same-session note/.exec(file)?.[1];
    const changeStamp = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Edited\s*\|\s*same session\s*\|/.exec(file)?.[1];

    expect(noteStamp).toBe(KST_DATE);
    expect(changeStamp).toBe(KST_DATE);
    expect(noteStamp).toBe(changeStamp);
  });

  it("AC-7: an explicit --date still wins over the clock", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await inKstSplitWindow(async () => {
      const streams = io();
      const code = await main(
        [
          "--root",
          rootPath,
          "add-change-note",
          "FR-ARCH-001",
          "--change",
          "Backfilled",
          "--reason",
          "history",
          "--date",
          "2020-01-02"
        ],
        streams
      );
      expect(code).toBe(0);
    });
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toMatch(/\|\s*2020-01-02\s*\|\s*Backfilled\s*\|\s*history\s*\|/);
  });

  it("AC-7: add-completed-work is never defaulted from the clock — an empty date is refused", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await withFrozenClock(SPLIT_INSTANT, () =>
      addCompletedWork(root, { date: "", summary: "no date given" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("date is required");
  });

  it("AC-7: the CLI keeps --date required for add-completed-work", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const code = await main(["--root", rootPath, "add-completed-work", "--summary", "no date given"], streams);
    expect(code).not.toBe(0);
    // The refusal has to be commander's missing-required-option, not a downstream crash on an
    // undefined date: demoting `requiredOption` to `option` also exits non-zero, so the exit code
    // alone would not notice the demotion.
    expect(drain(streams.stderr)).toContain("required option '--date");
  });

  it("AC-7: the MCP surface also requires a date on add_completed_work", () => {
    const shape = toolSchemas.add_completed_work;
    expect(shape).toBeDefined();
    const parsed = z.object(shape as Record<string, z.ZodTypeAny>).safeParse({ summary: "no date given" });
    expect(parsed.success).toBe(false);
    const paths = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("date");
  });

  it("AC-7: add_change_note is not an MCP tool at all, so no MCP call can default its date", () => {
    // `schemas.ts` registers add-change-note with an undefined exposure, which means CLI-only.
    expect(toolSchemas.add_change_note).toBeUndefined();
    // Control: a mutation that IS exposed appears in the same map, so the absence above is a fact
    // about this tool rather than about the map being empty or wrongly keyed.
    expect(toolSchemas.append_section_note).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The stamp sites. TWELVE ROWS, ONE SHAPE — and the shape is a BOUNDARY, drawn once.
//
// This structure was rebuilt five times because the same hole kept moving rather than closing: a row
// fabricated the observed value, then chose its own destination label, then smuggled a constant date
// through `argsFor`, then smuggled a live one through a getter that ran inside the clock window, then
// counted its own `argsFor` calls to tell the two injected instants apart and hand each one the answer
// it expected. Every face had one cause: THE ROW COULD RUN CODE, and code reaches the verdict.
//
// So the row runs no code at all now, and receives nothing:
//
//   * A row holds `fn` — the production export itself — and nothing else executable. The framework
//     checks that reference against this file's own `../../src/**` imports before every call.
//   * A row holds `args` as STATIC DATA. There is no `argsFor` function, so there is no call to count,
//     no closure to keep state in, and no parameter through which a row learns anything. The snapshot
//     below is taken ONCE at module load, so even an accessor written into the literal is evaluated a
//     single time, out here, against the real clock — the same value then reaches both instants.
//   * A row is handed NO PATH. It asks for what it needs with plain markers the framework substitutes:
//     `ROOT_SLOT` (the resolved project root), `ROOT_PATH_SLOT` (the workspace path), `IO_SLOT` (the
//     CLI's streams). Asking is not supplying, and a row cannot write to the workspace it never sees.
//   * Fixture seeding is the FRAMEWORK's. A row names a seed from a fixed set; the code behind that
//     name lives here. A row that could seed could forge, and that is what a seeding row did.
//   * The framework then calls the export inside the window, requires the call to have SUCCEEDED, and
//     only then reads the stamp — off disk for a file destination, out of the returned value for a
//     caller-facing one, with the destination derived from the value's runtime shape.
//
// What a row still decides, and why each is safe, is written out in AC-5: the `pattern` it is read by,
// the `seed` it names, and the `file`/`fn` pair the identity check ties together.
// ---------------------------------------------------------------------------

type FileDestination = "srs-file" | "step-state-file";
type CallerDestination = "rendered-text" | "returned-envelope";
type Destination = FileDestination | CallerDestination;

const FILE_DESTINATIONS: readonly Destination[] = ["srs-file", "step-state-file"];

/** The seeds a row may name. The code behind each name belongs to the framework, never to a row. */
type SeedName = "none" | "dangling-rules" | "empty-state" | "seeded-state" | "evidence-row";

interface StampSite {
  /** Repository-relative path of the module that produces the stamp. */
  file: string;
  destination: Destination;
  /**
   * The matcher SOURCE that captures the stamp out of whatever the destination names; group 1 is the
   * date. A string, not a `RegExp`: an object would be a row-owned thing with methods, and the
   * framework calls the matcher on the document it just read. See the boundary note above.
   */
  pattern: string;
  /** The production export itself, checked against `PRODUCTION_EXPORTS` before every call. */
  fn: (...args: never[]) => unknown;
  /** Which framework-owned fixture seeding to run first. */
  seed: SeedName;
  /** Static data arguments. Not a function — see the boundary note above. */
  args: readonly unknown[];
}

/** Markers a row uses to ASK for something only the framework can supply. */
const ROOT_SLOT = { __slot: "project-root" } as const;
const ROOT_PATH_SLOT = { __slot: "root-path" } as const;
const IO_SLOT = { __slot: "cli-io" } as const;

const STATE_FILE = path.join("docs", "spec", "steps", "state.md");
const STALE_RULES_LINK = "[SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md)";

/** Seeds docs/spec/steps/state.md with the FR-PARSE-026 column layout and the supplied rows. */
async function writeStateMd(rootPath: string, rows: readonly string[]): Promise<void> {
  const stepsDir = path.join(rootPath, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(
    path.join(rootPath, STATE_FILE),
    [
      "# Step State",
      "",
      "Mode: sdd",
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
      ""
    ].join("\n"),
    "utf8"
  );
}

/** A workspace whose requirement cites a rules document that was renamed. */
async function seedDanglingRulesReference(rootPath: string): Promise<void> {
  await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  const specPath = path.join(rootPath, ARCH_FILE);
  await writeFile(
    specPath,
    (await readFile(specPath, "utf8")).replace(/\| Related Docs \|[^\n]*\|/, `| Related Docs | ${STALE_RULES_LINK} |`),
    "utf8"
  );
}

/** The seeded step row carries 2026-06 dates so the Updated cell a site writes cannot be confused
 *  with the Created cell it leaves alone. */
const SEEDED_STEP_ROW = "| probe-step | active | - | ARCH | FR-ARCH-001 | 2026-06-01 | 2026-06-02 |";

/**
 * The framework's fixture seeds. A row names one; only this map can touch the workspace.
 * A row that could seed could also forge a stamp into the document before the production call ran.
 */
const SEEDS: Readonly<Record<SeedName, (rootPath: string) => Promise<void>>> = {
  none: async () => {},
  "dangling-rules": seedDanglingRulesReference,
  "empty-state": async (rootPath) => writeStateMd(rootPath, []),
  "seeded-state": async (rootPath) => writeStateMd(rootPath, [SEEDED_STEP_ROW]),
  "evidence-row": async (rootPath) => {
    const result = await addVerificationEvidence(await resolveProjectRoot(rootPath), {
      id: "FR-ARCH-001",
      type: "test",
      reference: "probe.test.ts",
      covers: "AC-1",
      notes: "probe"
    });
    expect(result.ok).toBe(true);
  }
};

const ROW_FIELDS = ["file", "destination", "pattern", "fn", "seed", "args"] as const;

/** Defects found while snapshotting the declared rows; a case below asserts this list is empty. */
const rowDefects: string[] = [];

const FILE_SITE_DECLARATIONS: readonly StampSite[] = [
  {
    file: "src/core/mutation/append-section-note.ts",
    destination: "srs-file",
    // The `- [date]` prefix of an appended note.
    pattern: String.raw`- \[(\d{4}-\d{2}-\d{2})\] probe note`,
    fn: appendSectionNote as (...args: never[]) => unknown,
    seed: "none",
    args: [ROOT_SLOT, { id: "FR-ARCH-001", section: "implementation_notes", text: "probe note" }]
  },
  {
    file: "src/cli/commands/mutations.ts",
    destination: "srs-file",
    // The default date of `add-change-note` when the caller passes none. The production entry point
    // for this site is the CLI's `main`, which is what reaches the default in `mutations.ts`.
    pattern: String.raw`\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Probed\s*\|\s*probe reason\s*\|`,
    fn: main as (...args: never[]) => unknown,
    seed: "none",
    args: [
      ["--root", ROOT_PATH_SLOT, "add-change-note", "FR-ARCH-001", "--change", "Probed", "--reason", "probe reason"],
      IO_SLOT
    ]
  },
  {
    file: "src/core/mutation/update-status.ts",
    destination: "srs-file",
    // The Change Notes row a status transition appends.
    pattern: String.raw`\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Status -> in_progress\s*\|\s*probe reason\s*\|`,
    fn: updateStatus as (...args: never[]) => unknown,
    seed: "none",
    args: [ROOT_SLOT, { id: "FR-ARCH-001", status: "in_progress", reason: "probe reason" }]
  },
  {
    file: "src/core/mutation/update-stability.ts",
    destination: "srs-file",
    // The Change Notes row a stability transition appends.
    pattern: String.raw`\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Stability -> evolving\s*\|\s*probe reason\s*\|`,
    fn: updateStability as (...args: never[]) => unknown,
    seed: "none",
    args: [ROOT_SLOT, { id: "FR-ARCH-001", stability: "evolving", reason: "probe reason" }]
  },
  {
    file: "src/core/mutation/retarget.ts",
    destination: "srs-file",
    // The Change Notes row a retarget appends.
    pattern: String.raw`\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Target -> v1\.1\.0\s*\|\s*probe reason\s*\|`,
    fn: retarget as (...args: never[]) => unknown,
    seed: "none",
    args: [ROOT_SLOT, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "probe reason", dryRun: false }]
  },
  {
    file: "src/core/mutation/repair-rules-references.ts",
    destination: "srs-file",
    // The Change Notes row a rules-reference repair appends.
    pattern: String.raw`\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Related Docs[^|]*\|`,
    fn: repairRulesReferences as (...args: never[]) => unknown,
    seed: "dangling-rules",
    args: [ROOT_SLOT, { apply: true }]
  },
  {
    file: "src/core/mutation/claim-step.ts",
    destination: "step-state-file",
    // The Created and Updated cells of the step row a claim appends.
    pattern: String.raw`\|\s*probe-step\s*\|[^\n]*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|`,
    fn: claimStep as (...args: never[]) => unknown,
    seed: "empty-state",
    args: [ROOT_SLOT, { step: "probe-step", touchesScope: "ARCH", touchesReq: ["FR-ARCH-001"] }]
  },
  {
    file: "src/core/mutation/update-step-state.ts",
    destination: "step-state-file",
    // The Updated cell a step-state transition rewrites.
    pattern: String.raw`\|\s*probe-step\s*\|[^\n]*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|`,
    fn: updateStepState as (...args: never[]) => unknown,
    seed: "seeded-state",
    args: [ROOT_SLOT, { step: "probe-step", status: "merging" }]
  }
];

const CALLER_SITE_DECLARATIONS: readonly StampSite[] = [
  {
    file: "src/core/mutation/render-requirement.ts",
    destination: "rendered-text",
    // The default `Created` Change Notes row of a freshly rendered requirement block. The pattern
    // spans the heading and the Change Notes header so that only a real rendered block satisfies it.
    pattern:
      String.raw`### FR-ARCH-900 — Probe[\s\S]*?\| Date \| Change \| Reason \|[\s\S]*?\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Created\s*\|\s*add-requirement\s*\|`,
    fn: renderRequirementBlock as (...args: never[]) => unknown,
    seed: "none",
    args: [
      {
        id: "FR-ARCH-900",
        type: "functional",
        target: "v1.0.0",
        title: "Probe",
        statement: "The system shall be probed.",
        acceptanceCriteria: ["probed"]
      }
    ]
  },
  {
    file: "src/core/bootstrap/templates.ts",
    destination: "rendered-text",
    // The `| Date |` metadata row of a scaffolded SDS design document, anchored on the surrounding
    // template so a bare date string cannot stand in for the template.
    pattern: String.raw`# SDS: probe-task[\s\S]*?\| Document Type \| sds \|[\s\S]*?\|\s*Date\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|`,
    fn: renderSdsDesignTemplate as (...args: never[]) => unknown,
    seed: "none",
    args: [{ task: "probe-task" }]
  },
  {
    file: "src/core/mutation/add-requirement.ts",
    destination: "returned-envelope",
    // The Change Note date of the record the mutation returns. Which module supplies the date of the
    // block that lands on disk is NOT asserted here — see the requirement's Research notes.
    pattern: String.raw`"changeNotes":\[\{"date":"(\d{4}-\d{2}-\d{2})"`,
    fn: addRequirement as (...args: never[]) => unknown,
    seed: "none",
    args: [
      ROOT_SLOT,
      {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "Probe requirement",
        statement: "The system shall be probed.",
        acceptanceCriteria: ["probed"]
      }
    ]
  },
  {
    file: "src/core/mutation/edit-requirement.ts",
    destination: "returned-envelope",
    // The `changed:<date>` token of the returned envelope's updatedFields, kept next to the section
    // name the same call put there. That this site appends no document row IS asserted, by the
    // paired case below.
    pattern: String.raw`"verification_evidence","changed:(\d{4}-\d{2}-\d{2})"`,
    fn: editRequirementTableRows as (...args: never[]) => unknown,
    seed: "evidence-row",
    args: [
      ROOT_SLOT,
      {
        id: "FR-ARCH-001",
        section: "verification_evidence",
        operations: [{ kind: "update", rowId: "VE-1", values: { notes: "probed" } }]
      }
    ]
  }
];

/**
 * The production exports, keyed by the file that holds them, built straight from this file's imports.
 * EVERY row has to hand back one of THESE — a lambda that fabricates a stamp, or a `mutate` body that
 * writes the file itself without calling production, fails the identity check before the call is made.
 * The eight file-writing rows were exempt from this until round 5, and that exemption was the hole.
 */
const PRODUCTION_EXPORTS: Readonly<Record<string, unknown>> = {
  "src/core/mutation/append-section-note.ts": appendSectionNote,
  "src/cli/commands/mutations.ts": main,
  "src/core/mutation/update-status.ts": updateStatus,
  "src/core/mutation/update-stability.ts": updateStability,
  "src/core/mutation/retarget.ts": retarget,
  "src/core/mutation/repair-rules-references.ts": repairRulesReferences,
  "src/core/mutation/claim-step.ts": claimStep,
  "src/core/mutation/update-step-state.ts": updateStepState,
  "src/core/mutation/render-requirement.ts": renderRequirementBlock,
  "src/core/bootstrap/templates.ts": renderSdsDesignTemplate,
  "src/core/mutation/add-requirement.ts": addRequirement,
  "src/core/mutation/edit-requirement.ts": editRequirementTableRows
};

/**
 * The rows everything below actually uses: one frozen snapshot per declaration.
 *
 * A declaration's field is read by descriptor exactly THREE times, not once (counted directly:
 * all six fields, 3 each). The kind rules are what raise the count — `rowViolations` reads every
 * field in its `ROW_FIELDS` loop and again in its `Reflect.ownKeys` loop — and both of those reads
 * produce defect NAMES, never values. `snapshotRow`'s read is the third and the only one whose
 * value is consumed, so the checks and the run still see one and the same snapshot. A descriptor
 * trap that splits `fn` by read ordinal therefore does land its forgery in the snapshot, and what
 * fails it is the identity check reading that same snapshot (measured: 3 failed).
 */
const FILE_SITES: readonly StampSite[] = FILE_SITE_DECLARATIONS.map(snapshotRow);
const CALLER_SITES: readonly StampSite[] = CALLER_SITE_DECLARATIONS.map(snapshotRow);

const ALL_SITES: readonly StampSite[] = [...FILE_SITES, ...CALLER_SITES];

const ALL_SITE_FILES: readonly string[] = [
  ...FILE_SITES.map((site) => site.file),
  ...CALLER_SITES.map((site) => site.file)
];

/** Every `.srs.md` under docs/spec, concatenated — where an `srs-file` stamp has to show up. */
async function readSrsFiles(rootPath: string): Promise<string> {
  const specDir = path.join(rootPath, "docs", "spec");
  const entries = await readdir(specDir, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".srs.md")) {
      parts.push(await readFile(path.join(specDir, entry.name), "utf8"));
    }
  }
  return parts.join("\n");
}

/**
 * Classifies what a production call returned by its RUNTIME SHAPE, not by anything the row says.
 * A rendered document comes back as lines or a string; a mutation comes back as a result envelope.
 */
function classifyReturn(value: unknown): { kind: CallerDestination; text: string } {
  if (Array.isArray(value)) return { kind: "rendered-text", text: value.join("\n") };
  if (typeof value === "string") return { kind: "rendered-text", text: value };
  if (value !== null && typeof value === "object" && "ok" in (value as Record<string, unknown>)) {
    return { kind: "returned-envelope", text: JSON.stringify(value) };
  }
  throw new Error(`unclassifiable return value: ${Object.prototype.toString.call(value)}`);
}

/** Files whose probe actually ran a checked production call. `AC-5` asserts this covers all twelve. */
const observedSites = new Set<string>();

/**
 * The row arguments, deep-copied ONCE for the whole module.
 *
 * Taking the snapshot a single time is what closes the last face of this hole. When the framework
 * evaluated a row's arguments per instant, the row could tell the two instants apart — by counting its
 * own evaluations — and hand each one the date that instant expected, so the production stamp branch
 * never had to run. Copying once means any accessor a row wrote into the literal is evaluated exactly
 * once, out here against the real clock, and both instants then receive the same value.
 */
const ARGS_SNAPSHOT: ReadonlyMap<string, readonly unknown[]> = new Map(
  [...FILE_SITES, ...CALLER_SITES].map((site) => [site.file, structuredClone(site.args) as readonly unknown[]])
);

interface SlotFill {
  rootPath: string;
  root: unknown;
}

/** Replaces the framework-only markers, wherever they sit, with the values only the framework has. */
function fillSlots(value: unknown, supply: SlotFill): unknown {
  if (Array.isArray(value)) return value.map((item) => fillSlots(item, supply));
  if (value === null || typeof value !== "object") return value;
  const slot = (value as { __slot?: unknown }).__slot;
  if (slot === "project-root") return supply.root;
  if (slot === "root-path") return supply.rootPath;
  if (slot === "cli-io") return io();
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = fillSlots(item, supply);
  return out;
}

/** Every string reachable from a value, so the arguments can be checked for a smuggled stamp. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) stringsIn(item, found);
  }
  return found;
}

/**
 * Compiles a row's declared matcher. The framework owns the object; the row owns only its source text.
 * A row that held the `RegExp` itself held something with methods, and this function is the caller of
 * those methods on the document just read — so overriding `exec` (or subclassing `RegExp`) let a row
 * hand back whatever date each instant wanted while the production stamp branch never ran.
 */
function matcherFor(pattern: string): RegExp {
  return new RegExp(pattern);
}

/**
 * Walks a value and names anything a row must not be able to own: a function, an accessor property,
 * or an object that is not a plain object or array. This is a check by KIND, not by field.
 *
 * Six rounds closed one field at a time and the hole simply moved to the next one — `mutate`, then
 * `argsFor`, then a getter inside `args`, then `pattern` as a live `RegExp`. Naming fields cannot keep
 * up with a row that has any field left. So the rule is on the shape of the whole row: everything a
 * row declares is inert data, and the single exception (`fn`) is the one thing checked by identity
 * against this file's own production imports.
 */
function executableParts(value: unknown, at = "row", found: string[] = []): string[] {
  if (typeof value === "function") {
    found.push(`${at} is a function`);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
    found.push(`${at} is a ${Object.prototype.toString.call(value)}, not plain data`);
    return found;
  }
  // `Reflect.ownKeys`, not `Object.entries`: a spread copies only enumerable string keys, so a
  // non-enumerable accessor and anything hidden under a symbol key both slipped past a walk built on
  // entries — and `structuredClone` drops symbol properties silently rather than refusing them.
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const label = `${at}.${String(key)}`;
    if (descriptor.get || descriptor.set) {
      found.push(`${label} is an accessor`);
      continue;
    }
    if (typeof key === "symbol") {
      found.push(`${label} is a symbol-keyed property`);
      continue;
    }
    executableParts(descriptor.value, label, found);
  }
  return found;
}

/**
 * The whole row, `fn` included. `fn` is the one field allowed to be callable, but it must be a DATA
 * property holding that function — an accessor there would return one value to the identity check and
 * another to the call, which is the same defect as a row running code, wearing the last field left.
 */
function rowViolations(site: StampSite): string[] {
  const found: string[] = [];
  // The row's own PROTOTYPE is judged too. `Reflect.ownKeys` sees own keys only, so a row that deleted
  // its own `pattern` and put a two-faced getter on its prototype was invisible to every rule here
  // while still answering the checks and the run with different values.
  if (Object.getPrototypeOf(site) !== Object.prototype) {
    found.push(`row has a ${Object.prototype.toString.call(site)} prototype, not a plain object`);
  }
  // Every field must EXIST as an own data property. Requiring existence, not just "if present it must
  // be inert", is what closes the delete-and-inherit route for all six rather than for `fn` alone.
  for (const field of ROW_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(site, field);
    if (!descriptor) {
      found.push(`row.${field} is not an own property`);
      continue;
    }
    if (descriptor.get || descriptor.set) found.push(`row.${field} is an accessor, not a fixed value`);
  }
  const fnDescriptor = Object.getOwnPropertyDescriptor(site, "fn");
  if (fnDescriptor && !fnDescriptor.get && !fnDescriptor.set && typeof fnDescriptor.value !== "function") {
    found.push("row.fn is not callable");
  }
  for (const key of Reflect.ownKeys(site)) {
    if (key === "fn") continue;
    const descriptor = Object.getOwnPropertyDescriptor(site, key);
    if (!descriptor) continue;
    const label = `row.${String(key)}`;
    if (descriptor.get || descriptor.set) continue;
    if (typeof key === "symbol") {
      found.push(`${label} is a symbol-keyed property`);
      continue;
    }
    executableParts(descriptor.value, label, found);
  }
  return found;
}

/**
 * Reads one declared row here and returns a frozen plain copy of it.
 *
 * Every case and every probe below reads a snapshot, never a declaration. The ninth face of this
 * defect was a row answering the check cases and the execution path with different values — the
 * execution path read each field once, but the checks each read again, so a getter (on the prototype,
 * where the own-key rules could not see it) could show one face to the checks and another to the run.
 * Reading every field HERE and nowhere else makes that impossible for any field, present or future.
 * Here is not once: `rowViolations` above reads each field twice more for its diagnostics, so a
 * declaration's field is read by descriptor exactly three times (counted directly, all six fields).
 * Only the third read is consumed into the snapshot, and that one snapshot is what everything sees.
 */
function snapshotRow(declared: StampSite): StampSite {
  rowDefects.push(...rowViolations(declared));
  const read = (field: (typeof ROW_FIELDS)[number]): unknown =>
    Object.getOwnPropertyDescriptor(declared, field)?.value;
  return Object.freeze({
    file: read("file") as string,
    destination: read("destination") as Destination,
    pattern: read("pattern") as string,
    fn: read("fn") as (...args: never[]) => unknown,
    seed: read("seed") as SeedName,
    args: read("args") as readonly unknown[]
  });
}

/** Requires that the production call actually succeeded, so a no-op cannot masquerade as a pass. */
function expectCallSucceeded(file: string, returned: unknown): void {
  if (typeof returned === "number") {
    expect(returned, `${file} exited non-zero`).toBe(0);
    return;
  }
  if (returned !== null && typeof returned === "object" && "ok" in (returned as Record<string, unknown>)) {
    expect((returned as { ok: unknown }).ok, `${file} returned a failed envelope`).toBe(true);
  }
}

/**
 * Runs ONE site at ONE instant and returns the stamp it produced.
 *
 * The same path serves all twelve. The row contributes a production reference, static data, a seed
 * name, a destination and a pattern; the workspace, the arguments' final values, the call, the success
 * check and the reading all belong to the framework.
 */
async function runSite(site: StampSite, instant: string): Promise<string | undefined> {
  // EVERY field is read exactly once, here, and only these bindings are used below. The seventh face
  // of this defect was `fn` being read twice — once for the identity check, once for the call — so a
  // row could answer the check with the real export and the call with a forgery. Reading once makes
  // "the value that was checked" and "the value that was used" the same value by construction, and
  // `rowViolations` keeps any field from being an accessor in the first place.
  const { file, fn, seed, destination, pattern } = site;
  expect(fn, `${file} does not hold its module's production export`).toBe(PRODUCTION_EXPORTS[file]);
  const rootPath = await copyFixtureWorkspace("mutation-target");
  await SEEDS[seed](rootPath);
  const args = fillSlots(structuredClone(ARGS_SNAPSHOT.get(file)), {
    rootPath,
    root: await resolveProjectRoot(rootPath)
  }) as unknown[];
  const returned = await inKstSplitWindow(() => (fn as (...a: unknown[]) => unknown)(...args), instant);
  expectCallSucceeded(file, returned);
  // Recorded only after a checked production call returned — a counter that moves regardless of what
  // ran is not a counter.
  observedSites.add(file);

  if (FILE_DESTINATIONS.includes(destination)) {
    const haystack =
      destination === "srs-file"
        ? await readSrsFiles(rootPath)
        : await readFile(path.join(rootPath, STATE_FILE), "utf8");
    return matcherFor(pattern).exec(haystack)?.[1];
  }
  const classified = classifyReturn(returned);
  // The destination is derived from the returned value, so a row cannot label itself.
  expect(classified.kind).toBe(destination);
  return matcherFor(pattern).exec(classified.text)?.[1];
}

/**
 * Runs one site at TWO injected instants and requires the two stamps to be the two local dates.
 *
 * With the row reduced to data, this is what ties the observed value to the injected clock: whatever a
 * row declares is the same at both instants, so only a date the production code read from the clock
 * can differ. Two of the caller-facing sites still take the date as an ARGUMENT (`templates.ts`
 * `options.date ?? todayStamp()`, `render-requirement.ts` `input.changeNotes ? … : todayStamp()`), and
 * a row that fills that argument gets the real function, the real shape and a matching pattern while
 * the stamp branch never runs — this pair is what makes that visible.
 */
async function observeStampPair(
  run: (instant: string) => Promise<string | undefined>
): Promise<{ first: string | undefined; second: string | undefined }> {
  const first = await run(SPLIT_INSTANT);
  const second = await run(OTHER_INSTANT);
  return { first, second };
}

/** Asserts one site's pair: each stamp is its instant's LOCAL date, and the two are not the same. */
function expectStampPair(pair: { first: string | undefined; second: string | undefined }): void {
  expect(pair.first).toBeDefined();
  expect(pair.first).toBe(KST_DATE);
  expect(pair.first).not.toBe(UTC_DATE);
  expect(pair.second).toBeDefined();
  expect(pair.second).toBe(OTHER_KST_DATE);
  // A date the row supplied — or any constant — is identical at both instants.
  expect(pair.second).not.toBe(pair.first);
}

// Each case here copies a fixture workspace twice (once per injected instant), so the cases carry an
// explicit timeout rather than relying on the runner's default: a bare `npx vitest run` uses 5000ms
// while `npm test` passes 30000, and a suite that only passes under one of them is not a suite.
const PROBE_TIMEOUT_MS = 30_000;

/** Prepares one site the way `runSite` does, for the two paired assertions below. */
async function stageSite(site: StampSite): Promise<{
  rootPath: string;
  args: unknown[];
  fn: (...a: unknown[]) => unknown;
  pattern: string;
}> {
  // Same single-read rule as `runSite`: the callers below use these bindings, never `site.*` again.
  const { file, fn, seed, pattern } = site;
  expect(fn, `${file} does not hold its module's production export`).toBe(PRODUCTION_EXPORTS[file]);
  const rootPath = await copyFixtureWorkspace("mutation-target");
  await SEEDS[seed](rootPath);
  const args = fillSlots(structuredClone(ARGS_SNAPSHOT.get(file)), {
    rootPath,
    root: await resolveProjectRoot(rootPath)
  }) as unknown[];
  return { rootPath, args, fn: fn as (...a: unknown[]) => unknown, pattern };
}

describe("FR-NODE-205 — every stamp site is EXECUTED, not merely scanned", () => {
  it.each(FILE_SITES.map((site) => [site.file, site] as const))(
    "AC-5: %s writes each injected instant's LOCAL date into the file it declares",
    async (_file, site) => {
      // Not found means either the site stopped producing a stamp, or the `destination` this row
      // declares is wrong — the framework only looked where the row said to look.
      expectStampPair(await observeStampPair((instant) => runSite(site, instant)));
    },
    PROBE_TIMEOUT_MS
  );

  it.each(CALLER_SITES.map((site) => [site.file, site] as const))(
    "AC-5: %s returns each injected instant's LOCAL date in the shape it declares",
    async (_file, site) => {
      expectStampPair(await observeStampPair((instant) => runSite(site, instant)));
    },
    PROBE_TIMEOUT_MS
  );

  it("AC-5: both destination names are in use — neither may become a dead label", () => {
    // The classifier's fixtures below pin four shapes; they cannot pin a shape they do not build. A
    // widened mapping plus a relabelled row could send every caller site to ONE destination, leaving
    // the other name dead while all four rows stayed self-consistent. This asserts the taxonomy stays
    // populated, so the four sites keep splitting into the two shapes they actually return.
    const byDestination = new Map<CallerDestination, number>();
    for (const site of CALLER_SITES) {
      byDestination.set(site.destination, (byDestination.get(site.destination) ?? 0) + 1);
    }
    expect([...byDestination.keys()].sort()).toEqual(["rendered-text", "returned-envelope"]);
    expect(byDestination.get("rendered-text")).toBe(2);
    expect(byDestination.get("returned-envelope")).toBe(2);
  });

  it("AC-5: the shape classifier is alive — each destination name matches the shape it claims", () => {
    // The positive/negative control for `classifyReturn`, the one thing that keeps a row from
    // choosing its own label. Without it the mapping could be inverted AND every row's label swapped
    // to match: the rows would stay self-consistent, so every probe above would still pass, while
    // "rendered-text" quietly came to mean an envelope. Renaming both members for real updates these
    // literals too and stays green; inverting one against the other does not.
    expect(classifyReturn(["# doc", "| Date | 2026-08-31 |"]).kind).toBe("rendered-text");
    expect(classifyReturn("| Date | 2026-08-31 |").kind).toBe("rendered-text");
    expect(classifyReturn({ ok: true, updatedFields: [] }).kind).toBe("returned-envelope");
    expect(() => classifyReturn(42)).toThrow(/unclassifiable/);
  });

  it("AC-5: every row is inert data — `fn` is the only executable thing a row may hold", () => {
    // The rule by KIND. A row that can hold a function, an accessor or an exotic object can reach the
    // verdict, and each round that closed one named field only moved the hole to the next. This is
    // read off the shipped rows, so a new field is covered the day it is added.
    for (const site of ALL_SITES) {
      const { fn, ...inert } = site;
      expect(typeof fn, `${site.file} must hold a callable production export`).toBe("function");
      // `structuredClone` refuses functions outright, so this is a second, independent statement of
      // the same rule — and it is the operation the framework already relies on for `args`. It is not
      // the whole rule: it DROPS symbol properties instead of refusing them, which `rowViolations`
      // catches by walking `Reflect.ownKeys`.
      expect(() => structuredClone(inert)).not.toThrow();
    }
    expect(ALL_SITES).toHaveLength(12);
    // Judged when the snapshots were taken, against the DECLARATIONS — the only place reading them.
    expect(rowDefects, "a declared row is not inert data").toEqual([]);
  });

  it("AC-5: no row's matcher is anchorless — a bare date must not satisfy it", () => {
    // The other axis of `pattern`. Measured: with the loosest possible date matcher swapped in at the
    // read, six of the twelve sites still passed, because for those six the first date in the haystack
    // IS the produced stamp — the anchors the rows declare were holding nothing up. A pattern that
    // matches a bare date carries no anchor at all, so it is refused here.
    //
    // This bounds looseness; it does not measure every weakening. A pattern loosened but still
    // demanding one neighbouring character is not caught by this, and was not measured.
    for (const site of ALL_SITES) {
      expect(matcherFor(site.pattern).test(KST_DATE), `${site.file} matches a bare date`).toBe(false);
      expect(matcherFor(site.pattern).test(OTHER_KST_DATE), `${site.file} matches a bare date`).toBe(false);
    }
  });

  it("AC-5: no row declares a date — the arguments carry nothing shaped like a stamp", () => {
    // The row is data now, so this can be read straight off the snapshot the framework will use. Two
    // caller-facing sites take the date as an argument, and the whole class of defects this suite kept
    // reopening was a row filling one of those. The two-instant rule already reds a supplied date; this
    // says the same thing one step earlier, where the failure names the row instead of the mismatch.
    for (const site of [...FILE_SITES, ...CALLER_SITES]) {
      const dated = stringsIn(ARGS_SNAPSHOT.get(site.file)).filter((text) => /\d{4}-\d{2}-\d{2}/.test(text));
      expect(dated, `${site.file} declares a date-shaped argument`).toEqual([]);
    }
    expect(ARGS_SNAPSHOT.size).toBe(12);
  });

  it("AC-5: the twelve sites are all of them, and no file appears twice", () => {
    expect(ALL_SITE_FILES).toHaveLength(12);
    expect(new Set(ALL_SITE_FILES).size).toBe(12);
    expect(FILE_SITES).toHaveLength(8);
    expect(CALLER_SITES).toHaveLength(4);
  });

  it("AC-5: edit_requirement_table_rows really writes no dated row into the document", async () => {
    // The paired half of that row's envelope label. Without this, "returned-envelope" would be an
    // unfalsifiable claim: a site that ALSO wrote the stamp to disk would still satisfy the probe.
    const site = CALLER_SITES.find((row) => row.file === "src/core/mutation/edit-requirement.ts");
    expect(site).toBeDefined();
    const { rootPath, args, fn } = await stageSite(site!);
    const before = await readSrsFiles(rootPath);
    await inKstSplitWindow(() => fn(...args));
    const after = await readSrsFiles(rootPath);
    expect(after).not.toContain(`changed:${KST_DATE}`);
    expect(after.match(/\| Date \| Change \| Reason \|/g)?.length).toBe(
      before.match(/\| Date \| Change \| Reason \|/g)?.length
    );
  });

  it("AC-5: add_requirement's disk block carries the same injected local date as its envelope", async () => {
    // The paired half for the other envelope row. The envelope probe alone would stay green if the
    // block that lands on disk drifted to a different day, which is the failure this requirement is
    // about. Which MODULE renders that block is left to prose and is not asserted.
    const site = CALLER_SITES.find((row) => row.file === "src/core/mutation/add-requirement.ts");
    expect(site).toBeDefined();
    const { rootPath, args, fn, pattern } = await stageSite(site!);
    const returned = await inKstSplitWindow(() => fn(...args));
    expect(matcherFor(pattern).exec(classifyReturn(returned).text)?.[1]).toBe(KST_DATE);
    const after = await readSrsFiles(rootPath);
    const onDisk = /### FR-ARCH-\d+ — Probe requirement[\s\S]*?\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Created\s*\|/.exec(after);
    expect(onDisk?.[1]).toBe(KST_DATE);
  });
});

describe("FR-NODE-205 — the probes actually ran", () => {
  it("AC-5: all twelve probes executed — declaring the table is not measuring it", () => {
    // Emptying the `it.each` argument leaves the table at twelve rows and the census untouched, so
    // nothing else in this file notices that no probe ever ran. This counts the runs.
    expect([...observedSites].sort()).toEqual([...ALL_SITE_FILES].sort());
    expect(observedSites.size).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// The lexical census. It no longer carries the "is it fixed" claim — the execution probes above do —
// but it still holds the two structural claims: nothing in src spells the banned UTC slice, and no
// stamp-producing file escapes the table.
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, "..", "..", "src");
const REPO_DIR = path.resolve(__dirname, "..", "..");

/** A raw UTC day slice: `new Date().toISOString().slice(0, 10)`. */
const UTC_SLICE_MARKER = /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/;
/**
 * A site that reaches the stamp through the shared helper: either it imports the module (so an
 * aliased import still counts) or it names one of the two exported functions.
 */
const HELPER_MARKER = /date-stamp\.js"|\b(?:todayStamp|toDateStamp)\s*\(/;

/** The module every other site delegates to. It produces stamps but is not itself a stamp site. */
const HELPER_FILE = "src/core/date-stamp.ts";

async function collectTypeScriptFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectTypeScriptFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
}

interface Census {
  scannedFiles: number;
  producers: string[];
  utcSlicers: string[];
}

async function censusOfStampProducers(): Promise<Census> {
  const files: string[] = [];
  await collectTypeScriptFiles(SRC_DIR, files);
  const producers: string[] = [];
  const utcSlicers: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(REPO_DIR, file).split(path.sep).join("/");
    const slices = UTC_SLICE_MARKER.test(text);
    if (slices) utcSlicers.push(relative);
    if (slices || HELPER_MARKER.test(text)) producers.push(relative);
  }
  return { scannedFiles: files.length, producers: producers.sort(), utcSlicers: utcSlicers.sort() };
}

describe("FR-NODE-205 — the census over every date-stamp site in src", () => {
  it("AC-4: the two markers are alive — each matches its positive control and rejects its negative one", () => {
    // Without this, blinding either marker (`/(?!)/`) silently empties the census and every case
    // below passes vacuously, taking a genuine UTC regression with it.
    expect(UTC_SLICE_MARKER.test('const d = new Date().toISOString().slice(0, 10);')).toBe(true);
    expect(UTC_SLICE_MARKER.test("const d = new Date().toISOString().slice(0,10);")).toBe(true);
    expect(UTC_SLICE_MARKER.test("const d = new Date().toISOString();")).toBe(false);
    expect(UTC_SLICE_MARKER.test("const d = todayStamp();")).toBe(false);

    expect(HELPER_MARKER.test('import { todayStamp } from "../date-stamp.js";')).toBe(true);
    expect(HELPER_MARKER.test('import { todayStamp as t } from "../date-stamp.js";')).toBe(true);
    expect(HELPER_MARKER.test("const d = toDateStamp(instant);")).toBe(true);
    expect(HELPER_MARKER.test("const d = new Date().toISOString();")).toBe(false);
  });

  it("AC-4: the scan actually reaches src — an empty or tiny sweep is not a pass", async () => {
    const census = await censusOfStampProducers();
    // 175 `.ts` files under src at the time of writing; the floor guards against a sweep that walks
    // nothing (an empty denominator would let every later case pass vacuously).
    expect(census.scannedFiles).toBeGreaterThanOrEqual(150);
    expect(census.producers.length).toBeGreaterThanOrEqual(12);
  });

  it("AC-4: every scanned stamp producer is either the helper or an executed site", async () => {
    // The known set is the set of sites that ACTUALLY RAN, not the table's rows. Building it from the
    // table would let the probes be skipped wholesale — emptying both `it.each` arguments leaves the
    // table at twelve rows and the census unchanged — while this case kept calling them "executed".
    // Drawing it from `observedSites` makes that state red here too, so the dedicated count case
    // below is a second guard rather than the only one.
    const census = await censusOfStampProducers();
    const known = new Set([HELPER_FILE, ...observedSites]);
    expect(census.producers.filter((file) => !known.has(file))).toEqual([]);
  });

  it("AC-4: every site the table names is a file the scan actually found — no stale rows", async () => {
    const census = await censusOfStampProducers();
    const found = new Set(census.producers);
    expect(ALL_SITE_FILES.filter((file) => !found.has(file))).toEqual([]);
    expect(found.has(HELPER_FILE)).toBe(true);
  });

  // A row's prose lives in an ordinary `//` comment, not in a field: a `why` string the suite only
  // checked for non-emptiness read like a contract while asserting nothing, so the field is gone. The
  // checked claims are `destination` (which the framework enforces by reading there) and `pattern`.

  // The ban on the raw slice is LEXICAL and covers ALL OF `src`, the helper module included — and only
  // `src`. It deliberately stops there: `test/cli/stale.ir-cli-055.test.ts` builds its fixture dates
  // with that spelling ON PURPOSE, to match the UTC basis `ageInDays` uses, so a repo-wide ban would
  // red correct code. An offset-shifted `toISOString().slice(0, 10)` inside the helper computes the
  // right date yet still reds here — that is what AC-6 buys: the spelling cannot come back by copy-paste.
  it("AC-6: no site is kept on UTC, and the raw UTC day slice is gone from src", async () => {
    const census = await censusOfStampProducers();
    expect(census.utcSlicers).toEqual([]);
  });
});
