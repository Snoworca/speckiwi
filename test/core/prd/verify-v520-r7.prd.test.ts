import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatPrdPointer, parsePrdPointer } from "../../../src/core/prd/pointer.js";
import { cliJson, mcp, writePrd } from "../../cli/prd-surface-fixture.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { buildPrd } from "./prd-fixture.js";

// Round 7 of the 5.2.0 PRD tool verification: a pointer the writer builds must parse back. A file
// name may hold U+2028 or U+2029 (legal on NTFS and POSIX file systems), which `.` in the pointer
// pattern does not match, so the cursor refuses the PRD's own pointer.

const bytes = Buffer.from("x", "utf8");
const hex = createHash("sha256").update(bytes).digest("hex");

describe("verify 5.2.0 round 7 — PRD pointer round trip", () => {
  // @req FR-NODE-240 AC-3, FR-NODE-241 AC-4
  it.each(["docs/prd/a b.prd.md", "docs/prd/a b.prd.md"])("parses back the path and hash of a pointer the writer built for %j", (prdPath) => {
    expect(parsePrdPointer(formatPrdPointer(prdPath, bytes))).toEqual({ path: prdPath, sha256: hex });
  });

  // @req FR-NODE-241 AC-1
  it("walks the cursor over a PRD file whose name holds U+2028, with the pointer prd check prints, on CLI and MCP", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const prdPath = "docs/prd/a b.prd.md";
    const text = buildPrd();
    await writePrd(root, prdPath, text);
    const pointer = `${prdPath}@sha256:${createHash("sha256").update(text).digest("hex")}`;
    expect((await cliJson<{ prd: string }>(root, "check", prdPath)).json.prd).toBe(pointer);
    const current = await cliJson<{ prd: string; error?: { code: string } }>(root, "cursor", "current", prdPath, "--run-id", "r7");
    expect(current.json.error?.code).toBeUndefined();
    expect(current.code).toBe(0);
    expect(current.json.prd).toBe(pointer);
    expect((await mcp<{ prd: string }>(root, "prd_cursor", { action: "current", path: prdPath, runId: "r7" })).value?.prd).toBe(pointer);
  });
});
