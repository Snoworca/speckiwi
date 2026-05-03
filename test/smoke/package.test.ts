import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as CoreApi from "speckiwi/core/api";
import type { SpecKiwiCore } from "speckiwi/core/api";

const root = resolve(import.meta.dirname, "../..");
const expectedCoreMethodNames = [
  "init",
  "doctor",
  "cacheRebuild",
  "cacheClean",
  "exportMarkdown",
  "overview",
  "listDocuments",
  "readDocument",
  "search",
  "getRequirement",
  "listRequirements",
  "previewRequirementId",
  "traceRequirement",
  "graph",
  "impact",
  "validate",
  "proposeChange",
  "applyChange",
  "loadRequirementRegistry"
] as const satisfies readonly (keyof SpecKiwiCore)[];

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
      exports: Record<string, { types: string; import: string }>;
    };

    expect(packageJson.name).toBe("speckiwi");
    expect(packageJson.type).toBe("module");
    expect(packageJson.engines.node).toBe(">=20");
    expect(packageJson.bin.speckiwi).toBe("./bin/speckiwi");
    expect(packageJson.exports["./core/api"]).toEqual({
      types: "./dist/core/api.d.ts",
      import: "./dist/core/api.js"
    });
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

  it("imports the expanded core facade from the package export", async () => {
    const { createSpecKiwiCore } = (await import("speckiwi/core/api")) as typeof CoreApi;
    const core = createSpecKiwiCore({ root });

    expect(
      Object.entries(core)
        .filter(([, value]) => typeof value === "function")
        .map(([key]) => key)
    ).toEqual(expectedCoreMethodNames);
    for (const methodName of expectedCoreMethodNames) {
      expect(typeof core[methodName]).toBe("function");
    }
  });

  it("declares runtime dependencies for direct imports", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const runtimeSourceFiles = [
      "src/mcp/schemas.ts",
      "src/mcp/structured-content.ts"
    ];
    const directImports = new Set<string>();

    for (const file of runtimeSourceFiles) {
      const source = readFileSync(resolve(root, file), "utf8");
      for (const match of source.matchAll(/from\s+["']((?![./])[^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier !== undefined) {
          directImports.add(packageName(specifier));
        }
      }
    }

    expect([...directImports].sort()).toContain("zod");
    for (const dependency of directImports) {
      expect(packageJson.dependencies?.[dependency], dependency).toBeDefined();
    }
  });
});

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}
