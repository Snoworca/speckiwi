import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// FR-NODE-067 — speckiwi init MCP server project registration.
//
// Registers the SpecKiwi stdio MCP server into the project's Claude Code `.mcp.json`, idempotently:
// create the file when absent, non-destructively merge the `speckiwi` server key into an existing
// file (preserving all other servers and top-level keys), skip when a `speckiwi` key already exists,
// and refuse to overwrite an unparseable file (warn instead). The global `~/.codex/config.toml` is
// never edited (no TOML parser is bundled and clobbering a global cross-project file is unrecoverable);
// instead a Codex remediation warning is always surfaced.

export type McpRegistrationStatus = "created" | "updated" | "skipped" | "warning";

/** The coding agents whose own CLI registers an MCP server at user scope. @req FR-NODE-223 */
export type AgentCli = "claude" | "codex";

/** What one agent CLI invocation answered. `found: false` means the binary is not on PATH. */
export interface AgentCliOutcome {
  found: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Killed at the runner's deadline: says nothing about whether the server is registered. */
  timedOut?: boolean;
}

/**
 * The only way the core reaches an agent CLI. @req FR-NODE-223 AC-8 — the core owns this type and the
 * CLI passes the implementation, so no core path spawns a binary of its own and a test can answer for
 * the agent without one.
 */
export type AgentCliRunner = (agent: AgentCli, args: readonly string[]) => Promise<AgentCliOutcome>;

export interface McpRegistrationResult {
  status: McpRegistrationStatus;
  filePath: string;
  warnings: string[];
}

const MCP_CONFIG_FILE = ".mcp.json";
const SERVER_KEY = "speckiwi";

export interface McpLauncher {
  command: string;
  args: string[];
}

/** The ordinary launcher: resolve the published package at launch time. */
const PUBLISHED_LAUNCHER: McpLauncher = { command: "npx", args: ["-y", "speckiwi", "mcp"] };

/** The launcher for a checkout of SpecKiwi itself: run what this checkout builds. */
const SELF_HOSTED_LAUNCHER: McpLauncher = { command: "node", args: ["bin/speckiwi", "mcp"] };

/**
 * Whether `root` is a checkout of SpecKiwi itself, which is the one project where the published copy
 * is guaranteed to be the wrong one — the point of working in the checkout is to run what the
 * checkout builds. Measured 2026-08-11: this repository's own `.mcp.json` said `npx -y speckiwi mcp`
 * and the session's server reported 2.7.1 against a 2.7.2 checkout, missing exactly the tool the
 * newer build adds.
 *
 * BOTH signals are required. The name alone is satisfied by a fork or a scratch directory with no
 * built entrypoint, and pointing those at `bin/speckiwi` would register a launcher that cannot
 * start. @req FR-NODE-187
 */
export async function isSelfHostingCheckout(root: string): Promise<boolean> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    // Absent, unreadable or malformed — an ordinary project, and never a reason to fail registration.
    return false;
  }
  if (!isPlainObject(manifest) || manifest.name !== SERVER_KEY) return false;
  return access(path.join(root, "bin", "speckiwi")).then(
    () => true,
    () => false
  );
}

/** The `.mcp.json` launcher entry for the SpecKiwi stdio MCP server. @req FR-NODE-187 */
async function speckiwiServerEntry(root: string): Promise<McpLauncher> {
  return (await isSelfHostingCheckout(root)) ? SELF_HOSTED_LAUNCHER : PUBLISHED_LAUNCHER;
}

/**
 * Codex registration is never written automatically, so the operator is told what to run. The command
 * quotes the SAME launcher the detection selected — advising `npx -y speckiwi mcp` inside a
 * self-hosting checkout would recreate exactly the drift FR-NODE-187 removes. @req FR-NODE-187
 */
function codexRemediation(entry: McpLauncher): string {
  return (
    "Codex MCP registration is not written automatically (the global ~/.codex/config.toml is left " +
    `untouched). To register speckiwi for Codex run: ${commandLine("codex", userScopeCommands("codex", entry).add)}`
  );
}

