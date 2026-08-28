import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpServerHandle, McpToolHandler } from "../../src/mcp/adapter.js";
import { createMcpServer, createSdkServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { renderToolDescriptions, renderToolNames, toolSpecs } from "../../src/mcp/schemas.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { REQUIREMENT_STATUSES, STABILITY_LEVELS } from "../../src/core/types.js";
import { SDS_STATUS_ORDER } from "../../src/core/mutation/set-sds-status.js";
import { STEP_STATE_STATUSES } from "../../src/core/mutation/update-step-state.js";
import { SECTION_ALLOWLIST } from "../../src/core/rules/section-allowlist.js";

// @req FR-MCP-060
//
// The audit measured the surface this file now holds shut: `tools/list` returned 100 tools and not
// one of them carried a description, so the only thing distinguishing `list_requirements` from
// `search_requirements` at selection time was the argument list. What that costs is accuracy, and
// the checks below are shaped around the two ways a description makes accuracy worse rather than
// better — it can be absent, and it can fail to separate the tool from the neighbour it is confused
// with. The third way, a description that is simply WRONG about what the tool does, is not
// decidable here; §4-9 of the plan hands that to an independent reader working from the source.
//
// What this file does NOT establish, stated so it is not read into the green:
//  - that a description matches the tool's behaviour. AC-3 proves two descriptions differ, never
//    that either is true.
//  - that the confusable-pair rule finds every pair an agent could confuse. It is a NAME rule:
//    `check_vibe_gate` and `workflow_doctor` answer nearby questions under unrelated names and no
//    row below pairs them.

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF_PATH), "..", "..");
const SCHEMAS_PATH = path.join("src", "mcp", "schemas.ts");
const SRS_PATH = path.join("docs", "spec", "40.mcp-stdio-interface.srs.md");
const REQUIREMENT_ID = "FR-MCP-060";

/** The disclosure markers AC-4 keys on. One of them appears in every description, never both. */
const READ_MARKER = "Read-only.";
const WRITE_MARKER = "Writes ";

/**
 * Words that cannot serve as a distinguishing word.
 *
 * Two groups. The first is ordinary English scaffolding, which distinguishes nothing. The second is
 * the AC-4 disclosure vocabulary — `read`, `only`, `writes` — and it is here for a specific reason:
 * every read-only description carries the same marker and every mutation description carries the
 * other, so without this exclusion each of the 39 read/mutation pairs would be handed a
 * distinguishing word for free and AC-3 would say nothing about them.
 */
const STOPWORDS = new Set([
  "read",
  "only",
  "write",
  "writes",
  "written",
  "that",
  "this",
  "with",
  "from",
  "when",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "these",
  "those",
  "which",
  "while",
  "what",
  "whose",
  "have",
  "been",
  "were",
  "will",
  "shall",
  "into",
  "over",
  "onto",
  "upon",
  "also",
  "each",
  "every",
  "both",
  "other",
  "others",
  "another",
  "same",
  "such",
  "does",
  "done",
  "doing",
  "just",
  "like",
  "some",
  "most",
  "more",
  "less",
  "much",
  "many",
  "before",
  "after",
  "because",
  "without",
  "within",
  "against",
  "between",
  "about",
  "above",
  "below",
  "under",
  "through",
  "during",
  "already",
  "instead",
  "rather",
  "never",
  "always",
  "still",
  "even",
  "once",
  "cannot",
  "would",
  "could",
  "should",
  "must",
  "need",
  "needs",
  "using",
  "used",
  "uses",
  "call",
  "calls",
  "called",
  "caller",
  "given",
  "take",
  "takes",
  "taken",
  "return",
  "returns",
  "returned",
  "tool",
  "tools",
  "whether",
  "where",
  "itself",
  "here"
]);

// --- the corpus -----------------------------------------------------------------------------------

/**
 * Every MCP tool name and the description the registry holds for it.
 *
 * Derived, never listed. A literal roster is an inclusion test one level above the surface it means
 * to cover, and whatever it omits is never checked — which is how a tool added without a
 * description would arrive unseen.
 */
const DESCRIPTIONS: Record<string, string> = renderToolDescriptions();
const TOOL_NAMES: string[] = renderToolNames();

function descriptionOf(name: string): string {
  return DESCRIPTIONS[name] ?? "";
}

