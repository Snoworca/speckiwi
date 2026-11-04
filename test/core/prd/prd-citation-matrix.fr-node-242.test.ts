import { describe, expect, it } from "vitest";
import { checkPrdReferences, findPrdCitations, findPrdReferences, parsePrd, prdCoverage } from "../../../src/core/prd/index.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd, DEFAULT_ITEMS } from "./prd-fixture.js";

// @req FR-NODE-242 AC-1, AC-2 — a generated matrix over the citation grammar: every way of writing a
// reference × every clause shape × every awkward path. For each combination, coverage (requirement and
// criterion level) and links check must see the same references, and each criterion's verdict must be
// the one the shape gives it. The expectations are written from the grammar below, not from the code.

const SPEC_FILE = "docs/spec/10.auth.srs.md";
const BASE = "docs/spec";
const ITEM = "PRD-2";

interface PathCase {
  name: string;
  /** File name under docs/prd. */
  file: string;
}

const PATHS: PathCase[] = [
  { name: "plain", file: "a.prd.md" },
  { name: "space", file: "a b.prd.md" },
  { name: "semicolon", file: "a;b.prd.md" },
  { name: "upper-case suffix", file: "a.PRD.md" }
];

/** How a link destination reaches docs/prd from docs/spec, and whether it really lands there. */
const PREFIXES: Array<{ prefix: string; reaches: boolean }> = [
  { prefix: "../prd/", reaches: true },
  { prefix: "./../prd/", reaches: true },
  { prefix: "../../docs/prd/", reaches: true },
  { prefix: "docs/prd/", reaches: false }
];

interface FormCase {
  name: string;
  /** The citation as written, and a definition line it needs (reference links). */
  text: string;
  definition?: string;
  /** "bare": cites this PRD's item without a path; "path": cites docs/prd/<file>; "none": cites nothing. */
  cites: "bare" | "path" | "none";
  file: string;
}

const encode = (file: string) => file.replace(/ /g, "%20").replace(/;/g, "%3B");
const isPrdName = (file: string) => file.endsWith(".prd.md");

function forms(path: PathCase): FormCase[] {
  const file = path.file;
  const valid = isPrdName(file);
  const list: FormCase[] = [
    { name: "bare item", text: ITEM, cites: "bare", file },
    { name: "shortcut without a definition", text: `[${ITEM}]`, cites: "bare", file },
    // Running text ends a path at a blank and at `;` (the clause separator): such a path must be a link.
    { name: "running-text path", text: `docs/prd/${file}#${ITEM}`, cites: valid && !/[ ;]/.test(file) ? "path" : "none", file },
    { name: "path in a code span", text: `\`docs/prd/${file}#${ITEM}\``, cites: "none", file },
    { name: "link in a code span", text: `\`[x](../prd/${encode(file)}#${ITEM})\``, cites: "none", file },
    // A link's text may wrap onto the next line: the link holds, and the break inside it ends no clause.
    { name: "link whose text wraps", text: `[the reset\nitem](<../prd/${file}#${ITEM}>)`, cites: valid ? "path" : "none", file },
    // HTML comments and inline tags are not text a reader sees; nothing in them cites.
    { name: "path in an HTML comment", text: `<!-- docs/prd/${file}#${ITEM} -->`, cites: "none", file },
    { name: "item in an HTML comment", text: `<!-- ${ITEM} -->`, cites: "none", file },
    { name: "link in a comment that wraps", text: `<!-- [x](<../prd/${file}#${ITEM}>)\nstill a comment -->`, cites: "none", file },
    { name: "item in a tag attribute", text: `<span title="${ITEM}">x</span>`, cites: "none", file },
    // A URL's path segment is not a bare item, whether the URL is an autolink or running text.
    { name: "item in an autolink", text: `<https://tracker.example.com/browse/${ITEM}>`, cites: "none", file },
    { name: "item in a running-text URL", text: `https://tracker.example.com/browse/${ITEM}`, cites: "none", file },
    // An autolink is a link to its destination, never running text: here no `/` precedes the item.
    { name: "item in a mailto autolink", text: `<mailto:${ITEM}@example.com>`, cites: "none", file },
    { name: "item in a URN autolink", text: `<urn:${ITEM}>`, cites: "none", file },
    { name: "item in an autolink query", text: `<https://x.example/?id=${ITEM}>`, cites: "none", file }
  ];
  for (const { prefix, reaches } of PREFIXES) {
    const cites = valid && reaches ? "path" : "none";
    list.push(
      { name: `angle link ${prefix}`, text: `[x](<${prefix}${file}#${ITEM}>)`, cites, file },
      { name: `percent link ${prefix}`, text: `[x](${prefix}${encode(file)}#${ITEM})`, cites, file },
      { name: `reference link ${prefix}`, text: "[x][p]", definition: `[p]: <${prefix}${file}#${ITEM}>`, cites, file }
    );
    if (!/[ ;]/.test(file)) list.push({ name: `inline link ${prefix}`, text: `[x](${prefix}${file}#${ITEM})`, cites, file });
    // A link nested in bracketed text is the inner link; a backslash-escaped `;` is part of the path.
    if (!/ /.test(file)) {
      const escaped = file.replace(/;/g, "\\;");
      list.push(
        { name: `escaped inline link ${prefix}`, text: `[x](${prefix}${escaped}#${ITEM})`, cites, file },
        { name: `nested link ${prefix}`, text: `[see [x](${prefix}${escaped}#${ITEM})](https://example.com)`, cites, file }
      );
    }
  }
  return list;
}

