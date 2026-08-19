import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Readers for the orchestrator skill's `## 0.G` table — the declaration of every gate that stops a
 * run regardless of `--auto`.
 *
 * One home rather than a copy per test file: the first copy of this walker was duplicated across two
 * files in one change, and only the copy inside the typecheck project's include list showed the
 * unchecked index access both carried.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Every shipped copy of the orchestrator body. A rule that holds in one is not a rule. */
export const ORCHESTRATOR_VARIANTS = [
  "skills/claude/kiwi-orchestrator/SKILL.md",
  "skills/codex/kiwi-orchestrator/SKILL.md",
  "skills/etc/kiwi-orchestrator/SKILL.md",
  ".agents/skills/kiwi-orchestrator/SKILL.md"
] as const;

/** ENOENT-to-"" so a missing variant fails as an assertion rather than a throw. */
export function readVariant(relativePath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

/** The `## 0.G` section of a skill body, or "" when the body has no such section. */
export function criticalGateTable(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^##\s*0\.G\b/.test(line));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && /^##\s/.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The gate identifiers a `## 0.G` table declares, in table order. */
export function declaredGateIds(table: string): string[] {
  return [...table.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].flatMap((match) => {
    const id = match[1];
    return id === undefined ? [] : [id];
  });
}
