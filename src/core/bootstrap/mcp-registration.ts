import { readFile, rename, rm, writeFile } from "node:fs/promises";
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

export interface McpRegistrationResult {
  status: McpRegistrationStatus;
  filePath: string;
  warnings: string[];
}

const MCP_CONFIG_FILE = ".mcp.json";
const SERVER_KEY = "speckiwi";

/** The `.mcp.json` launcher entry for the SpecKiwi stdio MCP server. */
function speckiwiServerEntry(): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", "speckiwi", "mcp"] };
}

const CODEX_REMEDIATION =
  "Codex MCP registration is not written automatically (the global ~/.codex/config.toml is left " +
  "untouched). To register speckiwi for Codex run: codex mcp add speckiwi -- npx -y speckiwi mcp";

function unparseableWarning(filePath: string): string {
  return (
    `Existing ${filePath} is not a usable JSON object with an "mcpServers" map; speckiwi left it unchanged. ` +
    `Add the speckiwi MCP server manually under "mcpServers": ${JSON.stringify(speckiwiServerEntry())}.`
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
  const warnings = [CODEX_REMEDIATION];
  const existing = await readExisting(filePath);

  if (existing.kind === "absent") {
    const content = `${JSON.stringify({ mcpServers: { [SERVER_KEY]: speckiwiServerEntry() } }, null, 2)}\n`;
    if (!dryRun) await writeAtomic(filePath, content);
    return { status: "created", filePath, warnings };
  }
  if (existing.kind === "unreadable") {
    warnings.push(unparseableWarning(filePath));
    return { status: "warning", filePath, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing.text);
  } catch {
    warnings.push(unparseableWarning(filePath));
    return { status: "warning", filePath, warnings };
  }
  if (!isPlainObject(parsed)) {
    warnings.push(unparseableWarning(filePath));
    return { status: "warning", filePath, warnings };
  }

  const rawServers = parsed.mcpServers;
  if (rawServers !== undefined && !isPlainObject(rawServers)) {
    // A non-object mcpServers (array, string, …) must not be spread/clobbered — warn and leave it.
    warnings.push(unparseableWarning(filePath));
    return { status: "warning", filePath, warnings };
  }
  const servers = rawServers ?? {};
  if (Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)) {
    return { status: "skipped", filePath, warnings };
  }

  const next = { ...parsed, mcpServers: { ...servers, [SERVER_KEY]: speckiwiServerEntry() } };
  if (!dryRun) await writeAtomic(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return { status: "updated", filePath, warnings };
}
