import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { buildCommand } from "../../../src/cli/command.js";
import { registerMutationCommands } from "../../../src/cli/commands/mutations.js";
import { toolSchemas } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-098 — the shipped authoring rules document defines six target types; three enforcement
// points accepted three. The rules document ships inside the npm package, so every consuming project
// reads the six-value table and meets a three-value runtime.
//
// The expected set is DERIVED from the rules document rather than restated here. That is AC-5, and it
// is the point of the requirement: hardcoding six values in the test would leave the same silent
// divergence one row later, the next time the table changes.

const RULES_DOCUMENT = path.join("docs", "rule", "SRS-MD-Rules-v2.5.0.md");
const APPENDIX = path.join("docs", "spec", "90.appendix.md");
const CORE_SITE = path.join("src", "core", "mutation", "set-active-target.ts");
const CLI_SITE = path.join("src", "cli", "commands", "mutations.ts");

function nullStream(): NodeJS.WriteStream {
  return { write: () => true } as unknown as NodeJS.WriteStream;
}

/** Read the `Target type values:` table from the shipped rules document and return its `Type` column. */
async function documentedTargetTypes(): Promise<string[]> {
  const rules = await readFile(RULES_DOCUMENT, "utf8");
  const heading = rules.indexOf("Target type values:");
  expect(heading, "the rules document must carry a 'Target type values:' table").toBeGreaterThan(-1);

  const types: string[] = [];
  for (const line of rules.slice(heading).split(/\r?\n/).slice(1)) {
    const row = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (row) {
      types.push(row[1]);
      continue;
    }
    // Stop at the first non-row line after the table has started.
    if (types.length > 0 && !/^\|/.test(line)) break;
  }
  return types;
}

describe("FR-NODE-098 AC-5 — the accepted set is derived from the rules document", () => {
  it("reads every type the rules document documents", async () => {
    const types = await documentedTargetTypes();

    expect(types.length).toBeGreaterThanOrEqual(6);
    expect(types).toContain("version");
    expect(types).toContain("phase");
    expect(types).toContain("objective");
    expect(types).toContain("experiment");
  });

  it("states the accepted set once, so the three enforcement points cannot disagree", async () => {
    const types = await documentedTargetTypes();
    const core = await readFile(CORE_SITE, "utf8");
    const cli = await readFile(CLI_SITE, "utf8");
    const server = await readFile(path.join("src", "mcp", "server.ts"), "utf8");

    // Exactly one module may spell the vocabulary out; the others import it. The guard looks for any
    // two type-name literals sitting close together — an array, a set, any container, in any order —
    // rather than for one exact prior spelling, which a mutation probe defeated by reordering values.
    const names = types.join("|");
    const twoLiteralsTogether = new RegExp('"(?:' + names + ')"[\\s\\S]{0,40}?"(?:' + names + ')"');
    expect(core, "the core must not enumerate the vocabulary itself").not.toMatch(twoLiteralsTogether);
    expect(server, "the MCP schema must not enumerate the vocabulary itself").not.toMatch(twoLiteralsTogether);
    expect(cli, "the CLI must not enumerate the vocabulary itself").not.toMatch(twoLiteralsTogether);

    expect(core).toMatch(/TARGET_TYPES/);
    expect(server).toMatch(/TARGET_TYPES/);
    expect(cli).toMatch(/TARGET_TYPES/);
  });
});

describe("FR-NODE-098 AC-1 — every documented type registers", () => {
  it("accepts each documented type and writes it into the Target Map row", async () => {
    const types = await documentedTargetTypes();
    const indexPath = ["docs", "spec", "00.index.md"];

    for (const targetType of types) {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const result = await setActiveTarget(await resolveProjectRoot(rootPath), {
        target: `t-${targetType}`,
        create: true,
        targetType,
        description: `Registered as ${targetType}`
      });

      expect(result, `registering --type ${targetType} must succeed`).toMatchObject({
        ok: true,
        value: { activeTarget: `t-${targetType}`, created: true, written: true }
      });

      const index = await readFile(path.join(rootPath, ...indexPath), "utf8");
      expect(index).toContain(`| t-${targetType} | ${targetType} | active | Registered as ${targetType} |`);
    }
  });
});

describe("FR-NODE-098 AC-2 — a type outside the documented set is refused", () => {
  it("fails with USAGE and names the accepted values", async () => {
    const types = await documentedTargetTypes();
    const rootPath = await copyFixtureWorkspace("mutation-target");

    const result = await setActiveTarget(await resolveProjectRoot(rootPath), {
      target: "t-bogus",
      create: true,
      targetType: "sprint",
      description: "Not a documented type"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
    const message = (result as { error: { message: string } }).error.message;
    for (const targetType of types) {
      expect(message, `the refusal must name ${targetType} as accepted`).toContain(targetType);
    }
  });

  it("writes nothing when the type is refused", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    await setActiveTarget(await resolveProjectRoot(rootPath), {
      target: "t-bogus",
      create: true,
      targetType: "sprint",
      description: "Not a documented type"
    });

    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });
});

describe("FR-NODE-098 AC-3 — the MCP schema does not reject before the core is reached", () => {
  it("accepts every documented type", async () => {
    const types = await documentedTargetTypes();
    const schema = toolSchemas.set_active_target.type;

    expect(schema, "set_active_target must expose a type schema").toBeDefined();
    for (const targetType of types) {
      expect(schema?.safeParse(targetType).success, `the MCP schema must accept ${targetType}`).toBe(true);
    }
  });

  it("still refuses a type outside the documented set", async () => {
    expect(toolSchemas.set_active_target.type?.safeParse("sprint").success).toBe(false);
  });
});

describe("FR-NODE-098 AC-4 — the CLI help and the shipped signature name the documented set", () => {
  it("lists the same types in the appendix signature as the rules document", async () => {
    const types = await documentedTargetTypes();
    const appendix = await readFile(APPENDIX, "utf8");

    // The appendix mentions the command twice: once as a row in the command table, once as the
    // signature. Only the signature carries the option spellings.
    const signature = appendix
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith("speckiwi set-active-target"));
    expect(signature, "the appendix must carry the set-active-target signature").toBeDefined();
    expect(signature).toContain(`--type <${types.join("|")}>`);
  });

  it("lists the same types in the rendered CLI help", async () => {
    const types = await documentedTargetTypes();

    // Assert the rendered help rather than the source text: the source builds the string from
    // TARGET_TYPES, so reading it would prove nothing about what a user is actually shown.
    const program = buildCommand({ io: { stdout: nullStream(), stderr: nullStream() } });
    registerMutationCommands(program, { io: { stdout: nullStream(), stderr: nullStream() } });
    const command = program.commands.find((candidate) => candidate.name() === "set-active-target");
    expect(command, "set-active-target must be registered").toBeDefined();
    const help = command!.helpInformation();

    for (const targetType of types) {
      expect(help, `the --type help must offer ${targetType}`).toContain(targetType);
    }
    // Not a phrase match. Commander wraps the help at about eighty columns, so a reverted three-value
    // string renders as "version, release, or\n  milestone" and a toContain check passes while the
    // defect is present — a mutation probe demonstrated exactly that. Collapse the whitespace and
    // compare against the sentence the rules document's set produces.
    const collapsed = help.replace(/\s+/g, " ");
    const sentence = types.slice(0, -1).join(", ") + ", or " + types[types.length - 1];
    expect(collapsed, "the rendered help must offer the full documented set").toContain(sentence);
  });
});
