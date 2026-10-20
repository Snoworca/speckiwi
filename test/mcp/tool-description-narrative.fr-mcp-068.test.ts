import { describe, expect, it } from "vitest";
import { renderToolDescriptions, renderToolNames } from "../../src/mcp/schemas.js";

/**
 * FR-MCP-068 — the scalar-field edit tool names the tool that rewrites narrative sections, and that
 * tool says it works at any Status and writes no Change Note. Read through the descriptions the
 * registry hands `tools/list` (FR-MCP-060's corpus), so a description the server does not ship is not
 * what is checked.
 */

const DESCRIPTIONS = renderToolDescriptions();

/** The sentences of a description, split at a full stop followed by a space. */
function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/);
}

/** What AC-1 requires of the edit_requirement_fields description; empty when it holds. */
function routeProblems(description: string): string[] {
  const route = sentences(description).find((sentence) => sentence.includes("append_section_note"));
  if (route === undefined) return ["no sentence names append_section_note"];
  return ["`replace`", "Rationale", "Research / Analysis", "Implementation Notes"].filter((token) => !route.includes(token));
}

/**
 * What AC-2 requires of the append_section_note description; empty when it holds. Worded without a
 * Status value: a description naming the Status axis and one of its values is an agent-facing copy of
 * the lifecycle contract, which FR-FLOW-154 AC-2 inventories (coordinator decision 2026-10-21), so
 * "any Status" stands for "not refused at verified".
 */
function anyStatusProblems(description: string): string[] {
  return [/Rationale/, /works at any Status/, /no Status refuses it/, /writes no Change Note/].filter((pattern) => !pattern.test(description)).map(String);
}

const ROUTE_SENTENCE = "To rewrite the Rationale, Research / Analysis or Implementation Notes section, use `append_section_note` with mode `replace`.";
const ANY_STATUS_SENTENCE = "It works at any Status, no Status refuses it, and it writes no Change Note.";

describe("FR-MCP-068 — the narrative-section route is named where an agent looks for it", () => {
  it("FR-MCP-068 AC-1: edit_requirement_fields names append_section_note in replace mode for Rationale, Research / Analysis and Implementation Notes", () => {
    expect(routeProblems(DESCRIPTIONS.edit_requirement_fields ?? "")).toEqual([]);
  });

  it("FR-MCP-068 AC-2: append_section_note names Rationale, says no Status refuses it, and says it writes no Change Note", () => {
    expect(anyStatusProblems(DESCRIPTIONS.append_section_note ?? "")).toEqual([]);
  });

  it("FR-MCP-068 AC-3: the MCP tool count is unchanged", () => {
    expect(renderToolNames()).toHaveLength(89);
  });

  it("FR-MCP-068 AC-4: deleting either added sentence from the shipped description turns its check red", () => {
    const fields = DESCRIPTIONS.edit_requirement_fields ?? "";
    const note = DESCRIPTIONS.append_section_note ?? "";
    expect(fields, "the AC-1 sentence is the one the server ships").toContain(ROUTE_SENTENCE);
    expect(note, "the AC-2 sentence is the one the server ships").toContain(ANY_STATUS_SENTENCE);
    expect(routeProblems(fields.replace(ROUTE_SENTENCE, ""))).not.toEqual([]);
    expect(anyStatusProblems(note.replace(ANY_STATUS_SENTENCE, ""))).not.toEqual([]);
  });
});
