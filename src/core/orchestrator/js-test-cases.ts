import { isBindingReference, localBindings, parameterScopes, type JsSource, type JsToken } from "./js-source-lexer.js";

// @req FR-NODE-252 AC-4 — the test cases of a JavaScript or TypeScript test file, as the mechanical
// half of kiwi-coder §0.20.3 reads them: each case by its title path, the skip and focus markers on
// it, and how many assertions (`expect(`, `expect.soft(`) sit directly in its body.
//
// The forms read are a closed list, the ones this repository's tests use:
// - a case is a call of `it`, `test`, `describe`, `xit` or `xdescribe`, through a member chain of
//   `.skip`, `.only`, `.concurrent`, `.sequential`, `.todo`, `.fails`, or one of `.each(rows)`,
//   `.for(rows)`, `.runIf(cond)`, `.skipIf(cond)` whose argument group comes before the titled call;
// - its title is a string or template literal, or a variable or property (`it(fixture.name, …)`,
//   written `${fixture.name}`);
// - a name bound to case functions (`const run = cond ? it : it.skip`) is a case function; a case
//   registered through it runs on one branch per reference of the definition, each carrying that
//   reference's markers plus the markers written on the call;
// - hooks (`beforeEach` …), `vi` and `expectTypeOf` used as a call or a member, and the `expect`
//   helpers (`expect.any(…)`, `expect.objectContaining(…)` …);
// - a case's context is the first parameter of its callback, the second for `.for(rows)`, and none for
//   `.each(rows)`, whose parameters are the row (@req FR-NODE-265 AC-4).
// Every occurrence of a test API name — the globals, every value imported from `vitest` or
// `@jest/globals`, every alias — must be consumed by one of those forms. A global other than a case
// function or `expect` that the file declares as its own binding (`(suite) => suite.file`) is that
// binding, not the API; a parameter (`(test) => test.status`) is that parameter inside its function,
// for every name. One left over (`v.it(…)`
// through a namespace import, an import alias, `suite(…)`, `wrap(it)`, `expect.poll(…)`) makes the
// whole surface `null`, and the caller lists the file as unchecked rather than missing a case it
// could not read.

export interface TestCaseRecord {
  /** The case's title path, `describe > it`; a repeated path gets ` (2)`, ` (3)` … in source order. */
  readonly key: string;
  /** The case's own title, without its enclosing describe titles. */
  readonly title: string;
  /**
   * The weakening markers (`.skip`, `.only`, `.skipIf`, `.runIf`, `xit`, `xdescribe`) of each branch
   * the case may run on: one branch for a direct call, one per reference of an alias definition.
   */
  readonly branches: readonly (readonly string[])[];
  /** Assertions in its body that are not inside a nested case. */
  readonly assertions: number;
  /** Skip calls on its context parameter in its body (`ctx.skip()`, or `skip()` destructured). */
  readonly contextSkips: number;
}

export interface TestCaseSurface {
  readonly cases: readonly TestCaseRecord[];
  /** Titles of case calls that appear inside comments — a commented-out case. */
  readonly commentedTitles: ReadonlySet<string>;
}

const CASE_FUNCTIONS = new Set(["it", "test", "describe", "xit", "xdescribe"]);
const PREFIX_MARKERS = new Set(["xit", "xdescribe"]);
/** Names consumed whenever they are called or a member of them is read. */
const HOOKS_AND_UTILITIES = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll", "vi", "expectTypeOf"]);
const GLOBAL_TEST_API = new Set([...CASE_FUNCTIONS, ...HOOKS_AND_UTILITIES, "suite", "bench", "expect", "fit"]);
const TEST_MODULES = new Set(["vitest", "@jest/globals"]);
/** Member chain entries a case function may carry; `arguments` ones take a group before the titled call. */
const CHAIN_MEMBERS: Readonly<Record<string, { readonly marker?: string; readonly arguments?: true }>> = {
  skip: { marker: ".skip" },
  only: { marker: ".only" },
  skipIf: { marker: ".skipIf", arguments: true },
  runIf: { marker: ".runIf", arguments: true },
  each: { arguments: true },
  for: { arguments: true },
  concurrent: {},
  sequential: {},
  todo: {},
  fails: {}
};
const EXPECT_ASSERTION_MEMBERS = new Set(["soft"]);
const EXPECT_HELPER_MEMBERS = new Set(["any", "anything", "objectContaining", "arrayContaining", "stringContaining", "stringMatching", "getState"]);
const COMMENTED_CASE = /\b(?:x?it|test|x?describe)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

