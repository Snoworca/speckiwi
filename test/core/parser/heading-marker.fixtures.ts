export interface HeadingFixtureExpectation {
  match: boolean;
  strikethrough?: boolean;
  id?: string;
  title?: string;
  marker?: "DISCARDED" | "DRAFT";
  successorId?: string;
  successorCount?: number;
}

export interface HeadingFixture {
  name: string;
  input: string;
  expected: HeadingFixtureExpectation;
  notes?: string;
}

export const POSITIVE_HEADING_FIXTURES: HeadingFixture[] = [
  {
    name: "plain-v1.0.0",
    input: "### FR-AUTH-001 — Add login",
    expected: { match: true, strikethrough: false, id: "FR-AUTH-001", title: "Add login" }
  },
  {
    name: "discarded-no-successor",
    input: "### ~~FR-AUTH-001 — Add login~~ [DISCARDED]",
    expected: { match: true, strikethrough: true, id: "FR-AUTH-001", title: "Add login", marker: "DISCARDED" }
  },
  {
    name: "discarded-single-successor",
    input: "### ~~FR-AUTH-001 — Add login~~ [DISCARDED → see FR-AUTH-002]",
    expected: {
      match: true,
      strikethrough: true,
      id: "FR-AUTH-001",
      title: "Add login",
      marker: "DISCARDED",
      successorId: "FR-AUTH-002"
    },
    notes: "successor extraction lives in marker-content parser, not REQUIREMENT_HEADING_RE itself; populate when the higher-level parser lands"
  },
  {
    name: "discarded-plus-n-successors",
    input: "### ~~FR-AUTH-001 — Add login~~ [DISCARDED → see FR-AUTH-002 +2]",
    expected: {
      match: true,
      strikethrough: true,
      id: "FR-AUTH-001",
      title: "Add login",
      marker: "DISCARDED",
      successorId: "FR-AUTH-002",
      successorCount: 2
    },
    notes: "successorCount mirrors SRS-MD-Rules v1.1.0 §30.x.1 (N = total supersedes - 1)"
  },
  {
    name: "draft-no-conflict",
    input: "### FR-AUTH-001 — Add login [DRAFT — pending user decision]",
    expected: { match: true, strikethrough: false, id: "FR-AUTH-001", title: "Add login", marker: "DRAFT" },
    notes: "em-dash inside marker body must not bleed into title capture"
  },
  {
    name: "draft-single-conflict",
    input: "### FR-AUTH-001 — Add login [DRAFT — pending user decision, see FR-AUTH-002]",
    expected: {
      match: true,
      strikethrough: false,
      id: "FR-AUTH-001",
      title: "Add login",
      marker: "DRAFT",
      successorId: "FR-AUTH-002"
    },
    notes: "draft `see` target is conflicts_with first row per SRS-MD-Rules v1.1.0 §30.x.2"
  }
];

export const NEGATIVE_HEADING_FIXTURES: HeadingFixture[] = [
  {
    name: "section-heading-in-scope",
    input: "### In Scope",
    expected: { match: false },
    notes: "must not collide with NON_REQUIREMENT_THIRD_LEVEL_HEADING_RE"
  },
  {
    name: "non-standard-brackets-tbd",
    input: "### FR-AUTH-001 — Title [TBD]",
    expected: { match: false },
    notes: "[TBD] is not a v1.1.0 marker; trailing-anchor must reject"
  },
  {
    name: "strikethrough-without-req-id",
    input: "### ~~Title only~~",
    expected: { match: false }
  },
  {
    name: "missing-em-dash-separator",
    input: "### FR-AUTH-001 Some text",
    expected: { match: false }
  }
];

export const ALL_HEADING_FIXTURES: HeadingFixture[] = [
  ...POSITIVE_HEADING_FIXTURES,
  ...NEGATIVE_HEADING_FIXTURES
];
