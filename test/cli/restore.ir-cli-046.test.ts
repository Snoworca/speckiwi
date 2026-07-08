import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-046 — `speckiwi restore` command.
//
// Red-phase suite (T-PH004-35): one test case per acceptance criterion (AC-1..AC-4). These cases pin the
// future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI a
// `restore` command, so the whole suite fails today — commander rejects the unknown `restore` command
// (non-zero usage exit, `{ ok:false, error:{ code:"CLI_USAGE_ERROR" } }` under --json) — until the green
// task (T-PH004-36) wires the command against the existing core mutation (src/core/mutation/update-status.ts
// `restore`, FR-NODE-051): the single-transaction un-discard that rewrites Status back to an active value
// (defaulting to planned), strips the heading strikethrough + DISCARDED marker, appends one Change Notes
// row carrying the required reason, supports --to / --dry-run / --json, and writes nothing when --reason
// is absent.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-046):
//
//   The speckiwi restore command delegates to the restore core to un-discard a requirement, requires a
//   reason, supports an optional target status, dry-run, and json, and writes nothing when the reason is
//   missing.
//
//   - AC-1: `restore <id> --reason <r>` un-discards the requirement to planned by default.
//   - AC-2: `restore <id> --to <status> --reason <r>` un-discards to the given active status.
//   - AC-3: `restore --dry-run` prints a preview and writes no file.
//   - AC-4: `restore` without --reason returns a non-zero exit code and writes no file.
//
// Fixture (mutation-target): the single requirement FR-ARCH-001 lives in the ARCH scope document
// (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md), starting at Status
// `planned`. Each case first DISCARDS it through the core updateStatus mutation (status=discarded, with a
// reason) so restore has a genuine discarded target; the heading then carries the SRS-MD-Rules v1.1.0
// §30.1 strikethrough + `[DISCARDED]` marker and Status `discarded`. The restore core returns
// mutationOk({ id, status, written, warnings }) and rejects a missing reason with mutationFail("USAGE", …).

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";
const DISCARD_REASON = "superseded by fixture flow";
const RESTORE_REASON = "reinstated after review";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function readArch(root: string): Promise<string> {
  return readFile(path.join(root, ARCH_DOC), "utf8");
}

/**
 * Slices an `### FR-...` requirement block out of the scope document, up to the next `### ` heading
 * (or EOF). Matches both the plain heading (`### <id> `) and the SRS-MD-Rules v1.1.0 §30.1 strikethrough
 * heading a discard rewrites it into (`### ~~<id> ...~~ [DISCARDED]`), so a discarded block is still
 * locatable. (Mirrors the trace-search / supersede suites' tolerant heading matcher.)
 */
function requirementBlock(text: string, id: string): string {
  let start = text.indexOf(`### ${id} `);
  if (start < 0) start = text.indexOf(`### ~~${id} `);
  if (start < 0) return "";
  const next = text.indexOf("\n### ", start + 1);
  return text.slice(start, next >= 0 ? next : undefined);
}

/** Recovers the Status field value (e.g. "discarded") declared inside a requirement's field block. */
function statusOf(block: string): string | undefined {
  const match = block.match(/\|\s*Status\s*\|\s*([^|]+?)\s*\|/);
  return match?.[1]?.trim();
}

/** Walks a JSON result envelope to recover the restore mutation value object (carrying id/status/written). */
function findValue(parsed: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.id === ID && "status" in record && "written" in record) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

/** Copies the mutation-target fixture and discards FR-ARCH-001 through the core so restore has a target. */
async function discardedWorkspace(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const root = await resolveProjectRoot(rootPath);
  // FR-ARCH-001 is Stability=stable (a protected state), so the FR-NODE-019 discard guard requires the
  // explicit override (reason + confirmDiscardVerified) to reach the discarded precondition.
  const discarded = await updateStatus(root, {
    id: ID,
    status: "discarded",
    reason: DISCARD_REASON,
    confirmDiscardVerified: true
  });
  expect(discarded.ok, "fixture setup: core discard must succeed").toBe(true);
  const after = await readArch(rootPath);
  // Pinned precondition: the heading is now struck through + DISCARDED and Status reads `discarded`.
  expect(after).toContain(`### ~~${ID} `);
  expect(after).toContain("[DISCARDED]");
  expect(statusOf(requirementBlock(after, ID))).toBe("discarded");
  return rootPath;
}

