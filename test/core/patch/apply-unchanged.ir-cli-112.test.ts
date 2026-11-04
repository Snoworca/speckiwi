import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyPatchPlan } from "../../../src/core/patch/apply-patch.js";
import { applyPatchPlans } from "../../../src/core/patch/apply-patch-plans.js";
import { createPatchPlan } from "../../../src/core/patch/patch-plan.js";
import { readUtf8File } from "../../../src/core/fs/read-text.js";

// IR-CLI-112 — the shared write path writes a document only when the rendered text differs from the
// text the plan was made from. A plan whose operations change nothing leaves the file in place (same
// bytes, same mtime) and reports written=false; in a batch, only the documents that change are written.

async function doc(dir: string, name: string, text: string) {
  const file = path.join(dir, name);
  await writeFile(file, text, "utf8");
  return readUtf8File(file, dir);
}

const sameLine = (line: number, text: string) => ({ type: "replaceLine" as const, line, original: text, replacement: text });

describe("IR-CLI-112 a plan that changes nothing is not written", () => {
  // @req IR-CLI-112 AC-1
  it("applyPatchPlan reports written=false and leaves the file untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "speckiwi-unchanged-"));
    const file = await doc(dir, "a.md", "one\ntwo\n");
    const mtime = (await stat(file.path)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await applyPatchPlan(createPatchPlan(file, [sameLine(2, "two")]), { dryRun: false });
    expect(result.written).toBe(false);
    expect((await stat(file.path)).mtimeMs).toBe(mtime);
  });

  // @req IR-CLI-112 AC-1
  it("applyPatchPlans writes only the documents that change, and reports written=false when none does", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "speckiwi-unchanged-"));
    const a = await doc(dir, "a.md", "one\ntwo\n");
    const b = await doc(dir, "b.md", "three\n");
    const mtimeA = (await stat(a.path)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const none = await applyPatchPlans([createPatchPlan(a, [sameLine(1, "one")]), createPatchPlan(b, [sameLine(1, "three")])], { dryRun: false });
    expect(none.written).toBe(false);
    const some = await applyPatchPlans([createPatchPlan(a, [sameLine(1, "one")]), createPatchPlan(b, [{ type: "replaceLine", line: 1, original: "three", replacement: "four" }])], { dryRun: false });
    expect(some.written).toBe(true);
    expect((await stat(a.path)).mtimeMs).toBe(mtimeA);
    expect(await readFile(b.path, "utf8")).toBe("four\n");
  });

  // @req IR-CLI-112 AC-1
  it("a changed plan is still written", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "speckiwi-unchanged-"));
    const file = await doc(dir, "a.md", "one\n");
    const result = await applyPatchPlan(createPatchPlan(file, [{ type: "replaceLine", line: 1, original: "one", replacement: "uno" }]), { dryRun: false });
    expect(result.written).toBe(true);
    expect(await readFile(file.path, "utf8")).toBe("uno\n");
  });
});
