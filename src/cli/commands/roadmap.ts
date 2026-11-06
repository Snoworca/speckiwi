import { InvalidArgumentError, Option, type Command } from "commander";
import { addRoadmapItem, updateRoadmapItem } from "../../core/mutation/roadmap-items.js";
import { syncRoadmapActuals } from "../../core/mutation/roadmap-sync.js";
import { resolveProjectRoot } from "../../core/project-root.js";
import { checkRoadmapFile, getRoadmapItem, listRoadmapItems, type RoadmapCheckOutput, type RoadmapListOutput } from "../../core/query/roadmap.js";
import { ROADMAP_STATUSES } from "../../core/roadmap/compute-roadmap.js";
import { isRoadmapDateCell } from "../../core/roadmap/roadmap-dates.js";
import { ROADMAP_KINDS, ROADMAP_LIFECYCLES, type RoadmapKind } from "../../core/roadmap/roadmap-grammar.js";
import type { Result } from "../../core/result.js";
import type { MutationResult, ProjectRoot } from "../../core/types.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";
import { integerOption, parseDate } from "../option-parsers.js";
import { SAFETY_BYPASS_OPTION_HELP } from "../safety-bypass-options.js";
import { failRead } from "./sds.js";

// @req IR-CLI-115 IR-MCP-009
//
// `speckiwi roadmap list|show|check|add|update|sync` and the six MCP tools that pair with them come
// from the one binding table below: each row names its command, its tool, its inputs and the core call
// both surfaces make. The CLI turns its options into the input record the MCP tool receives, and both
// hand that record to the same `run`, so the same input gives the same value.

/**
 * How one input is spelled on the command line and typed in the tool schema. `date` is a day only
 * (`--as-of`); `planned-date` and `actual-date` are what the matching cells hold, `-` included.
 */
export type RoadmapInputEncoding = "string" | "list" | "boolean" | "integer" | "date" | "planned-date" | "actual-date" | "choice";

/** The values a date-cell input admits, said once for the CLI refusal and the MCP schema. */
export const ROADMAP_DATE_CELL_FORMS = {
  "planned-date": "-, YYYY-MM-DD, YYYY-MM or YYYY-Qn",
  "actual-date": "- or YYYY-MM-DD"
} as const;

/** Whether `value` fits a date-cell input; one judgement for both surfaces. */
export function acceptsRoadmapDateCell(encoding: keyof typeof ROADMAP_DATE_CELL_FORMS, value: string): boolean {
  return isRoadmapDateCell(value, encoding === "planned-date");
}

export interface RoadmapInputBinding {
  /** The commander flag, e.g. `--depends-on <ids>`. */
  readonly flag: string;
  /** The key of the input record and of the MCP schema. */
  readonly dest: string;
  readonly encoding: RoadmapInputEncoding;
  readonly help: string;
  readonly required?: boolean;
  /** The allowed values of a `choice` input. */
  readonly choices?: readonly string[];
  /** The least value of an `integer` input. */
  readonly minimum?: number;
}

/** The input record of one command or tool, keyed by {@link RoadmapInputBinding.dest}. */
export type RoadmapInput = Readonly<Record<string, unknown>>;

interface RoadmapBindingBase {
  readonly command: "list" | "show" | "check" | "add" | "update" | "sync";
  readonly tool: string;
  /** What the MCP tool answers, why to pick it, and what it changes. @req FR-MCP-060 */
  readonly description: string;
  readonly help: string;
  /**
   * Whether the command takes the item ID positional `<id>`. Its input key is `item`, the key sync
   * filters by, rather than `id`, which a workspace tool does not declare (FR-ARCH-005).
   */
  readonly itemArgument: boolean;
  readonly inputs: readonly RoadmapInputBinding[];
}

/** A reader answers with a value; a writer answers with the mutation result every SRS writer returns. */
export type RoadmapBinding =
  | (RoadmapBindingBase & { readonly kind: "read"; readonly run: (root: ProjectRoot, input: RoadmapInput) => Promise<Result<unknown>> })
  | (RoadmapBindingBase & { readonly kind: "mutation"; readonly run: (root: ProjectRoot, input: RoadmapInput) => Promise<MutationResult<unknown>> });

