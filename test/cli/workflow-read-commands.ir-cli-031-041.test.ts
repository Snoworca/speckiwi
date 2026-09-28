import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";
import { editIndex, eventLine, jsonl, readText, runCli, treeDigest, writeText, type Json } from "../support/workflow-harness.js";

// @req IR-CLI-031 — the CLI workflow reads; @req IR-CLI-041 — the CLI pipeline projections and
// work-order profiles.

const PROJECTION_COMMANDS = [
  ["workflow", "pipeline", "status"],
  ["workflow", "pipeline", "tail"],
  ["workflow", "pipeline", "compact"],
  ["workflow", "pipeline-status"],
  ["workflow", "pipeline-tail"],
  ["workflow", "pipeline-compact"]
] as const;

function value(json: Json): Json {
  return json.value as Json;
}

/** A second SDS for another target, so a target selector has something to tell apart. */
async function writeSdsForTarget(root: string, sdsId: string, target: string): Promise<string> {
  const relativePath = `docs/sds/${sdsId}.sds.md`;
  const source = await readText(root, "docs/sds/fresh-run.sds.md");
  await writeText(root, relativePath, source.replace("| Target | v1.0.0 |", `| Target | ${target} |`).replace("# SDS: fresh-run", `# SDS: ${sdsId}`));
  return relativePath;
}

describe("IR-CLI-031 AC-5 — CLI workflow reads cover a target mismatch", () => {
  it("IR-CLI-031 AC-5: a target selector prefers the matching artifact and scores the mismatching one below it", async () => {
    const fixture = await createWorkflowFixture();
    const otherPath = await writeSdsForTarget(fixture.root, "other-target", "v2.0.0");

    const forOther = await runCli(fixture.root, ["workflow", "latest", "--kind", "sds", "--target", "v2.0.0"]);
    expect(forOther.code).toBe(0);
    expect(value(forOther.json).selected).toMatchObject({ relativePath: otherPath, target: "v2.0.0" });

    const forFixture = await runCli(fixture.root, ["workflow", "artifacts", "--kind", "sds", "--target", "v1.0.0"]);
    const listed = value(forFixture.json).artifacts as Array<{ relativePath: string; target?: string; score: number }>;
    const mismatched = listed.find((item) => item.relativePath === otherPath);
    const matched = listed.find((item) => item.relativePath === fixture.freshSdsPath);
    expect(mismatched?.target).toBe("v2.0.0");
    expect(matched?.target).toBe("v1.0.0");
    expect(mismatched!.score).toBeLessThan(matched!.score);
    expect(value(forFixture.json).selected).toMatchObject({ target: "v1.0.0" });
  });
});

describe("IR-CLI-041 AC-1 — the CLI pipeline projections carry no raw body by default", () => {
  it("IR-CLI-041 AC-1: pipeline status, tail and compact return the compact envelope with no body", async () => {
    const fixture = await createWorkflowFixture();
    const before = await treeDigest(fixture.root);
    for (const command of PROJECTION_COMMANDS) {
      const run = await runCli(fixture.root, [...command]);
      expect(run.code, command.join(" ")).toBe(0);
      expect(run.json, command.join(" ")).toMatchObject({ ok: true, value: expect.any(Object), meta: expect.any(Object), artifacts: expect.any(Array), diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) });
      expect(JSON.stringify(run.json), command.join(" ")).not.toContain('"body"');
      expect(JSON.stringify(run.json), command.join(" ")).not.toContain("SDS-AC-1");
    }
    // The opt-in exists for artifact reads, which is how the body is shown to be the thing omitted.
    const resolved = await runCli(fixture.root, ["workflow", "resolve", "--path", fixture.sdsPath, "--include-body"]);
    expect(JSON.stringify(resolved.json)).toContain("SDS-AC-1");
    expect(await treeDigest(fixture.root)).toEqual(before);
  });

  it("IR-CLI-041 AC-1: status and compact answer with the latest event, not the journal's text", async () => {
    const fixture = await createWorkflowFixture();
    const early = "EARLY-LINE-THAT-ONLY-A-BODY-WOULD-CARRY";
    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-early", "TASK_DONE", { summary: early }), eventLine("run-late")));
    for (const command of [["workflow", "pipeline", "status"], ["workflow", "pipeline", "compact"]]) {
      const run = await runCli(fixture.root, command);
      expect((value(run.json).latestEvent as { event: Json }).event.run_id, command.join(" ")).toBe("run-late");
      expect(JSON.stringify(run.json), command.join(" ")).not.toContain(early);
    }
    // The control: the same line is reachable, through the tail, when it is asked for.
    expect(JSON.stringify((await runCli(fixture.root, ["workflow", "pipeline", "tail"])).json)).toContain(early);
  });
});

