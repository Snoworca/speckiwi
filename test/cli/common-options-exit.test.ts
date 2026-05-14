import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import { main } from "../../src/cli/index.js";
import { formatJsonOutput } from "../../src/core/format/json.js";
import { mapResultToExitCode } from "../../src/cli/exit.js";
import { fail, ok } from "../../src/core/result.js";

const requirePackage = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = requirePackage("../../package.json") as { version: string };

function stream() {
  return new PassThrough() as NodeJS.WriteStream;
}

describe("CLI common framework", () => {
  it("supports help, version, JSON formatting, and registrar extension", async () => {
    const stdout = stream();
    const stderr = stream();
    const command = buildCommand({ io: { stdout, stderr } }, [
      (root) => root.command("ping").action(() => stdout.write(`${formatJsonOutput({ pong: true })}\n`))
    ]);
    await command.parseAsync(["ping"], { from: "user" });
    expect(stdout.read()?.toString()).toContain('"pong":true');
  });

  it("prints version once and exits cleanly", async () => {
    const stdout = stream();
    const stderr = stream();

    expect(await main(["--version"], { stdout, stderr })).toBe(0);
    expect(stdout.read()?.toString()).toBe(`${PACKAGE_VERSION}\n`);
    expect(stderr.read()).toBeNull();
  });

  it("maps result families to SRS exit codes", () => {
    expect(mapResultToExitCode(ok({}))).toBe(0);
    expect(mapResultToExitCode(fail("SRS-E001", "validation"))).toBe(1);
    expect(mapResultToExitCode(fail("USAGE", "usage"))).toBe(2);
    expect(mapResultToExitCode(fail("MUTATION_DENIED", "denied"))).toBe(5);
    expect(mapResultToExitCode(fail("MCP_FATAL", "fatal"))).toBe(6);
  });
});
