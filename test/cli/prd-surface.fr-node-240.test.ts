import { createHash } from "node:crypto";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { buildPrd, DEFAULT_ITEMS } from "../core/prd/prd-fixture.js";
import { cli, cliJson, mcp, PRD_PATH, prdWorkspace, writePrd } from "./prd-surface-fixture.js";

// FR-NODE-240 — the PRD readers on both surfaces: `speckiwi prd check|items|show|search` and the MCP
// tools check_prd, list_prd_items, get_prd_item, search_prd_items. Each MCP answer is the CLI's JSON.

interface CheckReport {
  path: string;
  prd: string;
  passed: boolean;
  diagnostics: Array<{ code: string; line?: number }>;
  diagnosticsSummary: { errors: number; warnings: number };
}

interface ItemView {
  id: string;
  kind: string;
  quote: string;
  source: string[];
  prd: string;
  path?: string;
}

interface Page {
  total: number;
  offset: number;
  returned: number;
  nextOffset: number | null;
}

function sha(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("FR-NODE-240 AC-1 — prd check / check_prd", () => {
  // @req FR-NODE-240 AC-1
  it("passes a well-formed PRD with exit 0, and the MCP answer equals the CLI JSON", async () => {
    const root = await prdWorkspace();
    const { code, json } = await cliJson<CheckReport>(root, "check", PRD_PATH);
    expect(code).toBe(0);
    expect(json).toMatchObject({ path: PRD_PATH, passed: true, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0 } });
    expect(json.prd).toBe(`${PRD_PATH}@sha256:${sha(buildPrd())}`);
    const answer = await mcp<CheckReport>(root, "check_prd", { path: PRD_PATH });
    expect(answer.ok).toBe(true);
    expect(answer.value).toEqual(json);
  });

  // @req FR-NODE-240 AC-1
  it("reports each fault with its own PRD code, exits 1, and lists each diagnostic once over MCP", async () => {
    const items = DEFAULT_ITEMS.map((item, position) => (position === 1 ? { ...item, number: 3, rows: { ...item.rows, Kind: "feature" } } : item));
    const root = await prdWorkspace({ items });
    const { code, json } = await cliJson<CheckReport>(root, "check", PRD_PATH);
    expect(code).toBe(1);
    expect(json.passed).toBe(false);
    expect(json.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["PRD-E001", "PRD-E003"]));
    expect(json.diagnosticsSummary.errors).toBe(json.diagnostics.length);
    const answer = await mcp<CheckReport>(root, "check_prd", { path: PRD_PATH });
    expect(answer.ok).toBe(true);
    expect(answer.value).toEqual(json);
    // @req FR-MCP-070 AC-1 — the value holds the entries; the envelope does not repeat them.
    expect(answer.diagnostics).toBeUndefined();
    expect((answer as { diagnosticsSummary?: unknown }).diagnosticsSummary).toEqual(json.diagnosticsSummary);
    expect(JSON.stringify(answer).split('"code":"PRD-E003"').length - 1).toBe(1);
  });

  // @req FR-NODE-240 AC-1
  it("hashes the file as bytes: a User Request byte that is not UTF-8 still matches a Request SHA256 taken over the bytes", async () => {
    const bytes = Buffer.from(buildPrd(), "utf8");
    const at = bytes.indexOf(Buffer.from("Password reset", "utf8"));
    const raw = Buffer.concat([bytes.subarray(0, at), Buffer.from([0xe9]), bytes.subarray(at)]);
    const folded = raw.toString("latin1");
    const start = folded.indexOf("\n## 1. User Request") + 1;
    const end = folded.indexOf("\n## ", start) + 1;
    const skillHash = createHash("sha256").update(folded.slice(start, end), "latin1").digest("hex");
    const sealed = Buffer.from(folded.replace(/\| Request SHA256 \| [0-9a-f]{64} \|/, `| Request SHA256 | ${skillHash} |`), "latin1");
    const root = await prdWorkspace();
    await writePrd(root, PRD_PATH, sealed);
    const { code, json } = await cliJson<CheckReport>(root, "check", PRD_PATH);
    expect(json.diagnostics.map((item) => item.code)).not.toContain("PRD-E007");
    expect(code).toBe(0);
    expect(json.prd).toBe(`${PRD_PATH}@sha256:${sha(sealed)}`);
    expect((await mcp<CheckReport>(root, "check_prd", { path: PRD_PATH })).value?.prd).toBe(json.prd);
  });

  // @req FR-NODE-240 AC-1
  it("refuses a missing file as NOT_FOUND (exit 5) and a path outside docs/prd as USAGE (exit 2), on both surfaces", async () => {
    const root = await prdWorkspace();
    const missing = await cliJson<{ error: { code: string } }>(root, "check", "docs/prd/none.prd.md");
    expect(missing.code).toBe(5);
    expect(missing.json.error.code).toBe("NOT_FOUND");
    expect((await mcp(root, "check_prd", { path: "docs/prd/none.prd.md" })).error?.code).toBe("NOT_FOUND");
    for (const outside of ["docs/spec/00.index.md", "../outside.prd.md", "docs/prd/../spec/10.product-architecture.srs.md", "docs/prd/notes.md"]) {
      const refused = await cliJson<{ error: { code: string } }>(root, "check", outside);
      expect(refused.code, outside).toBe(2);
      expect(refused.json.error.code, outside).toBe("USAGE");
      expect((await mcp(root, "check_prd", { path: outside })).error?.code, outside).toBe("USAGE");
    }
  });

  // @req FR-NODE-240 AC-1
  it("refuses a PRD path that leaves docs/prd through a directory link", async () => {
    const root = await prdWorkspace();
    const outside = path.join(tmpdir(), `speckiwi-prd-outside-${process.pid}-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    await writePrd(outside, "x.prd.md", buildPrd());
    await symlink(outside, path.join(root, "docs", "prd", "linked"), "junction");
    const refused = await cliJson<{ error: { code: string } }>(root, "check", "docs/prd/linked/x.prd.md");
    expect(refused.json.error.code).toBe("USAGE");
    expect((await mcp(root, "check_prd", { path: "docs/prd/linked/x.prd.md" })).error?.code).toBe("USAGE");
    await import("node:fs/promises").then((fs) => fs.rm(outside, { recursive: true, force: true }));
  });

  // @req FR-NODE-240 AC-1
  it("prints each diagnostic with its code and location in human output", async () => {
    const items = DEFAULT_ITEMS.map((item, position) => (position === 1 ? { ...item, rows: { ...item.rows, Kind: "feature" } } : item));
    const root = await prdWorkspace({ items });
    const { code, stdout } = await cli(root, "check", PRD_PATH);
    expect(code).toBe(1);
    expect(stdout).toMatch(new RegExp(`error PRD-E003 ${PRD_PATH.replace(/\./g, "\\.")}:\\d+`));
  });
});

describe("FR-NODE-240 AC-2 — PRD items stay out of the requirement queries", () => {
  // @req FR-NODE-240 AC-2
  it("leaves list, search and show of requirements unchanged by a PRD file", async () => {
    const root = await prdWorkspace();
    const listed = await mcp<{ records: Array<{ id: string }> }>(root, "list_requirements", {});
    expect(listed.value?.records.map((item) => item.id)).toEqual(["FR-ARCH-001"]);
    const searched = await mcp<{ records: Array<{ id: string }> }>(root, "search_requirements", { query: "비밀번호 재설정" });
    expect(searched.value?.records).toEqual([]);
    expect((await mcp(root, "get_requirement", { id: "PRD-1" })).ok).toBe(false);
  });
});

describe("FR-NODE-240 AC-3 — prd items / list_prd_items and prd show / get_prd_item", () => {
  // @req FR-NODE-240 AC-3
  it("lists items in document order with the requirement list's page fields, on both surfaces", async () => {
    const root = await prdWorkspace();
    const { code, json } = await cliJson<{ items: ItemView[]; page: Page }>(root, "items", PRD_PATH, "--offset", "1", "--limit", "2");
    expect(code).toBe(0);
    expect(json.items.map((item) => item.id)).toEqual(["PRD-2", "PRD-3"]);
    expect(json.page).toMatchObject({ total: 4, offset: 1, returned: 2, nextOffset: 3 });
    const answer = await mcp<{ items: ItemView[]; page: Page }>(root, "list_prd_items", { path: PRD_PATH, offset: 1, limit: 2 });
    expect(answer.value).toEqual(json);
    const all = await cliJson<{ items: ItemView[]; page: Page }>(root, "items", PRD_PATH);
    expect(all.json.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4"]);
    expect(all.json.page).toMatchObject({ total: 4, offset: 0, returned: 4, nextOffset: null });
  });

  // @req FR-NODE-240 AC-3
  it("reads one item with its kind, quote, source and the PRD pointer", async () => {
    const root = await prdWorkspace();
    const { code, json } = await cliJson<ItemView>(root, "show", PRD_PATH, "PRD-3");
    expect(code).toBe(0);
    expect(json).toMatchObject({
      id: "PRD-3",
      kind: "exclusion",
      quote: "소셜 로그인은 이번에 하지 않습니다.",
      source: ["U-2"],
      prd: `${PRD_PATH}@sha256:${sha(buildPrd())}`
    });
    expect((await mcp<ItemView>(root, "get_prd_item", { path: PRD_PATH, id: "PRD-3" })).value).toEqual(json);
  });

  // @req FR-NODE-240 AC-3
  it("refuses an item the PRD does not hold as PRD_ITEM_NOT_FOUND on both surfaces", async () => {
    const root = await prdWorkspace();
    const refused = await cliJson<{ error: { code: string } }>(root, "show", PRD_PATH, "PRD-9");
    expect(refused.code).not.toBe(0);
    expect(refused.json.error.code).toBe("PRD_ITEM_NOT_FOUND");
    expect((await mcp(root, "get_prd_item", { path: PRD_PATH, id: "PRD-9" })).error?.code).toBe("PRD_ITEM_NOT_FOUND");
  });

  // @req FR-NODE-240 AC-3
  it("refuses a negative offset and a non-positive limit as a usage error", async () => {
    const root = await prdWorkspace();
    expect((await cli(root, "items", PRD_PATH, "--offset", "-1")).code).toBe(2);
    expect((await cli(root, "items", PRD_PATH, "--limit", "0")).code).toBe(2);
    expect(toolSchemas.list_prd_items?.limit?.safeParse(0).success).toBe(false);
    expect(toolSchemas.list_prd_items?.offset?.safeParse(-1).success).toBe(false);
  });
});

describe("FR-NODE-240 AC-4 — prd search / search_prd_items", () => {
  // @req FR-NODE-240 AC-4
  it("ranks PRD items for a mixed Korean-English query and reads every PRD under docs/prd unless one file is named", async () => {
    const root = await prdWorkspace();
    const other = "docs/prd/2026-11-05.login.prd.md";
    await writePrd(root, other, buildPrd({ items: [{ title: "Login 화면", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "로그인 화면에 비밀번호 재설정 링크를" }] }));
    const query = "비밀번호 재설정 link";
    const { code, json } = await cliJson<{ items: ItemView[]; page: Page }>(root, "search", query);
    expect(code).toBe(0);
    expect(new Set(json.items.map((item) => item.path))).toEqual(new Set([PRD_PATH, other]));
    expect(json.items[0]).toMatchObject({ match: expect.any(String), score: expect.any(Number) });
    expect((await mcp(root, "search_prd_items", { query })).value).toEqual(json);
    const scoped = await cliJson<{ items: ItemView[] }>(root, "search", query, "--file", other);
    expect(scoped.json.items.map((item) => item.path)).toEqual([other]);
    expect((await mcp(root, "search_prd_items", { query, path: other })).value).toEqual(scoped.json);
  });

  // @req FR-NODE-240 AC-4
  it("answers an empty result, not an error, when docs/prd holds no PRD", async () => {
    const root = await prdWorkspace();
    await import("node:fs/promises").then((fs) => fs.rm(path.join(root, "docs", "prd"), { recursive: true, force: true }));
    expect(await readdir(path.join(root, "docs"))).not.toContain("prd");
    const { code, json } = await cliJson<{ items: unknown[]; page: Page }>(root, "search", "anything");
    expect(code).toBe(0);
    expect(json.items).toEqual([]);
    expect(json.page.total).toBe(0);
  });
});

describe("FR-NODE-240 — MCP classification", () => {
  // @req FR-NODE-240 AC-1
  it("declares the four PRD readers read-only and without a per-call workspace root", () => {
    for (const tool of ["check_prd", "list_prd_items", "get_prd_item", "search_prd_items"]) {
      expect(isReadOnlyTool(tool), tool).toBe(true);
      expect(toolSchemas[tool], tool).toBeDefined();
      expect(Object.keys(toolSchemas[tool] ?? {}), tool).not.toContain("workspaceRoot");
    }
  });
});
