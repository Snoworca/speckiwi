import { describe, expect, it } from "vitest";
import {
  FREEZE_LOCK_KINDS,
  LANES_LOCK_DIGEST_FIELDS,
  LANES_LOCK_RECORDED_INPUT_FIELDS,
  LANE_PLAN_INPUT_PINS,
  LOCK_SCHEMA_VERSION,
  freezeLock,
  reconstructLanePlanInputPins,
  serializeLock,
  type FreezeInputs,
  type FreezeLockKind
} from "../../../src/core/orchestrator/freeze.js";

// @req FR-NODE-138 — the six §3.3a lock kinds, their per-kind body schemas, the common envelope, and
// byte-determinism over injected inputs. `lanes.lock.json`'s eight recorded fields pin the nine
// declared `computeLanePlan` inputs that §4.7 drift digest 3 recomputes against.

function inputs(overrides: Partial<FreezeInputs> = {}): FreezeInputs {
  return {
    runId: "2026-08-02.speckiwi.v260",
    gitBlobOid: "0".repeat(40),
    writtenAt: "2026-08-02T09:00:00.000Z",
    declaredInputs: { sidecar: "sha-a", registry: "sha-b" },
    ...overrides
  };
}

function designBody(): Record<string, unknown> {
  return {
    design_items: [{ id: "D-001", heading_path: "3 > 3.1", line_start: 10, line_end: 10, statement: "The scheduler MUST x." }],
    integration_items: [],
    out_of_scope: []
  };
}

function wavesBody(): Record<string, unknown> {
  return {
    waves: [
      {
        n: 1,
        slug: "kernels",
        excerpt_path: "waves/wave-1/excerpt.md",
        design_path: "waves/wave-1/design.md",
        design_items: ["D-001"],
        integration_items: [],
        order: 1
      }
    ],
    wave_count: 1
  };
}

function lanesBody(): Record<string, unknown> {
  return {
    plan_run_id: "2026-08-02T09-00-00",
    sidecar_path: "docs/plans/2026-08-02T09-00-00.plan.tasks.json",
    sidecar_digest: "sha-sidecar",
    registry_digest: "sha-registry",
    existing_paths_digest: "sha-existing-paths",
    design_item_map_digest: "sha-design-item-map",
    prior_postmortem_digests: ["sha-postmortem-1"],
    lane_cap: 4,
    code_roots: ["src/"],
    test_roots: ["test/"],
    lane_count: 1,
    stage_count: 1,
    lanes: [{ lane_id: "lane-1", stage: 1, task_ids: ["T-1"], write_set: ["src/a.ts"], read_set: [], req_ids: ["FR-NODE-1"], design_items: ["D-001"] }],
    serial_epilogue: [],
    unassigned: [],
    serialized: [],
    conflicts: []
  };
}

function handoffBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    handoff_kind: "lane",
    lane_id: "lane-1",
    stage: 1,
    handoff_path: "waves/wave-1/lanes/lane-1.md",
    handoff_git_blob_oid: "1".repeat(40),
    handoff_sha256: "sha-handoff",
    front_matter_digest: "sha-front-matter",
    body_heading_digests: { Setup: "sha-setup" },
    task_field_count: 13,
    acceptance_row_count: 4,
    untested_row_count: 0,
    ...overrides
  };
}

function issuesBody(): Record<string, unknown> {
  return {
    wave: 1,
    issues: [
      {
        issue_id: "W1-I1",
        class: "local-defect",
        source: "loop-P",
        resolution_kind: "commit",
        resolution_ref: "abc1234",
        user_decision_ref: null
      }
    ],
    counts: { open: 0, planned: 0, resolved: 1, deferred: 0 }
  };
}

function postmortemBody(): Record<string, unknown> {
  return {
    waves: [
      {
        n: 1,
        doc_path: "partition-postmortem.wave-1.md",
        digest: "sha-postmortem",
        couplings: [{ from_task: "T-1", to_task: null, path: "src/a.ts", detected_at: "coupling-check", resolution: "merge-into-one-lane" }]
      }
    ]
  };
}

/** One valid body per kind, so every assertion below can iterate the six rather than name three. */
const VALID_BODIES: Record<FreezeLockKind, () => Record<string, unknown>> = {
  design: designBody,
  waves: wavesBody,
  lanes: lanesBody,
  handoff: handoffBody,
  issues: issuesBody,
  postmortem: postmortemBody
};