describe("IR-CLI-046 — restore command un-discards a requirement via the restore core", () => {
  // AC-1: `restore <id> --reason <r>` un-discards the requirement to planned by default.
  it("IR-CLI-046 AC-1: --reason un-discards to planned by default and clears the DISCARDED marker", async () => {
    const root = await discardedWorkspace();

    const run = io();
    const code = await main(["--root", root, "restore", ID, "--reason", RESTORE_REASON, "--json"], run);
    expect(code).toBe(0);

    const after = await readArch(root);
    // Default active status is planned, and the strikethrough + DISCARDED marker are removed.
    expect(statusOf(requirementBlock(after, ID))).toBe("planned");
    expect(after).toContain(`### ${ID} `);
    expect(after).not.toContain(`### ~~${ID} `);
    expect(after).not.toContain("[DISCARDED]");
    // The required reason is recorded as a Change Notes row in the same patch.
    expect(after).toContain(RESTORE_REASON);

    // The mutation envelope delegates the core restore result: { id, status, written }.
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "restore must print a mutation value carrying id/status/written").toBeDefined();
    expect(value?.id).toBe(ID);
    expect(value?.status).toBe("planned");
    expect(value?.written).toBe(true);
  });

  // AC-2: `restore <id> --to <status> --reason <r>` un-discards to the given active status.
  it("IR-CLI-046 AC-2: --to <status> un-discards to the requested active status", async () => {
    const root = await discardedWorkspace();

    const run = io();
    const code = await main(
      ["--root", root, "restore", ID, "--to", "implemented", "--reason", RESTORE_REASON, "--json"],
      run
    );
    expect(code).toBe(0);

    const after = await readArch(root);
    // The requested active status wins over the planned default; markers are still cleared.
    expect(statusOf(requirementBlock(after, ID))).toBe("implemented");
    expect(after).not.toContain("[DISCARDED]");

    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "restore --to must print a mutation value").toBeDefined();
    expect(value?.status).toBe("implemented");
    expect(value?.written).toBe(true);
  });

  // AC-3: `restore --dry-run` prints a preview and writes no file.
  it("IR-CLI-046 AC-3: --dry-run previews the un-discard and writes no file", async () => {
    const root = await discardedWorkspace();
    const before = await readArch(root);

    const run = io();
    const code = await main(
      ["--root", root, "restore", ID, "--reason", RESTORE_REASON, "--dry-run", "--json"],
      run
    );
    expect(code).toBe(0);

    // No file write: the scope document is byte-for-byte unchanged — the requirement is still discarded.
    const after = await readArch(root);
    expect(after).toBe(before);
    expect(statusOf(requirementBlock(after, ID))).toBe("discarded");
    expect(after).toContain("[DISCARDED]");

    // The dry-run still reports a successful (non-writing) restore envelope: written is false.
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "restore --dry-run must still print a mutation value").toBeDefined();
    expect(value?.id).toBe(ID);
    expect(value?.written).toBe(false);
  });

  // AC-4: `restore` without --reason returns a non-zero exit code and writes no file. The failure must be
  // the delegated CORE reason guard (mutationFail "USAGE"), NOT commander rejecting an unknown command
  // (CLI_USAGE_ERROR) — pinning the code proves the command exists and delegates restore (FR-NODE-051)
  // without a bypass.
  it("IR-CLI-046 AC-4: a missing --reason fails (non-zero) via the core reason guard and writes no file", async () => {
    const root = await discardedWorkspace();
    const before = await readArch(root);

    const run = io();
    const code = await main(["--root", root, "restore", ID, "--json"], run);
    expect(code).not.toBe(0);

    // Workspace untouched: the requirement stays discarded, nothing written.
    const after = await readArch(root);
    expect(after).toBe(before);
    expect(statusOf(requirementBlock(after, ID))).toBe("discarded");

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string; message?: string } };
    expect(parsed.ok).toBe(false);
    // Delegated core guard, not an unknown-command usage error.
    expect(parsed.error?.code).toBe("USAGE");
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.error?.message ?? "").toMatch(/reason/i);
  });
});
