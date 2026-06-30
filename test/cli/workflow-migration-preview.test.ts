import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function stream() {
  return new PassThrough() as NodeJS.WriteStream;
}

function io() {
  return { stdout: stream(), stderr: stream() };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("IR-CLI-040 workflow migrate-preview", () => {
  it("returns read-only legacy migration preview and rejects apply-style flags", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await write(root, "docs/plan/legacy.plan.md", "---\nrun_id: legacy-run\ntarget: v9.9.9\n---\n# Legacy\n");
    await write(root, ".snoworca/sessions/legacy-run/state.json", JSON.stringify({ run_id: "legacy-run", target: "v9.9.9", legacy_only: true }, null, 2));
    await write(root, ".snoworca/sessions/bad/state.json", "{bad\n");
    const legacyPlanPath = path.join(root, "docs/plan/legacy.plan.md");
    const before = await sha256(legacyPlanPath);

    const previewIo = io();
    expect(await main(["--root", root, "workflow", "migrate-preview", "--target", "v1.0.0", "--json"], previewIo)).toBe(0);
    const preview = JSON.parse(previewIo.stdout.read()?.toString() ?? "");

    expect(await sha256(legacyPlanPath)).toBe(before);
    expect(preview).toMatchObject({
      ok: true,
      value: {
        written: false,
        legacyArtifacts: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ relativePath: "docs/plan/legacy.plan.md", sha256: expect.any(String) }),
            proposedDestination: "docs/plans/legacy.plan.md",
            targetMismatch: true
          }),
          expect.objectContaining({
            source: expect.objectContaining({ relativePath: ".snoworca/sessions/legacy-run/state.json" }),
            unsupportedFields: expect.arrayContaining(["legacy_only"])
          })
        ])
      },
      diagnosticsSummary: { byCode: { "SRS-W050": 1 } }
    });
    expect(JSON.stringify(preview)).not.toContain("# Legacy");

    const bodyIo = io();
    expect(await main(["--root", root, "workflow", "migrate-preview", "--run-id", "legacy-run", "--include-body", "--json"], bodyIo)).toBe(0);
    const withBody = JSON.parse(bodyIo.stdout.read()?.toString() ?? "");
    expect(JSON.stringify(withBody)).toContain("# Legacy");

    const applyIo = io();
    expect(await main(["--root", root, "workflow", "migrate-preview", "--apply", "--json"], applyIo)).toBe(5);
    expect(JSON.parse(applyIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      written: false,
      error: { code: "UNSUPPORTED_OPERATION" },
      diagnosticsSummary: { errors: 1, byCode: { UNSUPPORTED_OPERATION: 1 } }
    });
  });
});
