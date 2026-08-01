import { describe, expect, it } from "vitest";
import { deriveScopeRequirementIds, deriveScopes, parseRouteProbe, type RegisteredScope, type RouteRequirementRecord } from "../../../src/core/orchestrator/route-probe.js";
import { probeDocument } from "../../support/route-probe-document.js";

// FR-NODE-118 — S4 (09 §3.2 S4). Resolution against the registered scope vocabulary is what stops one
// scope being counted twice under two spellings, which matters because D3 removes the step rung on a
// scope count of two or more. An unresolvable reported name is a naming miss, not an unreadable field.

const REGISTERED: RegisteredScope[] = [
  { scope: "Product Architecture", prefix: "ARCH", document: "./10.product-architecture.srs.md" },
  { scope: "CLI Interface", prefix: "CLI", document: "./30.cli-interface.srs.md" },
  { scope: "Node.js Implementation", prefix: "NODE", document: "./50.nodejs-implementation.srs.md" }
];

function record(id: string, scope: string): RouteRequirementRecord {
  return { id, scope, traceReferences: [], traceLinks: [] };
}

describe("FR-NODE-118 AC-1 — case and format variants collapse to a single entry", () => {
  it("resolves a scope name, its prefix and its document to one entry", () => {
    const reported = ["Node.js Implementation", "node.js implementation", "NODE", "./50.nodejs-implementation.srs.md"];

    expect(deriveScopes([], reported, REGISTERED)).toEqual({ scopes: ["NODE"], unresolved: [] });
  });

  it("collapses a record scope and a reported name naming the same scope", () => {
    expect(deriveScopes([record("FR-NODE-110", "NODE")], ["Node.js Implementation"], REGISTERED).scopes).toEqual(["NODE"]);
  });

  it("keeps two genuinely different scopes apart", () => {
    expect(deriveScopes([record("FR-NODE-110", "NODE")], ["CLI Interface"], REGISTERED).scopes).toEqual(["NODE", "CLI"]);
  });
});

describe("FR-NODE-118 AC-2 — an unresolvable reported name is recorded, not counted", () => {
  it("drops the name from scopes and records it in unresolved", () => {
    const derived = deriveScopes([], ["Node.js Implementation", "the caching layer"], REGISTERED);

    expect(derived.scopes).toEqual(["NODE"]);
    expect(derived.unresolved).toEqual(["the caching layer"]);
  });

  it("does not let an unresolvable name push the scope count to D3's threshold", () => {
    expect(deriveScopes([], ["NODE", "some free-text label"], REGISTERED).scopes).toHaveLength(1);
  });
});

describe("FR-NODE-118 AC-3 — the empty-anchor case", () => {
  it("sources every scope from the resolved reported names", () => {
    expect(deriveScopes([], ["CLI Interface", "Product Architecture"], REGISTERED).scopes).toEqual(["CLI", "ARCH"]);
  });

  it("yields no scope at all when nothing is anchored and nothing was reported", () => {
    expect(deriveScopes([], [], REGISTERED)).toEqual({ scopes: [], unresolved: [] });
  });
});

describe("FR-NODE-118 AC-4 — scope-scoped requirement ids", () => {
  const records = [record("FR-NODE-110", "NODE"), record("FR-CLI-071", "CLI"), record("FR-FLOW-040", "FLOW")];

  it("includes a record whose scope is a member of scopes", () => {
    expect(deriveScopeRequirementIds(records, ["NODE"])).toEqual(["FR-NODE-110"]);
  });

  it("excludes a record whose scope is not", () => {
    expect(deriveScopeRequirementIds(records, ["NODE", "CLI"])).toEqual(["FR-NODE-110", "FR-CLI-071"]);
  });
});

describe("FR-NODE-118 AC-5 — the empty-scopes case", () => {
  it("yields an empty id set", () => {
    expect(deriveScopeRequirementIds([record("FR-NODE-110", "NODE")], [])).toEqual([]);
  });
});

describe("FR-NODE-118 AC-6 — unresolved drives no routing predicate", () => {
  it("is absent from the parsed RouteProbe field set", () => {
    const probe = parseRouteProbe(probeDocument({ S4: { scopes: ["NODE"], scope_req_ids: ["FR-NODE-110"], unresolved: ["the caching layer"] } }));

    expect(Object.keys(probe)).not.toContain("unresolved");
    expect(JSON.stringify(probe)).not.toContain("caching layer");
  });

  it("does not enter S4 in unreadable[] when a reported name failed to resolve", () => {
    const probe = parseRouteProbe(probeDocument({ S4: { scopes: [], scope_req_ids: [], unresolved: ["the caching layer"] } }));

    expect(probe.unreadable).not.toContain("S4");
  });
});
