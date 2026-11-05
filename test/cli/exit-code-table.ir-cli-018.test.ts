import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLI_EXIT_CODES, ORCHESTRATE_EXIT_CODES, exitCodeFor } from "../../src/cli/exit.js";

// IR-CLI-018 — the process exit codes live in one table, `src/cli/exit.ts`; the read and orchestrate
// commands read them from it instead of writing the numbers where they exit.

const EXIT_LITERAL = /exitCode"?\s*[:,]\s*\d|EXIT_[A-Z_]+\s*=\s*\d/g;

describe("IR-CLI-018 one exit-code table", () => {
  // @req IR-CLI-018
  it("IR-CLI-018 read.ts and orchestrate.ts write no exit code as a number", async () => {
    for (const file of ["src/cli/commands/read.ts", "src/cli/commands/orchestrate.ts"]) {
      const source = await readFile(path.join(process.cwd(), file), "utf8");
      expect(source.match(EXIT_LITERAL) ?? [], file).toEqual([]);
    }
  });

  // @req IR-CLI-018
  it("IR-CLI-018 the table keeps the values the commands exited with", () => {
    expect([exitCodeFor("VALIDATION"), exitCodeFor("USAGE"), exitCodeFor("NOT_FOUND"), exitCodeFor("MUTATION_DENIED")]).toEqual([1, 2, 5, 5]);
    expect(CLI_EXIT_CODES.VALIDATION).toBe(1);
    expect(ORCHESTRATE_EXIT_CODES).toEqual({ OK: 0, OPERATIONAL_ERROR: 1, REPORTED_ERRORS: 1, GATE_REFUSAL: 2 });
  });
});