interface Chain {
  readonly markers: string[];
  /** The chain's member names in order (`each`, `skip` …). */
  readonly members: string[];
  /** Index just past the chain and the argument groups its members took. */
  readonly end: number;
  /** Whether a member took arguments (`.each(rows)`, `.skipIf(cond)`). */
  readonly configured: boolean;
}

/** The member chain after the case function at `index`, or `null` for a member outside the list. */
function chainAt(tokens: readonly JsToken[], index: number, own: readonly string[]): Chain | null {
  const markers = [...own];
  const members: string[] = [];
  let configured = false;
  let cursor = index + 1;
  while (tokens[cursor]?.value === ".") {
    const member = CHAIN_MEMBERS[tokens[cursor + 1]?.value ?? ""];
    if (member === undefined || tokens[cursor + 1]?.type !== "identifier") return null;
    members.push((tokens[cursor + 1] as JsToken).value);
    if (member.marker !== undefined) markers.push(member.marker);
    cursor += 2;
    if (member.arguments === true) {
      if (tokens[cursor]?.value !== "(") return null;
      cursor = (tokens[cursor] as JsToken).match + 1;
      configured = true;
    }
  }
  return { markers, members, end: cursor, configured };
}

/** The title of the call whose argument group opens at `open`: a literal, or a variable or property path. */
function titleAt(tokens: readonly JsToken[], open: number): string | null {
  const first = tokens[open + 1];
  if ((first?.type === "string" || first?.type === "template") && [",", ")"].includes(tokens[open + 2]?.value ?? "")) return first.value.slice(1, -1);
  let cursor = open + 1;
  if (tokens[cursor]?.type !== "identifier") return null;
  const parts = [(tokens[cursor] as JsToken).value];
  cursor += 1;
  while (tokens[cursor]?.value === "." && tokens[cursor + 1]?.type === "identifier") {
    parts.push((tokens[cursor + 1] as JsToken).value);
    cursor += 2;
  }
  return [",", ")"].includes(tokens[cursor]?.value ?? "") ? `\${${parts.join(".")}}` : null;
}

/** Every token of `import …` statements, and the value bindings imported from a test module. */
function testImports(tokens: readonly JsToken[]): { tokens: Set<number>; names: Set<string> } {
  const indices = new Set<number>();
  const names = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== "import" || tokens[index - 1]?.value === "." || ["(", "."].includes(tokens[index + 1]?.value ?? "")) continue;
    let cursor = index;
    while (cursor < tokens.length && tokens[cursor]?.value !== ";" && tokens[cursor - 1]?.value !== "from") indices.add(cursor++);
    const from = cursor - 1;
    if (tokens[from]?.value !== "from" || !TEST_MODULES.has(tokens[from + 1]?.value.slice(1, -1) ?? "")) continue;
    indices.add(from + 1);
    if (tokens[index + 1]?.value === "type") continue;
    for (let binding = index + 1; binding < from; binding += 1) {
      const token = tokens[binding] as JsToken;
      if (token.type !== "identifier" || ["as", "type"].includes(token.value) || tokens[binding - 1]?.value === "type") continue;
      // `a as b` binds `b`; `* as v` binds `v`.
      if (tokens[binding + 1]?.value !== "as") names.add(token.value);
    }
  }
  return { tokens: indices, names };
}

/**
 * Names bound to case functions (`const onFencedPlatform = cond ? it : it.skip;`): each with the
 * markers of each reference of its definition, and the token indices of the definitions.
 */
