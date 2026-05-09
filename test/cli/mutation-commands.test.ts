import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("mutation CLI commands", () => {
  it("updates status, AC, evidence, trace, and adds requirements", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const cases = [
      ["--root", root, "check-ac", "FR-ARCH-001", "--all"],
      ["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--reference", "test/cli/mutation-commands.test.ts", "--covers", "all"],
      ["--root", root, "add-trace", "FR-ARCH-001", "--type", "Requirement", "--reference", "FR-ARCH-001", "--relation", "self"],
      ["--root", root, "update-status", "FR-ARCH-001", "verified"],
      [
        "--root",
        root,
        "add-requirement",
        "--type",
        "functional",
        "--scope",
        "ARCH",
        "--target",
        "v1.0.0",
        "--title",
        "CLI 추가",
        "--requirement",
        "CLI가 요구사항을 추가한다.",
        "--ac",
        "created"
      ]
    ];
    for (const args of cases) {
      expect(await main(args, io())).toBe(0);
    }
    expect(await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).toContain("### FR-ARCH-002 — CLI 추가");
  });

  it("supports init options and add-requirement dry-run", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    expect(await main(["--root", root, "init", "--target", "v1.0.0", "--scope", "ARCH", "--force"], io())).toBe(0);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
    expect(
      await main(
        [
          "--root",
          root,
          "add-requirement",
          "--type",
          "functional",
          "--scope",
          "ARCH",
          "--target",
          "v1.0.0",
          "--title",
          "Dry Run",
          "--requirement",
          "Dry run only.",
          "--ac",
          "previewed",
          "--dry-run"
        ],
        io()
      )
    ).toBe(0);
    expect(await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).not.toContain("Dry Run");
  });

  it("passes init scope to generated files on empty repositories", async () => {
    const temp = await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "speckiwi-cli-init-")));
    expect(await main(["--root", temp, "init", "--target", "v2.0.0", "--scope", "Payments:PAY"], io())).toBe(0);
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("10.payments.srs.md");
    expect(await readFile(path.join(temp, "AGENTS.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
    expect(await readFile(path.join(temp, "CLAUDE.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
  });

  it("rejects removed init agent-file option", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const errors: string[] = [];
    streams.stderr.on("data", (chunk) => errors.push(String(chunk)));
    expect(await main(["--root", root, "init", "--agent-file", "both"], streams)).not.toBe(0);
    expect(errors.join("")).toContain("unknown option '--agent-file'");
  });
});