/**
 * The detect and register commands for each agent's own CLI. @req FR-NODE-223 AC-2/AC-3 — measured:
 * `claude mcp add` refuses an existing name while `codex mcp add` silently overwrites one, so the
 * `get` always comes first and is what decides "already registered".
 */
function userScopeCommands(agent: AgentCli, entry: McpLauncher): { get: string[]; add: string[] } {
  const launcher = ["--", entry.command, ...entry.args];
  return agent === "claude"
    ? { get: ["mcp", "get", SERVER_KEY], add: ["mcp", "add", "-s", "user", SERVER_KEY, ...launcher] }
    : { get: ["mcp", "get", SERVER_KEY, "--json"], add: ["mcp", "add", SERVER_KEY, ...launcher] };
}

function commandLine(agent: AgentCli, args: readonly string[]): string {
  return [agent, ...args].join(" ");
}

export type UserScopeRegistrationStatus = "created" | "skipped" | "planned" | "warning";

export interface UserScopeRegistrationResult {
  status: UserScopeRegistrationStatus;
  /** The entry a report lists under created or skipped. */
  label: string;
  /** The command lines run, in order; under dry-run, the ones a real run would issue. */
  commands: string[];
  warning?: string;
}

/**
 * Registers the SpecKiwi server at user scope through the agent's own CLI, so the agent writes its own
 * config file and SpecKiwi never edits `~/.claude.json` or `~/.codex/config.toml`. @req FR-NODE-223
 *
 * Always the published launcher: a SpecKiwi checkout never reaches this (it is onboarded at project
 * scope), and its relative `node bin/speckiwi` would resolve against every other project's directory.
 */
export async function registerSpeckiwiMcpForUser(
  agent: AgentCli,
  runner: AgentCliRunner | undefined,
  options: { dryRun?: boolean } = {}
): Promise<UserScopeRegistrationResult> {
  const { get, add } = userScopeCommands(agent, PUBLISHED_LAUNCHER);
  const label = `${agent} mcp (user scope): ${SERVER_KEY}`;
  const manual = commandLine(agent, add);
  if (options.dryRun) return { status: "planned", label, commands: [commandLine(agent, get), manual] };
  const commands: string[] = [];
  const byHand = (reason: string): UserScopeRegistrationResult => ({
    status: "warning",
    label,
    commands,
    warning: `${agent} MCP registration: ${reason}. To register speckiwi for ${agent} run: ${manual}`
  });
  if (runner === undefined) return byHand("no agent CLI runner was given");
  commands.push(commandLine(agent, get));
  const existing = await runner(agent, get);
  if (!existing.found) return byHand(`the ${agent} CLI was not found on PATH`);
  // A `get` killed at the deadline proves nothing either way, and an `add` after it would at best fail.
  if (existing.timedOut) return byHand(`\`${commandLine(agent, get)}\` timed out`);
  if (existing.exitCode === 0) return { status: "skipped", label, commands };
  commands.push(manual);
  const added = await runner(agent, add);
  if (!added.found) return byHand(`the ${agent} CLI was not found on PATH`);
  if (added.exitCode === 0) return { status: "created", label, commands };
  if (added.timedOut) return byHand(`\`${manual}\` timed out`);
  const detail = added.stderr.trim().split(/\r?\n/)[0] ?? "";
  return byHand(`\`${manual}\` exited ${added.exitCode}${detail ? ` (${detail})` : ""}`);
}

function unparseableWarning(filePath: string, entry: McpLauncher): string {
  return (
    `Existing ${filePath} is not a usable JSON object with an "mcpServers" map; speckiwi left it unchanged. ` +
    `Add the speckiwi MCP server manually under "mcpServers": ${JSON.stringify(entry)}.`
  );
}

type ExistingConfig = { kind: "absent" } | { kind: "unreadable" } | { kind: "content"; text: string };

