import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared reader and bilingual vocabulary for the four bundled `_shared/kiwi/auto-option.md`
 * renderings, plus the single `etc` rendering of `local-llm-profile.md`.
 *
 * `auto-option.md` is natural-language agent instruction, not executable code, so the `--auto`
 * contract is verified by raw-text presence and window-proximity assertions (the FR-FLOW-025 /
 * FR-FLOW-014 precedent) rather than by executing a skill. One module holds the vocabulary so the
 * seven requirement suites that read these files cannot drift into two spellings of one rule.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The contract ships in four copies. The `.agents/` mirror is byte-identical to the `codex`
 * rendering today, but it is read as its own copy because it is what an `.agents`-hosted agent
 * actually loads — an edit that reached three of the four would leave one host on the old contract.
 */
export const AUTO_OPTION_COPIES = [
  { id: "claude", relPath: "skills/claude/_shared/kiwi/auto-option.md" },
  { id: "codex", relPath: "skills/codex/_shared/kiwi/auto-option.md" },
  { id: "etc", relPath: "skills/etc/_shared/kiwi/auto-option.md" },
  { id: "agents-mirror", relPath: ".agents/skills/_shared/kiwi/auto-option.md" }
] as const;

/** `local-llm-profile.md` exists in exactly one rendering (FR-FLOW-071 AC-3). */
export const LOCAL_LLM_PROFILE = "skills/etc/_shared/kiwi/local-llm-profile.md";

/** The renderings in which `local-llm-profile.md` must NOT be created. */
export const LOCAL_LLM_PROFILE_ABSENT_FROM = [
  "skills/claude/_shared/kiwi/local-llm-profile.md",
  "skills/codex/_shared/kiwi/local-llm-profile.md",
  ".agents/skills/_shared/kiwi/local-llm-profile.md"
] as const;

/**
 * Reads a bundled skill file with line endings normalised to `\n`.
 *
 * These files ship CRLF. Every pattern below that spans a line break — a fenced block, a paragraph
 * split — would silently never match against `\r\n`, which is the wrapped-line vacuity trap in the
 * form that bites hardest: the assertion still runs, and still reports a clean absence.
 */
export function readRepoFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}

export function repoFileExists(relPath: string): boolean {
  return existsSync(path.join(REPO_ROOT, relPath));
}

export function autoOptionText(relPath: string): string {
  return readRepoFile(relPath);
}

/**
 * Text windows of +/- `radius` characters around every match of `re` in `text`.
 *
 * Proximity is how a co-occurrence claim is made discriminating: asserting two tokens exist
 * somewhere in a 400-line document proves nothing, while asserting they sit inside one window
 * proves the document ties them together.
 */
export function windowsAround(text: string, re: RegExp, radius = 300): string[] {
  const scan = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
  const out: string[] = [];
  for (let m = scan.exec(text); m; m = scan.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (scan.lastIndex === m.index) scan.lastIndex++;
  }
  return out;
}

/** True when some window around `anchor` satisfies every predicate in `required`. */
export function tiedTogether(
  text: string,
  anchor: RegExp,
  required: RegExp[],
  radius = 300
): boolean {
  return windowsAround(text, anchor, radius).some((w) => required.every((re) => re.test(w)));
}

/** Sentences of `text`, split on `.`/`!`/`?`/newline, with the delimiter dropped. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The first fenced ```json block that follows `heading` in `text`, JSON-parsed.
 *
 * The §10 / Logging audit-log schema is asserted by parsing rather than by substring matching so a
 * criterion that names a field and a value ("committee_size": 0) is checked against structure.
 */
export function jsonBlockAfter(text: string, heading: RegExp): unknown {
  const at = text.search(heading);
  if (at < 0) throw new Error(`heading ${heading} not found`);
  const fence = /```json\n([\s\S]*?)\n```/.exec(text.slice(at));
  if (!fence) throw new Error(`no fenced json block after ${heading}`);
  return JSON.parse(fence[1]);
}

// --- Bilingual vocabulary (Korean canonical `claude`, English `codex` / `etc` / `.agents`) -------

