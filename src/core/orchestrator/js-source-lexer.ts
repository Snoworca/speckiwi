// @req FR-NODE-252 — the token stream `orchestrate preservation check` reads JavaScript and TypeScript
// through. TypeScript is a development dependency only, so the shipped CLI cannot parse with the
// compiler; this lexer knows just enough to keep comments, strings, template literals and regular
// expressions from being read as code. Anything it cannot close is refused (`null`), and the caller
// lists that file as unchecked rather than reading it as preserved.

export type JsTokenType = "identifier" | "private-name" | "punctuator" | "string" | "template" | "regex" | "number" | "jsx";

export interface LexOptions {
  /** Read JSX elements (`.tsx`, `.jsx`). Off for `.ts`, where `<T>value` is a type assertion. */
  readonly jsx?: boolean;
}

export interface JsToken {
  readonly type: JsTokenType;
  readonly value: string;
  /** Whether a line break separates this token from the one before it. */
  readonly newlineBefore: boolean;
  /** For an opening bracket, the index of its closing bracket; -1 for every other token. */
  readonly match: number;
}

export interface JsSource {
  readonly tokens: readonly JsToken[];
  /** The text of every comment, without its `//` or `/*` delimiters. */
  readonly comments: readonly string[];
}

const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);
const MULTI_CHAR_PUNCTUATORS = ["...", "===", "!==", "=>", "==", "!=", "<=", ">=", "?.", "??", "&&", "||", "++", "--", "**"];
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char) || char.charCodeAt(0) > 0x7f;
}

function isIdentifierPart(char: string): boolean {
  return /[\w$]/.test(char) || char.charCodeAt(0) > 0x7f;
}

interface MutableToken {
  type: JsTokenType;
  value: string;
  newlineBefore: boolean;
  match: number;
}

/** Whether `token` can end an expression, so that an operator after it is binary. */
function endsExpression(token: MutableToken | undefined): boolean {
  if (token === undefined) return false;
  if (token.type === "identifier") return !KEYWORDS_BEFORE_EXPRESSION.has(token.value);
  if (token.type !== "punctuator") return true;
  return CLOSERS.has(token.value) || token.value === "++" || token.value === "--";
}

/**
 * Whether the next token starts an expression: where a `/` opens a regular expression and, in JSX,
 * a `<` opens an element. A `!` right after an expression is TypeScript's non-null assertion, so
 * `get(key)! / 2` divides.
 */
function expressionExpected(tokens: readonly MutableToken[]): boolean {
  const previous = tokens[tokens.length - 1];
  if (previous?.value === "!" && endsExpression(tokens[tokens.length - 2])) return false;
  return !endsExpression(previous);
}

/** The index just past a quoted string starting at `start`, or -1 when it does not close on its line. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === quote) return index + 1;
    else if (char === "\n") return -1;
    else index += 1;
  }
  return -1;
}

/** The index just past a regular expression literal starting at `start`, or -1. */
function regexEnd(text: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === "\n") return -1;
    else if (char === "[" || char === "]") {
      inClass = char === "[";
      index += 1;
    } else if (char === "/" && !inClass) {
      index += 1;
      while (index < text.length && /[A-Za-z]/.test(text[index] as string)) index += 1;
      return index;
    } else index += 1;
  }
  return -1;
}

/** Whether the `<` at `start` opens a JSX element rather than a generic arrow function's `<T,>`. */
function opensJsxElement(text: string, start: number): boolean {
  const next = text[start + 1];
  if (next === ">") return true;
  if (next === undefined || !isIdentifierStart(next)) return false;
  const after = /^[\w$]*\s*(,|extends\b)?/.exec(text.slice(start + 1, start + 200));
  return after?.[1] === undefined;
}

/** The index just past the JSX element (or fragment, whose tag name is empty) starting at `start`, or -1. */
function jsxElementEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && /[\w$.:-]/.test(text[index] as string)) index += 1;
  while (index < text.length) {
    const char = text[index] as string;
    if (char === "/" && text[index + 1] === ">") return index + 2;
    if (char === ">") return jsxChildrenEnd(text, index + 1);
    if (char === "{") {
      const nested = scan(text, index + 1, true, true);
      if (nested === null) return -1;
      index = nested.end;
    } else if (char === "\"" || char === "'") {
      const close = text.indexOf(char, index + 1);
      if (close === -1) return -1;
      index = close + 1;
    } else if (char === "<") {
      index = jsxElementEnd(text, index);
      if (index === -1) return -1;
    } else if (/[\s\w$:.=-]/.test(char)) index += 1;
    else return -1;
  }
  return -1;
}

/** The index just past the closing tag that ends the children starting at `start`, or -1. */
function jsxChildrenEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === "<" && text[index + 1] === "/") {
      const close = text.indexOf(">", index);
      return close === -1 ? -1 : close + 1;
    }
    if (char === "<") {
      index = jsxElementEnd(text, index);
      if (index === -1) return -1;
    } else if (char === "{") {
      const nested = scan(text, index + 1, true, true);
      if (nested === null) return -1;
      index = nested.end;
    } else index += 1;
  }
  return -1;
}

