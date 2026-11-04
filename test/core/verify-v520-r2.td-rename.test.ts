import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { retarget } from "../../src/core/mutation/retarget.js";
import { withSrsMutationLock } from "../../src/core/mutation/srs-lock.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function edit(rootPath: string, relative: string, change: (text: string) => string): Promise<void> {
  const file = path.join(rootPath, relative);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, change(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}

async function snapshot(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name !== ".status.json") out[path.relative(rootPath, full)] = await readFile(full, "utf8");
    }
  };
  await walk(path.join(rootPath, "docs", "spec"));
  await walk(path.join(rootPath, "kiwi"));
  return out;
}

describe("verify v5.2.0 r2: retarget honours the SRS mutation lock", () => {
  // @req IR-CLI-112 AC-3
  it("a retarget while another mutation holds the SRS lock writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    let inner: Awaited<ReturnType<typeof retarget>> | undefined;
    let specBefore = "";
    await withSrsMutationLock(root, { operation: "other_mutation" }, async () => {
      specBefore = await readFile(path.join(rootPath, SPEC), "utf8");
      inner = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
      return { ok: true, value: undefined, diagnostics: [] } as never;
    });
    const specAfter = await readFile(path.join(rootPath, SPEC), "utf8");
    // Every other SRS mutation refuses (or waits) while the lock is held; retarget writes straight through.
    expect({ ok: inner?.ok, changed: specAfter !== specBefore }).toEqual({ ok: false, changed: false });
  }, 30000);
});