// --- the bounds this suite runs under ---------------------------------------------------------------
//
// Measured, with these values held as literals in this file: five edits that narrow what the suite
// reaches left it green, and none of them touched a source file. The criteria roster lost an entry;
// a describe block was deleted together with its entry in that roster; the pair floors were set to
// zero and the derived pair set filtered down to three; a row was dropped from the enumeration
// table. The last two let through exactly the faults their criteria were written for — two
// confusable tools carrying one identical description, and `update_status` withholding `blocked` —
// with the test count still reading sixteen.
//
// A literal that bounds a check cannot be defended by the check it bounds, so each of these moved
// into the requirement this suite answers, where narrowing one is a requirement diff rather than a
// test-file edit. What the requirement does not fix is listed in its own AC-7.

interface RequirementFacts {
  /** Every criterion the requirement declares, in declaration order. */
  readonly criteria: string[];
  /** The floors AC-7 names, under the keys this file consumes them by. */
  readonly floors: Map<string, number>;
  /** The tools AC-8 names as presenting a closed list of argument values. */
  readonly enumTools: string[];
  /** The confusable pairs AC-3 requires the derivation to keep. */
  readonly namedPairs: Array<readonly [string, string]>;
}

/**
 * Reads the bounds out of `FR-MCP-060` with the parser the tool itself reads requirements with, so
 * a requirement this suite could not parse is a failure here rather than a silently empty roster.
 */
async function loadRequirementFacts(): Promise<RequirementFacts> {
  const workspace = await parseWorkspace({ root: REPO_ROOT });
  const record = workspace.records.find((item) => item.id === REQUIREMENT_ID);
  if (!record) throw new Error(`${SRS_PATH}: ${REQUIREMENT_ID} is not there, so this suite has no bounds to run under`);
  const textOf = (id: string): string => {
    const criterion = record.acceptanceCriteria.find((item) => item.id === id);
    if (!criterion) throw new Error(`${REQUIREMENT_ID} declares no ${id}, and this suite reads bounds out of it`);
    return criterion.text;
  };
  const floors = new Map<string, number>(
    [...textOf("AC-7").matchAll(/`([A-Za-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])])
  );
  // Backticked lowercase tokens that are shipped tool names: the constants AC-8 also names are
  // upper-case and the values it quotes are not tools, so both fall out without being listed here.
  const enumTools = [...textOf("AC-8").matchAll(/`([a-z][a-z_]*)`/g)]
    .map((match) => match[1] as string)
    .filter((token) => TOOL_NAMES.includes(token));
  const namedPairs = [...textOf("AC-3").matchAll(/\(`([a-z_]+)`,\s*`([a-z_]+)`\)/g)].map(
    (match) => [match[1] as string, match[2] as string] as const
  );
  return { criteria: record.acceptanceCriteria.map((item) => item.id), floors, enumTools: [...new Set(enumTools)], namedPairs };
}

let requirementFacts: RequirementFacts | undefined;
/**
 * Whatever the setup could not finish, held here and re-thrown from its first reader inside a test.
 *
 * A hook that throws leaves vitest reporting every test in the file as skipped rather than failed.
 * The file still fails, so CI stops; but the two mutations that broke registration were both
 * reported as `16 skipped`, and a reader scanning counts sees no red in that. Carrying the failure
 * to the test that needed it turns it back into a failing assertion that names what was missing.
 */
let factsFailure: unknown;

function facts(): RequirementFacts {
  if (factsFailure !== undefined) throw factsFailure;
  if (!requirementFacts) throw new Error(`${REQUIREMENT_ID} was never read, so nothing bounds this assertion`);
  return requirementFacts;
}

/** One floor, by the key AC-7 names it under. Absent means the requirement stopped bounding it. */
function floor(name: string): number {
  const value = facts().floors.get(name);
  if (value === undefined) {
    throw new Error(`${REQUIREMENT_ID} AC-7 names no floor \`${name}\`, so this assertion has no bound to hold to`);
  }
  return value;
}

// --- the confusable-pair rule ---------------------------------------------------------------------

interface ConfusablePair {
  readonly a: string;
  readonly b: string;
  /** Which clause of the rule admitted the pair, so a failure says why these two are together. */
  readonly reason: "namespace" | "final-token";
}

/** Every name token but the last — `workflow_pipeline_status` yields `workflow_pipeline`. */
function namespaceOf(name: string): string {
  const tokens = name.split("_");
  return tokens.slice(0, -1).join("_");
}

/** The final token with a trailing `s` dropped, so `requirements` and `requirement` meet. */
function finalTokenOf(name: string): string {
  const tokens = name.split("_");
  return (tokens[tokens.length - 1] ?? "").replace(/s$/, "");
}

/**
 * Two tools are confusable when their names share every token but the last, or share their final
 * token. Both clauses are needed and neither subsumes the other: the first is what puts
 * `workflow_pipeline_status` beside `workflow_pipeline_tail`, the second is what puts
 * `list_requirements` beside `search_requirements`, whose leading tokens have nothing in common.
 */
function confusablePairs(names: readonly string[]): ConfusablePair[] {
  const pairs: ConfusablePair[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i] as string;
      const b = names[j] as string;
      const sharedNamespace = namespaceOf(a).length > 0 && namespaceOf(a) === namespaceOf(b);
      if (sharedNamespace) {
        pairs.push({ a, b, reason: "namespace" });
        continue;
      }
      if (finalTokenOf(a) === finalTokenOf(b)) pairs.push({ a, b, reason: "final-token" });
    }
  }
  return pairs;
}

