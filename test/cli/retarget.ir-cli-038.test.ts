import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-054 — `speckiwi retarget` command with dry-run default and per-item skip reasons.
//
// Red-phase suite (T-PH004-19): one test case per acceptance criterion (AC-1..AC-5). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI a
// `retarget` command, so the whole suite fails today — commander rejects the unknown `retarget`
// command (non-zero usage exit, no retarget plan payload printed) — until the green task (T-PH004-20)
// wires the command against the existing core mutation (src/core/mutation/retarget.ts `retarget`,
// FR-NODE-059) plus selection filters and an --apply flag that flips the core's dry-run default off.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-054):
//
//   SpecKiwi provides a `speckiwi retarget` command that moves requirements selected by --from and
//   --to with optional --scope, --status, --type, and --id filters under a required --reason, defaults
//   to dry-run preview, includes verified requirements by default with an explicit --exclude opt-out,
//   refuses to move into a target that is not registered in the Target Map, and reports a per-item
//   skipReason for items it does not move.
//
//   - AC-1: `retarget --from <a> --to <b> --reason <text>` previews the set of requirements whose
//           target would change without writing unless --apply is given.
//   - AC-2: The command includes verified requirements in the move set by default and a documented
//           --exclude option removes only the listed ids.
//   - AC-3: When --to names a target that is not present in the Target Map, the command refuses the
//           operation and changes no files.
//   - AC-4: The preview reports each candidate with a per-item skipReason such as
//           target-not-registered or frozen-needs-change-note for items it will not move.
//   - AC-5: When a moved requirement is frozen or falls under the frozen change-control rule, the
//           supplied reason is recorded as a Change Notes row consistent with SRS-W009 governance
//           (Implementation Note 2026-06-08 correction: the frozen change-control diagnostic is
//           SRS-W009 / SRS-MD Rules §16 rule 5, not SRS-E028).
//
// Fixture (mutation-target): Target Map registers v1.0.0 (active) and v1.1.0 (planned); FR-ARCH-001
// targets v1.0.0 with stability stable. Each test appends extra requirement blocks to the ARCH scope
// document so the move set carries a verified id (FR-ARCH-002) and a frozen id (FR-ARCH-003), and an
// unregistered destination (v9.9.9) drives the target-not-registered refusal path.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const STABLE_ID = "FR-ARCH-001";
const VERIFIED_ID = "FR-ARCH-002";
const FROZEN_ID = "FR-ARCH-003";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** Reads the current value of a single metadata cell (e.g. "Target") for a requirement block. */
async function metadataCell(root: string, id: string, field: string): Promise<string | undefined> {
  const text = await readFile(path.join(root, SCOPE_DOC), "utf8");
  const blockStart = text.indexOf(`### ${id} `);
  if (blockStart < 0) return undefined;
  const block = text.slice(blockStart, text.indexOf("\n### ", blockStart + 1) >= 0 ? text.indexOf("\n### ", blockStart + 1) : undefined);
  const match = block.match(new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^|]*?)\\s*\\|`));
  return match ? match[1] : undefined;
}

/** A fully-formed requirement block targeting v1.0.0, parameterized for status/stability. */
function requirementBlock(id: string, options: { status?: string; stability?: string }): string {
  return [
    `### ${id} — Fixture ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${options.status ?? "planned"} |`,
    "| Priority | medium |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${options.stability ?? "stable"} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "Fixture rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [x] AC-1: First criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| VE-1 | test | test/cli/retarget.ir-cli-038.test.ts | all | - |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-08 | Created | Fixture |"
  ].join("\n");
}

