import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { summarizeReleaseReadiness } from "../../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import type { ProjectRoot } from "../../../src/core/types.js";

// @req FR-NODE-175 — release readiness admits an enumerated residue.
//
// The first independent verification round of this requirement ran mutations against the register and
// found two that survived every case, plus a gap between what the register's header promises and what
// the code grants. These cases close that round.
//
// The central one: the statement conditions acceptance on "a specific acceptance criterion … which is
// currently unticked", but acceptance was applied to the whole requirement. A requirement with four
// undischarged criteria was fully excused by a row naming one — so the cost of waiving five criteria
// equalled the cost of waiving one, which is the rubber stamp the Rationale exists to prevent.

const TARGET = "v1.0.0";
const REQ = "FR-ARCH-001";

async function fixture(): Promise<{ root: ProjectRoot; indexPath: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  return { root: await resolveProjectRoot(rootPath), indexPath: path.join(rootPath, "docs", "spec", "00.index.md") };
}

/**
 * Leaves REQ `implemented` with every criterion unticked and one resolvable evidence row, so the
 * fixture carries more than one undischarged criterion — which is the whole point of these cases.
 * An evidence row is added because an `implemented` requirement with none trips `missingEvidence`,
 * a different blocker.
 */
async function leaveImplemented(root: ProjectRoot): Promise<void> {
  const { updateStatus } = await import("../../../src/core/mutation/update-status.js");
  const { addVerificationEvidence } = await import("../../../src/core/mutation/add-evidence.js");
  expect(
    (await addVerificationEvidence(root, { id: REQ, type: "test", reference: "docs/spec/90.appendix.md", covers: "all" })).ok
  ).toBe(true);
  expect((await updateStatus(root, { id: REQ, status: "implemented" })).ok).toBe(true);
}

async function untickedOf(root: ProjectRoot): Promise<string[]> {
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((entry) => entry.id === REQ);
  return (record?.acceptanceCriteria ?? []).filter((entry) => !entry.checked).map((entry) => entry.id);
}

async function writeSection(indexPath: string, lines: string[]): Promise<void> {
  const body = await readFile(indexPath, "utf8");
  await writeFile(indexPath, `${body}\n${["## 12. Release Residue", "", ...lines, ""].join("\n")}`, "utf8");
}

async function writeResidue(indexPath: string, rows: string[]): Promise<void> {
  await writeSection(indexPath, ["| Target | Requirement | Criterion | Reason |", "| --- | --- | --- | --- |", ...rows]);
}

async function readiness(root: ProjectRoot) {
  return summarizeReleaseReadiness(await parseWorkspace(root), { target: TARGET });
}