const PAIRS = confusablePairs(TOOL_NAMES);

/** Content words of a description: four letters or more, outside the stopword list. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

/** Words of a tool's own name, which a description cannot use to distinguish itself. */
function nameWords(name: string): string[] {
  return name.split("_").filter((token) => token.length >= 4);
}

/**
 * The words in `mine` that carry the distinction: present in one description, absent from the other
 * both as a token and as a substring, and not simply a word out of either tool's own name.
 *
 * The substring clause is what stops `list` distinguishing a description from one that says
 * `listing`. Set difference alone would call those two different words.
 */
function distinguishingWords(mine: string, theirs: string, excluded: ReadonlySet<string>): string[] {
  const theirWords = new Set(contentWords(theirs));
  const theirText = theirs.toLowerCase();
  return contentWords(mine).filter(
    (word) => !excluded.has(word) && !theirWords.has(word) && !theirText.includes(word)
  );
}

/**
 * The pair judge. Returns one line per failed condition, empty when the pair is separable.
 *
 * `describeTool` is a parameter rather than a direct read of `DESCRIPTIONS` so AC-6 can hand this
 * function samples whose verdict is already known. A judge rewritten to compare a description with
 * itself reports no violations for the whole surface, and so does a correct judge on a clean tree;
 * the probes are the only thing that separates those two readings.
 */
function pairViolations(pair: ConfusablePair, describeTool: (name: string) => string): string[] {
  const descA = describeTool(pair.a);
  const descB = describeTool(pair.b);
  const excluded = new Set([...nameWords(pair.a), ...nameWords(pair.b)]);
  const violations: string[] = [];
  if (descA === descB) {
    violations.push(`${pair.a} and ${pair.b} (${pair.reason}) carry the same description.`);
    return violations;
  }
  if (distinguishingWords(descA, descB, excluded).length === 0) {
    violations.push(
      `${pair.a}'s description carries no word ${pair.b}'s lacks, so it does not say why to choose it.`
    );
  }
  if (distinguishingWords(descB, descA, excluded).length === 0) {
    violations.push(
      `${pair.b}'s description carries no word ${pair.a}'s lacks, so it does not say why to choose it.`
    );
  }
  return violations;
}

// --- the live tool listing ------------------------------------------------------------------------

/** One listed tool, as much of it as the byte comparison below reads. */
interface ListedDescription {
  readonly name: string;
  readonly description: string | undefined;
}

/**
 * One line per listing whose description is not the registry's bytes.
 *
 * `registryDescription` is a parameter rather than a direct read of `DESCRIPTIONS` for the reason
 * `pairViolations` takes one. Measured: rewriting the comparison to hold the registry against
 * itself left this file green while all 100 listed descriptions had drifted, and the test count did
 * not move. Nothing that reports violations can notice it has stopped finding any, so AC-6 hands
 * this judge listings whose verdict is already known.
 */
function driftViolations(listed: readonly ListedDescription[], registryDescription: (name: string) => string): string[] {
  return listed
    .filter((tool) => tool.description !== registryDescription(tool.name))
    .map((tool) => `${tool.name}: listed "${String(tool.description)}" but the registry holds "${registryDescription(tool.name)}"`);
}

let listedTools: Tool[] = [];
let client: Client | undefined;
/** The setup failure the listing tests re-throw, kept apart so a broken server fails only them. */
let listingFailure: unknown;

function listing(): Tool[] {
  if (listingFailure !== undefined) throw listingFailure;
  return listedTools;
}

