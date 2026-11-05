import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-NODE-270 AC-10 — no README example of `append-note --mode replace` is one the tool refuses,
// and the README says why the flag is there.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KOREAN_HEADING = "# SpecKiwi (한국어)";
const SHELL_INFO = new Set(["sh", "bash", "shell", "console", "powershell", "ps1", "pwsh"]);

function readmeHalves(): { en: string; ko: string } {
  const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const split = readme.indexOf(`\n${KOREAN_HEADING}\n`);
  expect(split, "README.md must carry the Korean section heading").toBeGreaterThan(0);
  return { en: readme.slice(0, split), ko: readme.slice(split) };
}

/** The commands written in the shell fences of `text`, a backslash or backtick continuation joined to its line. */
function shellCommands(text: string): string[] {
  const commands: string[] = [];
  let inShell = false;
  let inFence = false;
  let pending = "";
  for (const line of text.split("\n")) {
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      if (inFence) {
        inFence = false;
        inShell = false;
      } else {
        inFence = true;
        inShell = SHELL_INFO.has(fence[1] ?? "");
      }
      continue;
    }
    if (!inShell) continue;
    const continued = /[\\`]\s*$/.test(line);
    pending += `${line.replace(/[\\`]\s*$/, "")} `;
    if (!continued) {
      commands.push(pending.trim());
      pending = "";
    }
  }
  return commands;
}

function replaceCommands(text: string): string[] {
  return shellCommands(text).filter((command) => /\bappend-note\b/.test(command) && /--mode[ =]replace\b/.test(command));
}

describe("FR-NODE-270 AC-10 — the README's replace examples and their description", () => {
  for (const key of ["en", "ko"] as const) {
    // @req FR-NODE-270 AC-10
    it(`${key}: every append-note --mode replace example carries --dry-run or --confirm-replace`, () => {
      const commands = replaceCommands(readmeHalves()[key]);
      // The README is known to show a replace example in each half; zero found means the scan broke.
      expect(commands.length).toBeGreaterThan(0);
      const unguarded = commands.filter((command) => !/--dry-run\b|--confirm-replace\b/.test(command));
      expect(unguarded).toEqual([]);
    });

    // @req FR-NODE-270 AC-10
    it(`${key}: the description of append-note --mode replace says a replace removing an item needs --confirm-replace`, () => {
      const description = readmeHalves()[key]
        .split("\n")
        .filter((line) => line.startsWith("- ") && line.includes("`append-note --mode replace`"));
      expect(description).toHaveLength(1);
      expect(description[0]).toContain("--confirm-replace");
      expect(description[0]).toMatch(key === "en" ? /removes? (an|at least one) item/ : /항목을 (하나라도 )?지우/);
    });
  }
});
