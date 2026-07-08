import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-059 — `speckiwi supersede` command.
//
// Red-phase suite (T-PH004-33): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before `src/cli/index.ts` / `src/cli/commands/mutations.ts` teach the CLI a
// `supersede` command, so the whole suite fails today — commander rejects the unknown `supersede`
// command (non-zero usage exit, no mutation payload printed) — until the green task (T-PH004-34) wires
// the command against the existing core mutation (src/core/mutation/supersede-requirement.ts
// `supersedeRequirement`, FR-NODE-045): the strict ordered two-call sequence that mints a successor
// requirement carrying a `supersedes <oldId>` trace row (T1 add_requirement) and then discards the old
// requirement (T2 updateStatus → discarded), returning the new id, with a --dry-run preview, a --json
// mutation result envelope, and every core guard delegated through without a bypass option.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-059):
//
//   The speckiwi supersede command mirrors the existing supersede_requirement core mutation by creating
//   a successor requirement that traces supersedes the old id and then discarding the old requirement in
//   one command, returning the new id, supporting dry-run and json, and delegating every core guard
//   without a bypass option.
//
//   - AC-1: `supersede --old <id> --new-title <t> --new-statement <s> --scope <s> --type <ty>` creates a
//           successor requirement and discards the old requirement, returning the new id.
//   - AC-2: `supersede --dry-run` prints a preview of the two-step sequence and writes no file.
//   - AC-3: The command passes the core self-reference, reverse-duplicate, and verified-regression guards
//           through without any bypass flag.
//   - AC-4: `supersede --json` emits the mutation result envelope consistent with other mutation commands.
//
// Fixture (mutation-target): a single requirement FR-ARCH-001 lives in the ARCH scope document
// (test/fixtures/workspaces/mutation-target/docs/spec/10.product-architecture.srs.md). Its pinned
// fixture facts:
//   - Field block: `| Target | v1.0.0 |`, `| Status | planned |`, `| Stability | stable |`.
//   - Requirement statement body: "SpecKiwi must mutate this fixture requirement."
//   - Trace Links: a header-only table ("| Type | Reference | Relation | Notes |" / "| --- | --- | --- | --- |").
// The Target Map (00.index.md) registers v1.0.0 (active) and v1.1.0 (planned); the ARCH scope prefix is
// ARCH so a minted functional successor takes the next free FR-ARCH-### id.
// The core supersedeRequirement returns mutationOk({ oldId, newId, written }); it accepts dryRun and the
// successorId guard hint (successorId === oldId trips the self-reference guard before any mutation).

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const OLD_ID = "FR-ARCH-001";
const NEW_TITLE = "Mutable requirement v2";
const NEW_STATEMENT = "SpecKiwi must mutate this superseding fixture requirement.";
const SCOPE = "ARCH";
const TYPE = "functional";
const OLD_STATEMENT = "SpecKiwi must mutate this fixture requirement.";

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
 * (or EOF). Matches both the plain heading (`### <id> `) and the SRS-MD-Rules v1.1.0 §30.1
 * strikethrough heading a discard rewrites it into (`### ~~<id> ...~~ [DISCARDED]`), so a discarded
 * block is still locatable.
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