beforeAll(async () => {
  try {
    requirementFacts = await loadRequirementFacts();
  } catch (error) {
    factsFailure = error;
  }
  try {
    const local = createMcpServer({ root: REPO_ROOT, rootSource: "server-cwd-discovery" });
    const sdk = createSdkServer(local);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    client = new Client({ name: "speckiwi-tool-description-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    listedTools = (await client.listTools()).tools;
  } catch (error) {
    listingFailure = error;
  }
});

afterAll(async () => {
  await client?.close();
});

// --- AC-1 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-1 — every MCP-exposed spec declares a description", () => {
  it("FR-MCP-060 AC-1: describes all 100 tools, none of them in fewer than 60 characters", () => {
    const mcpSpecs = toolSpecs.filter((spec) => typeof spec.mcpName === "string" && spec.mcpName.length > 0);
    expect(mcpSpecs.length, "MCP-exposed registry rows").toBeGreaterThanOrEqual(floor("tools"));
    const thin = mcpSpecs
      .filter((spec) => (spec.description ?? "").trim().length < 60)
      .map((spec) => `${String(spec.mcpName)}: ${(spec.description ?? "").length} characters`);
    expect(
      thin,
      "a one-line description is the failure mode this requirement exists to avoid: it makes the payload bigger and still leaves the choice to the argument list."
    ).toEqual([]);
  });

  it("FR-MCP-060 AC-1: names a tool and describes it in one argument, so neither can arrive alone", () => {
    // A source rule, because the claim is about source shape: `readSpec`/`mutationSpec` take the
    // exposure as one value, so a bare string in the mcpName position is a tool named without a
    // description. TypeScript refuses it; this asserts nobody widened the builder back.
    const source = readFileSync(path.join(REPO_ROOT, SCHEMAS_PATH), "utf8");
    const bareNames = [...source.matchAll(/(readSpec|mutationSpec)\(\s*"[^"]*",\s*("[^"]*")/g)].map(
      (match) => `${match[1]}(… , ${String(match[2])})`
    );
    expect(
      bareNames,
      `${SCHEMAS_PATH}: an MCP name passed on its own. The description is no longer forced to arrive with it.`
    ).toEqual([]);
    // The rule above is vacuous if the builders are gone; this proves the file still uses them.
    expect(source.match(/mcp\("/g)?.length ?? 0, `${SCHEMAS_PATH}: no exposure declarations found`).toBeGreaterThan(0);
  });
});

// --- AC-2 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-2 — tools/list carries the registry's description", () => {
  it("FR-MCP-060 AC-2: answers a protocol listing with 100 described tools", () => {
    const tools = listing();
    expect(tools.length, "tools returned by tools/list").toBeGreaterThanOrEqual(floor("tools"));
    const undescribed = tools
      .filter((tool) => typeof tool.description !== "string" || tool.description.trim().length === 0)
      .map((tool) => tool.name);
    expect(undescribed, "tools/list returned a tool with no description").toEqual([]);
  });

  it("FR-MCP-060 AC-2: ships the registry's bytes, not a second description written beside them", () => {
    const tools = listing();
    // A comparison over nothing reports nothing, so the corpus it ran on is asserted with it.
    expect(tools.length, "tools compared against the registry").toBeGreaterThanOrEqual(floor("tools"));
    expect(driftViolations(tools, descriptionOf), "the listed description and the registry's have diverged").toEqual([]);
  });

  it("FR-MCP-060 AC-2: sends no title, which the audit measured equal to the name on all 100 tools", () => {
    // The boilerplate row this change disposed of. Held mechanically rather than left to the Change
    // Note, because re-adding `title: name` restores it invisibly: every other assertion here still
    // passes, and the repetition only shows up in a payload nobody measures twice.
    const tools = listing();
    const titled = tools.filter((tool) => tool.title !== undefined).map((tool) => `${tool.name}: ${String(tool.title)}`);
    expect(
      titled,
      "the specification uses `name` for display when `title` is absent, so a title equal to the name repeats what the client already has."
    ).toEqual([]);
    // Vacuous if nothing was listed, and vacuous if `name` stopped arriving — the display fallback
    // this row depends on is the name itself.
    const nameless = tools.filter((tool) => typeof tool.name !== "string" || tool.name.length === 0);
    expect(nameless, "a tool with no name has nothing left to display").toEqual([]);
    expect(tools.length, "tools listed").toBeGreaterThanOrEqual(floor("tools"));
  });
});

// --- AC-3 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-3 — confusable tools say why to choose between them", () => {
  it("FR-MCP-060 AC-3: derives the confusable set and keeps the three pairs the audit named", () => {
    expect(PAIRS.length, "confusable pairs derived from the tool names").toBeGreaterThanOrEqual(floor("pairs"));
    const paired = new Set(PAIRS.flatMap((pair) => [pair.a, pair.b]));
    expect(paired.size, "tools in at least one confusable pair").toBeGreaterThanOrEqual(floor("pairedTools"));
    // Named by the requirement, not listed here: a roster this file owned could drop the pair it was
    // asked to keep and go on reporting that every pair it kept was kept.
    const namedPairs = facts().namedPairs;
    expect(namedPairs.length, "pairs read out of the requirement for the derivation to survive").toBeGreaterThanOrEqual(
      floor("namedPairs")
    );
    const missing = namedPairs.filter(
      ([a, b]) => !PAIRS.some((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a))
    ).map(([a, b]) => `${a} / ${b}`);
    expect(
      missing,
      "a pair the audit named by hand fell out of the derived set. Narrowing the rule is how this check stops covering the case it was written for."
    ).toEqual([]);
  });

  it("FR-MCP-060 AC-3: separates every confusable pair by a word only one of them uses", () => {
    const violations = PAIRS.flatMap((pair) => pairViolations(pair, descriptionOf));
    expect(violations, "confusable tools whose descriptions do not choose between them").toEqual([]);
  });
});