interface ShapeCase {
  name: string;
  build: (citation: string) => string;
  /** Criteria grounded when the citation is a basis, and when it is not. */
  withBasis: string[];
  withoutBasis: string[];
}

const SHAPES: ShapeCase[] = [
  { name: "head", build: (c) => `AC-1 ← ${c}`, withBasis: ["AC-1"], withoutBasis: [] },
  { name: "list head", build: (c) => `AC-1, AC-2 ← ${c}`, withBasis: ["AC-1", "AC-2"], withoutBasis: [] },
  { name: "range head", build: (c) => `AC-1–AC-2 ← ${c}`, withBasis: ["AC-1", "AC-2"], withoutBasis: [] },
  { name: "head opening a fills", build: (c) => `AC-1 ← fills: ${c} / hole / x`, withBasis: ["AC-1"], withoutBasis: [] },
  { name: "fills naming a criterion", build: (c) => `fills: ${c} / hole / for AC-2`, withBasis: ["AC-2"], withoutBasis: [] },
  { name: "fills then ';' then a head", build: (c) => `fills: ${c} / hole / x; AC-2 ← PRD-1`, withBasis: ["AC-2"], withoutBasis: ["AC-2"] },
  { name: "citation on its own line", build: (c) => `AC-1 ← PRD-1\n${c}`, withBasis: ["AC-1"], withoutBasis: ["AC-1"] }
];

function record(rationale: string): RequirementRecord {
  return {
    id: "FR-AUTH-001", title: "t", type: "functional", target: "1.0.0", status: "planned", scope: "AUTH", filePath: SPEC_FILE,
    headingLine: 1, metadata: {}, requirement: "statement", rationale,
    acceptanceCriteria: [1, 2, 3].map((n) => ({ id: `AC-${n}`, text: `criterion ${n}`, checked: false })),
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as unknown as RequirementRecord;
}

const combinations = PATHS.flatMap((path) => forms(path).flatMap((form) => SHAPES.map((shape) => ({ path, form, shape }))));

describe("FR-NODE-242 citation grammar matrix", () => {
  it("covers every form, shape and path", () => {
    expect(combinations.length).toBeGreaterThan(300);
  });

  it.each(combinations.map((c) => [`${c.path.name} | ${c.form.name} | ${c.shape.name}`, c] as const))("%s", (_name, { form, shape }) => {
    const target = `docs/prd/${form.file}`;
    const doc = parsePrd(buildPrd({ items: DEFAULT_ITEMS }), target);
    // A definition cannot interrupt a paragraph (CommonMark), so it follows a blank line.
    const rationale = [shape.build(form.text), form.definition].filter((line) => line !== undefined).join("\n\n");
    const rec = record(rationale);

    // links check and coverage read the same references.
    const references = findPrdReferences(rationale, BASE);
    const qualified = findPrdCitations(rationale, BASE).filter((citation) => citation.path !== undefined);
    expect(new Set(references.map((ref) => `${ref.path}#${ref.itemId}`))).toEqual(new Set(qualified.map((c) => `${c.path}#${c.itemId}`)));
    const expectedRefs = form.cites === "path" ? [`${target}#${ITEM}`] : [];
    expect([...new Set(references.map((ref) => `${ref.path}#${ref.itemId}`))]).toEqual(expectedRefs);

    // links check: with the file present nothing is missing; without it every reference is reported.
    expect(checkPrdReferences([rec], (p) => (p === target ? doc : undefined))).toEqual([]);
    expect(checkPrdReferences([rec], () => undefined).length).toBe(references.length);

    // coverage, at the criterion and the requirement level.
    const basis = form.cites !== "none";
    const report = prdCoverage(doc, [rec], { target: "1.0.0" });
    const grounded = ["AC-1", "AC-2", "AC-3"].filter((id) => !report.ungroundedCriteria.some((item) => item.criterionId === id));
    expect(grounded).toEqual(basis ? shape.withBasis : shape.withoutBasis);
    const citedByShape = shape.name === "fills then ';' then a head" || shape.name === "citation on its own line";
    expect(report.uncitedRequirements.length).toBe(basis || citedByShape ? 0 : 1);
  });
});
