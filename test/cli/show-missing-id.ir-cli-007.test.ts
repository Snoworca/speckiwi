import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function text(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

describe("IR-CLI-007 — speckiwi show with an ID that does not exist", () => {
  // @req IR-CLI-007 AC-2
  it("exits with the NOT_FOUND code and names the missing ID in its error", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const json = io();
    expect(await main(["--root", root, "show", "FR-ARCH-999", "--json"], json)).toBe(5);
    expect(JSON.parse(text(json.stdout))).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("FR-ARCH-999") }
    });

    const human = io();
    expect(await main(["--root", root, "show", "FR-ARCH-999"], human)).toBe(5);
    expect(text(human.stdout) + text(human.stderr)).toContain("FR-ARCH-999");
  });
});