// --- AC-4 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-4 — every description discloses what the tool changes", () => {
  it("FR-MCP-060 AC-4: marks the 48 read-only tools read-only and the 52 mutation tools as writing", () => {
    const readOnly = TOOL_NAMES.filter((name) => isReadOnlyTool(name));
    const mutating = TOOL_NAMES.filter((name) => !isReadOnlyTool(name));
    expect(readOnly.length, "read-only tools").toBeGreaterThanOrEqual(floor("readOnly"));
    expect(mutating.length, "mutation tools").toBeGreaterThanOrEqual(floor("mutation"));

    const violations: string[] = [];
    for (const name of readOnly) {
      if (!descriptionOf(name).includes(READ_MARKER)) violations.push(`${name} is read-only and does not say so.`);
    }
    for (const name of mutating) {
      if (!descriptionOf(name).includes(WRITE_MARKER)) violations.push(`${name} mutates and does not say what it writes.`);
    }
    for (const name of TOOL_NAMES) {
      const description = descriptionOf(name);
      if (description.includes(READ_MARKER) && description.includes(WRITE_MARKER)) {
        violations.push(`${name} claims both to be read-only and to write.`);
      }
    }
    expect(
      violations,
      "a mutation described as a read is worse than an undescribed one: it is read as safe and called."
    ).toEqual([]);
  });
});

// --- AC-5 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-5 — the registration is projected from the registry", () => {
  it("FR-MCP-060 AC-5: describes exactly the names the registry declares", () => {
    expect(Object.keys(DESCRIPTIONS).sort(), "described names against registry names").toEqual([...TOOL_NAMES].sort());
    expect(
      listing().map((tool) => tool.name).sort(),
      "registered names against registry names"
    ).toEqual([...TOOL_NAMES].sort());
  });

  it("FR-MCP-060 AC-5: refuses to register a tool the registry does not describe", () => {
    const local = createMcpServer({ root: REPO_ROOT, rootSource: "server-cwd-discovery" });
    const stranger: McpToolHandler = async () => ({ ok: true });
    const widened: McpServerHandle = {
      ...local,
      tools: { ...local.tools, tool_the_registry_never_declared: stranger }
    };
    expect(() => createSdkServer(widened)).toThrowError(/tool_the_registry_never_declared/);
  });
});

// --- AC-6 -----------------------------------------------------------------------------------------

