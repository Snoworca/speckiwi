#!/usr/bin/env node
// @req FR-FLOW-154 AC-2 — reads the value-site golden's own diff and prints the places this commit
// NEWLY wrote a lifecycle value.
//
// The golden records every occurrence as `value \t homonym-entry \t file \t surrounding text`. Two
// edits look alike in it and mean opposite things: renaming a file rewrites every line that names
// it, which is dozens of deletions each paired with an addition differing only in the file column;
// writing a value into a new sentence is a single addition that pairs with nothing. Ninety-two
// lines of the first hide three lines of the second from anyone reading with their eyes, and the
// pairing that separates them is mechanical. Without it the site golden's whole defence — which is
// visibility, not refusal — rests on attention.
//
// Usage:  npm run value-sites:diff            (working tree against HEAD)
//         npm run value-sites:diff -- --cached
//         git diff <range> | node scripts/value-site-diff.mjs -

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const GOLDEN = "test/skills/status-enum-contract.value-sites.golden.md";

/** A recorded line, split into what identifies the occurrence and where it lives. */
function parse(line) {
  const [value, claim, file, ...rest] = line.split("\t");
  return { line, key: `${value}\t${claim}\t${rest.join("\t")}`, file, value, claim };
}

/**
 * The additions no deletion accounts for, and the deletions no addition does.
 *
 * Pairing is on everything except the FILE column, so an occurrence that merely moved between files
 * — which is what a rename produces, once per line naming that file — matches and drops out. What
 * is left is what the commit actually said.
 */
export function unpairedSites(diffText) {
  const added = [];
  const removed = [];
  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    if (/^[+-]{3}/.test(line) || !line.includes("\t")) continue;
    if (line.startsWith("+")) added.push(parse(line.slice(1)));
    else if (line.startsWith("-")) removed.push(parse(line.slice(1)));
  }
  const pool = new Map();
  for (const entry of removed) pool.set(entry.key, (pool.get(entry.key) ?? 0) + 1);
  const written = [];
  for (const entry of added) {
    const held = pool.get(entry.key) ?? 0;
    if (held > 0) pool.set(entry.key, held - 1);
    else written.push(entry);
  }
  const gone = [];
  for (const entry of removed) {
    const held = pool.get(entry.key) ?? 0;
    if (held === 0) continue;
    pool.set(entry.key, held - 1);
    gone.push(entry);
  }
  return { added, removed, written, gone };
}

function main(argv) {
  const diffText =
    argv[0] === "-"
      ? readFileSync(0, "utf8")
      : execFileSync("git", ["diff", ...argv, "--", GOLDEN], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const { added, removed, written, gone } = unpairedSites(diffText);
  console.log(`${GOLDEN}: +${added.length} / -${removed.length} recorded lines`);
  console.log(`\nnewly written value sites (${written.length}) — read every one of these:`);
  for (const entry of written) console.log(`  ${entry.line}`);
  console.log(`\nvalue sites this commit removed and did not write back (${gone.length}):`);
  for (const entry of gone) console.log(`  ${entry.line}`);
  if (written.length === 0 && gone.length === 0) console.log("\n(every changed line is the same occurrence in a different file)");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2));