interface ScanResult {
  readonly tokens: MutableToken[];
  readonly comments: string[];
  /** Index just past the scanned text: past the unmatched `}` in nested mode, `text.length` otherwise. */
  readonly end: number;
}

/** The index just past a template literal starting at `start`, or -1. */
function templateEnd(text: string, start: number, jsx: boolean): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === "`") return index + 1;
    else if (char === "$" && text[index + 1] === "{") {
      const nested = scan(text, index + 2, true, jsx);
      if (nested === null) return -1;
      index = nested.end;
    } else index += 1;
  }
  return -1;
}

/**
 * Tokens from `start`. In nested mode (a template substitution) it stops just past the `}` that closes
 * the substitution; otherwise at the end of the text, with every bracket matched.
 */
function scan(text: string, start: number, nested: boolean, jsx: boolean): ScanResult | null {
  const tokens: MutableToken[] = [];
  const comments: string[] = [];
  const openStack: number[] = [];
  let newline = false;
  let index = start;
  const push = (type: JsTokenType, value: string): void => {
    tokens.push({ type, value, newlineBefore: newline, match: -1 });
    newline = false;
  };
  if (!nested && text.startsWith("#!")) {
    const lineEnd = text.indexOf("\n");
    index = lineEnd === -1 ? text.length : lineEnd;
  }
  while (index < text.length) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (char === "\n" || char === " " || char === " ") {
      newline = true;
      index += 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else if (char === "/" && next === "/") {
      const lineEnd = text.indexOf("\n", index);
      const end = lineEnd === -1 ? text.length : lineEnd;
      comments.push(text.slice(index + 2, end));
      index = end;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) return null;
      const body = text.slice(index + 2, end);
      if (body.includes("\n")) newline = true;
      comments.push(body);
      index = end + 2;
    } else if (char === "'" || char === "\"") {
      const end = stringEnd(text, index);
      if (end === -1) return null;
      push("string", text.slice(index, end));
      index = end;
    } else if (char === "`") {
      const end = templateEnd(text, index, jsx);
      if (end === -1) return null;
      push("template", text.slice(index, end));
      index = end;
    } else if (jsx && char === "<" && expressionExpected(tokens) && opensJsxElement(text, index)) {
      const end = jsxElementEnd(text, index);
      if (end === -1) return null;
      push("jsx", text.slice(index, end));
      index = end;
    } else if (char === "/" && expressionExpected(tokens)) {
      const end = regexEnd(text, index);
      if (end === -1) return null;
      push("regex", text.slice(index, end));
      index = end;
    } else if (/[0-9]/.test(char) || (char === "." && next !== undefined && /[0-9]/.test(next))) {
      let end = index + 1;
      while (end < text.length && /[\w.]/.test(text[end] as string)) end += 1;
      push("number", text.slice(index, end));
      index = end;
    } else if (isIdentifierStart(char) || (char === "#" && next !== undefined && isIdentifierStart(next))) {
      let end = index + 1;
      while (end < text.length && isIdentifierPart(text[end] as string)) end += 1;
      push(char === "#" ? "private-name" : "identifier", text.slice(index, end));
      index = end;
    } else if (OPENERS[char] !== undefined) {
      openStack.push(tokens.length);
      push("punctuator", char);
      index += 1;
    } else if (CLOSERS.has(char)) {
      const opener = openStack.pop();
      if (opener === undefined) {
        if (nested && char === "}") return { tokens, comments, end: index + 1 };
        return null;
      }
      const openToken = tokens[opener] as MutableToken;
      if (OPENERS[openToken.value] !== char) return null;
      openToken.match = tokens.length;
      push("punctuator", char);
      index += 1;
    } else {
      const multi = MULTI_CHAR_PUNCTUATORS.find((candidate) => text.startsWith(candidate, index));
      const value = multi ?? char;
      push("punctuator", value);
      index += value.length;
    }
  }
  if (nested || openStack.length > 0) return null;
  return { tokens, comments, end: index };
}

/**
 * Whether the identifier at `index` refers to a binding: not a member (`.test`, `?.test`), not a
 * property key or parameter name (`{ test: … }`, `readonly module: string`), not a function name.
 */
export function isBindingReference(tokens: readonly JsToken[], index: number): boolean {
  if (tokens[index]?.type !== "identifier") return false;
  const previous = tokens[index - 1]?.value;
  if (previous === "." || previous === "?." || previous === "function") return false;
  const colon = tokens[index + 1]?.value === "?" ? index + 2 : index + 1;
  return !(tokens[colon]?.value === ":" && previous !== "?");
}

/** Keywords whose parenthesized group is a condition, not a parameter list. */
const CONDITION_KEYWORDS = new Set(["if", "while", "for", "switch", "with", "catch"]);

export interface ParameterScope {
  readonly name: string;
  /** First token of the parameter list. */
  readonly start: number;
  /** Last token of the function body. */
  readonly end: number;
}

/**
 * Index of the last token of an arrow function body that starts at `start` (the token after `=>`):
 * a block, or an expression ending at a closing bracket, `,`, `;`, or a `:` that closes no `?` of the
 * body (`flag ? (a) => a : (b) => b`).
 */