/**
 * AC-2's rejected-body fixtures: for each kind, one required field deleted. `lanes` deletes
 * `design_item_map_digest` by name, because that field is the one revision 3 added and the one a
 * digest-3 recomputation cannot proceed without.
 */
const REJECTED_BODIES: Record<FreezeLockKind, { field: string; body: () => Record<string, unknown> }> = {
  design: { field: "integration_items", body: () => omit(designBody(), "integration_items") },
  waves: { field: "wave_count", body: () => omit(wavesBody(), "wave_count") },
  lanes: { field: "design_item_map_digest", body: () => omit(lanesBody(), "design_item_map_digest") },
  handoff: { field: "front_matter_digest", body: () => omit(handoffBody(), "front_matter_digest") },
  issues: { field: "counts", body: () => omit(issuesBody(), "counts") },
  postmortem: { field: "waves", body: () => omit(postmortemBody(), "waves") }
};

function omit(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...body };
  delete copy[key];
  return copy;
}

function freezeOk(kind: FreezeLockKind, body: Record<string, unknown>, injected: FreezeInputs) {
  const result = freezeLock(kind, body, injected);
  if (!result.ok) throw new Error(`expected ${kind} to freeze, got ${result.code}: ${result.detail}`);
  return result.lock;
}

describe("FR-NODE-138 AC-1 — exactly six lock kinds", () => {
  it("declares the six §3.3a kinds and no seventh", () => {
    expect([...FREEZE_LOCK_KINDS]).toEqual(["design", "waves", "lanes", "handoff", "issues", "postmortem"]);
    expect(FREEZE_LOCK_KINDS).toHaveLength(6);
  });

  it("freezes every one of the six against its own valid body", () => {
    for (const kind of FREEZE_LOCK_KINDS) {
      const lock = freezeOk(kind, VALID_BODIES[kind](), inputs());
      expect(lock.kind, `${kind} records its own kind`).toBe(kind);
      expect(lock.schema_version).toBe(LOCK_SCHEMA_VERSION);
    }
  });

  it("rejects a seventh kind value with unknown-lock-kind", () => {
    const result = freezeLock("partition" as FreezeLockKind, designBody(), inputs());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("unknown-lock-kind");
    expect(result.detail).toContain("partition");
  });
});

describe("FR-NODE-138 AC-2 — one rejected-body fixture per kind", () => {
  for (const kind of FREEZE_LOCK_KINDS) {
    it(`refuses a ${kind} body missing ${REJECTED_BODIES[kind].field} rather than freezing it`, () => {
      const result = freezeLock(kind, REJECTED_BODIES[kind].body(), inputs());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe("lock-body-invalid");
      expect(result.detail).toContain(REJECTED_BODIES[kind].field);
    });
  }

  it("refuses a lanes body missing design_item_map_digest by name", () => {
    const result = freezeLock("lanes", omit(lanesBody(), "design_item_map_digest"), inputs());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toContain("design_item_map_digest");
  });

  it("admits the two per-kind handoff carve-outs: task_field_count 0 for remediation, stage null for epilogue", () => {
    expect(freezeOk("handoff", handoffBody({ handoff_kind: "remediation", task_field_count: 0 }), inputs()).body).toMatchObject({ task_field_count: 0 });
    expect(freezeOk("handoff", handoffBody({ handoff_kind: "epilogue", stage: null }), inputs()).body).toMatchObject({ stage: null });
  });

  it("still refuses a handoff body whose stage key is absent rather than marked null", () => {
    const result = freezeLock("handoff", omit(handoffBody(), "stage"), inputs());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toContain("stage");
  });
});

