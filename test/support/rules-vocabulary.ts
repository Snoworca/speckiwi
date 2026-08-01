import { readFile } from "node:fs/promises";
import path from "node:path";

// The shipped authoring rules document is the contract for the Target Map vocabularies. Tests derive
// the expected values from it rather than restating them, so that widening or narrowing a table fails
// a test instead of silently diverging from the runtime. See FR-NODE-098 AC-5.
const RULES_DOCUMENT = path.join("docs", "rule", "SRS-MD-Rules-v2.5.0.md");

/**
 * Read a `… values:` table from the rules document and return its first column, which the document
 * writes in backticks. `heading` is the exact line that introduces the table.
 */
export async function documentedVocabulary(heading: string): Promise<string[]> {
  const rules = await readFile(RULES_DOCUMENT, "utf8");
  const start = rules.indexOf(heading);
  if (start < 0) throw new Error(`the rules document has no '${heading}' table`);

  const values: string[] = [];
  for (const line of rules.slice(start).split(/\r?\n/).slice(1)) {
    const row = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (row) {
      values.push(row[1] as string);
      continue;
    }
    if (values.length > 0 && !/^\|/.test(line)) break;
  }
  if (values.length === 0) throw new Error(`the '${heading}' table has no rows`);
  return values;
}

export const documentedTargetTypes = () => documentedVocabulary("Target type values:");
export const documentedTargetStatuses = () => documentedVocabulary("Target status values:");
