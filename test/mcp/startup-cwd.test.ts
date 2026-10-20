import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMcpStartupRoot } from "../../src/mcp/server.js";

const HOME_ENV_KEYS = ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] as const;
type HomeEnvKey = (typeof HOME_ENV_KEYS)[number];

async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

describe("REL-MCP-002 — MCP startup workspace user home 경계 격리", () => {
  const originalCwd = process.cwd();
  const originalEnv: Partial<Record<HomeEnvKey, string | undefined>> = {};
  let scratch: string;

  beforeEach(async () => {
    for (const key of HOME_ENV_KEYS) originalEnv[key] = process.env[key];
    scratch = await mkdtemp(path.join(os.tmpdir(), "speckiwi-startup-cwd-"));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const key of HOME_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await rm(scratch, { recursive: true, force: true });
  });

  function applyFakeHome(home: string): void {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const parsed = path.parse(home);
    if (parsed.root && parsed.dir) {
      process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
      process.env.HOMEPATH = home.slice(parsed.root.length - 1);
    }
  }

  it("AC-1: 사용자 홈 디렉터리 자체의 SRS index 는 startup root 로 채택되지 않는다", async () => {
    const home = path.join(scratch, "home1");
    await mkdir(path.join(home, "docs", "spec"), { recursive: true });
    await writeFile(path.join(home, "docs", "spec", "00.index.md"), "# stray home index\n", "utf8");
    const cwd = path.join(home, "projects", "proj-a");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    // REL-MCP-002 AC-1: the home index is never adopted; with nothing else on the way up the server
    // is unbound (REL-MCP-002 AC-2, FR-MCP-067).
    expect(result).toMatchObject({ bound: false, checkedCwd: await realpathSafe(cwd) });
  });

  it("REL-MCP-002 AC-2: cwd 와 사용자 홈 사이에 SRS index 가 없으면 어떤 디렉터리도 project root 가 되지 않고 미결속이다", async () => {
    const home = path.join(scratch, "home2");
    await mkdir(home, { recursive: true });
    const cwd = path.join(home, "projects", "proj-b");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    expect(result).toMatchObject({ bound: false, checkedCwd: await realpathSafe(cwd) });
  });

  it("REL-MCP-002 AC-3: 홈 외부 cwd 에서 홈 내부의 stray SRS index 가 project root 로 치환되지 않는다", async () => {
    const home = path.join(scratch, "home3");
    await mkdir(path.join(home, "docs", "spec"), { recursive: true });
    await writeFile(path.join(home, "docs", "spec", "00.index.md"), "# stray home index\n", "utf8");
    const cwd = path.join(scratch, "external", "proj-c");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    const resolvedHome = await realpathSafe(home);
    const root = result.bound ? result.root : "";
    expect(root).not.toBe(resolvedHome);
    expect(root.startsWith(resolvedHome + path.sep)).toBe(false);
  });

  it("IR-CLI-045 AC-5 AC-6 / IR-MCP-001 AC-5 / FR-ARCH-002 AC-4 / REL-MCP-002 AC-4 / REL-MCP-004 AC-4: resolveMcpStartupRoot 는 explicit root 인자를 받지 않고 cwd 탐색만 사용한다", async () => {
    const home = path.join(scratch, "home4");
    await mkdir(home, { recursive: true });
    const cwd = path.join(home, "projects", "proj-explicit-removed");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    expect(resolveMcpStartupRoot.length).toBe(0);
    const result = await resolveMcpStartupRoot();

    // IR-CLI-045 AC-6: no index found, so no root and nothing created.
    expect(result).toMatchObject({ bound: false, checkedCwd: await realpathSafe(cwd) });
  });

  it("AC-1 보강: cwd 와 홈 사이의 중간 디렉터리에 SRS index 가 있으면 그 디렉터리가 project root 로 채택된다", async () => {
    const home = path.join(scratch, "home5");
    const projectRoot = path.join(home, "projects", "proj-d");
    await mkdir(path.join(projectRoot, "docs", "spec"), { recursive: true });
    await writeFile(path.join(projectRoot, "docs", "spec", "00.index.md"), "# project index\n", "utf8");
    const cwd = path.join(projectRoot, "src", "deep");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    expect(result).toMatchObject({ bound: true, root: await realpathSafe(projectRoot) });
  });
});
