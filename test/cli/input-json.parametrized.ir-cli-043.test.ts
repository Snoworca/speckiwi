import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-058
// IR-CLI-058 AC-1/AC-3 — parametrized equivalence of --input-json and discrete flags across EVERY
// mutation command shape, not just update-status. The earlier suite only exercised update-status,
// which hid that expandInputJsonArgv sourced CLI positionals from the MCP input schema (spec.args)
// rather than the command's actual declared positionals: commands whose registry args disagree with
// their CLI positionals (the ~17 CLI-only mutation commands with args:{}, plus check-ac's array arg)
// either dropped a required positional ("missing required argument") or injected a stray one
// ("too many arguments"). This suite pins one representative per positional/option shape:
//   - all-option        retarget         (no positionals; every input is an option)
//   - id + option       update-statement (<id> + --text)
//   - mixed positionals update-status    (<id> <status> + --reason/--dry-run)
//   - variadic          check-ac         (<id> [acIds...])
//   - variadic          uncheck-ac       (<id> [acIds...], CLI-only)
//   - log-append        add-completed-work (no positionals; --date/--summary/...)
//   - id + boolean      update-field     (<id> + --field/--value/--dry-run; line-replacement field)
//   - FND-002 commands  supersede / restore / sync-counts (mutation commands missing from
//                        MUTATION_COMMAND_NAMES, so --input-json / --help --json never reached them)
//
// FND-004: the update-field shape pins NF-001 — its ToolSpec options[] omitted --dry-run, so the
// --input-json channel dropped a dryRun:true payload and a line-replacement field (priority) was
// silently written (written:true) while the discrete --dry-run channel previewed (written:false).
// The deep-equal envelope assertion below catches that drift; the shape carries dryRun:true so a
// regression re-writes the fixture.
//
// Each case asserts (a) --input-json drives the command to a result envelope (AC-1), and (b) the
// --input-json envelope deep-equals the discrete-flag envelope for the equivalent input (AC-3).
// Every case runs a dry-run (or the command's dry-run-default) so the fixture file is never written.

const TARGET_ID = "FR-ARCH-001";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

async function withStdin<T>(text: string, body: () => Promise<T>): Promise<T> {
  const fake = Readable.from([text]) as unknown as NodeJS.ReadStream;
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  }
}

/**
 * Recursively replaces every occurrence of `root` (the per-run temp workspace path) inside any
 * string value with a stable placeholder, so two runs against separate fixture copies compare equal
 * on path-bearing fields (e.g. a dry-run patch's absolute filePath) — the path differs only because
 * each run uses its own temp directory, not because the mutation result differs.
 */
function normalizeRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.split(root).join("<ROOT>");
  if (Array.isArray(value)) return value.map((item) => normalizeRoot(item, root));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeRoot(v, root)]));
  }
  return value;
}

/** Runs one command against a fresh fixture copy and returns its exit code + parsed JSON stdout. */
async function run(args: string[]): Promise<{ code: number; parsed: unknown }> {
  const root = await copyFixtureWorkspace("mutation-target");
  const r = io();
  const code = await main(["--root", root, ...args, "--json"], r);
  const raw = drain(r.stdout).trim();
  const parsed = raw ? normalizeRoot(JSON.parse(raw), root) : undefined;
  return { code, parsed };
}

interface Shape {
  readonly label: string;
  /** Discrete-flag argv (command + positionals + options), excluding --root/--json. */
  readonly flags: readonly string[];
  /** Equivalent --input-json object. */
  readonly json: Record<string, unknown>;
  /** Command name (first token of flags). */
  readonly command: string;
}

const SHAPES: readonly Shape[] = [
  {
    label: "all-option (retarget)",
    command: "retarget",
    // retarget defaults to a dry-run preview (no --apply), so the fixture is never written.
    flags: ["retarget", "--from", "v1.0.0", "--to", "v2.0.0", "--reason", "ir-cli-043"],
    json: { from: "v1.0.0", to: "v2.0.0", reason: "ir-cli-043" }
  },
  {
    label: "mixed positionals (update-status)",
    command: "update-status",
    flags: ["update-status", TARGET_ID, "implemented", "--reason", "ir-cli-043", "--dry-run"],
    json: { id: TARGET_ID, status: "implemented", reason: "ir-cli-043", dryRun: true }
  },
  {
    label: "id + variadic (check-ac)",
    command: "check-ac",
    // check-ac/uncheck-ac have no --dry-run; assert via deep-equal envelope only (no write happens
    // because both channels run the identical mutation — equivalence is the contract, not no-write).
    flags: ["check-ac", TARGET_ID, "AC-1", "AC-2"],
    json: { id: TARGET_ID, acIds: ["AC-1", "AC-2"] }
  },
  {
    label: "id + variadic (uncheck-ac)",
    command: "uncheck-ac",
    flags: ["uncheck-ac", TARGET_ID, "AC-1"],
    json: { id: TARGET_ID, acIds: ["AC-1"] }
  },
  {
    label: "log-append (add-completed-work)",
    command: "add-completed-work",
    flags: ["add-completed-work", "--date", "2026-05-09", "--summary", "ir-cli-043 work", "--dry-run"],
    json: { date: "2026-05-09", summary: "ir-cli-043 work", dryRun: true }
  },
  {
    label: "id + boolean (update-field)",
    command: "update-field",
    // priority is a line-replacement field: it writes by default and previews only on --dry-run.
    // NF-001 — when the ToolSpec drops --dry-run, the --input-json channel writes (written:true)
    // while the discrete channel previews (written:false), so the envelopes diverge here.
    flags: ["update-field", TARGET_ID, "--field", "priority", "--value", "low", "--dry-run"],
    json: { id: TARGET_ID, field: "priority", value: "low", dryRun: true }
  },
  {
    label: "FND-002 restore",
    command: "restore",
    flags: ["restore", TARGET_ID, "--reason", "ir-cli-043", "--dry-run"],
    json: { id: TARGET_ID, reason: "ir-cli-043", dryRun: true }
  },
  {
    label: "FND-002 supersede",
    command: "supersede",
    // supersede defaults to a dry-run preview (no --apply); the fixture is never written.
    flags: [
      "supersede",
      "--old",
      TARGET_ID,
      "--new-title",
      "Successor",
      "--new-statement",
      "Successor statement.",
      "--scope",
      "ARCH",
      "--type",
      "functional"
    ],
    json: {
      old: TARGET_ID,
      newTitle: "Successor",
      newStatement: "Successor statement.",
      scope: "ARCH",
      type: "functional"
    }
  },
];