describe("FR-NODE-138 AC-3/AC-7 — byte-determinism over injected inputs", () => {
  it("produces byte-identical output for the same (kind, body, inputs) triple, for every kind", () => {
    for (const kind of FREEZE_LOCK_KINDS) {
      const first = freezeOk(kind, VALID_BODIES[kind](), inputs());
      const second = freezeOk(kind, VALID_BODIES[kind](), inputs());
      expect(JSON.stringify(first), `${kind} is byte-deterministic`).toBe(JSON.stringify(second));
      expect(first.inputs_digest).toBe(second.inputs_digest);
      expect(first.sha256).toBe(second.sha256);
    }
  });

  it("produces the same bytes when the body's keys arrive in a different insertion order", () => {
    const body = lanesBody();
    const reordered = Object.fromEntries(Object.keys(body).reverse().map((key) => [key, body[key]]));
    expect(JSON.stringify(freezeOk("lanes", reordered, inputs()))).toBe(JSON.stringify(freezeOk("lanes", body, inputs())));
    expect(serializeLock(freezeOk("lanes", reordered, inputs()))).toBe(serializeLock(freezeOk("lanes", body, inputs())));
  });

  it("serializes to canonical bytes that carry every field of the lock", () => {
    const lock = freezeOk("lanes", lanesBody(), inputs());
    const text = serializeLock(lock);
    expect(text).toBe(serializeLock(lock));
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.sha256).toBe(lock.sha256);
    expect(parsed.inputs_digest).toBe(lock.inputs_digest);
    expect((parsed.body as Record<string, unknown>).design_item_map_digest).toBe("sha-design-item-map");
    // Canonical means sorted, so the serialized key order does not follow the envelope's declaration
    // order and two producers cannot disagree on it.
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("changes inputs_digest when one member of the declared inputs changes", () => {
    const base = freezeOk("lanes", lanesBody(), inputs());
    const changed = freezeOk("lanes", lanesBody(), inputs({ declaredInputs: { sidecar: "sha-a", registry: "sha-CHANGED" } }));
    expect(changed.inputs_digest).not.toBe(base.inputs_digest);
    expect(changed.inputs_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes inputs_digest when a member is added to the declared inputs", () => {
    const base = freezeOk("lanes", lanesBody(), inputs());
    const extra = freezeOk("lanes", lanesBody(), inputs({ declaredInputs: { sidecar: "sha-a", registry: "sha-b", laneCap: 4 } }));
    expect(extra.inputs_digest).not.toBe(base.inputs_digest);
  });

  it("holds inputs_digest independent of written_at, so digest 2 can recompute it later", () => {
    const early = freezeOk("lanes", lanesBody(), inputs({ writtenAt: "2026-08-02T09:00:00.000Z" }));
    const late = freezeOk("lanes", lanesBody(), inputs({ writtenAt: "2027-01-01T00:00:00.000Z" }));
    expect(late.inputs_digest).toBe(early.inputs_digest);
  });

  it("reads no filesystem, clock or environment: the run id, blob oid and timestamp all arrive injected", () => {
    const lock = freezeOk("design", designBody(), inputs({ runId: "injected-run", gitBlobOid: "a".repeat(40), writtenAt: "1999-12-31T23:59:59.000Z" }));
    expect(lock.run_id).toBe("injected-run");
    expect(lock.git_blob_oid).toBe("a".repeat(40));
    expect(lock.written_at).toBe("1999-12-31T23:59:59.000Z");
    // A clock inside the module would make the same triple produce a different `written_at`.
    expect(freezeOk("design", designBody(), inputs({ writtenAt: "1999-12-31T23:59:59.000Z" })).written_at).toBe("1999-12-31T23:59:59.000Z");
  });
});

describe("FR-NODE-138 AC-4 — sha256 covers every envelope field above it", () => {
  it("changes when written_at alone changes", () => {
    const base = freezeOk("design", designBody(), inputs());
    const later = freezeOk("design", designBody(), inputs({ writtenAt: "2026-08-02T09:00:00.001Z" }));
    expect(later.sha256).not.toBe(base.sha256);
  });

  it("changes when run_id, kind, inputs_digest, git_blob_oid or the body change", () => {
    const base = freezeOk("design", designBody(), inputs());
    expect(freezeOk("design", designBody(), inputs({ runId: "other-run" })).sha256).not.toBe(base.sha256);
    expect(freezeOk("design", designBody(), inputs({ gitBlobOid: "b".repeat(40) })).sha256).not.toBe(base.sha256);
    expect(freezeOk("design", designBody(), inputs({ declaredInputs: { sidecar: "different" } })).sha256).not.toBe(base.sha256);
    expect(freezeOk("waves", wavesBody(), inputs()).sha256).not.toBe(base.sha256);
    const otherBody = designBody();
    (otherBody.design_items as Array<Record<string, unknown>>)[0]!.statement = "The scheduler MUST y.";
    expect(freezeOk("design", otherBody, inputs()).sha256).not.toBe(base.sha256);
  });

  it("emits the seven envelope fields plus body, and sha256 is a hex digest", () => {
    const lock = freezeOk("design", designBody(), inputs());
    expect(Object.keys(lock).sort()).toEqual(
      ["body", "git_blob_oid", "inputs_digest", "kind", "run_id", "schema_version", "sha256", "written_at"].sort()
    );
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("FR-NODE-138 AC-5 — lanes.lock.json's eight recorded fields", () => {
  it("declares five digest fields and three literal fields, eight in total", () => {
    expect([...LANES_LOCK_DIGEST_FIELDS]).toEqual([
      "sidecar_digest",
      "registry_digest",
      "existing_paths_digest",
      "design_item_map_digest",
      "prior_postmortem_digests"
    ]);
    expect(LANES_LOCK_DIGEST_FIELDS).toHaveLength(5);
    expect([...LANES_LOCK_RECORDED_INPUT_FIELDS]).toEqual([...LANES_LOCK_DIGEST_FIELDS, "lane_cap", "code_roots", "test_roots"]);
    expect(LANES_LOCK_RECORDED_INPUT_FIELDS).toHaveLength(8);
  });

  it("records lane_cap, code_roots and test_roots as literal values with no digest of their own", () => {
    const lock = freezeOk("lanes", lanesBody(), inputs());
    const body = lock.body as Record<string, unknown>;
    expect(body.lane_cap).toBe(4);
    expect(body.code_roots).toEqual(["src/"]);
    expect(body.test_roots).toEqual(["test/"]);
    for (const literal of ["lane_cap", "code_roots", "test_roots"]) {
      expect(Object.keys(body), `${literal} carries no digest field of its own`).not.toContain(`${literal.replace(/s$/, "")}_digest`);
      expect(Object.keys(body)).not.toContain(`${literal}_digest`);
    }
  });

  it("refuses a lanes body missing any one of the eight recorded fields", () => {
    for (const field of LANES_LOCK_RECORDED_INPUT_FIELDS) {
      const result = freezeLock("lanes", omit(lanesBody(), field), inputs());
      expect(result.ok, `${field} is required`).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.detail).toContain(field);
    }
  });
});

describe("FR-NODE-138 AC-6 — the eight recorded fields pin all nine computeLanePlan inputs", () => {
  it("maps every one of the nine declared inputs to a recorded field", () => {
    const pins = reconstructLanePlanInputPins(lanesBody());
    expect(Object.keys(pins).sort()).toEqual(
      ["catalog", "codeRoots", "designItemMap", "existingModules", "existingPaths", "laneCap", "priorPostmortems", "registry", "testRoots"].sort()
    );
    expect(Object.keys(pins)).toHaveLength(9);
    expect(new Set(Object.values(pins).map((pin) => pin.recordedField)).size).toBe(8);
  });

  it("has sidecar_digest cover both catalog and existing_modules, and nothing else", () => {
    const covered = Object.entries(LANE_PLAN_INPUT_PINS)
      .filter(([, field]) => field === "sidecar_digest")
      .map(([input]) => input)
      .sort();
    expect(covered).toEqual(["catalog", "existingModules"]);
  });

  it("resolves each pin to the value the lock recorded, so digest 3 recomputes against the lock", () => {
    const pins = reconstructLanePlanInputPins(lanesBody());
    expect(pins.catalog).toEqual({ recordedField: "sidecar_digest", recordedValue: "sha-sidecar" });
    expect(pins.existingModules).toEqual({ recordedField: "sidecar_digest", recordedValue: "sha-sidecar" });
    expect(pins.registry).toEqual({ recordedField: "registry_digest", recordedValue: "sha-registry" });
    expect(pins.existingPaths).toEqual({ recordedField: "existing_paths_digest", recordedValue: "sha-existing-paths" });
    expect(pins.designItemMap).toEqual({ recordedField: "design_item_map_digest", recordedValue: "sha-design-item-map" });
    expect(pins.priorPostmortems).toEqual({ recordedField: "prior_postmortem_digests", recordedValue: ["sha-postmortem-1"] });
    expect(pins.laneCap).toEqual({ recordedField: "lane_cap", recordedValue: 4 });
    expect(pins.codeRoots).toEqual({ recordedField: "code_roots", recordedValue: ["src/"] });
    expect(pins.testRoots).toEqual({ recordedField: "test_roots", recordedValue: ["test/"] });
  });

  it("reads the recorded value rather than any value available today", () => {
    const stale = lanesBody();
    stale.lane_cap = 2;
    stale.sidecar_digest = "sha-the-lock-was-computed-from";
    const pins = reconstructLanePlanInputPins(stale);
    expect(pins.laneCap.recordedValue).toBe(2);
    expect(pins.catalog.recordedValue).toBe("sha-the-lock-was-computed-from");
  });
});
