// One MCP `orchestrate_run_lock` call, in its own operating-system process.
//
// The MCP bridge does not spawn anything: it re-encodes the call as argv and runs the CLI's `main`
// inside the server process (`src/mcp/tools/read-tools.ts`). So the only way to ask the MCP surface
// the question FR-NODE-207 AC-2 asks — is a lease taken by an already-exited process refused? — is
// to be a *different* process from the one that took it. That is what this script is.
//
// It loads `dist/`, as `bin/speckiwi` does, because the bridge's import graph uses `.js` specifiers
// that Node's strip-only TypeScript loader cannot resolve against `src/`. The suite that spawns this
// asserts `dist/` is not older than the source it mirrors, so a stale build fails loudly instead of
// answering for code nobody is testing.
import { pathToFileURL } from "node:url";

const [, , repoRoot, fixtureRoot, owner, action = "lock"] = process.argv;

const orchestrate = await import(pathToFileURL(`${repoRoot}/dist/cli/commands/orchestrate.js`).href);
const readTools = await import(pathToFileURL(`${repoRoot}/dist/mcp/tools/read-tools.js`).href);

const binding = orchestrate.ORCHESTRATE_TOOL_BINDINGS.find((row) => row.tool === "orchestrate_run_lock");
if (!binding) throw new Error("orchestrate_run_lock is not a registered MCP binding");

const result = await readTools.callOrchestrateTool(binding, { action, owner }, { root: fixtureRoot });
process.stdout.write(`${JSON.stringify(result)}\n`);
