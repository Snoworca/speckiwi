import { createHash } from "node:crypto";

// PRD texts in the grammar kiwi-prd writes (skills/claude/kiwi-prd/SKILL.md §3). The hash is
// computed here the way the skill's `prd-hash` command computes it, independently of src/core/prd.

export interface FixtureItem {
  number?: number;
  title: string;
  rows: Record<string, string>;
  quote?: string;
  body?: string;
}

export interface FixtureOptions {
  status?: string;
  approved?: string;
  userBlocks?: string[];
  items?: FixtureItem[];
  approval?: string;
  /** Overrides the computed Request SHA256 cell. */
  requestSha?: string;
  extraAfterItems?: string;
}

export const DEFAULT_USER_BLOCKS = [
  "### U-1 — 2026-11-04 request\n\n> 로그인 화면에 비밀번호 재설정 링크를 추가해 주세요.\n> Password reset email must expire after one hour.\n",
  "### U-2 — 2026-11-04 answer\n\n> 질문: 소셜 로그인도 포함할까요?\n> 답: 소셜 로그인은 이번에 하지 않습니다.\n"
];

export const DEFAULT_ITEMS: FixtureItem[] = [
  { title: "재설정 목적", rows: { Kind: "intent", Source: "U-1", State: "confirmed" }, quote: "비밀번호 재설정 링크를 추가해", body: "사용자가 스스로 비밀번호를 복구한다." },
  { title: "Reset link", rows: { Kind: "in-scope", Source: "U-1", State: "confirmed" }, quote: "Password reset email must expire after one hour." },
  { title: "소셜 로그인 제외", rows: { Kind: "exclusion", Source: "U-2", State: "confirmed", "Exclusion Class": "user-excluded" }, quote: "소셜 로그인은 이번에 하지 않습니다." },
  { title: "Rate limit", rows: { Kind: "proposal", State: "proposed", Reason: "abuse guard default", Effect: "in-scope" }, body: "재설정 요청을 분당 5회로 제한한다." }
];

export function requestSectionSha(text: string): string {
  const f = text.replace(/\r\n/g, "\n");
  const a = f.indexOf("\n## 1. User Request") + 1;
  const b = f.indexOf("\n## ", a) + 1;
  return createHash("sha256").update(f.slice(a, b), "utf8").digest("hex");
}

function renderItem(item: FixtureItem, position: number): string {
  const rows = Object.entries(item.rows).map(([field, value]) => `| ${field} | ${value} |`).join("\n");
  const quote = item.quote === undefined ? "" : `\n${item.quote.split("\n").map((line) => `> ${line}`).join("\n")}\n`;
  const body = item.body === undefined ? "" : `\n${item.body}\n`;
  return `### PRD-${item.number ?? position + 1} — ${item.title}\n\n| Field | Value |\n|---|---|\n${rows}\n${quote}${body}`;
}

export function buildPrd(options: FixtureOptions = {}): string {
  const userBlocks = options.userBlocks ?? DEFAULT_USER_BLOCKS;
  const items = options.items ?? DEFAULT_ITEMS;
  const head = (sha: string) =>
    [
      "# PRD: 비밀번호 재설정",
      "",
      "> 입력 기록이다. 요구 원본이 아니다 — 무엇을 만들지는 `docs/spec` 의 SRS 가 정한다.",
      "> 이 문서는 kiwi-prd 만 쓴다. 검증·개선 루프는 읽기만 한다.",
      "",
      "| Field | Value |",
      "|---|---|",
      `| Status | ${options.status ?? "approved"} |`,
      `| Approved | ${options.approved ?? "2026-11-04"} |`,
      `| Request SHA256 | ${sha} |`,
      ""
    ].join("\n");
  const rest = [
    "## 1. User Request",
    "",
    userBlocks.join("\n"),
    "## 2. Items",
    "",
    items.map(renderItem).join("\n"),
    options.extraAfterItems ?? "",
    "## 3. Approval",
    "",
    `> ${options.approval ?? "이대로 진행해 주세요."}`,
    ""
  ].join("\n");
  const draft = `${head("-")}\n${rest}`;
  return `${head(options.requestSha ?? requestSectionSha(draft))}\n${rest}`;
}
