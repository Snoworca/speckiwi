import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
      ["--root", root, "set-active-target", "v1.1.0"],
      ["--root", root, "update-status", "FR-ARCH-001", "verified"],
      ["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "CLI completed work row.", "--target", "v1.1.0", "--scope", "ARCH", "--requirements", "FR-ARCH-001"],
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
    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("| Active Target | v1.1.0 |");
    expect(index).toContain("| v1.0.0 | release | planned | Fixture release |");
    expect(index).toContain("| v1.1.0 | version | active | Next fixture target |");
    expect(index).toContain("| 2026-05-10 | v1.1.0 | ARCH | FR-ARCH-001 | CLI completed work row. |");
    const scopeText = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(scopeText).toContain("### FR-ARCH-002 — CLI 추가");
    expect(scopeText).toContain("| Stability | draft |");

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
          "CLI volatile",
          "--requirement",
          "CLI must reject legacy stability for new requirements.",
          "--ac",
          "rejected",
          "--stability",
          "volatile"
        ],
        io()
      )
    ).toBe(5);
    expect(await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).not.toContain("CLI volatile");
  });

  it("supports init options and add-requirement dry-run", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    expect(await main(["--root", root, "init", "--target", "v1.0.0", "--scope", "ARCH", "--force"], io())).toBe(0);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
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
    const dryRun = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "Dry run completed work.", "--dry-run", "--json"], dryRun)).toBe(0);
    expect(JSON.parse(dryRun.stdout.read()?.toString() ?? "")).toMatchObject({ ok: true, value: { written: false }, patch: { dryRun: true } });
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).not.toContain("Dry run completed work.");

    const denied = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "Bad | row", "--json"], denied)).toBe(5);
    expect(JSON.parse(denied.stdout.read()?.toString() ?? "")).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });

    const incompleteDenied = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "Incomplete row", "--requirements", "FR-ARCH-001", "--json"], incompleteDenied)).toBe(5);
    expect(JSON.parse(incompleteDenied.stdout.read()?.toString() ?? "")).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });

    const incompleteAllowed = io();
    expect(
      await main(["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "Allowed incomplete row", "--requirements", "FR-ARCH-001", "--allow-incomplete", "--dry-run", "--json"], incompleteAllowed)
    ).toBe(0);
    expect(JSON.parse(incompleteAllowed.stdout.read()?.toString() ?? "")).toMatchObject({ ok: true, value: { written: false }, patch: { dryRun: true } });
  });

  it("passes init scope to generated files on empty repositories", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "speckiwi-cli-init-"));
    expect(await main(["--root", temp, "init", "--target", "v2.0.0", "--scope", "Payments:PAY"], io())).toBe(0);
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("10.payments.srs.md");
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("| v2.0.0 | release | planned | Initial target |");
    expect(await readFile(path.join(temp, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
    expect(await readFile(path.join(temp, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.2");
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