describe("FR-MCP-060 AC-6 — each judge answers a known question in both directions", () => {
  it("FR-MCP-060 AC-6: refuses the two shapes it must refuse and passes the one it must pass", () => {
    const pair: ConfusablePair = { a: "probe_alpha", b: "probe_beta", reason: "namespace" };
    const cases: Array<{ what: string; verdict: "refused" | "passed"; describeTool: (name: string) => string }> = [
      {
        what: "two tools handed the same description",
        verdict: "refused",
        describeTool: () => "Lists the ledger rows a wave produced. Read-only."
      },
      {
        what: "a description whose every word the neighbour already uses",
        verdict: "refused",
        describeTool: (name) =>
          name === "probe_alpha"
            ? "Lists ledger rows. Read-only."
            : "Lists ledger rows together with the wave summary beneath them. Read-only."
      },
      {
        what: "two descriptions that genuinely diverge",
        verdict: "passed",
        describeTool: (name) =>
          name === "probe_alpha"
            ? "Lists ledger rows for one wave. Read-only."
            : "Appends a resolution decision to the issue journal. Writes the ledger file."
      }
    ];
    const failures: string[] = [];
    for (const probe of cases) {
      const found = pairViolations(pair, probe.describeTool);
      if (probe.verdict === "refused" && found.length === 0) failures.push(`the judge accepted ${probe.what}.`);
      if (probe.verdict === "passed" && found.length > 0) {
        failures.push(`the judge rejected ${probe.what}: ${found.join(" ")}`);
      }
    }
    expect(
      failures,
      "a judge that has stopped judging reports no violations, and so does a correct one over a clean surface."
    ).toEqual([]);
  });

  it("FR-MCP-060 AC-6: refuses a listing restated beside the registry and passes one projected from it", () => {
    // The same shape for AC-2's byte comparison. Measured: rewritten to hold `descriptionOf(name)`
    // against itself, that comparison reported no drift while every listed description had been
    // rewritten, and the file stayed at sixteen green tests. These samples are what separates a
    // comparison that found nothing from one that can no longer find anything.
    const registryText = "Lists the ledger rows a wave produced. Read-only.";
    const describeProbe = (name: string): string => (name === "probe_listed_tool" ? registryText : "");
    const cases: Array<{ what: string; verdict: "refused" | "passed"; listed: ListedDescription[] }> = [
      {
        what: "a listing carrying the registry's text with a sentence written beside it",
        verdict: "refused",
        listed: [{ name: "probe_listed_tool", description: `${registryText} Restated beside the registry.` }]
      },
      {
        what: "a listing that dropped the description on the way out",
        verdict: "refused",
        listed: [{ name: "probe_listed_tool", description: undefined }]
      },
      {
        what: "a listing projected from the registry byte for byte",
        verdict: "passed",
        listed: [{ name: "probe_listed_tool", description: registryText }]
      }
    ];
    const failures: string[] = [];
    for (const probe of cases) {
      const found = driftViolations(probe.listed, describeProbe);
      if (probe.verdict === "refused" && found.length === 0) failures.push(`the comparison accepted ${probe.what}.`);
      if (probe.verdict === "passed" && found.length > 0) {
        failures.push(`the comparison rejected ${probe.what}: ${found.join(" ")}`);
      }
    }
    expect(
      failures,
      "a byte comparison rewritten to hold the registry against itself reports no drift, and so does a correct one over a projected listing."
    ).toEqual([]);
  });
});

// --- AC-7 -----------------------------------------------------------------------------------------
//
// The deletions no probe above can see: a describe block removed runs nothing at all, and a floor
// lowered to zero leaves every sweep green while the set it swept empties. Neither is visible to a
// suite whose bounds are its own literals, so the bounds are the requirement's and the checks below
// hold this file to them in both directions.

