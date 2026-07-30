import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertMutationKind, createTestMcpServer, type MutationToolKind } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";

const EXPECTED_KINDS: Record<string, MutationToolKind> = {
  sync_index: "workspace",
  update_status: "req-scoped",
  update_stability: "req-scoped",
  append_section_note: "req-scoped",
  edit_requirement_fields: "req-scoped",
  replace_acceptance_criteria: "req-scoped",
  edit_requirement_table_rows: "req-scoped",
  check_acceptance_criteria: "req-scoped",
  add_verification_evidence: "req-scoped",
  add_trace_link: "req-scoped",
  add_completed_work: "log-append",
  set_active_target: "workspace",
  set_target_goal: "workspace",
  init_project: "workspace",
  add_requirement: "workspace",
  workflow_task_check: "workspace",
  workflow_task_uncheck: "workspace",
  workflow_checklist_set: "workspace",
  workflow_task_status_set: "workspace",
  workflow_pipeline_emit: "workspace",
  workflow_worklog_emit: "workspace",
  workflow_repair_record: "workspace",
  workflow_logical_delete: "workspace",
  apply_requirement_id_collision_repair: "workspace",
  // FR-MCP-056 — scope creation and registration. Both act on the workspace index rather than on one
  // requirement id, so neither is req-scoped.
  scaffold_scope: "workspace",
  register_scopes: "workspace"
};

describe("FR-ARCH-005 — mutation tool kind classification", () => {
  describe("TASK-P1-001: McpServerHandle exposes MutationToolKind + assertMutationKind", () => {
    it("imports MutationToolKind type and assertMutationKind helper", () => {
      const kind: MutationToolKind = "req-scoped";
      expect(assertMutationKind("foo", { kind })).toBe("req-scoped");
    });

    it("throws when kind metadata is missing", () => {
      expect(() => assertMutationKind("foo", {})).toThrow(/missing kind metadata/);
    });

    it("throws when kind value is outside the enum", () => {
      expect(() => assertMutationKind("foo", { kind: "bogus" as never })).toThrow(/missing kind metadata/);
    });
  });

  describe("TASK-P1-002: registerMutationTools declares kind for every tool", () => {
    it("populates toolKinds for every mutation tool using the expected classification", () => {
      const server = createTestMcpServer({});
      registerMutationTools(server, {});
      expect(Object.keys(server.toolKinds).sort()).toEqual(Object.keys(EXPECTED_KINDS).sort());
      for (const [name, expected] of Object.entries(EXPECTED_KINDS)) {
        expect(server.toolKinds[name]).toBe(expected);
      }
    });

    it("returns undefined for tools that were never registered", () => {
      const server = createTestMcpServer({});
      expect(server.toolKinds["nonexistent_tool"]).toBeUndefined();
    });

    it("rejects registration helpers that try to bind without a kind", () => {
      expect(() => assertMutationKind("phantom", undefined)).toThrow();
    });
  });

  describe("TASK-P1-003: zod schemas align with declared kind", () => {
    it("req-scoped tools expose id as a string schema (rejects array)", () => {
      const server = createTestMcpServer({});
      registerMutationTools(server, {});
      for (const [name, schema] of Object.entries(toolSchemas)) {
        const kind = server.toolKinds[name];
        if (kind === "req-scoped") {
          expect(schema.id, `${name} should declare an id schema`).toBeDefined();
          const wrapper = z.object({ id: schema.id });
          expect(wrapper.safeParse({ id: "FR-ARCH-001" }).success, `${name}.id accepts strings`).toBe(true);
          expect(wrapper.safeParse({ id: ["FR-1", "FR-2"] }).success, `${name}.id rejects arrays`).toBe(false);
        }
      }
    });

    it("log-append tools allow requirementIds as string[]", () => {
      const cw = toolSchemas.add_completed_work;
      expect(cw).toBeDefined();
      expect(cw.requirementIds).toBeDefined();
      const parsed = z.object({ requirementIds: cw.requirementIds }).safeParse({ requirementIds: ["FR-1", "FR-2"] });
      expect(parsed.success).toBe(true);
    });

    it("preview-capable AC, evidence, and trace mutations expose dryRun schema fields", () => {
      for (const name of ["check_acceptance_criteria", "add_verification_evidence", "add_trace_link"] as const) {
        const schema = toolSchemas[name];
        expect(schema.dryRun, `${name}.dryRun should be declared`).toBeDefined();
        expect(z.object({ dryRun: schema.dryRun }).safeParse({ dryRun: true }).success, `${name}.dryRun accepts boolean`).toBe(true);
        expect(z.object({ dryRun: schema.dryRun }).safeParse({ dryRun: "true" }).success, `${name}.dryRun rejects strings`).toBe(false);
      }
      for (const name of ["add_verification_evidence", "add_trace_link"] as const) {
        const schema = toolSchemas[name];
        expect(schema.notes, `${name}.notes should be declared`).toBeDefined();
        expect(z.object({ notes: schema.notes }).safeParse({ notes: "exact note" }).success, `${name}.notes accepts strings`).toBe(true);
      }
    });

    it("workspace tools do not expose an id field", () => {
      const server = createTestMcpServer({});
      registerMutationTools(server, {});
      for (const [name, schema] of Object.entries(toolSchemas)) {
        const kind = server.toolKinds[name];
        if (kind === "workspace") {
          expect(schema.id, `${name} (workspace) must not declare an id schema`).toBeUndefined();
        }
      }
    });
  });

  describe("FR-MCP-018 AC-8 / FR-MCP-019 AC-4: readOnlyHint:false enforcement for mutation tools", () => {
    it("every registered mutation tool is classified as non read-only", () => {
      const server = createTestMcpServer({});
      registerMutationTools(server, {});
      for (const name of Object.keys(server.toolKinds)) {
        expect(isReadOnlyTool(name), `${name} (mutation) must be readOnlyHint=false`).toBe(false);
      }
    });

    it("read tools remain classified as read-only", () => {
      for (const name of ["list_requirements", "get_requirement", "validate_spec", "summarize_target", "get_active_target", "list_completed_work"]) {
        expect(isReadOnlyTool(name), `${name} (read) must be readOnlyHint=true`).toBe(true);
      }
    });
  });
});
