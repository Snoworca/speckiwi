import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @req FR-FLOW-137 — a research file declares itself an unverified working note.
 *
 * The scan walks the directory rather than reading a manifest. A list has to be edited by whoever
 * adds a file, and the file most likely to be believed is the one just written by someone who did
 * not know the rule existed.
 */

/** How far into a file the notice still counts as "near its top". */
export const NOTICE_WINDOW_LINES = 12;

/**
 * The notice these documents carry. Exported so the writer and the check share one text; nothing
 * asserts that a file matches it verbatim, because {@link classifyNotice} judges what the notice
 * says rather than how it is worded.
 */
export const RESEARCH_NOTICE = [
  "> **이 문서는 미검증 작업 노트다.** 확정된 사실은 요구(`docs/spec/`)와 그 테스트에 있다.",
  "> 여기의 수치·판단·계획은 검토를 거치지 않았고 틀릴 수 있다. 이 문서를 근거로 구현하지 말고,",
  "> 요구로 승격된 뒤 그 요구를 근거로 구현한다. — `FR-FLOW-137`"
].join("\n");

export interface NoticeClassification {
  /** The document says of itself that it is not verified. */
  readonly declaresUnverified: boolean;
  /** The document says where the confirmed facts are instead. */
  readonly namesWhereTruthLives: boolean;
}

/** Both halves stated is the whole bar — a notice missing either one fails. */
export function isCompliantNotice(classification: NoticeClassification): boolean {
  return classification.declaresUnverified && classification.namesWhereTruthLives;
}

/**
 * Judges the top of a document.
 *
 * The two halves are looked for independently because they fail independently: a document that
 * says only "draft" leaves a reader to treat the nearest document as truth, and one that only
 * points at the requirements reads as a summary of them rather than as a note that may be wrong.
 */
export function classifyNotice(body: string): NoticeClassification {
  const lines = body.split(/\r?\n/).slice(0, NOTICE_WINDOW_LINES);
  const top = lines.join("\n");
  // Both tokens have to land in ONE sentence, and that sentence must not deny the link. Asking only
  // that `docs/spec` and `요구` appear somewhere in the window accepts the opposite claim —
  // "docs/spec 요구와는 무관한 개인 메모다" — because co-occurrence cannot tell a statement from its
  // negation. That is the same defect this session found in two other checks.
  const pointer = lines.filter((line) => /docs\/spec/.test(line) && /요구/.test(line));
  return {
    declaresUnverified: /미검증|검토를 거치지 않/.test(top),
    namesWhereTruthLives: pointer.some((line) => !/무관|아니다|아님|해당\s*없/.test(line))
  };
}

/** Every Markdown document under the research directory, recursively, POSIX-separated. */
export async function listResearchDocuments(researchDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(researchDir, { withFileTypes: true })) {
    const entryPath = path.join(researchDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listResearchDocuments(entryPath)));
    } else if (entry.name.endsWith(".md")) {
      found.push(entryPath.split(path.sep).join("/"));
    }
  }
  return found.sort();
}

export interface NoticeReport {
  readonly file: string;
  readonly classification: NoticeClassification;
}

export async function auditResearchNotices(researchDir: string): Promise<NoticeReport[]> {
  const reports: NoticeReport[] = [];
  for (const file of await listResearchDocuments(researchDir)) {
    reports.push({ file, classification: classifyNotice(await readFile(file, "utf8")) });
  }
  return reports;
}