function caseAliases(tokens: readonly JsToken[]): { references: Map<string, string[][]>; definitions: Set<number> } {
  const references = new Map<string, string[][]>();
  const definitions = new Set<number>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (!["const", "let", "var"].includes((tokens[index] as JsToken).value) || tokens[index + 1]?.type !== "identifier" || tokens[index + 2]?.value !== "=") continue;
    const perReference: string[][] = [];
    const indices: number[] = [];
    let cursor = index + 3;
    let called = false;
    while (cursor < tokens.length && tokens[cursor]?.value !== ";" && !(cursor > index + 3 && (tokens[cursor] as JsToken).newlineBefore)) {
      const name = tokens[cursor]?.value ?? "";
      const chain = CASE_FUNCTIONS.has(name) && isBindingReference(tokens, cursor) ? chainAt(tokens, cursor, PREFIX_MARKERS.has(name) ? [name] : []) : null;
      if (chain !== null) {
        if (chain.configured || tokens[chain.end]?.value === "(" || tokens[chain.end]?.type === "template") called = true;
        perReference.push(chain.markers);
        indices.push(cursor);
        cursor = chain.end;
      } else cursor = (tokens[cursor] as JsToken).match >= 0 ? (tokens[cursor] as JsToken).match + 1 : cursor + 1;
    }
    if (indices.length === 0 || called) continue;
    references.set((tokens[index + 1] as JsToken).value, perReference);
    for (const definition of [index + 1, ...indices]) definitions.add(definition);
  }
  return { references, definitions };
}

/** The kind of `expect` use at `index`: an assertion, a helper, or `null` for a form outside the list. */
function expectUse(tokens: readonly JsToken[], index: number): "assertion" | "helper" | null {
  if (tokens[index + 1]?.value === "(") return "assertion";
  if (tokens[index + 1]?.value !== ".") return null;
  // `expect.not.objectContaining(…)` is the negated helper.
  const negated = tokens[index + 2]?.value === "not" && tokens[index + 3]?.value === ".";
  const member = tokens[index + (negated ? 4 : 2)]?.value ?? "";
  if (tokens[index + (negated ? 5 : 3)]?.value !== "(") return null;
  if (!negated && EXPECT_ASSERTION_MEMBERS.has(member)) return "assertion";
  return EXPECT_HELPER_MEMBERS.has(member) ? "helper" : null;
}

/** How a case's callback reaches its context's `skip`: `ctx.skip()` (member) or `({ skip }) => skip()` (call). */
interface CaseContext {
  readonly name: string;
  readonly via: "member" | "call";
}

/** The first token of each top-level item of the bracket group opening at `open`. */
function groupItems(tokens: readonly JsToken[], open: number): number[] {
  const close = (tokens[open] as JsToken).match;
  const starts = open + 1 < close ? [open + 1] : [];
  for (let cursor = open + 1; cursor < close; cursor = (tokens[cursor] as JsToken).match >= 0 ? (tokens[cursor] as JsToken).match + 1 : cursor + 1) {
    if (tokens[cursor]?.value === "," && cursor + 1 < close) starts.push(cursor + 1);
  }
  return starts;
}

/** The parameters of the function argument starting at `start` (their first tokens), or `null` when it is not a function. */
function functionParameters(tokens: readonly JsToken[], start: number): number[] | null {
  let cursor = start;
  if (tokens[cursor]?.value === "async" && tokens[cursor + 1]?.value !== "=>") cursor += 1;
  if (tokens[cursor]?.value === "function") cursor += tokens[cursor + 1]?.type === "identifier" ? 2 : 1;
  else if (tokens[cursor]?.type === "identifier" && tokens[cursor + 1]?.value === "=>") return [cursor];
  if (tokens[cursor]?.value !== "(") return null;
  return ["=>", "{", ":"].includes(tokens[(tokens[cursor] as JsToken).match + 1]?.value ?? "") ? groupItems(tokens, cursor) : null;
}

/**
 * The context parameter of a case: in the case callback — the last function argument of the titled
 * call whose group opens at `open` — the parameter at `position`, or none when `position` is `null`.
 * A destructured parameter reaches it as `skip`.
 */
function caseContext(tokens: readonly JsToken[], open: number, position: number | null): CaseContext | null {
  if (position === null) return null;
  const callback = groupItems(tokens, open)
    .reverse()
    .map((start) => functionParameters(tokens, start))
    .find((parameters) => parameters !== null);
  const parameter = callback?.[position];
  if (parameter === undefined) return null;
  const first = tokens[parameter] as JsToken;
  if (first.type === "identifier") return { name: first.value, via: "member" };
  if (first.value !== "{") return null;
  for (let key = parameter + 1; key < first.match; key += 1) {
    if (tokens[key]?.value !== "skip" || !["{", ","].includes(tokens[key - 1]?.value ?? "")) continue;
    const renamed = tokens[key + 1]?.value === ":" && tokens[key + 2]?.type === "identifier";
    return { name: renamed ? (tokens[key + 2] as JsToken).value : "skip", via: "call" };
  }
  return null;
}

