import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("package skeleton", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  });

  it("declares the speckiwi binary and TypeScript ESM contract", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      name: string;
      type: string;
      bin: Record<string, string>;
      engines: Record<string, string>;
    };

    expect(packageJson.name).toBe("speckiwi");
    expect(packageJson.type).toBe("module");
    expect(packageJson.engines.node).toBe(">=20");
    expect(packageJson.bin.speckiwi).toBe("./bin/speckiwi");
  });

  it("prints CLI help through the binary", () => {
    const result = spawnSync("node", ["bin/speckiwi", "--help"], {
      cwd: root,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: speckiwi");
    expect(result.stdout).toContain("mcp");
    expect(result.stderr).toBe("");
  });

  it("treats a missing command as the help boundary", () => {
    const result = spawnSync("node", ["bin/speckiwi"], {
      cwd: root,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: speckiwi");
    expect(result.stderr).toBe("");
  });

  it("returns nonzero with stderr for unknown commands", () => {
    const result = spawnSync("node", ["bin/speckiwi", "unknown"], {
      cwd: root,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown command");
  });
});
