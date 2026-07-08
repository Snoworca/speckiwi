import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-065 — `speckiwi doctor` scope/target consistency must not report a false "ok".
//
// FND-004: checkScopeTargetConsistency only inspected unregistered scopes/targets when the index
// Scope Map / Target Map were non-empty (knownScopes.size > 0). When the index map is EMPTY but
// requirement records still reference a scope/target (e.g. a record FR-ARCH-001 derives scope ARCH
// from its id prefix), the drift was invisible and the check returned state="ok" — a false-ok that
// hid a missing/empty index Scope Map. The fix must surface this as a warn (registration cannot be
// confirmed because the index map is empty) rather than ok.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const HEALTH_STATES = new Set(["ok", "warn", "fail"]);

/** Walks parsed JSON for the doctor diagnosis-check array (entries with an {ok,warn,fail} state). */
function findCheckArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        node.every(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).state === "string" &&
            HEALTH_STATES.has((item as Record<string, unknown>).state as string)
        )
      ) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** The scope/target consistency check entry from a doctor --json report. */
function consistencyCheck(out: string): Record<string, unknown> {
  const rows = findCheckArray(JSON.parse(out));
  expect(rows, "doctor --json must expose a checks array").toBeDefined();
  const match = (rows as Array<Record<string, unknown>>).find(
    (check) => String(check.topic).toLowerCase().includes("scope and target consistency")
  );
  expect(match, "doctor must include a scope and target consistency check").toBeDefined();
  return match as Record<string, unknown>;
}

/**
 * Empties the §4 Scope Map data row in the index (keeping the section heading + table header), so the
 * parsed index Scope Map is empty while the scope SRS still defines FR-ARCH-001 (record scope ARCH).
 */
async function emptyScopeMap(root: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const text = await readFile(indexPath, "utf8");
  // Drop the single ARCH data row from the §4 Scope Map (the row begins "| Product Architecture |"
  // and references ./10.product-architecture.srs.md). Both §2 and §4 carry an identical row; only the
  // §4 Scope Map row drives knownScopes, but removing both still leaves a record referencing ARCH.
  const stripped = text
    .split("\n")
    .filter((line) => !line.startsWith("| Product Architecture | [10.product-architecture.srs.md]"))
    .join("\n");
  await writeFile(indexPath, stripped, "utf8");
}

describe("IR-CLI-065 — doctor scope/target consistency with an empty index Scope Map (FND-004)", () => {
  it("IR-CLI-065: an empty Scope Map with a record that references a scope is not a false 'ok'", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await emptyScopeMap(root);

    const streams = io();
    const code = await main(["--root", root, "doctor", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const check = consistencyCheck(out);

    // The record FR-ARCH-001 still references scope ARCH, but the index Scope Map is now empty, so
    // registration cannot be confirmed. The check must NOT claim everything is consistent.
    expect(check.state, "an empty Scope Map with a referencing record must not be a false ok").not.toBe("ok");
    expect(["warn", "fail"]).toContain(check.state);
  });
});