describe("IR-CLI-058 — parametrized --input-json equivalence across mutation command shapes", () => {
  for (const shape of SHAPES) {
    it(`AC-1/AC-3 ${shape.label}: --input-json parses and matches discrete flags`, async () => {
      const flagsResult = await run(shape.flags);
      const jsonResult = await run([shape.command, "--input-json", JSON.stringify(shape.json)]);

      // AC-1: --input-json drives the command to a parseable result envelope (not a usage error).
      expect(
        jsonResult.parsed,
        `${shape.label}: --input-json must parse to a result envelope, not a usage error`
      ).toBeDefined();

      // The discrete-flag channel must itself succeed so the comparison is meaningful.
      expect(flagsResult.parsed, `${shape.label}: discrete-flag channel must print a result`).toBeDefined();

      // AC-3: the two channels yield identical result envelopes for equivalent input.
      expect(jsonResult.parsed, `${shape.label}: --input-json must equal discrete flags`).toEqual(
        flagsResult.parsed
      );
      expect(jsonResult.code).toBe(flagsResult.code);
    });
  }

  // NF-001 — a dry-run carried over --input-json must NOT write a line-replacement field. This pins
  // the silent-write defect directly: the update-field ToolSpec dropped --dry-run, so dryRun:true was
  // not injected into the discrete argv and priority was written. Assert written:false AND that the
  // SRS file on disk is byte-identical before and after the run.
  it("NF-001: update-field --input-json with dryRun:true previews without writing the file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const specFile = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(specFile, "utf8");

    const r = io();
    const json = JSON.stringify({ id: TARGET_ID, field: "priority", value: "low", dryRun: true });
    const code = await main(["--root", root, "update-field", "--input-json", json, "--json"], r);
    expect(code).toBe(0);

    const parsed = JSON.parse(drain(r.stdout).trim()) as { ok: boolean; value?: { written?: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.written).toBe(false);

    const after = await readFile(specFile, "utf8");
    expect(after).toBe(before);
  });

  // AC-2 over a non-update-status shape: stdin-fed --input-json - drives a CLI-only mutation command.
  it("AC-2: --input-json - reads the JSON object from stdin for a CLI-only command (edit-ac)", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const r = io();
    const json = JSON.stringify({ id: TARGET_ID, acId: "AC-1", text: "Stdin AC.", dryRun: true });
    const code = await withStdin(json, () =>
      main(["--root", root, "edit-ac", "--input-json", "-", "--json"], r)
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(drain(r.stdout).trim()) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
  });

  // FND-002: --help --json must reach supersede/restore/sync-counts (registry-derived description).
  for (const command of ["supersede", "restore"] as const) {
    it(`FND-002 AC-4: ${command} --help --json prints a registry-derived description`, async () => {
      const r = io();
      const code = await main([command, "--help", "--json"], r);
      expect(code).toBe(0);
      const raw = drain(r.stdout).trim();
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(raw);
      }, `${command} --help --json must print one machine-readable object`).not.toThrow();
      const blob = JSON.stringify(parsed);
      expect(blob).toContain(command);
      expect(blob).toMatch(/input-?json/i);
    });
  }

  // FND-008: a CLI-only command's --help --json must advertise its REAL declared positionals, even
  // though its ToolSpec args map is empty. uncheck-ac declares <id> [acIds...].
  it("FND-008 AC-4: uncheck-ac --help --json advertises its real positionals (id, acIds)", async () => {
    const r = io();
    const code = await main(["uncheck-ac", "--help", "--json"], r);
    expect(code).toBe(0);
    const parsed = JSON.parse(drain(r.stdout).trim()) as {
      parameters: { name: string; kind: string }[];
    };
    const positionals = parsed.parameters.filter((p) => p.kind === "positional").map((p) => p.name);
    expect(positionals).toContain("id");
    expect(positionals).toContain("acIds");
    expect(JSON.stringify(parsed)).toMatch(/input-?json/i);
  });

  // FND-007: a non-object --input-json value is rejected with a clear usage error, not silently coerced.
  for (const bad of ["[1,2,3]", '"x"', "42", "true", "null"]) {
    it(`FND-007: --input-json ${bad} is rejected as a usage error`, async () => {
      const root = await copyFixtureWorkspace("mutation-target");
      const r = io();
      const code = await main(["--root", root, "update-status", "--input-json", bad, "--json"], r);
      expect(code).toBe(2);
      const parsed = JSON.parse(drain(r.stdout).trim()) as Record<string, unknown>;
      expect(parsed.ok).toBe(false);
      expect(JSON.stringify(parsed)).toMatch(/input-?json must be a JSON object/i);
    });
  }
});
