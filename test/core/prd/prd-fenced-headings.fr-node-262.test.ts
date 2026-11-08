import { describe, expect, it } from "vitest";
import { checkPrd, parsePrd, PRD_DIAGNOSTIC_CODES } from "../../../src/core/prd/index.js";
import { buildPrd, DEFAULT_ITEMS } from "./prd-fixture.js";

// FR-NODE-262 AC-1 — a PRD section ends, and an item block starts, only at a heading line the shared
// document classifier reads as document body: a `## ` or `### ` line inside a fenced code block is text
// of the block it sits in.

const PATH = "docs/prd/2026-11-08.fenced.prd.md";
const FENCE = "```";

function withFirstItemBody(body: string[]): string {
  return buildPrd({ items: [{ ...DEFAULT_ITEMS[0]!, body: body.join("\n") }, ...DEFAULT_ITEMS.slice(1)] });
}

describe("FR-NODE-262 AC-1 — PRD sections and item blocks end only at a heading outside code", () => {
  // @req FR-NODE-262 AC-1
  it("a fenced `## ` line in an item body does not end the Items section", () => {
    const doc = parsePrd(withFirstItemBody(["Example:", "", `${FENCE}md`, "## Not a section", FENCE, "", "Body after the fence."]), PATH);
    expect(doc.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4"]);
    expect(doc.items[0]!.body).toContain("## Not a section");
    expect(doc.items[0]!.body).toContain("Body after the fence.");
  });

  // @req FR-NODE-262 AC-1
  it("a fenced `### ` line in an item body keeps the current item block going", () => {
    const doc = parsePrd(withFirstItemBody(["Example:", "", `${FENCE}md`, "### Example heading", FENCE, "", "Body after the fence."]), PATH);
    expect(doc.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4"]);
    expect(doc.items[0]!.body).toContain("### Example heading");
    expect(doc.items[0]!.body).toContain("Body after the fence.");
  });

  // @req FR-NODE-262 AC-1
  it("a fenced `### PRD-` line in an item body is not read as an item", () => {
    const doc = parsePrd(withFirstItemBody(["Example:", "", "~~~", "### PRD-9 — fenced example", "~~~"]), PATH);
    expect(doc.items.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4"]);
    expect(checkPrd(doc)).toEqual([]);
  });

  // @req FR-NODE-262 AC-1
  it("prd check reports no item heading outside the items section for a fenced `### PRD-` line", () => {
    const text = buildPrd().replace("## 3. Approval", ["## 3. Approval", "", FENCE, "### PRD-9 — fenced example", FENCE, ""].join("\n"));
    const codes = checkPrd(parsePrd(text, PATH)).map((d) => d.code);
    expect(codes).not.toContain(PRD_DIAGNOSTIC_CODES.itemOutsideItems);
  });

  // @req FR-NODE-262 AC-1
  it("a fenced copy of the Items heading does not start the Items section", () => {
    const text = buildPrd().replace("## 1. User Request", ["~~~", "## 2. Items", "", "### PRD-1 — fenced", "~~~", "", "## 1. User Request"].join("\n"));
    const doc = parsePrd(text, PATH);
    expect(doc.items.map((item) => item.title)).toEqual(DEFAULT_ITEMS.map((item) => item.title));
  });

  // @req FR-NODE-262 AC-1 — control: a heading outside code still ends the section and is still reported.
  it("a `### PRD-` heading outside code in the Approval section is still reported", () => {
    const text = buildPrd().replace("## 3. Approval", ["## 3. Approval", "", "### PRD-9 — stray", ""].join("\n"));
    const codes = checkPrd(parsePrd(text, PATH)).map((d) => d.code);
    expect(codes).toContain(PRD_DIAGNOSTIC_CODES.itemOutsideItems);
  });
});