const AS_OF: RoadmapInputBinding = { flag: "--as-of <date>", dest: "asOf", encoding: "date", help: "reference date as YYYY-MM-DD (default: today)" };
const DRY_RUN: RoadmapInputBinding = { flag: "--dry-run", dest: "dryRun", encoding: "boolean", help: "return the planned change and write nothing" };
const IGNORE_LOCK: RoadmapInputBinding = { flag: "--ignore-lock", dest: "ignoreLock", encoding: "boolean", help: SAFETY_BYPASS_OPTION_HELP.mutationLock };
const REASON: RoadmapInputBinding = { flag: "--reason <text>", dest: "reason", encoding: "string", help: "why; written into the Change History row" };

/** The metadata inputs add and update share, keyed as the core's `RoadmapFieldInput`. */
const FIELD_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--milestone <id>", dest: "milestone", encoding: "string", help: "the milestone item this feature belongs to, e.g. RM-1" },
  { flag: "--targets <targets>", dest: "targets", encoding: "list", help: "comma-separated targets; - empties" },
  { flag: "--requirements <ids>", dest: "requirements", encoding: "list", help: "comma-separated requirement IDs; - empties" },
  { flag: "--prd <paths>", dest: "prd", encoding: "list", help: "comma-separated PRD paths under docs/prd; - empties" },
  { flag: "--depends-on <ids>", dest: "dependsOn", encoding: "list", help: "comma-separated item IDs this item depends on; - empties" },
  { flag: "--owner <owner>", dest: "owner", encoding: "string", help: "owner; - empties" },
  { flag: "--issue <issues>", dest: "githubIssue", encoding: "list", help: "comma-separated GitHub issues; - empties" },
  { flag: "--planned-start <date>", dest: "plannedStart", encoding: "planned-date", help: "YYYY-MM-DD, YYYY-MM or YYYY-Qn; - empties" },
  { flag: "--planned-end <date>", dest: "plannedEnd", encoding: "planned-date", help: "YYYY-MM-DD, YYYY-MM or YYYY-Qn; - empties" },
  { flag: "--actual-start <date>", dest: "actualStart", encoding: "actual-date", help: "YYYY-MM-DD; - empties" },
  { flag: "--actual-end <date>", dest: "actualEnd", encoding: "actual-date", help: "YYYY-MM-DD; - empties" },
  { flag: "--lifecycle <lifecycle>", dest: "lifecycle", encoding: "choice", choices: ROADMAP_LIFECYCLES, help: "open, paused or cancelled" }
];

/** The prose sections add and update share, keyed as the core's `RoadmapSectionInput`. @req FR-NODE-268 AC-2 AC-3 */
const SECTION_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--description <text>", dest: "description", encoding: "string", help: "the item's Description section; - empties" },
  { flag: "--features <text>", dest: "features", encoding: "string", help: "the item's Features section, a list of what it delivers; - empties" }
];

const LIST_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--status <status>", dest: "status", encoding: "choice", choices: ROADMAP_STATUSES, help: "only items with this computed status" },
  { flag: "--kind <kind>", dest: "kind", encoding: "choice", choices: ROADMAP_KINDS, help: "only milestones or only features" },
  { flag: "--target <target>", dest: "target", encoding: "string", help: "only items whose Targets name this target" },
  { flag: "--milestone <id>", dest: "milestone", encoding: "string", help: "only the features of this milestone" },
  AS_OF,
  { flag: "--offset <n>", dest: "offset", encoding: "integer", minimum: 0, help: "items to skip" },
  { flag: "--limit <n>", dest: "limit", encoding: "integer", minimum: 1, help: "most items to return" }
];

const ADD_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--kind <kind>", dest: "kind", encoding: "choice", choices: ROADMAP_KINDS, required: true, help: "milestone or feature" },
  { flag: "--title <title>", dest: "title", encoding: "string", required: true, help: "item title" },
  { flag: "--purpose <text>", dest: "purpose", encoding: "string", help: "the item's Purpose section" },
  ...SECTION_INPUTS,
  ...FIELD_INPUTS,
  { flag: "--from-target <target>", dest: "fromTarget", encoding: "string", help: "make the item of this registered target; its goal becomes the purpose" },
  { ...REASON, required: true },
  DRY_RUN,
  IGNORE_LOCK
];

const UPDATE_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--title <title>", dest: "title", encoding: "string", help: "new title" },
  ...SECTION_INPUTS,
  ...FIELD_INPUTS,
  REASON,
  DRY_RUN,
  IGNORE_LOCK
];

const SYNC_INPUTS: readonly RoadmapInputBinding[] = [
  { flag: "--apply", dest: "apply", encoding: "boolean", help: "write the proposals" },
  { flag: "--item <id>", dest: "item", encoding: "string", help: "only this item" },
  AS_OF,
  IGNORE_LOCK
];

