import type { Command } from "commander";

/**
 * @req REL-FLOW-003 — a mechanical pass over a prose document's factual claims.
 *
 * Every check compares the document against a ground truth the caller enumerates from the symbol
 * that owns it (the live commander tree, the MCP tool registry, the doctor check list). Nothing
 * here reads the filesystem or infers meaning from language: a claim is checked only when it
 * matches an explicitly registered shape, so a check either has a source of truth or does not run.
 */

export type DocLintCheck = "command" | "anchor" | "mcp-tool" | "count";

export interface DocLintFinding {
  readonly check: DocLintCheck;
  /** 1-based line of the offending claim. */
  readonly line: number;
  /** The claim itself: a subcommand name, an anchor id, a tool token, or an enumerator id. */
  readonly token: string;
  readonly detail: string;
}

export type CountEnumerator = "mcp-tools" | "mcp-tools-orchestrate" | "mcp-tools-workflow" | "doctor-checks";

export interface DocLintGroundTruth {
  /** Every space-joined subcommand path the CLI registers, aliases included. */
  readonly commandPaths: ReadonlySet<string>;
  /** Every registered MCP tool name. */
  readonly toolNames: ReadonlySet<string>;
  /** Enumerator id -> the size of the set it enumerates. */
  readonly counts: ReadonlyMap<string, number>;
}

/**
 * The phrase registry. A numeric claim is checked only if it matches one of these patterns, so the
 * check never guesses what a number in a sentence means. Each entry names the enumerator whose set
 * size the number must equal; adding a claim to the document means adding a row here.
 */
