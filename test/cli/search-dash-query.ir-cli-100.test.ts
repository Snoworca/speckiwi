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

  // AC-4, the axis the first draft missed entirely. Commander answers --help itself, so the
  // option never appears in the command's own options array and the first normalizer searched
  // for the string "--help". Options declared on the parent were invisible for the same reason,
  // which broke `search --root <path> <query>` — a form with no dash-leading query at all.
  it("AC-4: --help still prints usage instead of being searched for", async () => {
    for (const flag of ["--help", "-h"]) {
      const result = await run(["search", flag]);
      expect(result.stdout, `search ${flag}`).toMatch(/^Usage: /m);
      expect(result.stdout, `search ${flag}`).not.toMatch(/"records"/);
    }
  });

  it("AC-4: a global option after the subcommand is still an option", async () => {
    // A root that does not exist proves --root was consumed: the run fails on the workspace, not
    // on argument counting. Reading it as the query would leave two operands instead.
    const result = await run(["search", "--root", "/nonexistent-xyz", "--json", "CON-ARCH-001"]);
    expect(result.stderr + result.stdout).not.toMatch(/too many arguments/);
  });

  it("AC-4: quiet and no-color after the subcommand are still options", async () => {
    for (const flag of ["--quiet", "--no-color"]) {
      const result = await run(["search", flag, "--json", "CON-ARCH-001"]);
      expect(result.stderr + result.stdout, `search ${flag}`).not.toMatch(/too many arguments/);
      expect(result.code, `search ${flag}`).toBe(0);
    }
  });

  it("AC-4: --version is answered, not searched for", async () => {
    const result = await run(["search", "--version"]);
    expect(result.stdout).not.toMatch(/"records"/);
  });

  // A plain operand must not be reordered: only a dash-leading token is lifted out.
  it("AC-4: an ordinary query is left where it was", async () => {
    const plain = await run(["search", "--json", "CON-ARCH-001"]);
    expect(plain.code).toBe(0);
    expect((JSON.parse(plain.stdout) as { records: unknown[] }).records.length).toBeGreaterThan(0);
  });
  // AC-1 for the form where a global option comes BEFORE the command name. The second draft
  // looked for the command at argv[0], so `speckiwi --root <path> search --force` never entered
  // the normaliser at all. This form is not hypothetical: the orchestrate command re-enters the
  // CLI with --root ahead of the command name.
  it("AC-1: a global option before the command name still leaves the query searchable", async () => {
    const result = await run(["--root", ".", "search", "--json", FLAG_QUERY]);
    expect(result.stderr).not.toMatch(/unknown option/);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { records?: unknown[] };
    expect(parsed.records!.length).toBeGreaterThan(0);
  });

  it("AC-1: the same holds for value-less globals before the command name", async () => {
    for (const flag of ["--quiet", "--no-color"]) {
      const result = await run([flag, "search", "--json", FLAG_QUERY]);
      expect(result.stderr, `${flag} before search`).not.toMatch(/unknown option/);
      expect(result.code, `${flag} before search`).toBe(0);
    }
  });

  it("AC-2: a global before the command gives the same result as the escaped form", async () => {
    const bare = await run(["--root", ".", "search", "--json", FLAG_QUERY]);
    const escaped = await run(["--root", ".", "search", "--json", "--", FLAG_QUERY]);
    expect(JSON.parse(bare.stdout)).toEqual(JSON.parse(escaped.stdout));
  });
  // AC-5: absence reads as absence, not as rejection.
  it("AC-5: a dash-leading query that matches nothing returns an empty result", async () => {
    const result = await run(["search", "--json", ABSENT_QUERY]);
    expect(result.stderr).not.toMatch(/unknown option/);
    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as { records: unknown[] }).records).toEqual([]);
  });
});