/** The inputs of `bindings` that `input` gives, each kept only when it has its encoding's type. */
function given(input: RoadmapInput, bindings: readonly RoadmapInputBinding[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const binding of bindings) {
    const value = input[binding.dest];
    if (binding.encoding === "list") {
      if (Array.isArray(value)) out[binding.dest] = value.map(String);
    } else if (binding.encoding === "boolean") {
      if (value === true) out[binding.dest] = true;
    } else if (binding.encoding === "integer") {
      if (typeof value === "number") out[binding.dest] = value;
    } else if (typeof value === "string") {
      out[binding.dest] = value;
    }
  }
  return out;
}

/** The item ID positional of show and update. */
function itemId(input: RoadmapInput): string {
  return typeof input.item === "string" ? input.item : "";
}

export const ROADMAP_BINDINGS: readonly RoadmapBinding[] = [
  {
    command: "list",
    tool: "list_roadmap_items",
    kind: "read",
    description:
      "Pages the items of `docs/roadmap.md` in document order, each with the status, blocked flag, acceptance-criterion progress and schedule health computed from the SRS on the as-of date, filtered by status, kind, target or milestone, under the page fields the requirement list uses (`total`, `offset`, `returned`, `nextOffset`) — the same JSON, at `schema: 1`, that `speckiwi roadmap list --json` prints. A workspace with no roadmap answers zero items. Read-only.",
    help: "list roadmap items with their computed status, progress and schedule",
    itemArgument: false,
    inputs: LIST_INPUTS,
    run: (root, input) => listRoadmapItems(root, given(input, LIST_INPUTS))
  },
  {
    command: "show",
    tool: "get_roadmap_item",
    kind: "read",
    description:
      "Returns one roadmap item by its `RM-<n>` ID with its scope requirement IDs, Description and Features text, Change History, schedule baseline, `replanCount`, health and `slipDays`, and the earlier dates the SRS records — Status change notes and Completed Work Log rows — as candidates for its actual dates; the same JSON, at `schema: 1`, that `speckiwi roadmap show --json` prints. An ID that names no item is refused with NOT_FOUND. Read-only.",
    help: "show one roadmap item with its scope, history, schedule and actual-date candidates",
    itemArgument: true,
    inputs: [AS_OF],
    run: (root, input) => getRoadmapItem(root, itemId(input), given(input, [AS_OF]))
  },
  {
    command: "check",
    tool: "check_roadmap",
    kind: "read",
    description:
      "Checks `docs/roadmap.md` against the roadmap grammar — item numbering, metadata rows, value sets, coarse dates, milestones, dependency cycles, history rows and the names it points at in the SRS — and returns each `ROADMAP-` diagnostic with `passed` false while an error remains; the same answer `speckiwi roadmap check --json` prints. It reads no clock, so a date passing never changes the verdict, and a workspace with no roadmap passes with no diagnostic. Read-only.",
    help: "check docs/roadmap.md and print its diagnostics; exits 1 while an error remains",
    itemArgument: false,
    inputs: [],
    run: (root) => checkRoadmapFile(root)
  },
  {
    command: "add",
    tool: "add_roadmap_item",
    kind: "mutation",
    description:
      "Allocates the next `RM-<n>` and appends a milestone or feature to `docs/roadmap.md`, creating the file with its banner when it is absent, with its Description and Features sections when given and a `Created` history row carrying the reason; `fromTarget` makes the item of a registered target, borrowing its goal as the purpose. Refuses a value that would break the document or add a roadmap error. Writes `docs/roadmap.md` under the SRS mutation lock unless `dryRun` is set.",
    help: "add a roadmap item; creates docs/roadmap.md when it is absent",
    itemArgument: false,
    inputs: ADD_INPUTS,
    run: (root, input) => addRoadmapItem(root, { kind: "" as RoadmapKind, title: "", reason: "", ...given(input, ADD_INPUTS) })
  },
  {
    command: "update",
    tool: "update_roadmap_item",
    kind: "mutation",
    description:
      "Changes the title, metadata, Description or Features of one existing roadmap item and appends one Change History row per changed field or section with its previous value, new value and reason; a schedule, Lifecycle, Milestone or Targets change is refused without a reason, and a call that changes nothing is a no-op. An item is closed by setting Lifecycle to cancelled, never deleted. Writes `docs/roadmap.md` under the SRS mutation lock unless `dryRun` is set.",
    help: "change fields of a roadmap item, with one history row per changed field",
    itemArgument: true,
    inputs: UPDATE_INPUTS,
    run: (root, input) => updateRoadmapItem(root, { ...given(input, UPDATE_INPUTS), id: itemId(input) })
  },
  {
    command: "sync",
    tool: "sync_roadmap_actuals",
    kind: "mutation",
    description:
      "Proposes the empty Actual Start and Actual End cells that each item's computed status supports, on the as-of date, with the rule, its basis and earlier candidate dates from the SRS; it never overwrites a recorded date, and `item` limits it to one item. It only proposes unless `apply` is true. Writes `docs/roadmap.md` under the SRS mutation lock when `apply` is true, one history row per date.",
    help: "propose the actual dates the computed statuses support; writes them only with --apply",
    itemArgument: false,
    inputs: SYNC_INPUTS,
    run: (root, input) => syncRoadmapActuals(root, given(input, SYNC_INPUTS))
  }
];

