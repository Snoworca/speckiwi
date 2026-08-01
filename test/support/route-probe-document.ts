import type { ProbeFieldId } from "../../src/core/orchestrator/route.js";

/**
 * The on-disk `routing/probe.json` shape (09 §3.2): a `{producer, call, value, read_at}` envelope per
 * S-row, plus S11's `unreadable[]`, which the producer records for a field it knows it could not read.
 *
 * The default document is the on-disk form of `baseProbe()`, so `parseRouteProbe(probeDocument())`
 * round-trips to it and a fixture only has to state the field its case is about.
 */
export interface ProbeDocumentOptions {
  omit?: readonly ProbeFieldId[];
  /** Not narrowed to `ProbeFieldId`: a producer can write any string here, and the parser must cope. */
  unreadable?: readonly string[];
}

function envelope(producer: string, call: string, value: unknown): Record<string, unknown> {
  return { producer, call, value, read_at: "2026-08-01T09:00:00.000Z" };
}

const DEFAULT_VALUES: Record<ProbeFieldId, Record<string, unknown>> = {
  S1: { mode: "sdd", source: "mcp" },
  S2: { path: "docs/plans/2026-08-01.speckiwi.v260.plan.md", candidates: ["docs/plans/2026-08-01.speckiwi.v260.plan.md"], contract_ok: true, reject_reason: null, open_tasks: 3, req_ids: ["FR-NODE-001"], lifecycle_req_ids: ["FR-NODE-001"], target: "v2.6.0" },
  S3: { anchored_reqs: [] },
  S3c: { anchor_coverage: 0.5 },
  S4: { scopes: ["NODE"], scope_req_ids: ["FR-NODE-001"], unresolved: [] },
  S5: { files: 4, modules: 1, external_paths: [] },
  S6: { ambiguities: 0, key_entities: [] },
  S7: { path: "docs/research/v260-orchestrator/01.intake.md", class: "intake", ordered_sections: 0 },
  S8: { issue: null, task_list_groups: 0, linked_sub_issues: 0 },
  S9: { activeTarget: "v2.6.0", summary: {} },
  S10: { blocked_stability: [] },
  S12: { declared_existing_req_edit: false }
};

const PRODUCERS: Record<ProbeFieldId, [string, string]> = {
  S1: ["mcp", "get_work_mode"],
  S2: ["mcp", "workflow_next_plan_task"],
  S3: ["mcp", "list_requirements({traceReference})"],
  S3c: ["mcp", "list_requirements({target, fields})"],
  S4: ["cli", "speckiwi scopes --json"],
  S5: ["subagent", "code_context.json"],
  S6: ["subagent", "intent.json"],
  S7: ["orchestrator", "1.a source classification"],
  S8: ["cli", "gh issue view"],
  S9: ["mcp", "get_active_target"],
  S10: ["mcp", "list_requirements({target, fields})"],
  S12: ["subagent", "existing_srs_context.json"]
};

export function probeDocument(overrides: Partial<Record<ProbeFieldId, unknown>> = {}, options: ProbeDocumentOptions = {}): unknown {
  const omit = new Set(options.omit ?? []);
  const fields: Record<string, unknown> = {};
  for (const [id, defaults] of Object.entries(DEFAULT_VALUES) as Array<[ProbeFieldId, Record<string, unknown>]>) {
    if (omit.has(id)) continue;
    const [producer, call] = PRODUCERS[id];
    const override = overrides[id];
    if (override === null) {
      fields[id] = envelope(producer, call, null);
      continue;
    }
    fields[id] = envelope(producer, call, override === undefined ? defaults : override);
  }
  return { schema_version: "1.0.0", fields, unreadable: [...(options.unreadable ?? [])] };
}
