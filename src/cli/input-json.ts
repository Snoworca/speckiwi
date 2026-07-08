import type { Command } from "commander";
import { describeCommandForHelp, findSpecByCliName } from "../mcp/schemas.js";
import type { CliIo } from "./index.js";
import { writeJson } from "./formatters.js";

// @req IR-CLI-043
// IR-CLI-043 — common --input-json option and --help --json renderer for all mutation commands.
//
// `--input-json <json>` (or `--input-json -` / piped stdin) carries the full argument object for a
// mutation command. Rather than re-declaring positionals as optional on every command (which would
// weaken their usage errors), the raw argv is rewritten into the equivalent discrete argv BEFORE
// commander parses it. The positional injection is sourced from the command's ACTUAL declared
// commander positionals (its `registeredArguments`, by name and variadic flag) — not from the MCP
// input schema (ToolSpec.args), which is empty for CLI-only commands and disagrees with the CLI
// positionals (FND-001) — so every mutation command's --input-json is equivalent to its discrete
// flags. Options are injected from the ToolSpec registry (FR-ARCH-006). `speckiwi <command> --help
// --json` is intercepted to print a registry-derived machine-readable description.

/** Mutation command cliNames registered by registerMutationCommands (those accepting --input-json). */
export const MUTATION_COMMAND_NAMES: readonly string[] = [
  "init",
  "update-status",
  "update-statement",
  "edit-ac",
  "update-stability",
  "append-note",
  "set-active-target",
  "set-target-goal",
  "add-completed-work",
  "check-ac",
  "uncheck-ac",
  "add-evidence",
  "add-trace",
  "add-requirement",
  "mode",
  "retarget",
  "update-field",
  "add-related-doc",
  "add-change-note",
  // FND-002: these are mutation commands too — they must accept --input-json and --help --json.
  "sync-counts",
  "supersede",
  "restore"
];

const INPUT_JSON_FLAG = "--input-json";

/** Global options declared on the root program that consume the following argv token as their value. */
const VALUE_GLOBAL_FLAGS: ReadonlySet<string> = new Set(["--root"]);

/**
 * Returns the cliName of the mutation command in `argv`, or undefined when none is present.
 * Global option values (e.g. the path after --root) are skipped so the command token is found.
 */
function findMutationCommand(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (VALUE_GLOBAL_FLAGS.has(token)) {
      index += 1; // skip this global option's value
      continue;
    }
    if (token.startsWith("-")) continue;
    if (MUTATION_COMMAND_NAMES.includes(token)) return token;
    // The first bare token that is not a known mutation command is not one we expand.
    return undefined;
  }
  return undefined;
}

/** One declared CLI positional of a command: its destination name and whether it is variadic. */
interface DeclaredPositional {
  name: string;
  variadic: boolean;
}

/**
 * Returns the declared CLI positionals (in order) of the subcommand named `cliName` within the
 * built command tree, sourced from commander's `registeredArguments` — the SSOT for the command's
 * actual positional argument list. Returns an empty array when the command is not found or declares
 * no positionals. The tree is walked recursively so grouped subcommands (e.g. `vibe-gate check`)
 * resolve to their leaf node.
 */
function declaredPositionals(program: Command, cliName: string): DeclaredPositional[] {
  function find(parent: Command): Command | undefined {
    for (const sub of parent.commands) {
      if (sub.name() === cliName) return sub;
      const nested = find(sub);
      if (nested) return nested;
    }
    return undefined;
  }
  const command = find(program);
  if (!command) return [];
  return command.registeredArguments.map((arg) => ({ name: arg.name(), variadic: arg.variadic }));
}

/** Reads all of stdin as a UTF-8 string (used for `--input-json -` and piped input). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A JSON value is a usable --input-json payload only when it is a plain, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Expands a `--input-json` occurrence in `argv` into the equivalent discrete argv for the matched
 * mutation command. Positional order/arity is sourced from the command's actual declared commander
 * positionals (`registeredArguments` in `program`) and option flags from the ToolSpec registry, so
 * the rewritten argv is equivalent to the discrete flags for every mutation command. The JSON value
 * may be an inline string, `-` (read from stdin), or omitted (read from stdin). Returns the argv
 * unchanged when no `--input-json` is present or the command is not a known mutation command. Throws
 * on malformed JSON or a non-object payload so the caller can surface a usage error.
 */