function arrowBodyEnd(tokens: readonly JsToken[], start: number): number {
  if (tokens[start]?.value === "{") return (tokens[start] as JsToken).match;
  let open = 0;
  let cursor = start;
  while (cursor < tokens.length && ![")", "]", "}", ",", ";"].includes(tokens[cursor]?.value ?? "")) {
    const value = tokens[cursor]?.value;
    if (value === "?") open += 1;
    else if (value === ":" && open === 0) break;
    else if (value === ":") open -= 1;
    const match = (tokens[cursor] as JsToken).match;
    cursor = match >= 0 ? match + 1 : cursor + 1;
  }
  return cursor - 1;
}

/** Tokens after which a `{` in a return type opens a type literal rather than the function body. */
const TYPE_POSITION = new Set([":", "|", "&", "<", ","]);

/**
 * Index of the `=>` or the body `{` that ends a return type annotation starting at `start`, or -1
 * when the tokens there are not one: they reach a `;`, `,` or closing bracket first (the `:` was a
 * ternary's), or hold a parenthesized group (a function type, read conservatively as no annotation).
 */
function returnTypeEnd(tokens: readonly JsToken[], start: number): number {
  let angles = 0;
  let cursor = start;
  while (cursor < tokens.length) {
    const value = tokens[cursor]?.value ?? "";
    if (value === "=>") return cursor;
    if (value === "{" && !TYPE_POSITION.has(tokens[cursor - 1]?.value ?? "")) return cursor;
    if (value === "(" || (angles === 0 && [";", ",", ")", "]", "}"].includes(value))) return -1;
    if (value === "<") angles += 1;
    else if (value === ">" && angles > 0) angles -= 1;
    const match = (tokens[cursor] as JsToken).match;
    cursor = match >= 0 ? match + 1 : cursor + 1;
  }
  return -1;
}

/**
 * The index of the first body token of the function whose parameter list opens at `open`, or -1 when
 * the group is not a parameter list. A group after a name or a closing bracket is a call unless a
 * block follows it (a function or method definition, `name(a): T {`); any other group is an arrow
 * function's parameters only when `=>` follows it, directly or after a return type.
 */
function parameterListBody(tokens: readonly JsToken[], open: number): number {
  const before = tokens[open - 1];
  if (CONDITION_KEYWORDS.has(before?.value ?? "")) return -1;
  const afterName =
    before !== undefined &&
    ((before.type === "identifier" && before.value !== "async" && !KEYWORDS_BEFORE_EXPRESSION.has(before.value)) || [")", "]"].includes(before.value));
  let after = (tokens[open] as JsToken).match + 1;
  if (tokens[after]?.value === ":") after = returnTypeEnd(tokens, after + 1);
  if (after < 0) return -1;
  const value = tokens[after]?.value;
  if (value === "=>") return afterName ? -1 : after + 1;
  return value === "{" && afterName ? after : -1;
}

/**
 * The parameters of every arrow function and function in the file, each with the token range it is
 * bound in: its own parameter list through the end of the body. `(test) => test.status` binds `test`
 * there, so a name the test API also uses is that parameter inside that range and nowhere else.
 */
export function parameterScopes(tokens: readonly JsToken[]): ParameterScope[] {
  const scopes: ParameterScope[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as JsToken;
    if (token.type === "identifier" && tokens[index + 1]?.value === "=>" && tokens[index - 1]?.value !== ".") {
      scopes.push({ name: token.value, start: index, end: arrowBodyEnd(tokens, index + 2) });
      continue;
    }
    if (token.value !== "(") continue;
    const body = parameterListBody(tokens, index);
    if (body < 0) continue;
    const end = tokens[body - 1]?.value === "=>" ? arrowBodyEnd(tokens, body) : (tokens[body] as JsToken).match;
    for (let cursor = index + 1; cursor < token.match; cursor = (tokens[cursor] as JsToken).match >= 0 ? (tokens[cursor] as JsToken).match + 1 : cursor + 1) {
      const parameter = tokens[cursor] as JsToken;
      const before = tokens[cursor - 1]?.value ?? "";
      if (parameter.type === "identifier" && ["(", ",", "..."].includes(before) && [",", ")", ":", "=", "?"].includes(tokens[cursor + 1]?.value ?? "")) {
        scopes.push({ name: parameter.value, start: index, end });
      }
    }
  }
  return scopes;
}

/** Names the file declares as its own bindings: `const|let|var` names and every parameter name. */
export function localBindings(tokens: readonly JsToken[]): Set<string> {
  const names = new Set(parameterScopes(tokens).map((scope) => scope.name));
  tokens.forEach((token, index) => {
    if (token.type === "identifier" && ["const", "let", "var"].includes(tokens[index - 1]?.value ?? "")) names.add(token.value);
  });
  return names;
}

/** The tokens and comments of a JavaScript or TypeScript source, or `null` when it does not lex. */
export function lexJsSource(text: string, options: LexOptions = {}): JsSource | null {
  const result = scan(text, 0, false, options.jsx === true);
  return result === null ? null : { tokens: result.tokens, comments: result.comments };
}