async function readExisting(filePath: string): Promise<ExistingConfig> {
  try {
    return { kind: "content", text: await readFile(filePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    // EISDIR (a directory), EACCES, etc. — cannot safely read or merge; leave the path untouched.
    return { kind: "unreadable" };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is exactly `entry` as registration writes it — no other field, the same args. */
function isLauncher(value: unknown, entry: McpLauncher): boolean {
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || value.command !== entry.command) return false;
  const args = value.args;
  return Array.isArray(args) && args.length === entry.args.length && args.every((arg, index) => arg === entry.args[index]);
}

/** Writes `content` to `filePath` atomically via a sibling temp file + rename; cleans up on failure. */
async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.speckiwi-tmp`;
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function registerSpeckiwiMcp(
  root: string,
  options: { dryRun?: boolean } = {}
): Promise<McpRegistrationResult> {
  const dryRun = Boolean(options.dryRun);
  const filePath = path.join(root, MCP_CONFIG_FILE);
  const entry = await speckiwiServerEntry(root);
  const warnings = [codexRemediation(entry)];
  const existing = await readExisting(filePath);

  if (existing.kind === "absent") {
    const content = `${JSON.stringify({ mcpServers: { [SERVER_KEY]: entry } }, null, 2)}\n`;
    if (!dryRun) await writeAtomic(filePath, content);
    return { status: "created", filePath, warnings };
  }
  if (existing.kind === "unreadable") {
    warnings.push(unparseableWarning(filePath, entry));
    return { status: "warning", filePath, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing.text);
  } catch {
    warnings.push(unparseableWarning(filePath, entry));
    return { status: "warning", filePath, warnings };
  }
  if (!isPlainObject(parsed)) {
    warnings.push(unparseableWarning(filePath, entry));
    return { status: "warning", filePath, warnings };
  }

  const rawServers = parsed.mcpServers;
  if (rawServers !== undefined && !isPlainObject(rawServers)) {
    // A non-object mcpServers (array, string, …) must not be spread/clobbered — warn and leave it.
    warnings.push(unparseableWarning(filePath, entry));
    return { status: "warning", filePath, warnings };
  }
  const servers = rawServers ?? {};
  if (Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)) {
    return { status: "skipped", filePath, warnings };
  }

  const next = { ...parsed, mcpServers: { ...servers, [SERVER_KEY]: entry } };
  if (!dryRun) await writeAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return { status: "updated", filePath, warnings };
}

/** `foreign`: the key holds something other than the launcher SpecKiwi writes, under `ownedOnly`. */
export type McpUnregistrationStatus = "removed" | "absent" | "unreadable" | "foreign";

export interface McpUnregistrationResult {
  status: McpUnregistrationStatus;
  filePath: string;
}

/**
 * Removes the `speckiwi` server key, and only that key.
 *
 * @req FR-NODE-191 — the inverse of the registration above, at the same granularity. Registration
 * merges one key into whatever file it finds and records nothing about whether it created that file,
 * so removal has no way to tell a file init wrote from one the operator wrote. Deleting the file would
 * therefore be a guess with the operator's other servers riding on it; an empty `mcpServers` map is a
 * valid configuration and is what an undone registration looks like.
 */
export async function unregisterSpeckiwiMcp(root: string, options: { dryRun?: boolean; ownedOnly?: boolean } = {}): Promise<McpUnregistrationResult> {
  const filePath = path.join(root, MCP_CONFIG_FILE);
  const existing = await readExisting(filePath);
  if (existing.kind === "absent") return { status: "absent", filePath };
  if (existing.kind === "unreadable") return { status: "unreadable", filePath };

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing.text);
  } catch {
    return { status: "unreadable", filePath };
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) return { status: "unreadable", filePath };

  const servers = parsed.mcpServers;
  if (!Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)) return { status: "absent", filePath };
  // @req FR-NODE-224 AC-4 — `speckiwi remove` is asked to undo the wiring and takes the key whatever it
  // holds. An upgrade is not asked that: it takes the key only as the launcher this project's
  // registration writes, so an entry the operator customised (env, args) survives the migration.
  if (options.ownedOnly && !isLauncher(servers[SERVER_KEY], await speckiwiServerEntry(root))) return { status: "foreign", filePath };

  const remaining = Object.fromEntries(Object.entries(servers).filter(([key]) => key !== SERVER_KEY));
  const next = { ...parsed, mcpServers: remaining };
  if (!options.dryRun) await writeAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return { status: "removed", filePath };
}
