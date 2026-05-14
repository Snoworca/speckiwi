/**
 * SRS-MD-Rules v1.1.0 §30.5 — `docs/spec/90.appendix.md` 메타 표 `Rules` 행에서
 * 활성 SRS-MD-Rules 버전을 추출한다. 본 module 은 frontmatter 를 사용하지 않으며
 * (Markdown 원본 원칙 보존) Rules 행 링크 파일명만을 SSOT 로 본다.
 *
 * 인식 정책:
 *   - 키 표기: `Rules` (canonical) 또는 `rules` (case-insensitive normalize 후 동일 인정)
 *   - 표 cell 공백 padding 은 trim 후 정규식 입력
 *   - 링크 본문: 상대 (`../rule/...`) 와 저장소-루트 절대 (`./docs/rule/...`) 모두 인정
 *
 * 반환값:
 *   - `version` : "1.0.0" / "1.1.0" 등. `Rules` 행이 없거나 파일명 정규식이 매치하지 않으면 undefined.
 *   - `keyVariant` : 정확한 키 표기 ("Rules" / "rules"). canonical 검증 용도.
 */

const RULES_ROW_RE = /^\|\s*(rules)\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*$/i;
const RULES_FILENAME_RE = /SRS-MD-Rules-v(\d+\.\d+\.\d+)\.md/;

export interface RulesRowInspection {
  version?: string;
  keyVariant?: string;
  rawLink?: string;
}

export function parseAppendixRulesRow(content: string): RulesRowInspection {
  for (const line of content.split(/\r?\n/)) {
    const rowMatch = RULES_ROW_RE.exec(line.trim());
    if (!rowMatch) continue;
    const inspection: RulesRowInspection = { keyVariant: rowMatch[1]!, rawLink: rowMatch[2]! };
    const fileMatch = RULES_FILENAME_RE.exec(rowMatch[2]!);
    if (fileMatch) inspection.version = fileMatch[1]!;
    return inspection;
  }
  return {};
}

export function isV110OrLater(version: string | undefined): boolean {
  if (!version) return false;
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return false;
  const [major, minor] = parts as [number, number, number];
  if (major > 1) return true;
  if (major < 1) return false;
  return minor >= 1;
}