describe("FR-NODE-175 — a row excuses the criterion it names, not the requirement", () => {
  it("AC-8: a requirement with an unnamed unticked criterion still blocks", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    expect(unticked.length, "the fixture must carry more than one unticked criterion for this case to bite").toBeGreaterThan(1);
    // Name exactly one of them. The rest are undischarged and unexcused.
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | ${unticked[0]} | Only this one is documented. |`]);

    const summary = await readiness(root);

    expect(summary.ready, "one row waived every criterion it does not name").toBe(false);
    expect(summary.implementedNotVerified, "the requirement stopped blocking while criteria remain unexcused").toContain(REQ);
  });

  it("AC-8: naming every unticked criterion excuses the requirement", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(
      indexPath,
      unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried: documented per criterion. |`)
    );

    const summary = await readiness(root);

    expect(summary.ready, summary.ready ? "" : `still blocked: ${JSON.stringify(summary.residueProblems ?? [])}`).toBe(true);
    expect(summary.acceptedResidue?.map((entry) => entry.criterion).sort()).toEqual([...unticked].sort());
  });

  it("AC-8: the report names the criteria a requirement is still unexcused for", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | ${unticked[0]} | Only this one. |`]);

    const unnamed = unticked.slice(1);
    expect(unnamed.length, "the case needs at least one unnamed criterion to report").toBeGreaterThan(0);

    const summary = await readiness(root);

    const reported = (summary.residueProblems ?? []).join(" ");
    for (const id of unnamed) {
      expect(reported, `a reader cannot see that ${id} is unexcused`).toContain(id);
    }
  });
});

describe("FR-NODE-175 — AC-5's populations, each constructed", () => {
  it("AC-5: a row for a verified requirement is reported, in a workspace that is otherwise ready", async () => {
    // The original case left the requirement `planned`, so `ready` was already false for an unrelated
    // reason and the assertion could not attribute the block. Here the ONLY defect is the row.
    const { root, indexPath } = await fixture();
    const { setAcceptanceCriteriaChecked } = await import("../../../src/core/mutation/check-ac.js");
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");
    const { addVerificationEvidence } = await import("../../../src/core/mutation/add-evidence.js");
    expect((await setAcceptanceCriteriaChecked(root, { id: REQ, acIds: ["all"], checked: true })).ok).toBe(true);
    expect((await addVerificationEvidence(root, { id: REQ, type: "test", reference: "docs/spec/90.appendix.md", covers: "all" })).ok).toBe(true);
    expect((await updateStatus(root, { id: REQ, status: "verified" })).ok).toBe(true);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-1 | Excuses a requirement that is already verified. |`]);

    const summary = await readiness(root);

    expect(summary.residueProblems ?? [], "a row for a verified requirement was accepted silently").not.toEqual([]);
    expect((summary.residueProblems ?? []).join(" ")).toContain(REQ);
  });

  it("AC-9: residueProblems alone blocks, with nothing else wrong", async () => {
    // Pins the `residueProblems.length === 0` conjunct. Without this the term can be deleted from the
    // ready conjunction and every case still passes, because some other term was already false.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    const valid = unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`);
    const bogus = `| ${TARGET} | FR-ARCH-404 | AC-1 | Excuses a requirement that is not here. |`;

    const withoutBogus = await (async () => {
      await writeResidue(indexPath, valid);
      return readiness(root);
    })();
    expect(withoutBogus.ready, "the control must be ready, or the case proves nothing").toBe(true);

    const backup = await readFile(indexPath, "utf8");
    await writeFile(indexPath, backup.replace(valid[valid.length - 1] ?? "", `${valid[valid.length - 1] ?? ""}\n${bogus}`), "utf8");
    const withBogus = await readiness(root);

    expect(withBogus.residueProblems ?? []).not.toEqual([]);
    expect(withBogus.ready, "a bogus row did not block an otherwise ready target").toBe(false);
  });
});

