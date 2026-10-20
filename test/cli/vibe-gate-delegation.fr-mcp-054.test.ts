import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import type { VibeGateStatus } from "../../src/core/query/vibe-gate.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-MCP-054 AC-4 — `speckiwi vibe-gate check` delegates to the extracted core function.
 *
 * The core function is replaced by a stub whose answer no real workspace can produce. The CLI can only
 * print that answer by calling the core function; a CLI carrying its own copy of the gate would
 * answer from the fixture instead. The existing IR-CLI-049 / IR-CLI-072 suites stay green beside it.
 */

const answer = vi.hoisted(() => ({ current: undefined as VibeGateStatus | undefined }));

vi.mock("../../src/core/query/vibe-gate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/query/vibe-gate.js")>();
  return { ...actual, evaluateVibeGate: async () => answer.current as VibeGateStatus };
});

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function check(): Promise<{ code: number; json: Record<string, unknown> }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const streams = io();
  const code = await main(["--root", root, "vibe-gate", "check", "--json"], streams);
  return { code, json: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Record<string, unknown> };
}

describe("FR-MCP-054 AC-4 — the CLI vibe-gate check delegates to the core query", () => {
  it("FR-MCP-054 AC-4: a blocked answer from the core function is what the CLI reports, with exit 1", async () => {
    answer.current = { mode: "tdd", activeTask: "SENTINEL-TASK", blocked: true, blockedReason: "sentinel reason from the core query" };
    const { code, json } = await check();
    expect(code).toBe(1);
    expect(json).toMatchObject({ ok: false, error: { message: "sentinel reason from the core query" } });
  });

  it("FR-MCP-054 AC-4: an unblocked answer from the core function is what the CLI reports, with exit 0", async () => {
    answer.current = { mode: "vibe", activeTask: "SENTINEL-TASK", blocked: false };
    const { code, json } = await check();
    expect(code).toBe(0);
    expect(json).toMatchObject({ ok: true, value: { mode: "vibe", activeTask: "SENTINEL-TASK", blocked: false } });
  });
});