export async function expandInputJsonArgv(argv: string[], program: Command): Promise<string[]> {
  const flagIndex = argv.indexOf(INPUT_JSON_FLAG);
  if (flagIndex === -1) return argv;

  const cliName = findMutationCommand(argv);
  if (cliName === undefined) return argv;
  const spec = findSpecByCliName(cliName);
  if (!spec) return argv;

  // The value is the token after --input-json. A literal "-" or another flag means read stdin; an
  // inline JSON string is the value. "-" is still consumed as the option's argument; a following
  // flag (or end of argv) is not.
  const rawValue = argv[flagIndex + 1];
  const readsStdin = rawValue === undefined || rawValue === "-" || rawValue.startsWith("-");
  const consumesNextToken = rawValue === "-" || (typeof rawValue === "string" && !rawValue.startsWith("-"));
  const jsonText = readsStdin ? await readStdin() : (rawValue as string);

  const parsedJson: unknown = JSON.parse(jsonText);
  // FND-007: a non-object JSON payload (array, string, number, boolean, null) cannot describe a
  // command's argument set; reject it with a clear usage error instead of silently coercing it.
  if (!isPlainObject(parsedJson)) {
    throw new Error("input-json must be a JSON object");
  }
  const parsed = parsedJson;

  // Drop the flag and (when present) its consumed value from the argv.
  const withoutFlag = argv.filter((_, index) => {
    if (index === flagIndex) return false;
    if (consumesNextToken && index === flagIndex + 1) return false;
    return true;
  });

  // Split the remaining argv around the command token so injected tokens land right after it.
  const commandPosition = withoutFlag.indexOf(cliName);
  const before = withoutFlag.slice(0, commandPosition + 1);
  const after = withoutFlag.slice(commandPosition + 1);

  // Positionals in the command's declared order/arity, then options as discrete flags. The
  // positionals come from the command's real commander declaration (registeredArguments), so a
  // variadic positional (e.g. check-ac's [acIds...]) spreads each array element as its own token
  // and a command with no positionals (all-option commands) injects none.
  const positionals: string[] = [];
  for (const positional of declaredPositionals(program, cliName)) {
    const value = parsed[positional.name];
    if (value === undefined) continue;
    if (positional.variadic && Array.isArray(value)) {
      for (const item of value) positionals.push(String(item));
    } else {
      positionals.push(String(value));
    }
  }

  const optionTokens: string[] = [];
  for (const option of spec.options) {
    const value = parsed[option.dest];
    if (value === undefined) continue;
    const flagName = option.flag.split(/\s+/)[0] as string;
    if (option.encoding === "boolean") {
      if (value) optionTokens.push(flagName);
    } else if (option.repeatable && Array.isArray(value)) {
      for (const item of value) optionTokens.push(flagName, String(item));
    } else {
      optionTokens.push(flagName, String(value));
    }
  }

  return [...before, ...positionals, ...optionTokens, ...after];
}

/**
 * When `argv` requests `--help --json` for a known mutation command, writes a registry-derived
 * machine-readable description (name, kind, parameters) and returns true; otherwise returns false.
 * The registry supplies the command kind and option parameters; the positional parameters are taken
 * from the command's actual declared commander positionals (FND-008) so that CLI-only commands —
 * whose ToolSpec args map is empty — still advertise their real positionals (e.g. uncheck-ac's
 * <id> [acIds...]) in the machine-readable help.
 */
export function tryRenderHelpJson(argv: readonly string[], io: CliIo, program: Command): boolean {
  if (!argv.includes("--help") || !argv.includes("--json")) return false;
  const cliName = findMutationCommand(argv);
  if (cliName === undefined) return false;
  const description = describeCommandForHelp(cliName);
  if (!description) return false;
  // Replace the registry-args-derived positionals with the command's actual declared positionals so
  // the help is accurate for CLI-only commands (registry args:{}); keep the registry-derived options.
  const realPositionals = declaredPositionals(program, cliName).map((positional) => ({
    name: positional.name,
    kind: "positional" as const
  }));
  const options = description.parameters.filter((parameter) => parameter.kind === "option");
  writeJson(io, { ...description, parameters: [...realPositionals, ...options] });
  return true;
}
