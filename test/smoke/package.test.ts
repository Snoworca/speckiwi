import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readPackageJson() {
  const text = await readFile("package.json", "utf8");
  return JSON.parse(text) as {
    description?: string;
    type?: string;
    bin?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    keywords?: string[];
  };
}

describe("package runtime contract", () => {
  it("uses Node 22+ TypeScript ESM metadata without YAML-era wording", async () => {
    const pkg = await readPackageJson();

    expect(pkg.type).toBe("module");
    expect(pkg.engines?.node).toBe(">=22");
    expect(pkg.description?.toLowerCase()).not.toContain("yaml");
    expect(pkg.keywords ?? []).not.toContain("yaml");
  });

  it("exposes the speckiwi binary and planned verification scripts", async () => {
    const pkg = await readPackageJson();

    expect(pkg.bin?.speckiwi).toBe("./bin/speckiwi");
    expect(pkg.scripts?.build).toBe("tsc -p tsconfig.json");
    expect(pkg.scripts?.typecheck).toContain("--noEmit");
    expect(pkg.scripts?.test).toContain("vitest run");
    expect(pkg.scripts?.["test:integration"]).toContain("test/integration");
    expect(pkg.scripts?.["perf:srs"]).toContain("test/perf/parser-performance.test.ts");
    expect(pkg.scripts?.["release:acceptance"]).toContain("test/release");
  });

  it("does not expose stale package export paths", async () => {
    const pkg = await readPackageJson();

    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./cli/json-renderer");
    expect(Object.keys((pkg as { exports?: Record<string, unknown> }).exports ?? {})).not.toContain("./mcp/structured-content");
  });
});
