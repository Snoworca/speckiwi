import { describe, expect, it } from "vitest";
import { classifyDocumentLines, type DocumentLineKind } from "../../../src/core/parser/document-lines.js";

// Synthetic invariant matrix: a document fragment D classified inside a container stack C must classify
// line for line as D does alone (CommonMark 0.31 §5: a container's content is parsed as a document).
// The line right after the container ends is asserted separately.

interface Fragment {
  lines: string[];
  /** The fragment's own classification, one letter per line: b body, f fence, c indented code, m comment. */
  expected: string;
  /**
   * The fragment leaves a fence open. Inside a container the container's end closes it; one still open
   * at the end of the document hides nothing (the classifier's stated limit), so the matrix always ends
   * the container.
   */
  unclosed?: boolean;
}

const FRAGMENTS: Record<string, Fragment> = {
  "backtick fence": { lines: ["```md", "## in fence", "\tindented in fence", "```", "## after"], expected: "ffffb" },
  "tilde fence holding a backtick fence": { lines: ["~~~", "# in", "```", "~~~", "text after"], expected: "ffffb" },
  // Not on the first line: a list marker takes the spaces after it as its own content offset.
  "fence indented one space": { lines: ["para", " ```", "x", " ```", "## after"], expected: "bfffb" },
  "tab-indented line inside a fence does not close it": { lines: ["```", "\t```", "```", "## after"], expected: "fffb" },
  "indented code after a heading": { lines: ["# h", "    ## code", "", "\t## tab code", "", "## after"], expected: "bcbcbb" },
  "indented code after a thematic break": { lines: ["***", "    ## code", "text"], expected: "bcb" },
  "indented code after a fence": { lines: ["```", "x", "```", "    ## code", "text"], expected: "fffcb" },
  "indented line continuing a paragraph": { lines: ["para", "    ## continuation", "## after"], expected: "bbb" },
  "tab-indented line continuing a paragraph": { lines: ["para", "\t## continuation", "## after"], expected: "bbb" },
  "paragraph interrupted by a fence": { lines: ["para", "```", "## code", "```", "text"], expected: "bfffb" },
  "comment block": { lines: ["<!--", "## hidden", "-->", "## after"], expected: "mmmb" },
  "complete one-line comments": { lines: ["<!-->", "## after", "<!--->", "## after too"], expected: "mbmb" },
  "heading, paragraph and inline comment": { lines: ["## Head", "text <!-- x --> more", "## after"], expected: "bbb" },
  "unclosed fence": { lines: ["```", "## in"], expected: "ff", unclosed: true }
};

interface ContainerStack {
  first: string;
  rest: string;
  blank: string;
  /** Leading tabs in D keep their width only where the content starts on a four-column tab stop. */
  keepsTabs: boolean;
}

const CONTAINERS: Record<string, ContainerStack> = {
  none: { first: "", rest: "", blank: "", keepsTabs: true },
  "`> `": { first: "> ", rest: "> ", blank: ">", keepsTabs: false },
  "`>\\t`": { first: ">\t", rest: ">\t", blank: ">", keepsTabs: true },
  "`- `": { first: "- ", rest: "  ", blank: "", keepsTabs: false },
  "`-\\t`": { first: "-\t", rest: "    ", blank: "", keepsTabs: true },
  "`1. `": { first: "1. ", rest: "   ", blank: "", keepsTabs: false },
  "`- > `": { first: "- > ", rest: "  > ", blank: "  >", keepsTabs: true },
  "`> - `": { first: "> - ", rest: ">   ", blank: ">", keepsTabs: true }
};

function spacesForLeadingTabs(line: string): string {
  let column = 0;
  let at = 0;
  for (; at < line.length && (line[at] === " " || line[at] === "\t"); at += 1) column = line[at] === " " ? column + 1 : column + 4 - (column % 4);
  return " ".repeat(column) + line.slice(at);
}

function wrap(fragment: readonly string[], container: ContainerStack): string[] {
  return fragment.map((line, index) => {
    if (line === "") return container.blank;
    const content = container.keepsTabs ? line : spacesForLeadingTabs(line);
    return (index === 0 ? container.first : container.rest) + content;
  });
}

/** Lines that end the container: an open fence ends with it, so no blank line comes first. */
const boundaryOf = (fragment: Fragment): string[] => (fragment.unclosed === true ? ["## boundary"] : ["", "## boundary"]);

const LETTER: Record<string, DocumentLineKind> = { b: "body", f: "fence", c: "indented-code", m: "comment" };

const kinds = (lines: readonly string[]): DocumentLineKind[] => classifyDocumentLines(lines).map((line) => line.kind);

describe("each fragment alone classifies as CommonMark reads it", () => {
  for (const [fragmentName, fragment] of Object.entries(FRAGMENTS)) {
    // @req FR-NODE-233 AC-1
    it(fragmentName, () => {
      expect(kinds(fragment.lines)).toEqual([...fragment.expected].map((letter) => LETTER[letter]));
    });
  }
});

describe("classifyDocumentLines reads a container's content as a document of its own", () => {
  for (const [containerName, container] of Object.entries(CONTAINERS)) {
    for (const [fragmentName, fragment] of Object.entries(FRAGMENTS)) {
      // @req FR-NODE-233 AC-1
      it(`${fragmentName} inside ${containerName}`, () => {
        const wrapped = containerName === "none" ? fragment.lines : [...wrap(fragment.lines, container), ...boundaryOf(fragment)];

        expect(kinds(wrapped).slice(0, fragment.lines.length)).toEqual(kinds(fragment.lines));
      });

      if (containerName === "none") continue;
      // @req FR-NODE-233 AC-1
      it(`${fragmentName} inside ${containerName}: the line after the container ends is document text`, () => {
        const lines = [...wrap(fragment.lines, container), ...boundaryOf(fragment)];

        expect(kinds(lines).at(-1)).toBe("body");
      });
    }
  }
});

describe("a tab after a list marker reaches the next tab stop (CommonMark §2.2, §5.2)", () => {
  // Checked against cmark-gfm: `-\t` puts the item's content at column 4, so a line indented two
  // columns has left the item, and the `  ```` on it opens a fence of its own at the top level.
  // @req FR-NODE-233 AC-1
  it("content indented to column 4 stays in the item and closes its fence", () => {
    expect(kinds(["-\t```md", "    sample", "    ```", "", "after"])).toEqual(["fence", "fence", "fence", "body", "body"]);
  });

  // @req FR-NODE-233 AC-1
  it("content indented two columns leaves the item, and its fence line opens a top-level fence", () => {
    expect(kinds(["-\t```md", "  sample", "  ```", "", "after"])).toEqual(["fence", "body", "fence", "fence", "fence"]);
  });
});