export const COUNT_PHRASES: ReadonlyArray<{ id: string; enumerator: CountEnumerator; pattern: RegExp }> = [
  { id: "mcp-tools-total-en", enumerator: "mcp-tools", pattern: /\*\*(\d+) tools ship in total\.\*\*/g },
  { id: "mcp-tools-total-ko", enumerator: "mcp-tools", pattern: /총 (\d+)개 도구가 배포됩니다/g },
  { id: "orchestrate-family-en", enumerator: "mcp-tools-orchestrate", pattern: /(\d+) `orchestrate_\*` tools/g },
  { id: "orchestrate-family-ko", enumerator: "mcp-tools-orchestrate", pattern: /`orchestrate_\*` (\d+)개/g },
  { id: "workflow-family-en", enumerator: "mcp-tools-workflow", pattern: /(\d+) `workflow_\*` tools/g },
  { id: "workflow-family-ko", enumerator: "mcp-tools-workflow", pattern: /`workflow_\*` (\d+)개 —/g },
  { id: "workflow-family-all-en", enumerator: "mcp-tools-workflow", pattern: /`workflow_\*` \(all (\d+)\)/g },
  { id: "workflow-family-all-ko", enumerator: "mcp-tools-workflow", pattern: /`workflow_\*` \((\d+)개 전부\)/g },
  { id: "doctor-checks-en", enumerator: "doctor-checks", pattern: /# (\d+) checks:/g },
  { id: "doctor-checks-ko", enumerator: "doctor-checks", pattern: /# (\d+)개 검사:/g }
];

/** Fence languages whose body is executable shell, and therefore carries command claims. */
const SHELL_FENCES = new Set(["sh", "bash", "shell", "zsh", "console"]);

const IGNORE_MARKER = /^\s*<!--\s*doc-lint:\s*ignore\s*-->\s*$/;
const FENCE = /^\s*```(\S*)\s*$/;
const COMMAND_LINE = /^\s*(?:npx\s+)?speckiwi\b/;
// `family_*` is a token shape of its own: the underscore is followed by the star, not by a name.
const TOOL_TOKEN = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)*_\*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;
const ANCHOR_ID = /<a\s+(?:[^>]*\s)?id="([^"]+)"/g;
const MARKDOWN_LINK = /\]\(#([^)\s]+)\)/g;
const HTML_LINK = /href="#([^"]+)"/g;

/** Every subcommand path the tree admits, so resolution is a set lookup against the real CLI. */
export function collectCommandPaths(program: Command): Set<string> {
  const paths = new Set<string>();
  const walk = (parent: Command, prefix: readonly string[]): void => {
    for (const child of parent.commands) {
      const names = [...prefix, child.name()];
      paths.add(names.join(" "));
      for (const alias of child.aliases()) paths.add([...prefix, alias].join(" "));
      walk(child, names);
    }
  };
  walk(program, []);
  return paths;
}

function hasChildren(paths: ReadonlySet<string>, prefix: string): boolean {
  if (prefix === "") return paths.size > 0;
  const needle = `${prefix} `;
  for (const candidate of paths) if (candidate.startsWith(needle)) return true;
  return false;
}

function ignoredLines(lines: readonly string[]): Set<number> {
  const ignored = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (!IGNORE_MARKER.test(lines[index] as string)) continue;
    let target = index + 1;
    while (target < lines.length && (lines[target] as string).trim() === "") target += 1;
    if (target >= lines.length) break;
    if (!FENCE.test(lines[target] as string)) {
      ignored.add(target + 1);
      continue;
    }
    let end = target + 1;
    while (end < lines.length && !FENCE.test(lines[end] as string)) end += 1;
    for (let line = target; line <= Math.min(end, lines.length - 1); line += 1) ignored.add(line + 1);
  }
  return ignored;
}

/** The fence language in effect on each line, or null outside a fence. Fence delimiters are null. */
function fenceLanguages(lines: readonly string[]): Array<string | null> {
  const languages: Array<string | null> = [];
  let current: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence) {
      current = current === null ? (fence[1] ?? "").toLowerCase() : null;
      languages.push(null);
      continue;
    }
    languages.push(current);
  }
  return languages;
}

/** Every `speckiwi …` line inside a shell fence, with its trailing `#` comment removed. */
export function extractFencedCommands(text: string): Array<{ line: number; command: string }> {
  const lines = text.split(/\r?\n/);
  const languages = fenceLanguages(lines);
  const commands: Array<{ line: number; command: string }> = [];
  lines.forEach((line, index) => {
    const language = languages[index];
    if (language === null || !SHELL_FENCES.has(language)) return;
    if (!COMMAND_LINE.test(line)) return;
    commands.push({ line: index + 1, command: line.replace(/\s+#.*$/, "").trim() });
  });
  return commands;
}

/**
 * The first token of a command line that names no registered subcommand. Options and `<placeholder>`
 * arguments end the walk, and so does reaching a leaf command, whose remaining tokens are arguments.
 */
function unresolvedSubcommand(command: string, paths: ReadonlySet<string>): string | null {
  const tokens = command.split(/\s+/).filter(Boolean);
  const start = tokens.indexOf("speckiwi") + 1;
  let consumed = "";
  for (const token of tokens.slice(start)) {
    if (token.startsWith("-") || /^[<[(]/.test(token)) return null;
    if (!hasChildren(paths, consumed)) return null;
    const candidate = consumed === "" ? token : `${consumed} ${token}`;
    if (!paths.has(candidate)) return token;
    consumed = candidate;
  }
  return null;
}

/** The explicit `<a id="…">` anchors this repository uses; heading auto-slugs are not anchors. */
export function extractAnchorIds(text: string): Set<string> {
  return new Set([...text.matchAll(ANCHOR_ID)].map((match) => match[1] as string));
}

export function extractAnchorLinks(text: string): Array<{ line: number; id: string }> {
  const links: Array<{ line: number; id: string }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of [MARKDOWN_LINK, HTML_LINK]) {
      for (const match of line.matchAll(pattern)) links.push({ line: index + 1, id: match[1] as string });
    }
  });
  return links;
}

/**
 * GitHub's heading auto-slug. Present so the test can assert this repository's anchors are NOT
 * slugs: a slug-based checker was measured reporting 26/26 false positives here.
 */
export function githubHeadingSlug(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function headingSlugs(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .filter((line) => /^#{1,6}\s/.test(line))
      .map(githubHeadingSlug)
  );
}

/**
 * Tool-name claims: backticked snake_case tokens inside a Markdown table row. The tables are where
 * this document asserts a tool exists; the same token in prose can be a Status value or a journal
 * record, which is why the scope is the row and not the backtick.
 */
export function extractToolTokens(text: string): Array<{ line: number; token: string }> {
  const tokens: Array<{ line: number; token: string }> = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!/^\s*\|/.test(line)) return;
    for (const match of line.matchAll(TOOL_TOKEN)) tokens.push({ line: index + 1, token: match[1] as string });
  });
  return tokens;
}

function toolTokenResolves(token: string, toolNames: ReadonlySet<string>): boolean {
  if (!token.endsWith("*")) return toolNames.has(token);
  const prefix = token.slice(0, -1);
  for (const name of toolNames) if (name.startsWith(prefix)) return true;
  return false;
}

export function lintDocument(text: string, truth: DocLintGroundTruth): DocLintFinding[] {
  const lines = text.split(/\r?\n/);
  const exempt = ignoredLines(lines);
  const findings: DocLintFinding[] = [];

  for (const { line, command } of extractFencedCommands(text)) {
    const token = unresolvedSubcommand(command, truth.commandPaths);
    if (token === null) continue;
    findings.push({
      check: "command",
      line,
      token,
      detail: `\`${command}\` names no registered subcommand path: \`speckiwi ${token}\``
    });
  }

  const anchors = extractAnchorIds(text);
  for (const link of extractAnchorLinks(text)) {
    if (anchors.has(link.id)) continue;
    findings.push({
      check: "anchor",
      line: link.line,
      token: link.id,
      detail: `#${link.id} has no <a id="${link.id}"> anchor in this document`
    });
  }

  for (const { line, token } of extractToolTokens(text)) {
    if (toolTokenResolves(token, truth.toolNames)) continue;
    findings.push({
      check: "mcp-tool",
      line,
      token,
      detail: token.endsWith("*")
        ? `no registered MCP tool starts with \`${token.slice(0, -1)}\``
        : `\`${token}\` is not a registered MCP tool`
    });
  }

  lines.forEach((line, index) => {
    for (const phrase of COUNT_PHRASES) {
      const pattern = new RegExp(phrase.pattern.source, phrase.pattern.flags);
      for (const match of line.matchAll(pattern)) {
        const claimed = Number(match[1]);
        const actual = truth.counts.get(phrase.enumerator);
        if (actual === undefined || claimed === actual) continue;
        findings.push({
          check: "count",
          line: index + 1,
          token: phrase.enumerator,
          detail: `${phrase.id} claims ${claimed}, but ${phrase.enumerator} enumerates ${actual}`
        });
      }
    }
  });

  return findings.filter((finding) => !exempt.has(finding.line)).sort((left, right) => left.line - right.line);
}
