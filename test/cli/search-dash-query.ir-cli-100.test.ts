import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req IR-CLI-100 — a query that begins with a dash is a query, not an option. The escape hatch
// already worked, so the escaped form is the oracle: the bare form must agree with it.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = io();
  const code = await main(argv, streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

const FLAG_QUERY = "--force";
const ABSENT_QUERY = "--zzz-no-such-flag-anywhere";

describe("IR-CLI-100 — search takes a dash-leading query", () => {
  // AC-1: it searches, and it succeeds.
  it("AC-1: a dash-leading query is searched for and exits 0", async () => {
    const result = await run(["search", "--json", FLAG_QUERY]);
    expect(result.stderr).not.toMatch(/unknown option/);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { records?: unknown[] };
    expect(Array.isArray(parsed.records)).toBe(true);
    expect(parsed.records!.length).toBeGreaterThan(0);
  });

  // AC-2: the escaped form is the oracle, so the two must agree field for field.
  it("AC-2: the bare form equals the escaped form", async () => {
    const bare = await run(["search", "--json", FLAG_QUERY]);
    const escaped = await run(["search", "--json", "--", FLAG_QUERY]);
    expect(bare.code).toBe(escaped.code);
    expect(JSON.parse(bare.stdout)).toEqual(JSON.parse(escaped.stdout));
  });

  // AC-3: options keep working on either side of the query.
  it("AC-3: options work before and after the query", async () => {
    const before = await run(["search", "--json", "--limit", "1", FLAG_QUERY]);
    const after = await run(["search", FLAG_QUERY, "--json", "--limit", "1"]);
    expect(before.code).toBe(0);
    expect(after.code).toBe(0);
    expect(JSON.parse(after.stdout)).toEqual(JSON.parse(before.stdout));

    const parsed = JSON.parse(before.stdout) as { records?: unknown[] };
    expect(parsed.records!.length, "--limit must still be an option, not part of the query").toBe(1);
  });

  // AC-4: a real option keeps its meaning.
  it("AC-4: a genuine option is not captured as the query", async () => {
    // `--status verified` filters; if it were swallowed as the query, the result would differ.
    const filtered = await run(["search", "--json", "--status", "verified", FLAG_QUERY]);
    const unfiltered = await run(["search", "--json", FLAG_QUERY]);
    expect(filtered.code).toBe(0);

    const filteredRecords = (JSON.parse(filtered.stdout) as { records: Array<{ status: string }> }).records;
    const unfilteredRecords = (JSON.parse(unfiltered.stdout) as { records: unknown[] }).records;
    expect(filteredRecords.every((record) => record.status === "verified")).toBe(true);
    expect(filteredRecords.length).toBeLessThanOrEqual(unfilteredRecords.length);
  });

  // AC-5: absence reads as absence, not as rejection.
  it("AC-5: a dash-leading query that matches nothing returns an empty result", async () => {
    const result = await run(["search", "--json", ABSENT_QUERY]);
    expect(result.stderr).not.toMatch(/unknown option/);
    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as { records: unknown[] }).records).toEqual([]);
  });
});