export const AUTO_FLAG = /--auto\b/;
export const MAX_FLAG = /--max\b/;
export const COMMITTEE = /committee|위원회/i;
export const RESEARCH = /research|investigat|리서치|조사|연구/i;
export const SELECT = /select|choose|adopt|most[\s-]*reasonable|선택|채택|가장\s*합리/i;

/** Member counts match only beside a member word, so "confidence >= 0.5" cannot satisfy a sizing. */
export const THREE = /\b3[\s-]*(?:members?|인|명|위원)|three[\s-]*members?|셋|세\s*(?:명|위원)/i;
export const FIVE = /\b5[\s-]*(?:members?|인|명|위원)|five[\s-]*members?|다섯/i;
export const SEVEN = /\b7[\s-]*(?:members?|인|명|위원)|seven[\s-]*members?|일곱/i;

export const SIMPLE_MAJORITY = /simple[\s-]*majority|단순\s*과반/i;
export const MAJORITY = /majority|과반|다수결/i;
export const IMMEDIATELY = /immediat|바로|즉시|곧바로/i;
export const UNANIMOUS = /unanim|만장일치|전원\s*일치/i;
export const PLURALITY = /plurality|최다\s*(?:득표|표)/i;

/**
 * The escalation-rung mechanism, narrowly: growing a committee or re-running its vote.
 *
 * Two senses are deliberately NOT matched, because both must survive the change and a regex that
 * swallowed either would make every rung-absence assertion unsatisfiable rather than merely false:
 * `--max` sizing the committee at 5, and escalating a *gate* to `critical` (Korean `critical 격상`).
 * The Korean rung is therefore `격상` qualified by a member word, never `격상` alone.
 */
export const RUNG =
  /escalat\w*\s+(?:one\s+rung|to\s+(?:a\s+)?(?:5|7|five|seven)|the\s+committee)|(?:위원(?:회)?|\d\s*인)[^.\n]{0,12}격상|re-?vote|재투표|재결정|add(?:ing|s)?\s+(?:two|2)\s+(?:more\s+)?members?|위원\s*2\s*인을?\s*추가|증원|3\s*(?:->|→|to)\s*5|5\s*(?:->|→|to)\s*7/i;

/** Any lead-member / senior-member tie-break mechanism (FR-FLOW-072 AC-3 deletes it everywhere). */
export const TIE_BREAK = /tie[-\s]?break|동점|동률|tie\s+is\s+broken/i;
export const LEAD_MEMBER = /lead\s+committee\s+member|lead\s+member|선임\s*위원|수석\s*위원|위원장/i;

export const HALT = /\bhalt\b|중단|정지|멈춤|HALT/;
export const CRITICAL = /critical/i;

/** The structured marker itself. A prose `(권장)` label is deliberately not matched. */
export const RECOMMENDED_MARKER = /`?recommended`?\s*:\s*true/i;
export const DEFAULT_IF_AUTO = /default_if_auto/;
export const PROSE_RECOMMENDATION_LABEL = /\(권장\)/;
export const NO_MACHINE_MEANING =
  /no\s+machine\s+meaning|never\s+parsed|기계적?\s*의미(가)?\s*없|파싱하지\s*않/i;

export const SPREAD = /spread|교차\s*검증|최고[·\s]*최저|highest\s+and\s+(?:the\s+)?lowest/i;
export const WINNING_BLOC =
  /winning\s+bloc|승리\s*(?:블록|진영|다수)|채택된?\s*옵션에?\s*투표한/i;
export const MINIMUM = /minimum|lowest|최소|가장\s*낮은/i;

/**
 * The governing-confidence rule itself: the value TAKEN is the minimum, within the winning bloc.
 *
 * A window assertion pairing `minimum` with `winning bloc` is satisfied by the criterion's own
 * exclusion list — "not the mean of the winning bloc, not the minimum across all members" — and so
 * survives a mutation that changes the operative sentence from minimum to mean. A mutation probe
 * caught exactly that, which is why this pattern requires the two tokens inside one sentence with
 * the verb that adopts the value, and refuses to cross a sentence boundary.
 */
export const GOVERNING_MINIMUM =
  /(?:take|takes|is|use|uses)\s+the\s+\*{0,2}minimum\*{0,2}[^.]{0,140}?winning\s+bloc|승리\s*블록[^.]{0,80}?최소값|최소값[^.]{0,80}?승리\s*블록/i;
