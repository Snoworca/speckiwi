# kiwi code-comments v1.0.0

The single source of what the code-comment setting means (FR-FLOW-234). The setting exists to save tokens by not writing explanatory comments; the AC numbers in trace tags stay whatever the setting. The user changes the setting with the CLI `speckiwi comments on|off` (IR-CLI-121); the agent only reads it, as `codeComments` in the MCP `get_work_mode` answer (the CLI `speckiwi mode --json` when MCP is unavailable). Without a value it is `on`. The agent changes the setting only when the user asks. A skill that writes or changes code reads `codeComments` before it writes code, cites this path, and does not restate the rules.

## 1. What `off` leaves out (omit)

The agent writes no **explanatory comment** in code it writes or changes:

- a why-comment that explains a choice
- the explanatory text of a JSDoc block or a docstring
- an inline comment that restates or explains a line of code
- a TODO or FIXME left as a comment

## 2. What is still written with `off` (keep)

- The trace tag `@req <REQ-ID> AC-<n>[ AC-<m>…]`, carrying the AC numbers the code implements whatever the setting (`on` or `off`), one REQ-ID per line (format, placement and dedupe in `kiwi-coder` §0.17). For step work (vibe, `kiwi-tdd`) the task-name tag is `@step <task-name>: AC-<n>[ AC-<m>…]`, carrying the step's AC numbers (`speckiwi step synthesize` reads this marker). While a vibe step's code comes first its tag may start as `@step <task-name>:`; before any commit that carries such code, write the step's acceptance lines (`AC-<n>: WHEN … THE SYSTEM SHALL …` under `## Acceptance` in `docs/spec/steps/<task-name>/intent.md`), adding a line for tagged code that no line covers yet, and fill each `@step <task-name>:` tag with the AC numbers its code implements; before the commit that lands the task, finish that fill and then synthesize the step SRS. The synthesis copies the text after each marker and never rewrites an existing step SRS, so if it ran before the tags were filled, delete `docs/spec/steps/<task-name>/<task-name>.srs.md` and synthesize again. This way every trace tag a commit carries has its AC numbers. With `off` the tag line carries the tag and its AC numbers alone, with no explanatory sentence.
- The `<REQ-ID> AC-<n>` and `SDS-AC-<n>` citations on test lines, never left out. The test-sufficiency check reads those lines (`_shared/kiwi/test-sufficiency.md`).
- The directive comments a language or tool needs: `// eslint-disable-next-line`, `// @ts-expect-error`, `# type: ignore`, `@req-lint: ignore`, a shebang, a license header, and anything else the code's behaviour, build or checks depend on.

## 3. Comments already there (existing)

- Existing comments are not removed; that would be a change outside the request.
- A comment the agent's own change made untrue may be corrected or removed, that comment only.

## 4. With `on` (on)

Comments are written as before; section 1 does not apply.

## 5. Review

With `off`, a reviewer raises no finding for a missing or thin comment, and the fixer adds no explanatory comment. Whether a missing item from section 2 is a finding follows each skill's existing rules (for example, `kiwi-coder` does not review `@req` tags).
