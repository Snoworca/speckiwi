import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @req FR-FLOW-110
// A skill body is no longer self-contained: FR-FLOW-106..109 move whole rule sets out of
// `kiwi-wave-master/SKILL.md` into `_shared/kiwi/` modules that the skill's §0 table references.
// A reader that opens only SKILL.md therefore stops seeing rules that still govern the skill, and
// every text assertion over those rules goes red for a reason that is not a regression.
//
// `readResolvedSkill` is the reader those assertions use instead. It returns the SKILL.md body with
// the body of every `_shared/kiwi/` module the §0 table references APPENDED, in the order that table
// lists them. Against a skill that has not been extracted yet the result is byte-identical to the old
// reader plus whatever shared modules that skill already referenced, which is why swapping the readers
// is verified by the pre-existing assertions staying green.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** ENOENT-to-"" so a net-new file fails as a clean AssertionError instead of throwing. */
function readOrEmpty(absPath: string): string {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

/** Body with the leading YAML frontmatter block stripped. */
export function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/**
 * The skill's `## 0.` section — the SSOT table that declares which shared modules the skill follows.
 * Scoped to `## 0.` exactly, not `## 0.G`, because only the SSOT table carries module references.
 */
export function sectionZero(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^##\s*0\.\s/.test(line));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * The `_shared/kiwi/` module basenames the §0 table references, in first-mention order, de-duplicated.
 * Order is load-bearing: the concatenation below must reproduce it so a reader is deterministic.
 */
export function sharedModuleRefs(skillText: string): string[] {
  const zero = sectionZero(stripFrontmatter(skillText));
  const out: string[] = [];
  const re = /_shared\/kiwi\/([A-Za-z0-9._-]+)\.md/g;
  for (let m = re.exec(zero); m; m = re.exec(zero)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Every heading line prefixed with `[<module>.md] `, so an appended heading can never win a
 * `findIndex` against the skill's own heading of the same text. `sectionUnder` takes the FIRST
 * matching heading, and `auto-option.md` alone carries `## 5. critical_gates[] 인터페이스`, which
 * matches the gate-section regex four skills are asserted with — without the prefix (or with a
 * prepending concatenation) those assertions would silently resolve against the shared module.
 * Fenced-code lines starting with `#` are not headings and are left alone.
 */
export function prefixHeadings(body: string, moduleName: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      return m ? `${m[1]} [${moduleName}.md] ${m[2]}` : line;
    })
    .join("\n");
}

/**
 * The appended region belonging to one shared module of a resolved skill — from its first
 * `[<module>.md]`-prefixed heading to the next module's first heading, or the end.
 *
 * This is what keeps a moved rule's assertion SECTION-SCOPED rather than body-wide after the
 * extraction: a rule that lived under `kiwi-wave-master §5.5.4` and now lives under
 * `verify-loop.md` is still read from one bounded region, so a neighbouring section restating the
 * same tokens cannot satisfy it. "" when the skill does not reference that module.
 */
export function moduleRegion(resolvedBody: string, moduleName: string): string {
  const lines = resolvedBody.split("\n");
  const mine = new RegExp(`^#{1,6}\\s+\\[${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md\\]\\s`);
  const anyModule = /^#{1,6}\s+\[[A-Za-z0-9._-]+\.md\]\s/;
  const start = lines.findIndex((l) => mine.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (anyModule.test(lines[i]) && !mine.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * A skill body plus the bodies of the shared modules its §0 table references, appended in table order.
 * Appended, never prepended — see `prefixHeadings`.
 */
export function readResolvedSkill(variant: string, skill: string): string {
  const raw = readOrEmpty(path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"));
  if (raw === "") return "";
  const parts = [raw];
  for (const name of sharedModuleRefs(raw)) {
    const moduleText = readOrEmpty(
      path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", `${name}.md`)
    );
    if (moduleText === "") continue;
    parts.push(prefixHeadings(stripFrontmatter(moduleText), name));
  }
  return parts.join("\n\n");
}
