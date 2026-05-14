import type { RequirementRecord } from "../types.js";

/**
 * SRS-MD-Rules v1.1.0 §30.1 / §30.2 — FIRST 결정 + N 표기를 지원하기 위한
 * 인커밍 trace 검색 helper.
 *
 * v1.1.0 §30.x 의 "see Y" 슬롯은 *본 REQ 를 supersedes 한 신규 REQ 의 ID* 를 가리키며,
 * trace_link 의 방향 규약 (kiwi-srs §0.18) 은 항상 `id: 신규 REQ → reference: 본 REQ`.
 * 따라서 본 REQ 의 자체 traceLinks 가 아니라 *모든 REQ 의 traceLinks 중* 본 REQ 를
 * `reference` 로 가지는 row 를 검색해야 한다.
 *
 * 정렬 정책 (FIRST):
 *   - 동일 (sourceFile, line) 그룹 안에서는 trace 표 row 등장 순서 = `line` 오름차순
 *   - 다른 파일 간에는 filePath 사전순으로 안정 정렬 (deterministic)
 */
export interface IncomingTraceMatch {
  sourceId: string;
  sourceFilePath: string;
  line: number;
  relation: string;
  notes: string;
}

export interface IncomingTraceFilter {
  /** TraceLink.type 값. "Requirement" 의 supersedes/conflicts_with 만 본 정책의 대상. */
  type: string;
  /** "supersedes" 또는 "conflicts_with". */
  relation: string;
  /** 본 REQ 의 ID — incoming row 의 `reference` 와 매칭. */
  reference: string;
}

export function findIncomingTraceRows(
  records: readonly RequirementRecord[],
  filter: IncomingTraceFilter
): IncomingTraceMatch[] {
  const matches: IncomingTraceMatch[] = [];
  for (const record of records) {
    for (const link of record.traceLinks) {
      if (link.type !== filter.type) continue;
      if (link.relation !== filter.relation) continue;
      if (link.reference !== filter.reference) continue;
      matches.push({
        sourceId: record.id,
        sourceFilePath: record.filePath,
        line: link.line ?? Number.MAX_SAFE_INTEGER,
        relation: link.relation,
        notes: link.notes
      });
    }
  }
  matches.sort((a, b) => {
    const filePathDiff = a.sourceFilePath.localeCompare(b.sourceFilePath);
    if (filePathDiff !== 0) return filePathDiff;
    return a.line - b.line;
  });
  return matches;
}

/**
 * `[DISCARDED → see Y +N]` / `[DRAFT — pending decision, see Y +N]` 의 successor 슬롯을
 * (successorId, successorCount) 로 환원한다. matches 가 비어 있으면 undefined 반환 — 기본 marker
 * (`[DISCARDED]` / `[DRAFT — pending decision]`) 가 사용된다.
 */
export function deriveSuccessorSlot(matches: IncomingTraceMatch[]): { successorId: string; successorCount: number } | undefined {
  if (matches.length === 0) return undefined;
  return {
    successorId: matches[0]!.sourceId,
    successorCount: matches.length - 1
  };
}
