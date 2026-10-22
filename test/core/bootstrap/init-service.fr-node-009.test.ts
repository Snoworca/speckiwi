import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type * as ChildProcess from "node:child_process";

const spawned = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcess>();
  const record = <T extends (...args: never[]) => unknown>(name: string, fn: T): T =>
    Object.assign(((...args: Parameters<T>) => {
      spawned.calls.push(`${name} ${String(args[0])}`);
      return fn(...args);
    }) as T, fn);
  return {
    ...actual,
    exec: record("exec", actual.exec),
    execSync: record("execSync", actual.execSync),
    spawn: record("spawn", actual.spawn),
    spawnSync: record("spawnSync", actual.spawnSync),
    execFile: record("execFile", actual.execFile),
    execFileSync: record("execFileSync", actual.execFileSync)
  };
});

/**
 * FR-NODE-009 — the project initialisation bootstrap service: its inputs, its no-overwrite rule, its
 * root confinement and its structured result. (The file-by-file creation ACs are held by
 * init-project.test.ts, whose test names cite them.)
 */

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-service-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

describe("FR-NODE-009 — init service inputs, overwrite rule, confinement and result", () => {
  it("FR-NODE-009 AC-1: root is the one required input; target, scope and force are optional and honoured", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    expect((await initProject(root, {})).ok).toBe(true);

    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(indexPath, "# hand-written index\n", "utf8");
    const forced = await initProject(root, { target: "v3.0.0", scope: "Billing:BIL", force: true });
    expect(forced.ok).toBe(true);
    const index = await readFile(indexPath, "utf8");
    expect(index).toContain("| v3.0.0 | release | planned | Initial target |");
  });

  it("FR-NODE-009 AC-9: without force an existing file is not overwritten and is reported as skipped", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const appendixPath = path.join(rootPath, "docs", "spec", "90.appendix.md");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, "# hand-written index\n", "utf8");
    await writeFile(appendixPath, "# hand-written appendix\n", "utf8");

    const result = await initProject(root, {});
    expect(result.ok).toBe(true);
    expect(await readFile(appendixPath, "utf8")).toBe("# hand-written appendix\n");
    expect(result.value?.skipped).toEqual(expect.arrayContaining([indexPath, appendixPath]));
  });

  it("FR-NODE-009 AC-10: every path the service writes is inside the root, and it runs no shell command", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    spawned.calls = [];
    const result = await initProject(root, {});
    expect(result.ok).toBe(true);
    const written = [...(result.value?.created ?? []), ...(result.value?.updated ?? []), ...(result.value?.skipped ?? [])];
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((file) => !inside(root.root, file))).toEqual([]);
    expect(spawned.calls.filter((call) => call.startsWith("exec ") || call.startsWith("execSync") || call.startsWith("spawn"))).toEqual([]);
  });

  it("FR-NODE-009 AC-11: the result lists created, skipped and updated paths, with diagnostics", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    const first = await initProject(root, {});
    expect(first).toMatchObject({ ok: true, diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) });
    expect(first.value).toMatchObject({ created: expect.any(Array), skipped: expect.any(Array), updated: expect.any(Array) });
    expect(first.value?.created.length).toBeGreaterThan(0);

    await writeFile(path.join(rootPath, "AGENTS.md"), "# Notes\n", "utf8");
    const second = await initProject(root, {});
    expect(second.value?.skipped.length).toBeGreaterThan(0);
    expect(second.value?.updated).toContain(path.join(root.root, "AGENTS.md"));
  });
});
