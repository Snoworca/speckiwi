import type { Command } from "commander";

// @req IR-CLI-100 — the identifiers worth searching for include CLI flags, and a query that starts
// with a dash is read by commander as an option. The double-dash escape already worked; what fails
// is the form an agent types first, and the usage error it gets back reads like a dead end rather
// than like "quote it differently".
//
// Normalising argv keeps this out of the option parser: the query token is lifted out and re-added
// after a separator, so options keep being parsed as options wherever the caller put them.

/** Commands whose single operand is free text a user may reasonably start with a dash. */
const DASH_QUERY_COMMANDS = new Set(["search"]);

/** Every option token the command accepts, long and short, plus whether it takes a value. */
function optionTokens(command: Command): Map<string, boolean> {
  const tokens = new Map<string, boolean>();
  for (const option of command.options) {
    const takesValue = option.required || option.optional;
    if (option.short) tokens.set(option.short, takesValue);
    if (option.long) tokens.set(option.long, takesValue);
  }
  return tokens;
}

function findSubcommand(root: Command, name: string): Command | undefined {
  return root.commands.find((child) => child.name() === name || child.aliases().includes(name));
}

/**
 * Moves a dash-leading query out of option position for the commands that take one.
 *
 * Returns argv unchanged when there is nothing to do: a different command, an explicit `--`
 * already present, or a first operand that does not start with a dash.
 */
export function normalizeDashQueryArgv(argv: string[], root: Command): string[] {
  const name = argv[0];
  if (name === undefined || !DASH_QUERY_COMMANDS.has(name)) return argv;
  if (argv.includes("--")) return argv;

  const subcommand = findSubcommand(root, name);
  if (subcommand === undefined) return argv;

  const tokens = optionTokens(subcommand);
  const rest = argv.slice(1);
  const kept: string[] = [];
  let query: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;

    if (token.startsWith("-") && token !== "-") {
      // `--flag=value` carries its own value; the map is keyed on the flag alone.
      const flag = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
      if (tokens.has(flag)) {
        kept.push(token);
        // A value-taking flag consumes the next token, which must not be mistaken for the query.
        if (tokens.get(flag) === true && !token.includes("=") && index + 1 < rest.length) {
          index += 1;
          kept.push(rest[index] as string);
        }
        continue;
      }
      // An unknown dash token: the query, if we have not already taken one.
      if (query === undefined) { query = token; continue; }
      kept.push(token);
      continue;
    }

    // A plain operand is the query when no dash token claimed the role first.
    if (query === undefined && !kept.includes(token)) { query = token; continue; }
    kept.push(token);
  }

  if (query === undefined || !query.startsWith("-")) return argv;
  return [name, ...kept, "--", query];
}
