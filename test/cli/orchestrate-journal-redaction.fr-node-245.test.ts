import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-245 AC-3 — `orchestrate journal append` writes a line's `error` with every shared
// secret-pattern match replaced by the redaction marker. The credential values are fake.

const JOURNAL = "kiwi/waves.jsonl";
const FAKE = "FAKEvalue0000fake";

async function append(root: string, line: Record<string, unknown>): Promise<number> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  return main(["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(line), "--json"], pipes);
}

describe("FR-NODE-245 AC-3 — journal append redacts the error field", () => {
  // @req FR-NODE-245 AC-3
  it("FR-NODE-245 AC-3: the written error carries the marker in place of every match and keeps the rest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-journal-redaction-"));
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, JOURNAL), "", "utf8");
    const error = `POST https://chat.example.invalid/v1/spaces/S/messages?key=${FAKE}&token=${FAKE}9 returned 500; password=${FAKE}`;
    const exit = await append(root, {
      schema_version: "2.0.0",
      run_id: "run-a",
      engine: "kiwi-orchestrator",
      verb: "node-complete-action",
      wave: "wave-1",
      action_id: "report",
      completion_ref: "L2",
      attempt: 1,
      result: "failed",
      error
    });
    expect(exit).toBe(0);
    const text = await readFile(path.join(root, JOURNAL), "utf8");
    expect(text).not.toContain(FAKE);
    const written = JSON.parse(text.trim()) as Record<string, unknown>;
    expect(written.error).toBe("POST https://chat.example.invalid/v1/spaces/S/messages?[REDACTED]&[REDACTED] returned 500; [REDACTED]");
    expect(written.action_id).toBe("report");
  });
});
