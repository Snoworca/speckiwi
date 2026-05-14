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

    const resolvedCwd = await realpathSafe(cwd);
    const resolvedHome = await realpathSafe(home);
    expect(result.root).toBe(resolvedCwd);
    expect(result.root).not.toBe(resolvedHome);
  });

  it("AC-2: cwd 와 사용자 홈 사이에 SRS index 가 없으면 cwd 가 project root 로 선택된다", async () => {
    const home = path.join(scratch, "home2");
    await mkdir(home, { recursive: true });
    const cwd = path.join(home, "projects", "proj-b");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    expect(result.root).toBe(await realpathSafe(cwd));
  });

  it("AC-3: 홈 외부 cwd 에서 홈 내부의 stray SRS index 가 project root 로 치환되지 않는다", async () => {
    const home = path.join(scratch, "home3");
    await mkdir(path.join(home, "docs", "spec"), { recursive: true });
    await writeFile(path.join(home, "docs", "spec", "00.index.md"), "# stray home index\n", "utf8");
    const cwd = path.join(scratch, "external", "proj-c");
    await mkdir(cwd, { recursive: true });

    applyFakeHome(home);
    process.chdir(cwd);

    const result = await resolveMcpStartupRoot();

    const resolvedHome = await realpathSafe(home);
    expect(result.root).not.toBe(resolvedHome);
    expect(result.root.startsWith(resolvedHome + path.sep)).toBe(false);
  });

  it("AC-4: --root 옵션이 명시되면 사용자 홈 경계 규칙 없이 명시 경로가 그대로 채택된다", async () => {
    const home = path.join(scratch, "home4");
    await mkdir(home, { recursive: true });
    const explicit = path.join(home, "explicit-root");
    await mkdir(explicit, { recursive: true });

    applyFakeHome(home);
    process.chdir(originalCwd);

    const result = await resolveMcpStartupRoot(explicit);

    expect(result.root).toBe(await realpathSafe(explicit));
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

    expect(result.root).toBe(await realpathSafe(projectRoot));
  });
});
