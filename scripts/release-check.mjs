#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultCwd = resolve(dirname(scriptPath), "..");
const releaseAcceptanceTimeoutMs = 120_000;

export function releaseCommands() {
  return [
    { name: "build", command: "npm", args: ["run", "build"] },
    { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
    { name: "lint", command: "npm", args: ["run", "lint"] },
    { name: "test", command: "npm", args: ["test", "--", "--exclude", "test/release/**"] },
    { name: "release-acceptance", command: "npm", args: ["run", "release:acceptance"], timeoutMs: releaseAcceptanceTimeoutMs },
    { name: "pack", command: "npm", args: ["pack", "--dry-run"] }
  ];
}

export async function runReleaseCheck(options = {}) {
  const cwd = options.cwd ?? defaultCwd;
  const commands = options.commands ?? releaseCommands();
  const runner = options.runner ?? runCommand;
  const stdio = options.stdio ?? "inherit";

  for (const item of commands) {
    const exitCode = await runner(item, { cwd, stdio });
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}

export function runCommand(item, options) {
  return new Promise((resolveExit) => {
    const command = process.platform === "win32" && item.command === "npm" ? "npm.cmd" : item.command;
    let settled = false;
    let timeout;
    let forceTimeout;
    let timedOut = false;
    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimeout);
      resolveExit(exitCode);
    };
    const child = spawn(command, item.args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: options.stdio
    });
    const timeoutMs = Number.isFinite(item.timeoutMs) ? item.timeoutMs : undefined;
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceTimeout = setTimeout(() => {
          child.kill("SIGKILL");
          finish(1);
        }, 5_000);
      }, timeoutMs);
    }

    child.on("error", () => finish(1));
    child.on("close", (code, signal) => {
      if (timedOut || signal !== null) {
        finish(1);
      } else {
        finish(code ?? 1);
      }
    });
  });
}

if (process.argv[1] === scriptPath) {
  process.exitCode = await runReleaseCheck();
}