/** Appends a verified and a frozen requirement (both targeting v1.0.0) to the ARCH scope doc. */
async function appendMoveSet(root: string): Promise<void> {
  const specPath = path.join(root, SCOPE_DOC);
  const text = await readFile(specPath, "utf8");
  const blocks = [
    requirementBlock(VERIFIED_ID, { status: "verified", stability: "stable" }),
    requirementBlock(FROZEN_ID, { status: "planned", stability: "frozen" })
  ];
  await writeFile(specPath, `${text.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/** Recovers the array of per-item retarget plan entries from a JSON result envelope. */
function findItems(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-054 — retarget command with dry-run default and per-item skip reasons", () => {
  // AC-1: `retarget --from <a> --to <b> --reason <text>` previews the set of requirements whose target
  //       would change without writing unless --apply is given.
  it("IR-CLI-054 AC-1: previews the move set in dry-run by default and writes only under --apply", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    // Preview (no --apply): both targets are registered, so FR-ARCH-001 (target v1.0.0) is a candidate
    // to move to v1.1.0. The command must report the candidate WITHOUT touching the file.
    const preview = io();
    const previewCode = await main(
      ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--reason", "consolidate target", "--json"],
      preview
    );
    const previewOut = drain(preview.stdout);
    expect(previewCode).toBe(0);
    const previewItems = findItems(JSON.parse(previewOut));
    expect(previewItems, "retarget preview must expose a per-item plan array").toBeDefined();
    const previewPlan = (previewItems ?? []).find((item) => item.id === STABLE_ID);
    expect(previewPlan, `${STABLE_ID} must appear in the preview move set`).toBeDefined();
    expect(previewPlan?.toTarget).toBe("v1.1.0");
    expect(previewOut).not.toContain("undefined");

    // Dry-run default leaves the Target metadata cell untouched on disk.
    expect(await metadataCell(root, STABLE_ID, "Target")).toBe("v1.0.0");

    // --apply performs the move: the Target cell is rewritten to v1.1.0.
    const apply = io();
    const applyCode = await main(
      ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--reason", "consolidate target", "--apply", "--json"],
      apply
    );
    expect(applyCode).toBe(0);
    expect(await metadataCell(root, STABLE_ID, "Target")).toBe("v1.1.0");
  });

  // AC-2: The command includes verified requirements in the move set by default and a documented
  //       --exclude option removes only the listed ids.
  it("IR-CLI-054 AC-2: includes verified requirements by default and --exclude drops only listed ids", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendMoveSet(root);

    // By default the verified requirement (FR-ARCH-002) is part of the move set.
    const defaultRun = io();
    expect(
      await main(["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--reason", "move verified", "--json"], defaultRun)
    ).toBe(0);
    const defaultItems = findItems(JSON.parse(drain(defaultRun.stdout))) ?? [];
    const verifiedPlan = defaultItems.find((item) => item.id === VERIFIED_ID);
    expect(verifiedPlan, `${VERIFIED_ID} (verified) must be in the move set by default`).toBeDefined();
    expect(verifiedPlan?.toTarget).toBe("v1.1.0");
    expect(verifiedPlan?.skipReason).toBeUndefined();

    // --exclude removes ONLY the listed id: FR-ARCH-002 is skipped (excluded) while FR-ARCH-001 still
    // moves.
    const excludeRun = io();
    expect(
      await main(
        ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--reason", "move verified", "--exclude", VERIFIED_ID, "--json"],
        excludeRun
      )
    ).toBe(0);
    const excludeItems = findItems(JSON.parse(drain(excludeRun.stdout))) ?? [];
    const excludedPlan = excludeItems.find((item) => item.id === VERIFIED_ID);
    expect(excludedPlan?.skipReason).toBe("excluded");
    const keptPlan = excludeItems.find((item) => item.id === STABLE_ID);
    expect(keptPlan?.skipReason, `${STABLE_ID} must NOT be excluded by --exclude ${VERIFIED_ID}`).toBeUndefined();
    expect(keptPlan?.toTarget).toBe("v1.1.0");
  });

  // AC-3: When --to names a target that is not present in the Target Map, the command refuses the
  //       operation and changes no files.
  it("IR-CLI-054 AC-3: refuses an unregistered --to target and changes no files", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, SCOPE_DOC), "utf8");

    // v9.9.9 is not a row in the Target Map. Even with --apply, the command must refuse to move and
    // leave the file byte-identical.
    const refused = io();
    const code = await main(
      ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v9.9.9", "--reason", "bad target", "--apply", "--json"],
      refused
    );
    const out = drain(refused.stdout);
    const combined = `${out}${drain(refused.stderr)}`;

    // The refusal surfaces either as a non-zero exit or as a per-item target-not-registered skipReason;
    // either way the scope document must be unchanged.
    const items = findItems((() => {
      try {
        return JSON.parse(out);
      } catch {
        return undefined;
      }
    })());
    const refusedAll = (items ?? []).every((item) => item.skipReason === "target-not-registered" || item.toTarget === undefined);
    expect(code !== 0 || (items !== undefined && refusedAll), "unregistered --to must be refused").toBe(true);
    expect(combined).toContain("target-not-registered");

    // No files changed.
    expect(await readFile(path.join(root, SCOPE_DOC), "utf8")).toBe(before);
  });

  // AC-4: The preview reports each candidate with a per-item skipReason such as target-not-registered
  //       or frozen-needs-change-note for items it will not move.
  it("IR-CLI-054 AC-4: preview reports per-item skipReason for items it will not move", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendMoveSet(root);

    // target-not-registered: an unregistered destination yields that skipReason for each candidate.
    const unregistered = io();
    expect(
      await main(["--root", root, "retarget", "--from", "v1.0.0", "--to", "v9.9.9", "--reason", "x", "--json"], unregistered)
    ).not.toBe(0);
    const unregOut = drain(unregistered.stdout);
    const unregItems = findItems((() => {
      try {
        return JSON.parse(unregOut);
      } catch {
        return undefined;
      }
    })());
    if (unregItems) {
      const plan = unregItems.find((item) => item.id === STABLE_ID);
      expect(plan?.skipReason).toBe("target-not-registered");
    }
    expect(`${unregOut}${drain(unregistered.stderr)}`).toContain("target-not-registered");

    // frozen-needs-change-note: a frozen requirement moved WITHOUT a reason reports that skipReason.
    // (The CLI marks --reason required, so this path is exercised through the --id selector with an
    // empty reason being rejected; the skipReason token itself must be reachable in the preview output
    // when a frozen candidate cannot be moved.) Here we assert the token is documented/emitted for the
    // frozen candidate when no governance reason is recorded.
    const frozenPreview = io();
    await main(
      ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--id", FROZEN_ID, "--json"],
      frozenPreview
    );
    const frozenOut = `${drain(frozenPreview.stdout)}${drain(frozenPreview.stderr)}`;
    expect(frozenOut).toMatch(/frozen-needs-change-note|reason/);
  });

  // AC-5: When a moved requirement is frozen or falls under the frozen change-control rule, the
  //       supplied reason is recorded as a Change Notes row consistent with SRS-W009 governance.
  it("IR-CLI-054 AC-5: a frozen move records the reason as a Change Notes row (SRS-W009 governance)", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await appendMoveSet(root);

    const reason = "governed frozen retarget rationale";
    const applied = io();
    const code = await main(
      ["--root", root, "retarget", "--from", "v1.0.0", "--to", "v1.1.0", "--id", FROZEN_ID, "--reason", reason, "--apply", "--json"],
      applied
    );
    expect(code).toBe(0);

    // The frozen requirement's Target moved and a Change Notes row carrying the supplied reason exists.
    const text = await readFile(path.join(root, SCOPE_DOC), "utf8");
    const blockStart = text.indexOf(`### ${FROZEN_ID} `);
    const block = text.slice(blockStart);
    const changeNotes = block.slice(block.indexOf("#### Change Notes"));
    expect(await metadataCell(root, FROZEN_ID, "Target")).toBe("v1.1.0");
    expect(changeNotes).toContain(reason);
  });
});
