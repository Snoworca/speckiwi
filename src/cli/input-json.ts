import type { Command } from "commander";
import { describeCommandForHelp, findSpecByCliName, type ToolSpec } from "../mcp/schemas.js";
import type { CliIo } from "./index.js";
import { writeJson } from "./formatters.js";
import { describeNonText, textOf } from "../core/mutation/seed-rows.js";

// @req IR-CLI-058
// IR-CLI-058 — common --input-json option and --help --json renderer for all mutation commands.
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

/**
 * Mutation command cliNames accepting --input-json and --help --json.
 *
 * Derived from registration, not transcribed. @req IR-CLI-101
 *
 * This used to be a literal array beside the commands it was supposed to mirror, and it fell out of
 * step twice: FND-002 (supersede, restore) was repaired by adding two names, and by 2026-09-20 ten
 * more had accumulated — among them edit-requirement, whose --statement is exactly the kind of
 * multi-line value a Windows command line cannot carry. Each registrar now reports what it actually
 * registered, so a command added later reaches the channel without anyone editing a list here.
 */
const MUTATION_COMMANDS = new WeakSet<Command>();

/**
 * Marks `commands` as mutation commands. Each registrar calls this with the subcommands it actually
 * registered, so the set follows registration rather than restating it.
 *
 * The mark lives on the Command objects rather than in a set of names, so the answer belongs to the
 * program that declared it: a throwaway program built elsewhere cannot make this one admit a command
 * it never registered, and a build that stopped registering reddens instead of answering from
 * whatever ran first.
 */
export function markMutationCommands(commands: readonly Command[]): void {
  for (const command of commands) MUTATION_COMMANDS.add(command);
}

/** True when the --input-json channel expands `command`: a top-level mutation command with a ToolSpec. */
function admitsInputJson(command: Command): boolean {
  return MUTATION_COMMANDS.has(command) && findSpecByCliName(command.name()) !== undefined;
}

/**
 * Printed after the help of every command the channel admits. Commander never sees `--input-json`,
 * because the argv is rewritten before it parses, so without this the generated help never names
 * the one route a multi-line value survives on Windows. @req IR-CLI-117 AC-1
 */
const INPUT_JSON_HELP_NOTE = [
  "",
  "Multi-line values:",
  "  Pass a value that holds line breaks through --input-json -: a JSON object on stdin whose keys are",
  "  the camelCase payload keys, not the flag spellings (dryRun, not dry-run); a key the command does",
  "  not know is refused. speckiwi commands --json lists each option's flag with its payload key. A",
  "  command line run through cmd.exe (the npm .cmd shim, cmd /c, a shell: true spawn) loses",
  "  everything after the value's first newline, including flags written after it such as --dry-run."
].join("\n");

/**
 * Adds the multi-line note to the help of exactly the commands the gate admits, read from the
 * program after every registrar ran, so a grouped subcommand that lacks the channel never
 * advertises it. @req IR-CLI-117 AC-2
 */
export function attachInputJsonHelp(program: Command): void {
  for (const command of program.commands) {
    if (admitsInputJson(command)) command.addHelpText("after", INPUT_JSON_HELP_NOTE);
  }
}

const INPUT_JSON_FLAG = "--input-json";

/** Global options declared on the root program that consume the following argv token as their value. */
const VALUE_GLOBAL_FLAGS: ReadonlySet<string> = new Set(["--root"]);

/**
 * Returns the cliName of the mutation command in `argv`, or undefined when none is present.
 * Global option values (e.g. the path after --root) are skipped so the command token is found.
 */
function findMutationCommand(argv: readonly string[], program: Command): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (VALUE_GLOBAL_FLAGS.has(token)) {
      index += 1; // skip this global option's value
      continue;
    }
    if (token.startsWith("-")) continue;
    const subcommand = program.commands.find((sub) => sub.name() === token);
    if (subcommand && admitsInputJson(subcommand)) return token;
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
  const command = findCommand(program, cliName);
  if (!command) return [];
  return command.registeredArguments.map((arg) => ({ name: arg.name(), variadic: arg.variadic }));
}

