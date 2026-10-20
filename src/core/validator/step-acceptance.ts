import type { StepFileInput } from "./validate-scoped.js";

// @req FR-PARSE-042
//
// The one predicate that decides whether a tdd step has a written acceptance contract before tests.
// `speckiwi step validate`, MCP `validate_step`, `speckiwi vibe-gate check` and MCP `check_vibe_gate`
// all call it, so no surface can judge a step differently from another.

/** The body lines of every `##` section whose heading contains `name`, in document order. */
export function markdownSections(lines: readonly string[], name: string): Array<readonly string[]> {
  const isHeading = (line: string): boolean => /^##\s/.test(line);
  const sections: Array<readonly string[]> = [];
  lines.forEach((line, index) => {
    if (!isHeading(line) || !line.includes(name)) return;
    const rest = lines.slice(index + 1);
    const end = rest.findIndex(isHeading);
    sections.push(end < 0 ? rest : rest.slice(0, end));
  });
  return sections;
}

/** The first `##` section whose heading contains `name`, or undefined when there is none. */
export function markdownSection(lines: readonly string[], name: string): readonly string[] | undefined {
  return markdownSections(lines, name)[0];
}

/**
 * A template placeholder: a `<…>` token outside inline code whose content is only letters and spaces
 * (`<condition>`, `<observable behavior>`). A backticked `<task>` and a comparison such as
 * `n < 5 … m > 2` are not placeholders.
 */
function hasPlaceholder(text: string): boolean {
  return /<[A-Za-z ]+>/.test(text.replace(/`[^`]*`/g, ""));
}

/** An `<id>:` line (after an optional list marker) with WHEN and SHALL and no template placeholder. */
function isEarsLine(line: string, id: RegExp): boolean {
  const body = line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "");
  return id.test(body) && /\bWHEN\b/.test(body) && /\bSHALL\b/.test(body) && !hasPlaceholder(body);
}

/** Whether any `##` section whose heading contains `name` carries an EARS line with the given id. */
function anySectionHasEarsLine(lines: readonly string[], name: string, id: RegExp): boolean {
  return markdownSections(lines, name).some((section) => section.some((line) => isEarsLine(line, id)));
}

/**
 * A design.md counts as authored only when its Acceptance Contracts section carries a real
 * `SDS-AC-<n>:` line; the scaffold stub (template text) does not, so it never switches the check off.
 */
export function isAuthoredDesign(design: StepFileInput): boolean {
  return design.present && anySectionHasEarsLine(design.lines, "Acceptance Contracts", /^SDS-AC-\d+:/);
}

/**
 * Why the step has no written acceptance contract, naming the first failing part, or undefined when
 * it has one: an authored design.md, or an `## Acceptance` section in intent.md with an EARS line.
 */
export function stepAcceptanceFailure(design: StepFileInput, intent: StepFileInput): string | undefined {
  if (isAuthoredDesign(design)) return undefined;
  if (!intent.present) return "intent.md is absent";
  if (markdownSections(intent.lines, "Acceptance").length === 0) return "intent.md has no '## Acceptance' section";
  if (!anySectionHasEarsLine(intent.lines, "Acceptance", /^AC-\d+:/)) {
    return "the '## Acceptance' section has no acceptance line 'AC-<n>: WHEN … SHALL …' without a <…> placeholder";
  }
  return undefined;
}
