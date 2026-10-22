import { execFile, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentCliOutcome, AgentCliRunner } from "../core/bootstrap/mcp-registration.js";

// @req FR-NODE-223 AC-8 — the runner the CLI hands to init and upgrade: the agent's own binary,
// resolved by name from PATH.

/** `claude mcp get` health-checks the server, which spawns it; a first `npx` fetch can take a while. */
const AGENT_CLI_TIMEOUT_MS = 60_000;

/**
 * Whether cmd.exe would find `name` on PATH. Asked up front because cmd reports a missing command
 * only as exit 1 with a message in the system language (measured: Korean on this host), which is the
 * same exit an agent CLI gives for an ordinary refusal.
 */
async function isOnWindowsPath(name: string): Promise<boolean> {
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // cmd accepts quoted PATH entries such as `"C:\Program Files\x"`.
  const directories = (process.env.PATH ?? "").split(path.delimiter).map((entry) => entry.replace(/^"(.*)"$/, "$1")).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const found = await access(path.join(directory, `${name}${extension}`)).then(
        () => true,
        () => false
      );
      if (found) return true;
    }
  }
  return false;
}

/**
 * Ends the child and everything it started. On Windows the child is cmd.exe and the agent runs under
 * it, so killing cmd alone leaves the agent running — and still holding the call's directory.
 */
function endProcessTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }
  child.kill();
}

/** A runner that gives each call `timeoutMs` before ending it and reporting it as timed out. */
export function createAgentCliRunner(timeoutMs: number): AgentCliRunner {
  return async (agent, args) => {
    const onWindows = process.platform === "win32";
    if (onWindows && !(await isOnWindowsPath(agent))) return { found: false, exitCode: 1, stdout: "", stderr: "" };
    // Never the caller's directory, which is the project. From there `claude mcp get` also finds the
    // project's own `.mcp.json` server and reports it as registered, and cmd.exe runs a `claude.cmd`
    // lying in the current directory ahead of the one on PATH. A directory made for this call holds
    // neither.
    const cwd = await mkdtemp(path.join(tmpdir(), "speckiwi-agent-cli-"));
    // On Windows both CLIs are commonly npm `.cmd` shims, which execFile cannot start without a shell.
    // The command line is joined here rather than passed as an argument array: Node deprecates args
    // with `shell: true` (DEP0190). Every token is a fixed constant from the core, never user input.
    const file = onWindows ? [agent, ...args].join(" ") : agent;
    const fileArgs = onWindows ? [] : [...args];
    const outcome = await new Promise<AgentCliOutcome>((resolve) => {
      let timedOut = false;
      const child = execFile(file, fileArgs, { cwd, encoding: "utf8", windowsHide: true, shell: onWindows }, (error, stdout, stderr) => {
        clearTimeout(deadline);
        if (error === null) {
          resolve({ found: true, exitCode: 0, stdout, stderr });
          return;
        }
        const code: unknown = (error as { code?: unknown }).code;
        // POSIX reports a binary missing from PATH as ENOENT; Windows was settled before the spawn.
        resolve({
          found: code !== "ENOENT",
          exitCode: typeof code === "number" ? code : 1,
          stdout,
          stderr: stderr || error.message,
          ...(timedOut ? { timedOut: true } : {})
        });
      });
      // execFile's own `timeout` kills only the direct child, which on Windows is cmd.exe.
      const deadline = setTimeout(() => {
        timedOut = true;
        endProcessTree(child);
      }, timeoutMs);
    });
    // Best effort: an empty directory left in the temp folder is harmless, and a cleanup failure must
    // not turn an agent's answer into a failed init.
    await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    return outcome;
  };
}

export const runAgentCli: AgentCliRunner = createAgentCliRunner(AGENT_CLI_TIMEOUT_MS);