/** The subcommand named `cliName` anywhere in the built command tree, so grouped leaves resolve too. */
function findCommand(parent: Command, cliName: string): Command | undefined {
  for (const sub of parent.commands) {
    if (sub.name() === cliName) return sub;
    const nested = findCommand(sub, cliName);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * The argv token for one payload value where the command takes text. A string, number or boolean is
 * its text; anything else has no text the command could write as given, so it is refused rather than
 * turned into `[object Object]` (or an empty string) that the command would then write.
 * `form` is the option's own description, which names the row form a structured value should take.
 * @req FR-NODE-281 AC-1 AC-2 AC-3
 */
function textToken(key: string, value: unknown, form: string | undefined): string {
  const text = textOf(value);
  if (text !== undefined) return text;
  const hint = form ? ` (${form})` : "";
  throw new Error(`input-json key "${key}" holds ${describeNonText(value)}, which cannot be written as given; pass text: a string, a number or a boolean${hint}`);
}

/** How a payload option becomes argv: a flag set by a truthy value, a `--no-…` flag set by a falsy one, text, or JSON. */
type PayloadOptionKind = "flag" | "negated-flag" | "text" | "json";

/** One payload key the channel carries, and the long flag it is written as. */
interface PayloadOption {
  key: string;
  flag: string;
  kind: PayloadOptionKind;
  repeatable: boolean;
}

/** The long flag of a flags string such as `-g, --global` or `--ac <criterion>`. */
function longFlag(flags: string): string {
  const tokens = flags.split(/[\s,]+/).filter(Boolean);
  return tokens.find((token) => token.startsWith("--")) ?? (tokens[0] as string);
}

/**
 * How a value-less flag is set from its payload key. A `--no-x` flag is the key `x` set to false, as
 * commander reads it, so it is written for a false value and never for true (the default). Decided
 * from the flag itself, so a registry row and a commander option read the same key the same way.
 * @req FR-NODE-281 AC-5
 */
function booleanKind(flag: string): PayloadOptionKind {
  return flag.startsWith("--no-") ? "negated-flag" : "flag";
}

/**
 * Every payload key the command takes, with its flag.
 *
 * The ToolSpec registry comes first, because its keys are the documented payload keys (some differ
 * from commander's own name, such as `reportPaths` for `--report`) and it alone knows which options
 * take JSON. Then every option commander declares on the command and on the program, under its
 * camelCase attribute name, so an option a caller can pass as a flag is never refused as a payload key:
 * `json`, `root`, init's `dryRun`, `update-status`'s `confirmDiscardVerified`. The program's
 * `--version` is left out: it prints the version instead of running the command.
 * @req FR-NODE-281 AC-5
 */
function payloadOptions(spec: ToolSpec, command: Command | undefined, program: Command): PayloadOption[] {
  const options = new Map<string, PayloadOption>();
  for (const option of spec.options) {
    const flag = longFlag(option.flag);
    const kind: PayloadOptionKind = option.encoding === "boolean" ? booleanKind(flag) : option.encoding === "json" ? "json" : "text";
    options.set(option.dest, { key: option.dest, flag, kind, repeatable: option.repeatable });
  }
  const declared = [...(command?.options ?? []), ...program.options.filter((option) => option.long !== "--version")];
  for (const option of declared) {
    const key = option.attributeName();
    if (options.has(key)) continue;
    const flag = longFlag(option.flags);
    const kind: PayloadOptionKind = option.required || option.optional ? "text" : booleanKind(flag);
    options.set(key, { key, flag, kind, repeatable: option.variadic || Array.isArray(option.defaultValue) });
  }
  return [...options.values()];
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
 * positionals (`registeredArguments` in `program`) and option keys and flags from the ToolSpec registry
 * and the command's and program's commander options ({@link payloadOptions}), so
 * the rewritten argv is equivalent to the discrete flags for every mutation command. The JSON value
 * may be an inline string, `-` (read from stdin), or omitted (read from stdin). Returns the argv
 * unchanged when no `--input-json` is present or the command is not a known mutation command. Throws
 * on malformed JSON, a non-object payload, a key the command does not declare, or a value that is not
 * text where the command takes text, so the caller can surface a usage error.
 */
export async function expandInputJsonArgv(argv: string[], program: Command): Promise<string[]> {
  const flagIndex = argv.indexOf(INPUT_JSON_FLAG);
  if (flagIndex === -1) return argv;

  const cliName = findMutationCommand(argv, program);
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
  const command = findCommand(program, cliName);
  const positionalsDeclared = declaredPositionals(program, cliName);
  const options = payloadOptions(spec, command, program);
  // A key the channel would not carry is refused, not dropped: dropping `"dry-run": true` turns a
  // preview into a write. @req FR-NODE-281 AC-5
  const declaredKeys = new Set([...positionalsDeclared.map((positional) => positional.name), ...options.map((option) => option.key)]);
  const undeclared = Object.keys(parsed).filter((key) => !declaredKeys.has(key));
  if (undeclared.length > 0) {
    const named = undeclared.map((key) => `"${key}"`).join(", ");
    const subject = undeclared.length === 1 ? `key ${named} is not an argument` : `keys ${named} are not arguments`;
    throw new Error(`input-json ${subject} of ${cliName}; speckiwi commands --json lists each option's payload key`);
  }
  const optionDescriptions = new Map(
    (command?.options ?? []).filter((option) => option.description !== "").map((option) => [option.long, `${option.flags}: ${option.description}`])
  );

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
  for (const positional of positionalsDeclared) {
    const value = parsed[positional.name];
    if (value === undefined) continue;
    if (positional.variadic && Array.isArray(value)) {
      for (const item of value) positionals.push(textToken(positional.name, item, undefined));
    } else {
      positionals.push(textToken(positional.name, value, undefined));
    }
  }

  const optionTokens: string[] = [];
  for (const option of options) {
    const value = parsed[option.key];
    if (value === undefined) continue;
    if (option.kind === "flag") {
      if (value) optionTokens.push(option.flag);
    } else if (option.kind === "negated-flag") {
      if (!value) optionTokens.push(option.flag);
    } else if (option.kind === "json") {
      // The discrete flag takes a JSON string, so the payload's structured value has to be encoded
      // back rather than stringified: String([...]) yields "[object Object]", which parses as
      // nothing. Only --items and --operations declare this encoding, and both belong to commands
      // that had no channel before IR-CLI-101, so this path had never been exercised.
      optionTokens.push(option.flag, JSON.stringify(value));
    } else if (option.repeatable && Array.isArray(value)) {
      for (const item of value) optionTokens.push(option.flag, textToken(option.key, item, optionDescriptions.get(option.flag)));
    } else {
      optionTokens.push(option.flag, textToken(option.key, value, optionDescriptions.get(option.flag)));
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
  const cliName = findMutationCommand(argv, program);
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