describe("FR-NODE-175 — a row the register cannot read fails loudly", () => {
  it("AC-10: a row missing its trailing pipe is read, because that is what the table renders", async () => {
    // GFM renders `| a | b | c | d` as four cells, so a reader sees a valid excuse. The old parser
    // sliced the first and last field away unconditionally, counted three, and dropped the row with
    // nobody told. Reading it is the honest repair; refusing it would still surprise the author.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(indexPath, [
      ...unticked.slice(1).map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`),
      `| ${TARGET} | ${REQ} | ${unticked[0]} | Carried.`
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue?.map((entry) => entry.criterion).sort(), "the pipe-less row was dropped").toEqual(
      [...unticked].sort()
    );
    expect(summary.ready).toBe(true);
  });

  it("AC-10: a row with too few cells is reported rather than skipped", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(indexPath, [
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`),
      `| ${TARGET} | ${REQ} | no reason column |`
    ]);

    const summary = await readiness(root);

    expect(summary.residueProblems ?? [], "an unreadable row vanished without a word").not.toEqual([]);
    expect(summary.ready, "an unreadable row did not block").toBe(false);
  });

  it("AC-10: a row carrying an escaped pipe reports the reason the register renders", async () => {
    // The reason here was `a \| b` — five rendered characters — until a later round added a minimum
    // substance rule for reasons and this case began failing on LENGTH rather than on splitting. The
    // fixture is longer now and the assertion is unchanged: what this case tests is that `\|` renders
    // as a pipe, and the length of the surrounding sentence was never part of that.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    const escaped = "a \\| b, and the reason continues past the escape";
    await writeResidue(
      indexPath,
      unticked.map((id, index) => (index === 0 ? `| ${TARGET} | ${REQ} | ${id} | ${escaped} |` : `| ${TARGET} | ${REQ} | ${id} | Carried. |`))
    );

    const summary = await readiness(root);

    const entry = (summary.acceptedResidue ?? []).find((row) => row.criterion === unticked[0]);
    expect(entry?.reason, "the reported reason is not what the table renders").toBe("a | b, and the reason continues past the escape");
  });

  it("AC-10: a header whose column names differ is reported, not silently ignored", async () => {
    // The failure this closes: any near-miss in the section's shape dropped every row with no
    // diagnostic, so the author saw the requirement blocking and no word about the register.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "| target | requirement | criterion | reason |",
      "| --- | --- | --- | --- |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`)
    ]);

    const summary = await readiness(root);

    expect(summary.residueProblems ?? [], "the register was dropped without a word").not.toEqual([]);
  });

  it("AC-10: a subheading before the table does not drop the register in silence", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "### A note before the table",
      "",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`)
    ]);

    const summary = await readiness(root);

    expect(summary.residueProblems ?? [], "a subheading silently killed the whole register").not.toEqual([]);
  });

  it("AC-10: a four-column table with other names before the register does not become the register", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "| Alpha | Beta | Gamma | Delta |",
      "| --- | --- | --- | --- |",
      "| one | two | three | four |",
      "",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`)
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue?.map((entry) => entry.criterion).sort(), "the wrong table was read as the register").toEqual(
      [...unticked].sort()
    );
  });

  it("AC-10: an example table inside a fence is not read as the register", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "```markdown",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      "| v1.0.0 | FR-ARCH-404 | AC-1 | An example, not a row. |",
      "```",
      "",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`)
    ]);

    const summary = await readiness(root);

    expect((summary.residueProblems ?? []).join(" "), "a fenced example blocked the release").not.toContain("FR-ARCH-404");
    expect(summary.ready, "the real register below the fence was never reached").toBe(true);
  });

  it("AC-10: a fenced example of the section heading does not capture the reader", async () => {
    // Round 7. Fence tracking began only AFTER the heading was located, and the heading was located
    // with a fence-blind scan. So a documented example of the register anywhere earlier in the index
    // became the register: it contributed the header row, its closing fence was read as an opening
    // one, the real table below was swallowed, and because a header had been seen the "no table
    // found" diagnostic never fired. Every row dropped, in silence — the exact failure AC-10 claims
    // to have closed, reached through the sentence that closes it.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    const body = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      [
        body,
        "",
        "## 11. How to write a residue row",
        "",
        "```",
        "## 12. Release Residue",
        "",
        "| Target | Requirement | Criterion | Reason |",
        "| --- | --- | --- | --- |",
        "```",
        "",
        "## 12. Release Residue",
        "",
        "| Target | Requirement | Criterion | Reason |",
        "| --- | --- | --- | --- |",
        ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`),
        ""
      ].join("\n"),
      "utf8"
    );

    const summary = await readiness(root);

    expect(summary.acceptedResidue?.map((entry) => entry.criterion).sort(), "the fenced example became the register").toEqual(
      [...unticked].sort()
    );
    expect(summary.ready).toBe(true);
  });

  it("AC-10: a header with no separator row beneath it is not honoured as a table", async () => {
    // No Markdown renderer shows this as a table, so a reader sees no register at all while the gate
    // honours one. AC-10's premise is reader-parity; a row nobody can see must not excuse anything.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "| Target | Requirement | Criterion | Reason |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`)
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], "a table a reader cannot see excused a requirement").toEqual([]);
    expect(summary.residueProblems ?? [], "and it was dropped without a word").not.toEqual([]);
  });

  it("AC-2: the SRS placeholder dash is not a reason", async () => {
    // Round 7 measured this branch unasserted: deleting the `-` half left every case green. `-` is
    // what this project writes for an empty cell, so honouring it would make the register excusable
    // by a row that says nothing.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(indexPath, unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | - |`));

    const summary = await readiness(root);

    expect(summary.ready, "a row whose reason is the empty-cell placeholder opened the gate").toBe(false);
    expect((summary.residueProblems ?? []).join(" ")).toContain("no reason");
  });

  it("AC-10: the register ends at a fence opened inside it", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      `| ${TARGET} | ${REQ} | ${unticked[0]} | Carried. |`,
      "```",
      "an example",
      "```",
      ...unticked.slice(1).map((id) => `| ${TARGET} | ${REQ} | ${id} | Absorbed across a fence. |`)
    ]);

    const summary = await readiness(root);

    expect(
      summary.acceptedResidue?.map((entry) => entry.criterion) ?? [],
      "the register spanned a code fence"
    ).toEqual([unticked[0]]);
  });

  it("AC-10: a table under a different subheading inside the section is not read as residue", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeSection(indexPath, [
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | Carried. |`),
      "",
      "### Some unrelated subsection",
      "",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      `| ${TARGET} | FR-ARCH-404 | AC-1 | Absorbed from a different table. |`
    ]);

    const summary = await readiness(root);

    expect(
      (summary.acceptedResidue ?? []).map((row) => row.requirementId),
      "a foreign table contributed rows to the register"
    ).not.toContain("FR-ARCH-404");
    expect((summary.residueProblems ?? []).join(" ")).not.toContain("FR-ARCH-404");
  });
});

// An eighth independent round drove the register end to end and took `ready` from false to true four
// different ways, each with `residueProblems: []`. The two structural causes it named:
//
//   (i)  the fence tracker is a parity toggle. It cannot represent a nested fence, so the ONLY way
//        Markdown can display a fenced block — an outer fence longer than the inner one — reads as
//        two toggles and leaves the documented EXAMPLE of a register being read as the register.
//   (ii) any unexpected line in the data region was treated as "the register ended" rather than as
//        "the register has a problem", and the heading was an exact string match whose failure
//        returned silently. Both let a row a reader sees rendered vanish with nothing said.
//
// These cases are the round's measurements, turned into assertions. The standard throughout is the
// one the requirement already sets: a row a human wrote is either honoured or REPORTED, never both
// ignored and silent, and no register content may raise `ready` that a human did not name.

/** Appends arbitrary lines to the index — no heading is supplied, because several cases test the heading. */
async function writeRawIndex(indexPath: string, lines: string[]): Promise<void> {
  const body = await readFile(indexPath, "utf8");
  await writeFile(indexPath, `${body}\n${lines.join("\n")}\n`, "utf8");
}

const HEADER = ["| Target | Requirement | Criterion | Reason |", "| --- | --- | --- | --- |"];
const REASON = "Carried to the next target, with a reason a reader can weigh.";

describe("FR-NODE-175 AC-10 — the register is read as a reader reads it, or the difference is reported", () => {
  it("a fenced EXAMPLE of a register nested inside a longer fence is not the register", async () => {
    // The exact shape a document takes when it shows someone how to write a residue row. The inner
    // ``` closes what the outer ```` opened, so a parity toggle reads the example as live document,
    // finds the heading, reads the example table, and excuses a real requirement with the word
    // `<put the reason here>`. Measured: ready false -> true.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 11. How to write a residue row",
      "",
      "````markdown",
      "```",
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-2 | <put the reason here> |`,
      "```",
      "````"
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], "a documented example excused a real requirement").toEqual([]);
    expect(summary.implementedNotVerified ?? [], "the requirement stopped blocking on an example").toContain(REQ);
  });

  it("a row that omits its leading pipe is read, because that is how it renders", async () => {
    // GFM makes leading and trailing pipes optional. Dropping one character made the row invisible
    // AND suppressed every diagnostic, because the reader took it as the end of the table. Reading it
    // is the honest repair: a reader sees four cells, so the gate must see four cells.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`,
      `${TARGET} | FR-ARCH-404 | AC-1 | A row naming a requirement that does not exist. |`
    ]);

    const summary = await readiness(root);

    expect((summary.residueProblems ?? []).join(" "), "a row without its leading pipe vanished").toContain("FR-ARCH-404");
  });

  it.each([
    ["an HTML comment", "<!-- rows below are for the next release -->"],
    ["a blank line", ""],
    ["a paragraph", "The rows above are the current ones."]
  ])("rows separated from the table by %s are reported rather than dropped", async (_label, interruption) => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`,
      interruption,
      `| ${TARGET} | FR-ARCH-404 | AC-1 | A row a reader would not see rendered in the table. |`
    ]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).join(" "),
      "a row after the table ended was neither read nor reported"
    ).toContain("FR-ARCH-404");
  });

  it.each([
    "## 12. Release residue",
    "### 12. Release Residue",
    "## 12.1 Release Residue",
    "## 12. Release Residue (v1.0.0)",
    "## Release  Residue"
  ])("a heading that near-misses the register is reported: %s", async (heading) => {
    // Each of these took `ready` from false to true with a bogus row still in the file, because the
    // heading search returned `heading < 0` and a hard-coded silent path returned no rows AND no
    // problems. A section a human wrote and named all but exactly cannot be silently unread.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [heading, "", ...HEADER, `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).join(" "),
      "a near-miss heading left the section unread and unreported"
    ).not.toEqual("");
    expect(summary.acceptedResidue ?? [], "a near-miss heading was honoured as the register").toEqual([]);
  });

  it("a second section with the same heading is reported, not silently ignored", async () => {
    // The ordinary outcome of two branches both appending a residue row. The heading search breaks at
    // the first match and the row loop breaks at the next heading, so the second half is invisible.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`,
      "",
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | FR-ARCH-404 | AC-1 | A row nobody would see was dropped. |`
    ]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).join(" ").toLowerCase(),
      "a duplicated register section was read as if there were one"
    ).toContain("release residue");
  });

  it("a separator-shaped row in the data region is reported like any other malformed row", async () => {
    // `| - |` was skipped by the separator test that runs before the cell-count test, so whether a
    // malformed row is reported depended on whether its content happened to look like dashes.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`,
      "| --- | --- | --- | --- |",
      "| - |"
    ]);

    const summary = await readiness(root);

    // Asserting only that SOME problem exists passes for the wrong reason — the carrier's other
    // unticked criteria already produce one. The malformed row itself has to be named.
    expect(
      (summary.residueProblems ?? []).filter((problem) => problem.includes("| - |")),
      "an all-dash row was dropped in silence while an identical `| x |` would have been reported"
    ).not.toEqual([]);
  });
});

