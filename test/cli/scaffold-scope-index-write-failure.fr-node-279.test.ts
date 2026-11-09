import { chmod, readdir, readFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-279 AC-4 — a scaffold-scope that cannot write 00.index.md reports a filesystem error naming
// the path (not a workspace parse error that recommends init), and a rerun once the index is writable
// leaves exactly one scope document for the prefix.

const fault = vi.hoisted(() => ({ failIndexRename: false, failScopeDocumentRemove: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failIndexRename && path.basename(String(to)) === "00.index.md") {
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`), {
          code: "EPERM",
          syscall: "rename",
          path: String(from),
          dest: String(to)
        });
      }
      return actual.rename(from, to);
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (fault.failScopeDocumentRemove && String(args[0]).endsWith(".billing.srs.md")) {
        throw Object.assign(new Error(`EIO: i/o error, unlink '${String(args[0])}'`), { code: "EIO", syscall: "unlink" });
      }
      return actual.rm(...args);
    }
  };
});
afterEach(() => {
  fault.failIndexRename = false;
  fault.failScopeDocumentRemove = false;
});

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function billingDocuments(rootPath: string): Promise<string[]> {
  return (await readdir(path.join(rootPath, "docs", "spec"))).filter((name) => name.endsWith(".billing.srs.md"));
}

const scaffold = (rootPath: string) => ["--root", rootPath, "scaffold-scope", "Billing:BILL", "--apply", "--json"];

describe("FR-NODE-279 AC-4 — scaffold-scope whose index cannot be written", () => {
  // @req FR-NODE-279 AC-4
  it("reports a filesystem error naming the index path, not WORKSPACE_PARSE_ERROR with init", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    fault.failIndexRename = true;
    const streams = io();
    const code = await main(scaffold(rootPath), streams);
    const out = JSON.parse(drain(streams.stdout)) as { ok: boolean; error: { code: string; message: string }; recovery?: { command?: string } };
    expect(code).not.toBe(0);
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("FILESYSTEM_WRITE_ERROR");
    expect(out.error.message).toContain(indexPath);
    expect(out.recovery?.command).not.toBe("init");
  });

  // @req FR-NODE-279 AC-4
  it("leaves exactly one scope document for the prefix after a rerun once the index is writable", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    fault.failIndexRename = true;
    await main(scaffold(rootPath), io());
    fault.failIndexRename = false;
    const streams = io();
    expect(await main(scaffold(rootPath), streams), drain(streams.stdout)).toBe(0);
    expect(await billingDocuments(rootPath)).toHaveLength(1);
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain(`(./${(await billingDocuments(rootPath))[0]})`);
  });

  // @req FR-NODE-279 AC-4 — a restore that also fails is a filesystem error too; it names the document left behind.
  it("reports a failed restore as a filesystem error naming the document it could not remove", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    fault.failIndexRename = true;
    fault.failScopeDocumentRemove = true;
    const streams = io();
    const code = await main(scaffold(rootPath), streams);
    const out = JSON.parse(drain(streams.stdout)) as { error: { code: string; message: string } };
    expect(code).not.toBe(0);
    expect(out.error.code).toBe("FILESYSTEM_WRITE_ERROR");
    const [leftBehind] = await billingDocuments(rootPath);
    expect(out.error.message).toContain(path.join(rootPath, "docs", "spec", leftBehind!));
  });

  // @req FR-NODE-279 AC-4 — the measured case: Windows refuses to replace a read-only index.
  it.runIf(process.platform === "win32")("with a read-only index on Windows: a filesystem error, then one document after the rerun", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await chmod(indexPath, 0o444);
    const first = io();
    const failedCode = await main(scaffold(rootPath), first);
    const failed = JSON.parse(drain(first.stdout)) as { error: { code: string; message: string } };
    await chmod(indexPath, 0o666);
    expect(failedCode).not.toBe(0);
    expect(failed.error.code).toBe("FILESYSTEM_WRITE_ERROR");
    expect(failed.error.message).toContain(indexPath);
    expect(await billingDocuments(rootPath)).toEqual([]);
    const second = io();
    expect(await main(scaffold(rootPath), second), drain(second.stdout)).toBe(0);
    expect(await billingDocuments(rootPath)).toHaveLength(1);
  });
});