describe("IR-CLI-041 AC-3 — the CLI projections and profiles fail closed", () => {
  it("IR-CLI-041 AC-3: an invalid artifact and an unsupported schema version each make the compact projection block", async () => {
    const fixture = await createWorkflowFixture();
    const invalid = await runCli(fixture.root, ["workflow", "pipeline", "compact"]);
    expect(value(invalid.json)).toMatchObject({ blocking: true, outcomeCodes: expect.arrayContaining(["invalid_artifact"]) });

    await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a", "TASK_DONE", { schema_version: "2.0.0" })));
    const unsupported = await runCli(fixture.root, ["workflow", "pipeline", "compact"]);
    expect(value(unsupported.json)).toMatchObject({ blocking: true, outcomeCodes: ["unsupported_schema_version"] });
  });

  for (const [status, action] of [["FAILED", "blocked"], ["NEEDS_USER", "ask-user"]] as const) {
    it(`IR-CLI-041 AC-3: an active ${status} pipeline state blocks the compact projection and the explain and compact profiles`, async () => {
      const fixture = await createWorkflowFixture();
      await writeText(fixture.root, "kiwi/pipeline.jsonl", jsonl(eventLine("run-a"), eventLine("run-b", status)));

      const compact = await runCli(fixture.root, ["workflow", "pipeline-compact"]);
      expect(value(compact.json)).toMatchObject({ latestStatus: status, blocking: true });

      for (const profile of [["--explain"], ["--profile", "compact"], ["--context-profile", "compact"]]) {
        const order = await runCli(fixture.root, ["workflow", "work-order", "next", "--path", fixture.freshSdsPath, ...profile]);
        expect(order.json, profile.join(" ")).toMatchObject({ action, blocking: true, pipeline: { latestStatus: status } });
      }
    });
  }

  it("IR-CLI-041 AC-3: an invalid SDS artifact makes the explain and compact profiles block with fix-artifact", async () => {
    const fixture = await createWorkflowFixture();
    for (const profile of [["--explain"], ["--profile", "compact"]]) {
      const control = await runCli(fixture.root, ["workflow", "work-order", "next", "--path", fixture.freshSdsPath, ...profile]);
      expect(control.json, profile.join(" ")).toMatchObject({ action: "execute-sds", blocking: false });
      const invalid = await runCli(fixture.root, ["workflow", "work-order", "next", "--path", fixture.invalidSdsPath, ...profile]);
      expect(invalid.json, profile.join(" ")).toMatchObject({ action: "fix-artifact", blocking: true });
    }
  });

  it("IR-CLI-041 AC-3: an ambiguous target state — two active Target Map rows — blocks the profiles", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const control = await runCli(root, ["workflow", "work-order", "next", "--explain"]);
    expect(control.json).toMatchObject({ action: "create-sds", blocking: false });

    await editIndex(root, { extraTargetRows: ["| v2.0.0 | release | active | A second active row |"] });
    const ambiguous = await runCli(root, ["workflow", "work-order", "next", "--explain"]);
    expect(ambiguous.json).toMatchObject({
      action: "blocked",
      blocking: true,
      decisionTrace: expect.arrayContaining([
        expect.objectContaining({ step: "target", reason: expect.stringContaining("SRS-E024") }),
        expect.objectContaining({ step: "decision", outcome: "blocked" })
      ]),
      blockers: expect.arrayContaining([expect.objectContaining({ code: "SRS-E024" })])
    });
  });

  // The CLI names its workspace with --root or discovers it deterministically, so it has no ambiguous
  // workspace identity to refuse; what it does is refuse a root that holds no SRS instead of guessing.
  it("IR-CLI-041 AC-3: a root that holds no SRS index is refused rather than answered with a guess", async () => {
    const noSrs = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-041-"));
    try {
      const refused = await runCli(noSrs, ["workflow", "work-order", "next", "--profile", "compact"]);
      expect(refused.code).not.toBe(0);
      expect(refused.json).toMatchObject({ ok: false, error: { code: "WORKSPACE_PARSE_ERROR" } });
      expect(refused.json).not.toHaveProperty("action");
    } finally {
      await rm(noSrs, { recursive: true, force: true });
    }
  });
});
