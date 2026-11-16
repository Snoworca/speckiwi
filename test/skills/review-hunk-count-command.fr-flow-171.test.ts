import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readRepoFile, RENDERINGS } from "./kiwi-renderings.js";
import { section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-171 AC-1 AC-10 — the command the skill writes out is the one the loop runs, so it is
// run here as written rather than restated: the test reads the fenced block that follows the
// counting sentence in each shipped copy, substitutes the range and the path, and runs it in a
// scratch repository over diffs built to hit the cases the rule turns on.
//
// The cases come from the requests that reopened this rule. Nine byte-identical renames in one
// test file (OG lane E) and the same `// @req` line added above several methods (OG lane M) left an
// honest reviewer unable to fill the row, since each hunk needed a distinct anchor and only a
// handful exist. A hunk that only adds or removes blank lines has no anchor at all. Each case below
// would make an honest review round invalid under the counting command it replaces.

const COPIES = RENDERINGS.map((rendering) => `${rendering}/kiwi-review-fix-loop/SKILL.md`);

/** The fenced block after the counting sentence of the coverage section. */
function countingCommand(copy: string): string {
  const body = section(stripFrontmatter(readRepoFile(copy)), /^#{1,6}\s.*리뷰 커버리지 분모/);
  const at = body.indexOf("**`hunks_total` 은 루프가 센다 — 리뷰어가 세지 않는다.**");
  if (at < 0) return "";
  const open = body.indexOf("```", at);
  const start = body.indexOf("\n", open) + 1;
  const close = body.indexOf("\n```", start);
  return open < 0 || close < 0 ? "" : body.slice(start, close);
}

/**
 * Git's own bash on Windows, so that `bash` on PATH cannot resolve to the WSL launcher in
 * System32, which runs in another filesystem. Elsewhere the system bash.
 */
function bashPath(): string {
  if (process.platform !== "win32") return "bash";
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const candidates = [path.resolve(execPath, "../../../bin/bash.exe"), path.resolve(execPath, "../../../usr/bin/bash.exe")];
  return candidates.find((candidate) => existsSync(candidate)) ?? "bash";
}

let repo = "";

function git(...args: string[]): void {
  execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, stdio: "pipe" });
}

/** Commit `before`, write `after` to the work tree, and run the copy's command over that diff. */
async function count(copy: string, file: string, before: string, after: string): Promise<string> {
  await writeFile(path.join(repo, file), before, "utf8");
  git("add", "--", file);
  git("commit", "--quiet", "--allow-empty", "-m", file);
  await writeFile(path.join(repo, file), after, "utf8");
  const command = countingCommand(copy).split("<범위>").join("HEAD").split("<path>").join(file);
  const run = spawnSync(bashPath(), ["-c", command], { cwd: repo, encoding: "utf8" });
  git("checkout", "--quiet", "--", file);
  expect(run.status, `${copy}: ${run.stderr}`).toBe(0);
  return run.stdout.trim().split(/\s+/).join(" ");
}

const method = (name: string, line: string): string => `  void ${name}() {\n    ${line}\n    run(fx);\n  }\n\n  // spacer ${name}\n\n`;
const NAMES = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

beforeAll(async () => {
  repo = await realpath(await mkdtemp(path.join(tmpdir(), "fr-flow-171-hunks-")));
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf8" }).trim();
  expect(path.resolve(top).toLowerCase()).toBe(path.resolve(repo).toLowerCase());
});

afterAll(async () => {
  if (repo !== "") await rm(repo, { recursive: true, force: true });
});

describe("FR-FLOW-171 AC-10 — every shipped copy writes out the same counting command", () => {
  it("finds a command in each copy and the four agree", () => {
    const commands = COPIES.map(countingCommand);
    for (const [index, command] of commands.entries()) expect(command, COPIES[index]).not.toBe("");
    expect(new Set(commands).size).toBe(1);
  });
});

describe.each(COPIES)("FR-FLOW-171 AC-1 — the counting command counts distinct hunk bodies (%s)", (copy) => {
  it("prints the distinct-body count, the raw hunk count and the blank-only count for nine identical renames", async () => {
    const before = `class T {\n${NAMES.map((name) => method(name, "Fixture fx = new Fixture();")).join("")}}\n`;
    const after = before.split("Fixture fx = new Fixture();").join("RunRecordFixture fx = new RunRecordFixture();");
    expect(await count(copy, "T.java", before, after)).toBe("1 9 0");
  });

  it("counts the same added `// @req` line above several methods as one body", async () => {
    const before = `class R {\n${NAMES.slice(0, 4).map((name) => method(name, `call${name}();`)).join("")}}\n`;
    // Spelled in two parts so this repository's own @req resolver does not read the fixture as a citation.
    const after = before.split(/(?=  void [a-d]\(\))/).join(`  // @${"req"} FR-OG-001 AC-1\n`);
    expect(await count(copy, "R.java", before, after)).toBe("1 4 0");
  });

  it("groups renames that differ only in indentation, as comparison 1 does", async () => {
    const before = "a\n  x = old();\nb\nc\n\td\n      x = old();\ne\n";
    const after = before.split("x = old();").join("x = fresh();");
    expect(await count(copy, "I.ts", before, after)).toBe("1 2 0");
  });

  it("leaves a blank line out of a body that also has content", async () => {
    // 14c5fab duplication-audit.fr-node-135.test.ts: one hunk adds a line, another adds the same
    // line and a blank one. The anchor for both is that line, so they are one body.
    const before = "a\nkeep\nkeep\nb\n";
    const after = "a\nfoo\nkeep\nkeep\nb\nfoo\n\n";
    expect(await count(copy, "K.ts", before, after)).toBe("1 2 0");
  });

  it("keeps hunks apart when their bodies differ but share a line", async () => {
    const before = "one\n}\nkeep\nkeep\ntwo\n}\nkeep\nkeep\nthree\n}\n";
    const after = before.replace("one\n}", "uno\n}").replace("two\n}", "dos\n}").replace("three\n}", "tres\n}");
    expect(await count(copy, "S.ts", before, after)).toBe("3 3 0");
  });

  it("leaves a hunk that only adds or removes blank lines out of hunks_total and reports it", async () => {
    const before = "first\nsecond\nthird\nfourth\nfifth\n";
    const after = "first\n\n\nsecond\nthird\nfourth\nchanged\n";
    expect(await count(copy, "B.ts", before, after)).toBe("1 2 1");
  });

  it("does not take a deleted line that starts with `-- ` for the file header", async () => {
    const before = "-- note one\nselect 1;\nkeep\nkeep\n-- note two\nselect 2;\n";
    const after = "select 1;\nkeep\nkeep\nselect 2;\n";
    expect(await count(copy, "Q.sql", before, after)).toBe("2 2 0");
  });

  it("groups the same rename whether its line ends in CRLF or LF", async () => {
    // One file with mixed endings: without stripping the carriage return, the CRLF hunk and the LF
    // hunks carry different bodies and an honest reviewer is asked for an anchor it cannot supply.
    const lines = ["class C {", ...NAMES.slice(0, 3).flatMap((name) => [`  void ${name}() {`, "    Fixture fx = new Fixture();", "  }", "", `  // spacer ${name}`, ""]), "}"];
    const before = lines.map((line, index) => (index === 2 ? `${line}\r\n` : `${line}\n`)).join("");
    const after = before.split("Fixture fx = new Fixture();").join("RunRecordFixture fx = new RunRecordFixture();");
    expect(await count(copy, "C.java", before, after)).toBe("1 3 0");
  });
});