function splitList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
}

function commanderOption(binding: RoadmapInputBinding): Option {
  const option = new Option(binding.flag, binding.help);
  if (binding.encoding === "list") option.argParser(splitList);
  if (binding.encoding === "date") option.argParser(parseDate);
  if (binding.encoding === "planned-date" || binding.encoding === "actual-date") {
    const encoding = binding.encoding;
    option.argParser((value: string) => {
      if (!acceptsRoadmapDateCell(encoding, value)) throw new InvalidArgumentError(`must be ${ROADMAP_DATE_CELL_FORMS[encoding]}.`);
      return value;
    });
  }
  if (binding.encoding === "integer") option.argParser(integerOption(binding.minimum ?? 0));
  if (binding.encoding === "choice") option.choices([...(binding.choices ?? [])]);
  if (binding.required) option.makeOptionMandatory();
  return option;
}

function formatList(value: RoadmapListOutput): string {
  const { page } = value;
  return [
    ...value.items.map((item) => `${item.id} ${item.status}${item.blocked ? " (blocked)" : ""} ${item.kind} ${item.title} — ${item.schedule.health}`),
    `${page.returned} of ${page.total} items as of ${value.asOf}${page.nextOffset === null ? "" : `; next offset ${page.nextOffset}`}`
  ].join("\n");
}

function formatCheck(value: RoadmapCheckOutput): string {
  const { errors, warnings } = value.diagnosticsSummary;
  return [
    `Roadmap ${value.source ?? "docs/roadmap.md (absent)"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`,
    ...value.diagnostics.map((item) => `${item.severity} ${item.code} ${item.filePath ?? "-"}:${item.line ?? "-"} ${item.message}`)
  ].join("\n");
}

/** The human rendering of a read value; a command without one prints the value as it is. */
function human(command: RoadmapBinding["command"], value: unknown): unknown {
  if (command === "list") return formatList(value as RoadmapListOutput);
  if (command === "check") return formatCheck(value as RoadmapCheckOutput);
  return value;
}

export function registerRoadmapCommands(command: Command, context: CliContext): void {
  const roadmap = command.command("roadmap").description("the feature roadmap in docs/roadmap.md: list, show, check, add, update and sync");
  for (const binding of ROADMAP_BINDINGS) {
    const sub = roadmap.command(binding.command).description(binding.help);
    if (binding.itemArgument) sub.argument("<id>", "roadmap item ID, e.g. RM-3");
    const options = binding.inputs.map((declared) => ({ declared, option: commanderOption(declared) }));
    for (const { option } of options) sub.addOption(option);
    sub.option("--json", "JSON output");
    sub.action(async (...args: unknown[]) => {
      const parsed = (binding.itemArgument ? args[1] : args[0]) as Record<string, unknown>;
      const json = Boolean(parsed.json) || Boolean(command.opts().json);
      const input: Record<string, unknown> = binding.itemArgument ? { item: args[0] } : {};
      for (const { declared, option } of options) {
        const value = parsed[option.attributeName()];
        if (value !== undefined) input[declared.dest] = value;
      }
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      if (binding.kind === "mutation") {
        const result = await binding.run(root, input);
        if (json) writeJson(context.io, result);
        else writeHuman(context.io, result);
        if (!result.ok) command.setOptionValue("exitCode", 5);
        return;
      }
      const result = await binding.run(root, input);
      if (!result.ok) {
        failRead(command, context, json, result.error);
        return;
      }
      if (json) writeJson(context.io, result.value);
      else writeHuman(context.io, human(binding.command, result.value));
      if (binding.command === "check" && !(result.value as RoadmapCheckOutput).passed) command.setOptionValue("exitCode", 1);
    });
  }
}