/** The callback parameter that is a case's context: none for `.each(rows)`, the second for `.for(rows)`. */
function contextPosition(members: readonly string[]): number | null {
  if (members.includes("each")) return null;
  return members.includes("for") ? 1 : 0;
}

/** Whether the token at `index` is a skip call through `context`. */
function isContextSkip(tokens: readonly JsToken[], index: number, context: CaseContext): boolean {
  if (tokens[index]?.value !== context.name || tokens[index - 1]?.value === ".") return false;
  return context.via === "call" ? tokens[index + 1]?.value === "(" : tokens[index + 1]?.value === "." && tokens[index + 2]?.value === "skip" && tokens[index + 3]?.value === "(";
}

interface OpenCase {
  readonly path: string;
  readonly end: number;
  readonly context: CaseContext | null;
  readonly record: { key: string; title: string; branches: string[][]; assertions: number; contextSkips: number };
}

/** The cases of a lexed test file and the case titles its comments hold, or `null` (see above). */
export function testCaseSurface(source: JsSource): TestCaseSurface | null {
  const { tokens } = source;
  const imports = testImports(tokens);
  const aliases = caseAliases(tokens);
  const scopes = parameterScopes(tokens);
  const isParameter = (index: number): boolean =>
    scopes.some((scope) => scope.name === tokens[index]?.value && index >= scope.start && index <= scope.end);
  const consumed = new Set([...imports.tokens, ...aliases.definitions]);
  const cases: OpenCase["record"][] = [];
  const occurrences = new Map<string, number>();
  const stack: OpenCase[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    while (stack.length > 0 && (stack[stack.length - 1] as OpenCase).end < index) stack.pop();
    const skipOwner = [...stack].reverse().find((open) => open.context !== null && isContextSkip(tokens, index, open.context));
    if (skipOwner !== undefined) skipOwner.record.contextSkips += 1;
    if (consumed.has(index) || !isBindingReference(tokens, index)) continue;
    const name = (tokens[index] as JsToken).value;
    // A parameter (`(test) => test.status`) is that parameter, except where it is written as a case
    // call — then it is read as one, so a misjudged parameter range cannot hide a case.
    const parameter = isParameter(index);
    if (parameter && !CASE_FUNCTIONS.has(name)) continue;
    if (name === "expect") {
      const use = expectUse(tokens, index);
      if (use === null) continue;
      consumed.add(index);
      const owner = stack[stack.length - 1];
      if (use === "assertion" && owner !== undefined) owner.record.assertions += 1;
      continue;
    }
    if (HOOKS_AND_UTILITIES.has(name)) {
      if (["(", ".", "<"].includes(tokens[index + 1]?.value ?? "")) consumed.add(index);
      continue;
    }
    const definition = CASE_FUNCTIONS.has(name) ? [PREFIX_MARKERS.has(name) ? [name] : []] : aliases.references.get(name);
    if (definition === undefined) continue;
    const chain = chainAt(tokens, index, []);
    if (chain === null || tokens[chain.end]?.value !== "(") continue;
    const title = titleAt(tokens, chain.end);
    if (title === null) continue;
    consumed.add(index);
    const parent = stack[stack.length - 1];
    const path = parent === undefined ? title : `${parent.path} > ${title}`;
    const seen = (occurrences.get(path) ?? 0) + 1;
    occurrences.set(path, seen);
    const branches = definition.map((markers) => [...markers, ...chain.markers]);
    const record = { key: seen === 1 ? path : `${path} (${seen})`, title, branches, assertions: 0, contextSkips: 0 };
    cases.push(record);
    stack.push({ path, end: (tokens[chain.end] as JsToken).match, context: caseContext(tokens, chain.end, contextPosition(chain.members)), record });
  }
  const locals = localBindings(tokens);
  const globals = [...GLOBAL_TEST_API].filter((name) => CASE_FUNCTIONS.has(name) || name === "expect" || !locals.has(name));
  const api = new Set([...globals, ...imports.names, ...aliases.references.keys()]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!consumed.has(index) && api.has(tokens[index]?.value ?? "") && isBindingReference(tokens, index) && !isParameter(index)) return null;
  }
  const commentedTitles = new Set<string>();
  for (const comment of source.comments) {
    for (const match of comment.matchAll(COMMENTED_CASE)) commentedTitles.add(match[2] as string);
  }
  return { cases, commentedTitles };
}
