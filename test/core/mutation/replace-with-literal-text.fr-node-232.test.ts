import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A string replacement passed to String.prototype.replace interprets `$&`, `$1`, `$$` and `` $` ``, so
// text taken from a document (an anchor, a reference cell) changes when it holds one of them. The
// 5.2.0 rename and link code therefore passes a function whenever the replacement is not a literal.
// Denominator: every `.replace(` / `.replaceAll(` call in these files, found by the scan below.

const FILES = [
  "src/core/mutation/rename-scope.ts",
  "src/core/mutation/scope-index-table.ts",
  "src/core/mutation/scaffold-scope.ts",
  "src/core/mutation/register-scopes.ts",
  "src/core/parser/markdown-links.ts",
  "src/core/parser/file-references.ts",
  "src/core/parser/fence.ts",
  "src/core/parser/table.ts",
  "src/core/query/links.ts",
  "src/core/patch/apply-patch.ts",
  "src/core/bootstrap/rules-references.ts",
  "src/core/bootstrap/upgrade-project.ts"
];

/** The second argument of each replace call, as written. */
function replacementArguments(source: string): Array<{ line: number; argument: string }> {
  const found: Array<{ line: number; argument: string }> = [];
  const call = /\.replace(?:All)?\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    let depth = 1;
    let at = match.index + match[0].length;
    let comma = -1;
    let quote: string | undefined;
    for (; at < source.length && depth > 0; at += 1) {
      const char = source[at] ?? "";
      if (quote) {
        if (char === "\\") at += 1;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "/" && comma < 0 && /[(,\s]/.test(source[at - 1] ?? "")) {
        // A regex literal as the first argument: skip to its closing slash.
        for (at += 1; at < source.length && source[at] !== "/"; at += 1) if (source[at] === "\\" || source[at] === "[") at += source[at] === "\\" ? 1 : source.indexOf("]", at) - at;
      } else if ("([{".includes(char)) depth += 1;
      else if (")]}".includes(char)) depth -= 1;
      else if (char === "," && depth === 1 && comma < 0) comma = at;
    }
    if (comma < 0) continue;
    const argument = source.slice(comma + 1, at - 1).trim();
    found.push({ line: source.slice(0, match.index).split("\n").length, argument });
  }
  return found;
}

describe("FR-NODE-232 replacement text is never re-read for `$` patterns", () => {
  // @req FR-NODE-232 AC-6
  it("passes either a literal or a function as every replacement in the 5.2.0 rename and link code", () => {
    const offenders = FILES.flatMap((file) =>
      replacementArguments(readFileSync(path.resolve(file), "utf8"))
        .filter(({ argument }) => !/^(["'])(?:[^"'\\]|\\.)*\1$/.test(argument) && !/^`[^`$]*`$/.test(argument) && !/^\(.*\)\s*=>|^\w+\s*=>|^function\b/s.test(argument))
        .map(({ line, argument }) => `${file}:${line}: ${argument}`)
    );
    expect(offenders).toEqual([]);
  });

  it("finds the replace calls it checks (the scan is not empty)", () => {
    const total = FILES.reduce((count, file) => count + replacementArguments(readFileSync(path.resolve(file), "utf8")).length, 0);
    expect(total).toBeGreaterThanOrEqual(8);
  });
});
