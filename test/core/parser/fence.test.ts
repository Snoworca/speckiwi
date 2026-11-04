import { describe, expect, it } from "vitest";
import { closesFence, closingFenceAt, fenceAt } from "../../../src/core/parser/fence.js";

// The one fence reader the parser layer shares (block scanner, link scanner, AC parser).

describe("code fence detection", () => {
  it.each([
    ["```", { marker: "`", length: 3 }],
    ["   ~~~~ js", { marker: "~", length: 4 }],
    ["```ts title", { marker: "`", length: 3 }],
    ["    ```", undefined],
    ["``", undefined],
    ["text ```", undefined]
  ])("reads an opening fence from %j", (line, expected) => {
    expect(fenceAt(line)).toEqual(expected);
  });

  it.each([
    ["```", { marker: "`", length: 3 }],
    ["~~~~  ", { marker: "~", length: 4 }],
    ["```js", undefined],
    ["    ~~~", undefined]
  ])("reads a closing fence, which carries nothing but blanks, from %j", (line, expected) => {
    expect(closingFenceAt(line)).toEqual(expected);
  });

  it("lets a closing fence end in tabs as well as spaces (CommonMark)", () => {
    expect(closingFenceAt("```\t")).toEqual({ marker: "`", length: 3 });
    expect(closingFenceAt("~~~ \t ")).toEqual({ marker: "~", length: 3 });
  });

  it("closes on trailing spaces only when the caller asks for the SRS parsers' reading", () => {
    expect(closingFenceAt("```\t", "spaces")).toBeUndefined();
    expect(closingFenceAt("```  ", "spaces")).toEqual({ marker: "`", length: 3 });
  });

  it("does not read a backtick run whose info string holds a backtick as a fence; a tilde fence may", () => {
    expect(fenceAt("```inline``` spans are code.")).toBeUndefined();
    expect(fenceAt("```js `x`")).toBeUndefined();
    expect(fenceAt("~~~ a`b")).toEqual({ marker: "~", length: 3 });
  });

  it("closes a fence only with the same marker at least as long", () => {
    const open = { marker: "~", length: 4 } as const;
    expect(closesFence(open, { marker: "~", length: 4 })).toBe(true);
    expect(closesFence(open, { marker: "~", length: 5 })).toBe(true);
    expect(closesFence(open, { marker: "~", length: 3 })).toBe(false);
    expect(closesFence(open, { marker: "`", length: 4 })).toBe(false);
    expect(closesFence(open, undefined)).toBe(false);
  });
});