/** Walks a JSON result envelope to recover the supersede mutation value object (carrying oldId/newId). */
function findValue(parsed: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.oldId === OLD_ID && "newId" in record && "written" in record) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-059 — supersede command creates a successor and discards the old requirement", () => {
  // AC-1: `supersede --old <id> --new-title <t> --new-statement <s> --scope <s> --type <ty>` creates a
  // successor requirement and discards the old requirement, returning the new id.
  it("IR-CLI-059 AC-1: creates a successor that supersedes the old id, discards the old, returns the new id", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);
    // sanity: the old requirement starts present and is not yet discarded.
    expect(before).toContain(`### ${OLD_ID} `);
    expect(statusOf(requirementBlock(before, OLD_ID))).not.toBe("discarded");

    const run = io();
    const code = await main(
      [
        "--root",
        root,
        "supersede",
        "--old",
        OLD_ID,
        "--new-title",
        NEW_TITLE,
        "--new-statement",
        NEW_STATEMENT,
        "--scope",
        SCOPE,
        "--type",
        TYPE,
        "--apply",
        "--json"
      ],
      run
    );
    expect(code).toBe(0);

    // The returned new id is surfaced on the mutation value (oldId/newId/written), and it differs from
    // the old id.
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "supersede must print a mutation value carrying oldId/newId/written").toBeDefined();
    expect(value?.oldId).toBe(OLD_ID);
    expect(typeof value?.newId).toBe("string");
    expect(value?.newId).not.toBe(OLD_ID);
    expect((value?.newId as string)).toMatch(/^FR-ARCH-\d{3}$/);

    const after = await readArch(root);
    const newId = value?.newId as string;
    // The successor requirement was minted, carries the new statement, and traces `supersedes <oldId>`.
    const newBlock = requirementBlock(after, newId);
    expect(newBlock).not.toBe("");
    expect(newBlock).toContain(NEW_STATEMENT);
    expect(newBlock).toContain("supersedes");
    expect(newBlock).toContain(OLD_ID);
    // The old requirement was discarded (T2).
    expect(statusOf(requirementBlock(after, OLD_ID))).toBe("discarded");
  });

  // AC-2: `supersede --dry-run` prints a preview of the two-step sequence and writes no file.
  it("IR-CLI-059 AC-2: --dry-run previews the two-step sequence and writes no file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);

    const run = io();
    const code = await main(
      [
        "--root",
        root,
        "supersede",
        "--old",
        OLD_ID,
        "--new-title",
        NEW_TITLE,
        "--new-statement",
        NEW_STATEMENT,
        "--scope",
        SCOPE,
        "--type",
        TYPE,
        "--dry-run",
        "--json"
      ],
      run
    );
    expect(code).toBe(0);

    // No file write: the scope document is byte-for-byte unchanged after a dry-run — neither a successor
    // block is appended nor is the old requirement discarded.
    const after = await readArch(root);
    expect(after).toBe(before);
    expect(after).toContain(OLD_STATEMENT);
    expect(statusOf(requirementBlock(after, OLD_ID))).not.toBe("discarded");

    // The dry-run still reports a successful (non-writing) supersede envelope: written is false.
    const value = findValue(JSON.parse(drain(run.stdout)));
    expect(value, "supersede --dry-run must still print a mutation value").toBeDefined();
    expect(value?.oldId).toBe(OLD_ID);
    expect(value?.written).toBe(false);
  });

  // AC-3: passes the core self-reference (and reverse-duplicate / verified-regression) guards through
  // without any bypass flag. Pinned via the self-reference guard: superseding an id with itself is
  // rejected by the core, the CLI surfaces the failure (non-zero exit), and writes no file.
  it("IR-CLI-059 AC-3: delegates the core self-reference guard with no bypass flag", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readArch(root);

    const run = io();
    // `--successor <id>` pins the intended successor identity; when it equals --old the core
    // self-reference guard must reject before any mutation. There is intentionally no bypass flag.
    const code = await main(
      [
        "--root",
        root,
        "supersede",
        "--old",
        OLD_ID,
        "--successor",
        OLD_ID,
        "--new-title",
        NEW_TITLE,
        "--new-statement",
        NEW_STATEMENT,
        "--scope",
        SCOPE,
        "--type",
        TYPE,
        "--apply",
        "--json"
      ],
      run
    );
    // The self-reference guard denies the supersede: non-zero exit, workspace untouched.
    expect(code).not.toBe(0);
    expect(await readArch(root)).toBe(before);

    // The failure must come from the delegated CORE guard, not from commander rejecting an unknown
    // command. The core self-reference guard returns code "MUTATION_DENIED" with a distinct-successor
    // message; a CLI usage error (unknown command / missing option) carries "CLI_USAGE_ERROR" and must
    // NOT satisfy this case. Pinning the code+message proves the guard is delegated with no bypass flag.
    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; error?: { code?: string; message?: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("MUTATION_DENIED");
    expect(parsed.error?.code).not.toBe("CLI_USAGE_ERROR");
    expect(parsed.error?.message ?? "").toMatch(/supersede .*with itself|distinct requirement/i);
  });

  // AC-4: `supersede --json` emits the mutation result envelope consistent with other mutation commands.
  it("IR-CLI-059 AC-4: --json emits a mutation result envelope consistent with other mutation commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const run = io();
    const code = await main(
      [
        "--root",
        root,
        "supersede",
        "--old",
        OLD_ID,
        "--new-title",
        NEW_TITLE,
        "--new-statement",
        NEW_STATEMENT,
        "--scope",
        SCOPE,
        "--type",
        TYPE,
        "--apply",
        "--json"
      ],
      run
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(run.stdout)) as { ok?: boolean; value?: unknown; diagnostics?: unknown };
    // Envelope shape mirrors the other mutation commands: { ok, value, diagnostics }.
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    // The value object delegates the core supersede_requirement result: { oldId, newId, written }.
    const value = findValue(parsed);
    expect(value, "supersede --json must print a mutation value with oldId/newId/written").toBeDefined();
    expect(value?.oldId).toBe(OLD_ID);
    expect(typeof value?.newId).toBe("string");
    expect(value?.written).toBe(true);
  });
});
