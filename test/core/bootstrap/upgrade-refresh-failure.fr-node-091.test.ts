import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-091 — the refresh-failure branch, recorded as an untested branch and found on inspection to
// be an unreachable one.
//
// `upgrade` maps `!initResult.ok` to UPGRADE_REFRESH_FAILED. Nothing can reach it: initProject returns
// only a success result, and the lock it would otherwise fail on is skipped because upgrade already
// holds it. The branch exists because MutationResult is a union, so the check is a type obligation.
// Adding a production seam purely to drive it would put test-only indirection into the command.
//
// What is worth pinning is the pair of facts that make that safe: the branch has no live trigger, and
// a real filesystem failure is caught at the CLI boundary and reported with a non-zero exit rather
// than escaping as an unhandled rejection.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

describe("FR-NODE-091 — the refresh-failure branch has no live trigger", () => {
  it("returns a success result from initProject under the options upgrade passes", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const result = await initProject(await resolveProjectRoot(rootPath), {
      dryRun: false,
      skipLock: true,
      installSkills: false,
      registerMcp: false
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBeDefined();
  });

  it("returns a success result on a dry run too, which is upgrade's default", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const result = await initProject(await resolveProjectRoot(rootPath), {
      dryRun: true,
      skipLock: true,
      installSkills: false,
      registerMcp: false
    });

    expect(result.ok).toBe(true);
  });
});

describe("FR-NODE-091 — a filesystem failure is reported, not thrown", () => {
  it("reports an unreadable spec document as a failure with a non-zero exit", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // A directory where a document belongs: the read fails with EISDIR at a point no branch anticipates.
    const appendix = path.join(rootPath, "docs", "spec", "90.appendix.md");
    await rm(appendix);
    await mkdir(appendix, { recursive: true });

    const streams = io();
    const code = await main(["--root", rootPath, "upgrade", "--apply", "--json"], streams);

    expect(code).not.toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(false);
    expect(typeof output.error?.code).toBe("string");
    expect(output.error.message).toContain("90.appendix.md");
  });
});
