import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";

const REPO = path.resolve(__dirname, "..", "..");
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

type Parse = typeof parseWorkspace;

/** HEAD's src, unpacked next to a link to this checkout's node_modules, so both parsers read the same corpus. */
async function headParser(): Promise<Parse> {
  const dir = await mkdtemp(path.join(tmpdir(), "v520-r15-head-"));
  made.push(dir);
  const files = execFileSync("git", ["-C", REPO, "ls-tree", "-r", "--name-only", "HEAD", "src", "package.json"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), execFileSync("git", ["-C", REPO, "show", `HEAD:${file}`], { maxBuffer: 1 << 28 }));
  }
  await symlink(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "junction");
  const module = (await import(pathToFileURL(path.join(dir, "src", "core", "parser", "workspace-parser.ts")).href)) as { parseWorkspace: Parse };
  return module.parseWorkspace;
}

async function medianMs(parse: Parse, rootPath: string): Promise<number> {
  const root = await resolveProjectRoot(rootPath);
  await parse(root);
  const times: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const start = performance.now();
    await parse(root);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[3]!;
}

describe("verify v5.2.0 r15 — the line classifier on the real corpus", () => {
  // The new line classifier (document-lines.ts classifyDocumentLines) costs about 175 ms per pass over this
  // repository's docs/spec (51,000 lines), and one parse runs it more than once over the same text:
  // block-scanner.ts over the whole document, section-parser.ts again over every block, ac-parser.ts again
  // over every Acceptance Criteria section. Measured on this checkout's docs/spec: HEAD src 130-250 ms per
  // warm parseWorkspace, working-tree src 520-760 ms. Every CLI read, MCP read and mutation parses the
  // workspace at least once.
  // @req FR-NODE-233 AC-1
  it("parses this repository's docs/spec in no more than twice the time HEAD's parser takes", async () => {
    const head = await headParser();

    const before = await medianMs(head, REPO);
    const after = await medianMs(parseWorkspace, REPO);

    expect(after, `HEAD ${Math.round(before)} ms, working tree ${Math.round(after)} ms`).toBeLessThanOrEqual(before * 2);
  }, 300_000);
});
