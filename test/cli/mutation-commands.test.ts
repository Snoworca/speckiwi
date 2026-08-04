import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import {
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION
} from "../../src/core/bootstrap/templates.js";

// FR-NODE-086 turned the injected heading English; the expectation follows the shipped constants.
const CURRENT_AGENT_HEADING = `${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`;

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function writeExternalCompletedWorkFile(root: string): Promise<void> {
  await writeFile(
    path.join(root, "docs", "spec", "05.completed-work.md"),
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      "| 2026-05-12 | v1.0.0 | ARCH | FR-ARCH-001 | Existing external CLI row. | docs/reports/existing.md |"
    ].join("\n"),
    "utf8"
  );
}

async function writeSrsLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        owner: "cli-test",
        operation: "update_status",
        requestId: "cli-lock",
        acquiredAt: new Date(Date.now()).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

describe("mutation CLI commands", () => {
  it("exposes dry-run mutation envelopes for AC, evidence, and trace commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const scopePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(scopePath, "utf8");

    const acDryRun = io();
    expect(await main(["--root", root, "check-ac", "FR-ARCH-001", "--all", "--dry-run", "--json"], acDryRun)).toBe(0);
    expect(JSON.parse(acDryRun.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      mutation: {
        kind: "check_acceptance_criteria",
        dryRun: true,
        written: false,
        filePath: "docs/spec/10.product-architecture.srs.md"
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    const evidenceDryRun = io();
    expect(
      await main(
        [
          "--root",
          root,
          "add-evidence",
          "FR-ARCH-001",
          "--type",
          "test",
          "--reference",
          "test/cli/mutation-commands.test.ts",
          "--notes",
          "cli dry-run note",
          "--dry-run",
          "--json"
        ],
        evidenceDryRun
      )
    ).toBe(0);
    expect(JSON.parse(evidenceDryRun.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      mutation: {
        kind: "add_verification_evidence",
        dryRun: true,
        written: false,
        preview: [expect.stringContaining("cli dry-run note")]
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    const evidenceRefAlias = io();
    expect(await main(["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--ref", "test/cli/mutation-commands.test.ts", "--dry-run", "--json"], evidenceRefAlias)).toBe(0);
    expect(JSON.parse(evidenceRefAlias.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      mutation: { kind: "add_verification_evidence", dryRun: true, written: false }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    const traceDryRun = io();
    expect(
      await main(["--root", root, "add-trace", "FR-ARCH-001", "--type", "Requirement", "--ref", "FR-ARCH-001", "--relation", "self", "--notes", "trace alias note", "--dry-run", "--json"], traceDryRun)
    ).toBe(0);
    expect(JSON.parse(traceDryRun.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      mutation: {
        kind: "add_trace_link",
        dryRun: true,
        written: false,
        preview: [expect.stringContaining("trace alias note")]
      }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    const traceReferenceAlias = io();
    expect(await main(["--root", root, "add-trace", "FR-ARCH-001", "--type", "Requirement", "--reference", "FR-ARCH-001", "--relation", "self", "--dry-run", "--json"], traceReferenceAlias)).toBe(0);
    expect(JSON.parse(traceReferenceAlias.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      mutation: { kind: "add_trace_link", dryRun: true, written: false }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);
  });

  it("preserves dry-run mutation envelopes for existing mutation commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const scopePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const beforeIndex = await readFile(indexPath, "utf8");
    const beforeScope = await readFile(scopePath, "utf8");
    const cases = [
      {
        args: ["--root", root, "uncheck-ac", "FR-ARCH-001", "--all", "--dry-run", "--json"],
        expected: { value: { id: "FR-ARCH-001", written: false, checked: false }, mutation: { kind: "check_acceptance_criteria", dryRun: true, written: false } }
      },
      {
        args: ["--root", root, "update-status", "FR-ARCH-001", "implemented", "--dry-run", "--json"],
        expected: { value: { id: "FR-ARCH-001", status: "implemented", written: false }, mutation: { kind: "update_status", dryRun: true, written: false } }
      },
      {
        args: ["--root", root, "set-active-target", "v1.1.0", "--dry-run", "--json"],
        expected: { value: { activeTarget: "v1.1.0", written: false }, mutation: { kind: "set_active_target", dryRun: true, written: false } }
      },
      {
        args: ["--root", root, "set-target-goal", "v1.0.0", "--goal", "Fixture target goal.", "--dry-run", "--json"],
        expected: { value: { target: "v1.0.0", goal: "Fixture target goal.", written: false }, mutation: { kind: "set_target_goal", dryRun: true, written: false } }
      }
    ];

    for (const testCase of cases) {
      const streams = io();
      expect(await main(testCase.args, streams)).toBe(0);
      expect(JSON.parse(streams.stdout.read()?.toString() ?? "")).toMatchObject({
        ok: true,
        diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
        ...testCase.expected
      });
      await expect(readFile(indexPath, "utf8")).resolves.toBe(beforeIndex);
      await expect(readFile(scopePath, "utf8")).resolves.toBe(beforeScope);
    }
  });

  it("returns structured JSON errors for malformed table-cell mutation input before writing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const scopePath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(scopePath, "utf8");

    const denied = io();
    expect(await main(["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--reference", "bad|cell", "--json"], denied)).toBe(5);
    expect(JSON.parse(denied.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);

    const traceDenied = io();
    expect(await main(["--root", root, "add-trace", "FR-ARCH-001", "--type", "Requirement", "--reference", "FR-ARCH-001", "--relation", "bad|relation", "--json"], traceDenied)).toBe(5);
    expect(JSON.parse(traceDenied.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} }
    });
    await expect(readFile(scopePath, "utf8")).resolves.toBe(before);
  });

  it("updates status, AC, evidence, trace, and adds requirements", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const cases = [
      ["--root", root, "check-ac", "FR-ARCH-001", "--all"],
      // FR-NODE-174: the reference is resolved against the fixture workspace, not this repository, so
      // citing this test file would name nothing and the verified transition would be refused.
      ["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--reference", "docs/spec/00.index.md", "--covers", "all"],
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
    const historyLog = await readFile(path.join(root, "docs", "spec", "91.completed-work-log.md"), "utf8");
    expect(historyLog).toContain("| 2026-05-10 | v1.1.0 | ARCH | FR-ARCH-001 | CLI completed work row. |");
    expect(index).not.toContain("| 2026-05-10 | v1.1.0 | ARCH | FR-ARCH-001 | CLI completed work row. |");
    const scopeText = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(scopeText).toContain("### FR-ARCH-002 — CLI 추가");
    expect(scopeText).toContain("| Stability | draft |");

    const createdTarget = io();
    expect(await main(["--root", root, "set-active-target", "v2.3.0", "--create", "--type", "version", "--description", "Tool improvement", "--json"], createdTarget)).toBe(0);
    expect(JSON.parse(createdTarget.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { activeTarget: "v2.3.0", created: true, written: true }
    });
    const defaultedTarget = io();
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
          "--title",
          "CLI target default",
          "--requirement",
          "CLI defaults omitted target from Active Target.",
          "--ac",
          "created",
          "--json"
        ],
        defaultedTarget
      )
    ).toBe(0);
    expect(JSON.parse(defaultedTarget.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { targetSource: "active-target", record: { target: "v2.3.0", metadata: { Target: "v2.3.0" } } }
    });

    const emptyTargetRoot = await copyFixtureWorkspace("mutation-target");
    const emptyIndexPath = path.join(emptyTargetRoot, "docs", "spec", "00.index.md");
    await writeFile(emptyIndexPath, (await readFile(emptyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const emptyTarget = io();
    expect(
      await main(
        [
          "--root",
          emptyTargetRoot,
          "add-requirement",
          "--type",
          "functional",
          "--scope",
          "ARCH",
          "--title",
          "CLI no target",
          "--requirement",
          "CLI must fail when neither explicit target nor Active Target exists.",
          "--ac",
          "rejected",
          "--json"
        ],
        emptyTarget
      )
    ).toBe(5);
    expect(JSON.parse(emptyTarget.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "USAGE", message: expect.stringContaining("Active Target is empty") }
    });

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
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain(CURRENT_AGENT_HEADING);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain(CURRENT_AGENT_HEADING);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("Agents MUST follow TDD for behavior changes");
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
    expect(JSON.parse(dryRun.stdout.read()?.toString() ?? "")).toMatchObject({ ok: true, value: { written: false, reportPaths: [] }, patch: { dryRun: true } });
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

  it("supports repeatable completed-work report options and human output compatibility", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const json = io();
    expect(
      await main(
        [
          "--root",
          root,
          "add-completed-work",
          "--date",
          "2026-05-10",
          "--summary",
          "CLI report path row.",
          "--report",
          "docs/reports/report-a.md",
          "--report",
          "docs/reports/report-a.md",
          "--json"
        ],
        json
      )
    ).toBe(0);
    expect(JSON.parse(json.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: {
        reportPaths: ["docs/reports/report-a.md", "docs/reports/report-a.md"]
      }
    });
    await expect(readFile(path.join(root, "docs", "spec", "91.completed-work-log.md"), "utf8")).resolves.toContain(
      "| 2026-05-10 |  |  |  | CLI report path row. | docs/reports/report-a.md, docs/reports/report-a.md |"
    );

    const humanEmpty = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-11", "--summary", "No report paths."], humanEmpty)).toBe(0);
    expect(humanEmpty.stdout.read()?.toString() ?? "").not.toContain("reportPaths");

    const humanNonEmpty = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-12", "--summary", "Human report paths.", "--report", "docs/reports/human.md"], humanNonEmpty)).toBe(0);
    expect(humanNonEmpty.stdout.read()?.toString() ?? "").toContain("docs/reports/human.md");

    const dryRun = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-13", "--summary", "Dry-run report path.", "--report", "docs/reports/dry-run.md", "--dry-run", "--json"], dryRun)).toBe(0);
    expect(JSON.parse(dryRun.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { written: false, reportPaths: ["docs/reports/dry-run.md"] },
      patch: { dryRun: true }
    });
    await expect(readFile(path.join(root, "docs", "spec", "91.completed-work-log.md"), "utf8")).resolves.not.toContain("Dry-run report path.");
  });

  it("rejects invalid completed-work report options before writing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    for (const reportPath of [
      "",
      "   ",
      "/absolute.md",
      "./local.md",
      "../escape.md",
      "docs/../escape.md",
      "https://example.com/report.md",
      String.raw`docs\report.md`,
      "docs/report|bad.md",
      "docs/report,extra.md",
      "docs/report\nbad.md",
      "docs/report#fragment.md"
    ]) {
      const streams = io();
      expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-10", "--summary", "Bad report path.", "--report", reportPath], streams)).not.toBe(0);
      expect(streams.stderr.read()?.toString() ?? "").toContain("invalid report path");
      await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
    }
  });

  it("IR-CLI-037 appends completed work to the external log when present", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWorkFile(root);
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const externalPath = path.join(root, "docs", "spec", "05.completed-work.md");
    const beforeIndex = await readFile(indexPath, "utf8");

    const dryRun = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-13", "--summary", "External CLI dry-run.", "--dry-run", "--json"], dryRun)).toBe(0);
    expect(JSON.parse(dryRun.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: {
        written: false,
        completedWorkSource: {
          mode: "external",
          authoritativeFilePath: "docs/spec/05.completed-work.md"
        }
      },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W041" })]),
      mutation: { filePath: "docs/spec/05.completed-work.md", dryRun: true, written: false },
      patch: { filePath: "docs/spec/05.completed-work.md", dryRun: true }
    });
    await expect(readFile(externalPath, "utf8")).resolves.not.toContain("External CLI dry-run.");
    await expect(readFile(indexPath, "utf8")).resolves.toBe(beforeIndex);

    const write = io();
    expect(await main(["--root", root, "add-completed-work", "--date", "2026-05-14", "--summary", "External CLI write.", "--json"], write)).toBe(0);
    expect(JSON.parse(write.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: {
        written: true,
        completedWorkSource: {
          mode: "external",
          authoritativeFilePath: "docs/spec/05.completed-work.md"
        }
      },
      mutation: { filePath: "docs/spec/05.completed-work.md", dryRun: false, written: true },
      patch: { filePath: "docs/spec/05.completed-work.md", dryRun: false }
    });
    await expect(readFile(externalPath, "utf8")).resolves.toContain("| 2026-05-14 |  |  |  | External CLI write. |");
    await expect(readFile(indexPath, "utf8")).resolves.toBe(beforeIndex);
  });

  it("IR-CLI-038 reports SRS locks and supports narrow ignore-lock", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");
    await writeSrsLock(root);

    const denied = io();
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "blocked", "--json"], denied)).toBe(5);
    const deniedOutput = JSON.parse(denied.stdout.read()?.toString() ?? "");
    expect(deniedOutput).toMatchObject({
      ok: false,
      error: {
        code: "SRS_LOCKED",
        lock: {
          owner: "cli-test",
          operation: "update_status",
          requestId: "cli-lock",
          retry: expect.any(Object)
        }
      },
      diagnosticsSummary: { errors: 1, byCode: { "SRS-E065": 1 } }
    });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const preview = io();
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "blocked", "--dry-run", "--json"], preview)).toBe(5);
    expect(JSON.parse(preview.stdout.read()?.toString() ?? "")).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const human = io();
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "blocked"], human)).toBe(5);
    expect(human.stdout.read()?.toString() ?? "").toContain("cli-lock");

    const initDenied = io();
    expect(await main(["--root", root, "init", "--force", "--json"], initDenied)).toBe(5);
    expect(JSON.parse(initDenied.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" }
    });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const unsafeBypass = io();
    expect(await main(["--root", root, "add-evidence", "FR-ARCH-001", "--type", "test", "--reference", "bad|cell", "--ignore-lock", "--json"], unsafeBypass)).toBe(5);
    expect(JSON.parse(unsafeBypass.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    await expect(readFile(specPath, "utf8")).resolves.toBe(before);

    const ignored = io();
    expect(await main(["--root", root, "update-status", "FR-ARCH-001", "blocked", "--ignore-lock", "--json"], ignored)).toBe(0);
    expect(JSON.parse(ignored.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })])
    });
    await expect(readFile(specPath, "utf8")).resolves.toContain("| Status | blocked |");
  });

  it("IR-CLI-038 applies SRS locks to init and allows explicit SRS-only bypass", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "speckiwi-cli-init-lock-"));
    await writeSrsLock(temp);

    const denied = io();
    expect(await main(["--root", temp, "init", "--target", "v2.0.0", "--scope", "Payments:PAY", "--json"], denied)).toBe(5);
    expect(JSON.parse(denied.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "SRS_LOCKED" }
    });
    await expect(readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const ignored = io();
    expect(await main(["--root", temp, "init", "--target", "v2.0.0", "--scope", "Payments:PAY", "--ignore-lock", "--json"], ignored)).toBe(0);
    expect(JSON.parse(ignored.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })])
    });
    await expect(readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).resolves.toContain("01.payments.srs.md");
  });

  it("documents completed-work report options in CLI help", async () => {
    const streams = io();
    expect(await main(["add-completed-work", "--help"], streams)).toBe(0);
    const help = (streams.stdout.read()?.toString() ?? "").replace(/\s+/g, " ");
    expect(help).toContain("--report <path>");
    expect(help).toContain("repeatable");
    expect(help).toContain("stored comma-separated");
    expect(help).toContain("forbids absolute paths");
  });

  it("documents evidence and trace reference aliases in CLI help", async () => {
    for (const commandName of ["add-evidence", "add-trace"]) {
      const streams = io();
      expect(await main([commandName, "--help"], streams)).toBe(0);
      const help = (streams.stdout.read()?.toString() ?? "").replace(/\s+/g, " ");
      expect(help).toContain("--reference <reference>");
      expect(help).toContain("--ref <reference>");
      expect(help).toContain("--dry-run");
    }
  });

  it("passes init scope to generated files on empty repositories", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "speckiwi-cli-init-"));
    expect(await main(["--root", temp, "init", "--target", "v2.0.0", "--scope", "Payments:PAY"], io())).toBe(0);
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("01.payments.srs.md");
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("| Active Target |  |");
    expect(await readFile(path.join(temp, "docs", "spec", "00.index.md"), "utf8")).toContain("| v2.0.0 | release | planned | Initial target |");
    expect(await readFile(path.join(temp, "AGENTS.md"), "utf8")).toContain(CURRENT_AGENT_HEADING);
    expect(await readFile(path.join(temp, "CLAUDE.md"), "utf8")).toContain(CURRENT_AGENT_HEADING);
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