describe("FR-MCP-060 AC-7 — the suite runs under bounds the requirement sets, not its own", () => {
  it("FR-MCP-060 AC-7: declares a block for every criterion the requirement names, and answers no other", () => {
    // The count as well as the entries: a roster filtered on the way out of the requirement leaves
    // the two set comparisons below agreeing with each other over whatever survived the filter.
    const declared = facts().criteria;
    expect(declared.length, "criteria read out of the requirement").toBeGreaterThanOrEqual(floor("criteria"));
    const source = readFileSync(SELF_PATH, "utf8");
    const titles = [...source.matchAll(/describe\(\s*"([^"]+)"/g)].map((match) => match[1] as string);
    expect(titles.length, `${SELF_PATH}: no block titles were read, so the extraction has stopped matching`).toBeGreaterThan(0);
    // The whole id, so `AC-1` is not answered by a title reading `AC-10`.
    const answered = titles
      .map((title) => /\b(AC-\d+)\b/.exec(title)?.[1])
      .filter((id): id is string => typeof id === "string");
    const missing = declared.filter((criterion) => !answered.includes(criterion));
    expect(
      missing,
      "a criterion no longer has a block in this file. Whatever it checked is no longer checked, and the only other trace is a lower test count."
    ).toEqual([]);
    // The other direction, which is also what keeps the check above from passing over an empty
    // roster: every block here answers something the requirement still declares.
    const unclaimed = answered.filter((id) => !declared.includes(id));
    expect(
      unclaimed,
      `a block answers a criterion ${REQUIREMENT_ID} does not declare, so either the requirement lost it or this roster was read out of the wrong document.`
    ).toEqual([]);
  });

  it("FR-MCP-060 AC-7: keeps every floor the requirement names above a value derived from the shipped registry", () => {
    expect(toolSpecs.length, "registry rows").toBeGreaterThanOrEqual(floor("specs"));
    expect(TOOL_NAMES.length, "MCP tool names").toBeGreaterThanOrEqual(floor("tools"));
    expect(Object.keys(DESCRIPTIONS).length, "described tools").toBeGreaterThanOrEqual(floor("tools"));
    expect(floor("readOnly") + floor("mutation"), "the two kind floors must add up to the tool floor").toBe(floor("tools"));
    // A pair count of zero is what a rule that stopped matching reports; the floor refuses it, and
    // the paired-tool floor refuses a rule that survives by pairing one namespace with itself.
    expect(PAIRS.length, "confusable pairs").toBeGreaterThanOrEqual(floor("pairs"));
    expect(new Set(PAIRS.flatMap((pair) => [pair.a, pair.b])).size, "paired tools").toBeGreaterThanOrEqual(
      floor("pairedTools")
    );
    // Emptying the stopword list would hand every read/mutation pair the disclosure vocabulary as a
    // distinguishing word, and AC-3 would then say nothing about 39 of its pairs while staying green.
    expect(STOPWORDS.size, "stopwords excluded from the distinguishing-word test").toBeGreaterThanOrEqual(floor("stopwords"));
  });

  it("FR-MCP-060 AC-7: reads every floor the requirement names, at the value it names, and refuses one that bounds nothing", () => {
    const source = readFileSync(SELF_PATH, "utf8");
    const consumed = new Set([...source.matchAll(/\bfloor\("([A-Za-z]+)"\)/g)].map((match) => match[1] as string));
    const unread = [...facts().floors.keys()].filter((name) => !consumed.has(name));
    expect(
      unread,
      "a floor the requirement names is asserted nowhere in this file, so deleting the assertion that held it leaves no trace."
    ).toEqual([]);
    // The accessor itself, held to what the requirement holds. Every assertion above reads its bound
    // through `floor`, so an accessor rewritten to answer zero lowers all of them at once and every
    // `toBeGreaterThanOrEqual` over it passes for the same reason a correct one does.
    const misread = [...facts().floors.entries()]
      .filter(([name, value]) => floor(name) !== value)
      .map(([name, value]) => `${name}: read as ${floor(name)} where the requirement holds ${value}`);
    expect(misread, "a floor was read at some value other than the one the requirement names").toEqual([]);
    // And a floor of zero, which no derived count can fall below and which therefore bounds nothing.
    const empty = [...facts().floors.entries()].filter(([, value]) => value <= 0).map(([name]) => name);
    expect(empty, "a floor of zero admits the empty set, which is what a rule that stopped matching produces").toEqual([]);
  });
});

// --- AC-8 -----------------------------------------------------------------------------------------
//
// The one accuracy axis that is decidable from strings alone. A tool whose argument is drawn from a
// closed list has that list in source as a runtime constant, so the enumeration a description
// presents can be compared against it in both directions: a value the code admits and the
// description omits, and a value the description invents and the code refuses. Both were live —
// `update_status` omitted `blocked`, and `update_step_state` named `claimed` and `synthesized`,
// neither of which its guard accepts — and every assertion above passed over both.
//
// The comparison needs the enumeration to be findable, so the shape is part of the contract: the
// values arrive as one em-dash-delimited list, comma- or `or`-separated. That is the only prose
// constraint this file imposes, and it buys the only truth check in it.

/** The closed lists a description presents, each paired with the constant the code decides by. */
const ENUM_DISCLOSURES: ReadonlyArray<{ tool: string; axis: string; admitted: readonly string[] }> = [
  { tool: "update_status", axis: "requirement Status", admitted: REQUIREMENT_STATUSES },
  { tool: "update_stability", axis: "requirement Stability", admitted: STABILITY_LEVELS },
  { tool: "update_step_state", axis: "step lifecycle Status", admitted: STEP_STATE_STATUSES },
  { tool: "set_sds_status", axis: "SDS lifecycle Status", admitted: SDS_STATUS_ORDER },
  { tool: "append_section_note", axis: "narrative section key", admitted: Object.keys(SECTION_ALLOWLIST) }
];

/** The values a description presents: the first em-dash-delimited run, split on commas and `or`. */
function presentedEnum(description: string): string[] {
  const match = /\s—\s([^—]+)\s—\s/.exec(description);
  if (!match) return [];
  return (match[1] ?? "")
    .split(/,|\bor\b/)
    .map((token) => token.replace(/[`.]/g, "").trim())
    .filter((token) => /^[a-z][a-z_]*$/.test(token));
}

describe("FR-MCP-060 AC-8 — a description that names a closed list names the code's list", () => {
  it("FR-MCP-060 AC-8: compares exactly the tools the requirement names as presenting a closed list", () => {
    // The table above binds runtime constants, which prose cannot hold, but which tools it covers is
    // the requirement's to say. Measured: dropping the `update_status` row let that description go on
    // withholding `blocked` — the fault this criterion was written for — with every test still green.
    expect(facts().enumTools.length, "tools read out of AC-8 as presenting a closed list").toBeGreaterThanOrEqual(
      floor("enumRows")
    );
    expect(
      ENUM_DISCLOSURES.map((row) => row.tool).sort(),
      `the rows compared here against the tools ${REQUIREMENT_ID} AC-8 names`
    ).toEqual([...facts().enumTools].sort());
  });

  it("FR-MCP-060 AC-8: presents exactly the values each guard admits, inventing none and dropping none", () => {
    const violations: string[] = [];
    for (const row of ENUM_DISCLOSURES) {
      const description = descriptionOf(row.tool);
      const presented = presentedEnum(description);
      // Non-vacuity on both sides: an empty code list would make any description agree with it, and
      // an unfindable presentation would otherwise be reported as a mismatch of unknown cause.
      expect(row.admitted.length, `${row.tool}: the ${row.axis} constant is empty`).toBeGreaterThan(0);
      if (presented.length === 0) {
        violations.push(`${row.tool} presents no em-dash-delimited ${row.axis} list, so nothing can be compared.`);
        continue;
      }
      const invented = presented.filter((value) => !row.admitted.includes(value));
      const omitted = row.admitted.filter((value) => !presented.includes(value));
      if (invented.length > 0) violations.push(`${row.tool} offers ${row.axis} values its guard refuses: ${invented.join(", ")}.`);
      if (omitted.length > 0) violations.push(`${row.tool} withholds ${row.axis} values its guard accepts: ${omitted.join(", ")}.`);
    }
    expect(
      violations,
      "an agent learns this vocabulary from the description and nowhere else, so an invented value is a call that cannot succeed and an omitted one is a transition nobody reaches."
    ).toEqual([]);
  });
});

// --- AC-9 -----------------------------------------------------------------------------------------
//
// The boundary, demonstrated rather than narrated. Everything above judges the string; only AC-8
// reaches what the tool does, and only over four tools and one axis. The two probes below are that
// gap made executable: they construct a claim that is false about its tool and show the rules
// accepting it. If someone later closes one of these holes, the probe fails and this requirement has
// to be re-read — which is the point of writing the limit as a criterion instead of as a comment.

describe("FR-MCP-060 AC-9 — the suite states what it cannot decide", () => {
  it("FR-MCP-060 AC-9: accepts a Writes clause naming a path the tool never touches", () => {
    // AC-4 tests for the marker, not for its object. Seven of the first hundred descriptions were
    // false in exactly this way and passed; two of the seven were false in the `Writes` clause.
    const forged = "Appends one dated row to the Completed Work Log. Writes /etc/passwd and the moon.";
    // Restated as the rule AC-4 runs, so this is that rule's verdict rather than a paraphrase of it.
    const acceptedByAc4 = forged.includes(WRITE_MARKER) && !forged.includes(READ_MARKER);
    expect(
      acceptedByAc4,
      "deciding whether a Writes object is the path the tool writes needs the source, not the string; that read is delegated, and this file must not be quoted as having done it."
    ).toBe(true);
  });

  it("FR-MCP-060 AC-9: never pairs two tools whose names do not resemble each other", () => {
    // The confusable-pair rule is a NAME rule, so a pair that answers nearby questions under
    // unrelated names is never asked to distinguish itself, however alike the two descriptions are.
    const unpaired: Array<[string, string]> = [
      ["check_vibe_gate", "workflow_doctor"],
      ["get_next_work_order", "workflow_next_plan_task"]
    ];
    for (const [left, right] of unpaired) {
      expect(TOOL_NAMES, `${left} must still be a shipped tool for this probe to mean anything`).toContain(left);
      expect(TOOL_NAMES, `${right} must still be a shipped tool for this probe to mean anything`).toContain(right);
      const paired = PAIRS.some(
        (pair) => (pair.a === left && pair.b === right) || (pair.a === right && pair.b === left)
      );
      expect(
        paired,
        `${left} and ${right} answer neighbouring questions and AC-3 does not compare them. If this now fails, the rule has widened and AC-3's floors and this limit both need re-reading.`
      ).toBe(false);
    }
  });
});
