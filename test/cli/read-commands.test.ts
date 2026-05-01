import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");

describe("read-only CLI commands", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  });

  it("prints overview, document lists, and requirement lists as Core DTO JSON", () => {
    const overview = json(["overview", "--root", validRoot, "--json"]);
    const docs = json(["list", "docs", "--root", validRoot, "--type", "srs", "--json"]);
    const reqs = json(["list", "reqs", "--root", validRoot, "--scope", "core", "--json"]);

    expect(overview).toMatchObject({
      ok: true,
      project: { id: "speckiwi" },
      overview: { title: "SpecKiwi" },
      stats: { documents: 3, scopes: 1, requirements: 1 }
    });
    expect(docs).toMatchObject({ ok: true, documents: [{ id: "srs.core", type: "srs", path: "srs/core.yaml" }], page: { limit: 50 } });
    expect(reqs).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001", scope: "core" }], page: { limit: 50 } });
  });

  it("filters requirement lists by project id or name and clamps list pagination", () => {
    const byId = json(["list", "reqs", "--root", validRoot, "--project", "speckiwi", "--json"]);
    const byName = json(["list", "reqs", "--root", validRoot, "--project", "SpecKiwi", "--json"]);
    const unknown = json(["list", "reqs", "--root", validRoot, "--project", "missing", "--json"]);
    const combined = json(["list", "reqs", "--root", validRoot, "--project", "speckiwi", "--scope", "core", "--status", "active", "--json"]);
    const clampedReqs = json(["list", "reqs", "--root", validRoot, "--limit", "999", "--json"]);
    const clampedDocs = json(["list", "docs", "--root", validRoot, "--limit", "999", "--json"]);

    expect(byId).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { total: 1 } });
    expect(byName).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { total: 1 } });
    expect(unknown).toMatchObject({ ok: true, requirements: [], page: { returned: 0, total: 0 } });
    expect(combined).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001", scope: "core", status: "active" }] });
    expect(clampedReqs.page.limit).toBe(500);
    expect(clampedDocs.page.limit).toBe(500);
  }, 15000);

  it("wires search and requirement exact lookup without stdout diagnostics", () => {
    const search = runCli(["search", "Validate workspace", "--root", validRoot, "--mode", "bm25", "--json"]);
    const requirement = runCli(["req", "get", "FR-CORE-0001", "--relations", "--document", "--root", validRoot, "--json"]);

    expect(search.status).toBe(0);
    expect(search.stderr).toBe("");
    const searchJson = JSON.parse(search.stdout) as { results: Array<{ id: string; score: number }> };
    expect(searchJson.results[0]?.id).toBe("FR-CORE-0001");
    expect(searchJson.results[0]?.score).toBeGreaterThan(0);

    expect(requirement.status).toBe(0);
    expect(requirement.stderr).toBe("");
    expect(JSON.parse(requirement.stdout)).toMatchObject({
      ok: true,
      document: { id: "srs.core" },
      requirement: { id: "FR-CORE-0001" },
      relations: { incoming: [], outgoing: [] }
    });
  });

  it("normalizes graph aliases and computes requirement impact", () => {
    const graph = json(["graph", "--root", validRoot, "--type", "requirements", "--json"]);
    const impact = json(["impact", "FR-CORE-0001", "--root", validRoot, "--json"]);

    expect(graph).toMatchObject({ ok: true, graphType: "requirement" });
    expect(graph.nodes.every((node: { entityType: string }) => node.entityType === "requirement")).toBe(true);
    expect(impact).toMatchObject({ ok: true, requirementId: "FR-CORE-0001", impacted: [] });
  });

  it("renders human output for read commands", () => {
    const result = runCli(["list", "docs", "--root", validRoot, "--type", "srs"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("srs.core");
    expect(result.stdout).toContain("srs/core.yaml");
  });
});

function json(args: string[]) {
  const result = runCli(args);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
