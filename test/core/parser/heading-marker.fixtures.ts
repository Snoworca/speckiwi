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
    input: "### FR-AUTH-001 — Add login [DRAFT — pending decision]",
    expected: { match: true, strikethrough: false, id: "FR-AUTH-001", title: "Add login", marker: "DRAFT" },
    notes: "em-dash inside marker body must not bleed into title capture"
  },
  {
    name: "draft-single-conflict",
    input: "### FR-AUTH-001 — Add login [DRAFT — pending decision, see FR-AUTH-002]",
    expected: {
      match: true,
      strikethrough: false,
      id: "FR-AUTH-001",
      title: "Add login",
      marker: "DRAFT",
      successorId: "FR-AUTH-002"
    },
    notes: "draft `see` target is conflicts_with first row per SRS-MD-Rules v1.1.0 §30.x.2"
  },
  {
    name: "draft-plus-n-conflicts",
    input: "### FR-AUTH-001 — Add login [DRAFT — pending decision, see FR-AUTH-002 +1]",
    expected: {
      match: true,
      strikethrough: false,
      id: "FR-AUTH-001",
      title: "Add login",
      marker: "DRAFT",
      successorId: "FR-AUTH-002",
      successorCount: 1
    },
    notes: "successorCount mirrors §30.x.2 conflicts_with FIRST + N pattern"
  },
  {
    name: "plain-title-with-trailing-em-dash",
    input: "### FR-AUTH-001 — Title — extra",
    expected: {
      match: true,
      strikethrough: false,
      id: "FR-AUTH-001",
      title: "Title — extra"
    },
    notes: "v5 §3.2 #6.3 negative #5 정정 — title 끝 em-dash 가 separator 와 구별, marker 부재 시 title 끝까지 흡수"
  }
];

/**
 * non-standard-brackets-tbd 는 v5.1 §3 (B) 결정에 따라 POSITIVE 로 이동 (정규식 매치 + sub-parser 후속 warning).
 * 즉 fixture 분류는 "정규식 매치 여부" 기준이며 sub-parser 거부는 별도 단계.
 */
export const NEGATIVE_HEADING_FIXTURES: HeadingFixture[] = [
  {
    name: "section-heading-in-scope",
    input: "### In Scope",
    expected: { match: false },
    notes: "must not collide with NON_REQUIREMENT_THIRD_LEVEL_HEADING_RE"
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

/**
 * SUB_PARSER_WARNING_FIXTURES — 정규식은 매치하나 후속 sub-parser 가 unknown marker warning 발행해야 하는 케이스.
 * 본 fixture 는 v5.1 §3 (B) Title-residual bracket sub-parser 단계 (C2 후속) 에서 검증.
 */
export const SUB_PARSER_WARNING_FIXTURES: HeadingFixture[] = [
  {
    name: "non-standard-brackets-tbd",
    input: "### FR-AUTH-001 — Title [TBD]",
    expected: { match: true, strikethrough: false, id: "FR-AUTH-001", title: "Title [TBD]" },
    notes: "정규식 단계에서는 매치 (title 캡처에 [TBD] 흡수, marker=undefined). sub-parser 가 title 내 비표준 brackets 검출 → unknown marker warning. 본 fixture 는 POSITIVE 로 통합되어 정규식 동작 검증, 별도 sub-parser fixture 는 C2 후속 단계에서 추가."
  }
];

export const ALL_HEADING_FIXTURES: HeadingFixture[] = [
  ...POSITIVE_HEADING_FIXTURES,
  ...NEGATIVE_HEADING_FIXTURES,
  ...SUB_PARSER_WARNING_FIXTURES
];