// A ninth round drove the repaired reader end to end and took `ready` from false to true five more
// ways, each with `residueProblems: []`. The reader had learned fence LENGTH and forgotten that a
// renderer decides what a table is by four rules, not one: indentation, adjacency of the delimiter
// row, HTML blocks, and where a heading may sit. These cases are that round's measurements.
describe("FR-NODE-175 AC-10/AC-11 — the reader draws the table where a renderer draws it", () => {
  it("an indented example table under the heading is not the register", async () => {
    // Four spaces makes an indented code block. Every renderer shows this as an example; the reader
    // read it as the register and excused a real requirement. `ready` false -> true, problems empty.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      "Authors write rows like this:",
      "",
      ...HEADER.map((line) => `    ${line}`),
      ...unticked.map((id) => `    | ${TARGET} | ${REQ} | ${id} | ${REASON} |`)
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], "an indented example excused a real requirement").toEqual([]);
    expect(summary.implementedNotVerified ?? []).toContain(REQ);
    expect((summary.residueProblems ?? []).join(" "), "the section held no readable table and said nothing").not.toEqual("");
  });

  it("a separator row that does not immediately follow the header is not a table", async () => {
    // GFM requires the delimiter row to be the very next line. One blank line between them and no
    // renderer draws a table — but the reader stitched them together across it.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      HEADER[0] as string,
      "",
      HEADER[1] as string,
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | ${REASON} |`)
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], "a header and a separator with a gap between them were read as a table").toEqual([]);
  });

  it("a register inside an HTML comment is not read", async () => {
    // A CommonMark HTML block renders nothing at all. The reader read the whole register out of one.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeRawIndex(indexPath, [
      "<!--",
      "## 12. Release Residue",
      "",
      ...HEADER,
      ...unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | ${REASON} |`),
      "-->"
    ]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], "a commented-out register excused a real requirement").toEqual([]);
    expect(summary.implementedNotVerified ?? []).toContain(REQ);
  });

  it.each([
    ["a setext heading", ["Release Residue", "---------------"]],
    ["an ATX heading indented one space", [" ## 12. Release Residue"]],
    ["an ATX heading indented three spaces", ["   ## 12. Release Residue"]],
    ["a zero-width space inside the title", ["## 12. Release ​Residue"]]
  ])("%s is a heading to a renderer, so it is read or reported — never silently skipped", async (_label, heading) => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [...heading, "", ...HEADER, `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    const seen = (summary.acceptedResidue ?? []).length > 0 || (summary.residueProblems ?? []).length > 0;
    expect(seen, "a section a renderer shows as the register was neither read nor mentioned").toBe(true);
  });

  it("an unclosed fence earlier in the index does not swallow the register in silence", async () => {
    // The likeliest real shape in a 300-line index. The fence scanner never reopens, so the heading
    // scan ran to end of file and the reader returned no rows AND no problems.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeRawIndex(indexPath, [
      "## 11. Notes",
      "",
      "```",
      "an example nobody closed",
      "",
      "## 12. Release Residue",
      "",
      ...HEADER,
      `| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`
    ]);

    const summary = await readiness(root);

    expect((summary.residueProblems ?? []).join(" "), "an unclosed fence hid the register with nothing said").not.toEqual("");
  });

  it("a residue row written above the header is reported, not dropped", async () => {
    // The author is otherwise told their criterion is unexcused while the row they wrote sits unread.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeRawIndex(indexPath, [
      "## 12. Release Residue",
      "",
      `| ${TARGET} | ${REQ} | ${unticked[0]} | ${REASON} |`,
      ...HEADER,
      ...unticked.slice(1).map((id) => `| ${TARGET} | ${REQ} | ${id} | ${REASON} |`)
    ]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).join(" "),
      "a row above the header was neither read nor mentioned"
    ).toContain(unticked[0] as string);
  });

  it("a row naming a target the index registers but no requirement carries yet is not reported", async () => {
    // The register legitimately stages rows for the next target. `declaredTargets` was built from
    // requirement records alone, so a row for a registered-but-unused target blocked this release.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const body = await readFile(indexPath, "utf8");
    const staged = "v9.9.9";
    // Registered in the Target Map exactly as a human would register it, and carried by no record.
    const withTarget = body.replace(/(\n\|\s*Target\s*\|[^\n]*\n\|[\s:-]+\|[^\n]*\n)/, `$1| ${staged} | planned | staged for the next release |\n`);
    expect(withTarget, "the Target Map table was not found, so this case would prove nothing").not.toBe(body);
    await writeFile(indexPath, withTarget, "utf8");
    await writeResidue(indexPath, [`| ${staged} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).filter((problem) => problem.includes(staged)),
      "a row for a registered future target blocked this release"
    ).toEqual([]);
  });
});

describe("FR-NODE-175 AC-1/AC-7 — a row that resolves to nothing is reported, whichever cell is wrong", () => {
  it.each([
    ["a target that exists nowhere", "v1.O.O"],
    ["an empty target cell", ""]
  ])("%s is reported rather than filtered away", async (_label, target) => {
    // The target filter ran before every diagnostic, so a typo in the Target cell put the row beyond
    // the reach of every check. The author saw the requirement blocking and no word about the row.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${target} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    expect((summary.residueProblems ?? []).join(" "), "a row naming no known target was dropped in silence").toContain(REQ);
  });

  it("a row naming a different but real target is skipped without a complaint", async () => {
    // The bound in the other direction: a register legitimately carries rows for other targets, and
    // reporting those would make every multi-target register unreleasable.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const workspace = await parseWorkspace(root);
    const otherTarget = workspace.records.map((record) => record.target).find((value) => value && value !== TARGET);
    await writeResidue(indexPath, [`| ${otherTarget ?? "v0.9.0"} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    // Only meaningful when the fixture actually declares a second target; otherwise the case above
    // covers the same ground and this one is skipped rather than passing for the wrong reason.
    if (otherTarget === undefined) return;
    expect((summary.residueProblems ?? []).join(" ")).not.toContain(REQ);
  });

  it.each(["--", "—", "N/A", "TBD", ".", "?"])("a reason of %j does not excuse anything", async (reason) => {
    // Only the single `-` was refused. Every one of these renders as a cell that says nothing and
    // fully excused the criterion. The rule cannot judge whether a sentence is TRUE — that limit is
    // real and is stated here rather than implied — but it can refuse a cell that says nothing.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-1 | ${reason} |`]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue ?? [], `a reason of ${reason} excused a criterion`).toEqual([]);
    expect((summary.residueProblems ?? []).join(" ")).toContain(REQ);
  });

  it("a substantive reason still excuses, so the rule above is not simply refusing everything", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const unticked = await untickedOf(root);
    await writeResidue(
      indexPath,
      unticked.map((id) => `| ${TARGET} | ${REQ} | ${id} | ${REASON} |`)
    );

    const summary = await readiness(root);

    expect((summary.acceptedResidue ?? []).length, "the reason rule refused a real reason").toBe(unticked.length);
  });

  it("a duplicated Requirement ID is reported rather than resolved to whichever block came first", async () => {
    // `records.find` always returns the first block, so one row discharged criteria on a block it
    // never named. Duplicate ids are a real merge outcome — the repository ships a repair workflow
    // for them — so the register must refuse to guess which block a row means.
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    const workspace = await parseWorkspace(root);
    const file = workspace.files.find((entry) => entry.relativePath.endsWith(".srs.md") && !entry.relativePath.endsWith("00.index.md"));
    expect(file, "the fixture has no scope document to duplicate a block in").toBeDefined();
    const filePath = path.join(root.root, file?.relativePath ?? "");
    const body = await readFile(filePath, "utf8");
    const blockStart = body.indexOf(`### ${REQ}`);
    expect(blockStart, "the carrier block was not found").toBeGreaterThan(-1);
    await writeFile(filePath, `${body}\n\n${body.slice(blockStart)}`, "utf8");
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-1 | ${REASON} |`]);

    const summary = await readiness(root);

    expect(
      (summary.residueProblems ?? []).join(" "),
      "a row was applied to one of two blocks sharing an id without saying so"
    ).toContain(REQ);
    expect(summary.acceptedResidue ?? []).toEqual([]);
  });
});
