import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { readRepoFile, scanUnits } from "./kiwi-renderings.js";

/**
 * Section-by-section freezing of rule text, shared by the rule-block suites (d1, d2).
 *
 * A contract test that holds a rule sentence as a substring does not see an exception appended after it,
 * a bracketed condition inside the same block, or a new block beside it. These helpers record every block
 * of a chosen section — paragraph, list item, table row, pseudocode line — as a sha-256 prefix with its
 * line count, so any such edit changes the record. The suites regenerate their records with
 * UPDATE_D1_RULE_BLOCKS=1, the one flag for every rule-block record; read the diff before committing it.
 */

export const UPDATE_RULE_BLOCKS = process.env.UPDATE_D1_RULE_BLOCKS === "1";

const HEADING = /^#{1,6}\s/;

/** A file's sections: each heading line and the lines under it up to the next heading of any depth. */
export function sections(text: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; lines: string[] }> = [{ heading: "(top)", lines: [] }];
  let inFence = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^(?:```|~~~)/.test(line.trim())) inFence = !inFence;
    if (!inFence && HEADING.test(line)) found.push({ heading: line.trim(), lines: [] });
    else found[found.length - 1]!.lines.push(line);
  }
  return found.map((section) => ({ heading: section.heading, body: section.lines.join("\n") }));
}

/** The blocks of a section body, in order. */
export function blocksOf(body: string): string[] {
  return scanUnits(body, { splitListItems: true, splitFencedLines: true }).map((unit) => unit.text);
}

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);

/** One recorded section: `<file>\t<heading>\t<block count>\t<sha:lines of each block, in order>`. */
export function sectionEntry(file: string, heading: string, blocks: readonly string[]): string {
  return `${file}\t${heading}\t${blocks.length}\t${blocks.map((block) => `${digest(block)}:${block.split("\n").length}`).join(" ")}`;
}

/** The sections of a repository file, read as the suites read it. */
export function fileSections(relPath: string): Array<{ heading: string; body: string }> {
  return sections(readRepoFile(relPath));
}

/** Replaces the generated declaration between `start` and `end` in the suite file `self`. */
export function writeRecord(self: string, start: string, end: string, declaration: string): void {
  const own = readFileSync(self, "utf8");
  writeFileSync(self, `${own.slice(0, own.lastIndexOf(start) + start.length)}\n${declaration}\n${own.slice(own.lastIndexOf(end))}`, "utf8");
}
