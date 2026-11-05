import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req IR-CLI-117 AC-3 — both README sections on values a command line cannot carry keep the
// cmd.exe warning and the `--input-json -` example.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The text from the anchor to the next `### ` or `## ` heading after the section's own heading. */
function section(anchor: string): string {
  const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const start = readme.indexOf(`<a id="${anchor}"></a>`);
  expect(start, `README.md must carry the ${anchor} anchor`).toBeGreaterThan(-1);
  const body = readme.slice(start);
  const heading = body.indexOf("\n### ");
  const next = body.slice(heading + 1).search(/\n#{2,3} /);
  return next === -1 ? body : body.slice(0, heading + 1 + next);
}

const SECTIONS = [
  {
    anchor: "en-long-values",
    heading: "### Passing a value a command line cannot carry",
    cut: /`cmd\.exe` cuts a command line at its first newline/,
    flags: /neither does any flag written after it, including `--dry-run`/
  },
  {
    anchor: "ko-long-values",
    heading: "### 명령줄로 전달할 수 없는 값 넘기기",
    cut: /`cmd\.exe`는 명령줄을 첫 줄바꿈에서 자릅니다/,
    flags: /그 뒤에 쓴 플래그도 `--dry-run`을 포함해 전달되지 않습니다/
  }
];

describe("IR-CLI-117 AC-3 — the README keeps the warning and the example", () => {
  for (const expected of SECTIONS) {
    // @req IR-CLI-117 AC-3
    it(`${expected.anchor}: states the cmd.exe cut with the flags after it, and shows --input-json -`, () => {
      const text = section(expected.anchor);
      expect(text).toContain(expected.heading);
      expect(text).toMatch(expected.cut);
      expect(text).toMatch(expected.flags);
      expect(text).toMatch(/^speckiwi [a-z-]+ --input-json - < payload\.json$/m);
    });
  }
});
