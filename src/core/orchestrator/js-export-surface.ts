import { isBindingReference, localBindings, type JsSource, type JsToken } from "./js-source-lexer.js";

// @req FR-NODE-252 AC-3 — the export surface of a JavaScript or TypeScript module: each exported name
// with the text of its parameter list and type, the part kiwi-coder §0.20.2 calls the public contract.
// A body or an initializer value is not part of it. The signature is the declaration's tokens joined by
// one space, so reformatting a declaration changes nothing while changing a parameter or a type does.
//
// The forms read are a closed list: the top-level `export` declarations, lists, re-exports and
// `export default` forms this repository's sources use, plus the CommonJS `exports.x =` and
// `module.exports =` forms. Every `export`, `exports` and `module` token must be consumed by one of
// them; one left over — a namespace, `export default interface`, `module["exports"]`, a function-local
// `module.exports.x =` — makes the whole surface `null`, as do a class expression and a list entry
// naming a binding the reader did not see declared or imported. The caller lists such a file as
// unchecked: a file the reader only partly understood never reads as preserved.

/** Exported name → signature text (`""` when the export carries no parameter list or type). */
export type ExportSurface = ReadonlyMap<string, string>;

/** Tokens on a new line that start a statement, ending the one before when it has no semicolon. */
const STATEMENT_STARTS = new Set([
  "export",
  "import",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "declare",
  "namespace",
  "abstract",
  "@"
]);

/** Tokens after which a `{` opens a type literal rather than a body. */
const TYPE_POSITION_BEFORE_BRACE = new Set([
  ":",
  "|",
  "&",
  "<",
  ",",
  "(",
  "=>",
  "[",
  "?",
  "=",
  "extends",
  "keyof",
  "typeof",
  "readonly",
  "infer",
  "is",
  "as",
  "satisfies"
]);

/** Words that may precede a class member's name. */
const MEMBER_MODIFIERS = new Set(["public", "private", "protected", "static", "readonly", "abstract", "override", "declare", "async", "accessor", "get", "set"]);
/** Modifiers that keep a member out of the public contract (kiwi-coder §0.20.2). */
const NON_PUBLIC_MODIFIERS = new Set(["private", "protected"]);
/** Tokens after which a line break does not end a class member written without a semicolon. */
const CONTINUES_MEMBER = new Set(["=", ":", "|", "&", ",", "=>", "?", ".", "?.", "<", "extends", "keyof", "typeof", "new", "as", "satisfies", "+", "-", "*", "/", "&&", "||", "??"]);

interface Declared {
  readonly name: string;
  readonly signature: string;
}

interface Parsed {
  readonly declared: readonly Declared[];
  readonly next: number;
}

class SurfaceReader {
  constructor(readonly tokens: readonly JsToken[]) {}

  value(index: number): string | undefined {
    return this.tokens[index]?.value;
  }

  isIdentifier(index: number): boolean {
    return this.tokens[index]?.type === "identifier";
  }

  isString(index: number): boolean {
    return this.tokens[index]?.type === "string";
  }

  /** Index just past the token at `index`, jumping over a bracketed group when it opens one. */
  step(index: number): number {
    const match = this.tokens[index]?.match ?? -1;
    return match >= 0 ? match + 1 : index + 1;
  }

  text(from: number, to: number): string {
    return this.tokens
      .slice(from, to)
      .map((token) => token.value)
      .join(" ");
  }

  /** Index just past a `<…>` group starting at `index`. */
  skipAngles(index: number): number {
    let depth = 0;
    let cursor = index;
    while (cursor < this.tokens.length) {
      const value = this.value(cursor);
      if (value === "<") depth += 1;
      else if (value === ">") depth -= 1;
      cursor = this.step(cursor);
      if (depth === 0) return cursor;
    }
    return cursor;
  }

  /** Whether the token at `index` ends the statement that started before it. */
  endsStatement(index: number, start: number): boolean {
    const token = this.tokens[index];
    if (token === undefined) return true;
    if (token.value === ";" || (token.type === "punctuator" && [")", "]", "}"].includes(token.value))) return true;
    return index > start && token.newlineBefore && STATEMENT_STARTS.has(token.value);
  }

  /** Index of the token that ends a statement begun at `start`. */
  statementEnd(start: number): number {
    let cursor = start;
    while (!this.endsStatement(cursor, start)) cursor = this.step(cursor);
    return cursor;
  }

  /**
   * Index of the token that ends one declarator (or object entry) begun at `start`: the statement
   * end, a `,` outside type arguments, or — with `stopAtEquals` — the `=` ending an annotation.
   * Angle brackets are not lexed as brackets, so their depth is counted here: the comma in
   * `Map<string, number>` belongs to the type, not to the declarator list.
   */
  declaratorEnd(start: number, stopAtEquals = false): number {
    let angles = 0;
    let cursor = start;
    while (!this.endsStatement(cursor, start)) {
      const value = this.value(cursor);
      if (angles === 0 && (value === "," || (stopAtEquals && value === "="))) return cursor;
      if (value === "<") angles += 1;
      else if (value === ">" && angles > 0) angles -= 1;
      cursor = this.step(cursor);
    }
    return cursor;
  }

  /** Index of the `{` opening the body of a declaration whose head starts at `start`, or -1. */
  bodyStart(start: number, limit = this.tokens.length): number {
    let cursor = start;
    while (cursor < limit) {
      const value = this.value(cursor);
      if (value === "{") {
        if (!TYPE_POSITION_BEFORE_BRACE.has(this.value(cursor - 1) ?? "")) return cursor;
      } else if (this.endsStatement(cursor, start)) return -1;
      cursor = this.step(cursor);
    }
    return -1;
  }

  /** `function` [`*`] [name] [<…>] (…) [: type] — the declaration at `index` (the `function` token). */
  functionDeclaration(index: number, anonymousName?: string): Parsed | null {
    let cursor = index + 1;
    if (this.value(cursor) === "*") cursor += 1;
    let name = anonymousName;
    if (anonymousName === undefined || this.isIdentifier(cursor)) {
      if (!this.isIdentifier(cursor)) return null;
      name = anonymousName ?? this.value(cursor);
      cursor += 1;
    }
    const signatureStart = cursor;
    if (this.value(cursor) === "<") cursor = this.skipAngles(cursor);
    if (this.value(cursor) !== "(") return null;
    cursor = this.step(cursor);
    const body = this.bodyStart(cursor);
    const end = body >= 0 ? body : this.statementEnd(cursor);
    return { declared: [{ name: name as string, signature: this.text(signatureStart, end) }], next: body >= 0 ? this.step(body) : end };
  }

  /** `class` [name] header { … } — the signature is the header: type parameters and heritage. */
  classDeclaration(index: number, anonymousName?: string): Parsed | null {
    let cursor = index + 1;
    let name = anonymousName;
    if (this.isIdentifier(cursor) && this.value(cursor) !== "extends" && this.value(cursor) !== "implements") {
      name = anonymousName ?? this.value(cursor);
      cursor += 1;
    }
    if (name === undefined) return null;
    const body = this.bodyStart(cursor);
    if (body < 0) return null;
    const members = this.publicMembers(body, this.step(body) - 1);
    if (members === null) return null;
    return { declared: [{ name, signature: `${this.text(cursor, body)} { ${members.join(" ; ")} }` }], next: this.step(body) };
  }

  /** Whether the token at `index` can be a class member's name. */
  isMemberName(index: number): boolean {
    const token = this.tokens[index];
    if (token === undefined) return false;
    return ["identifier", "private-name", "string", "number"].includes(token.type) || token.value === "[" || token.value === "*";
  }

  /**
   * Index of the token that ends a class member's type or initializer begun at `start`: a `;`, the
   * class body's `}`, a line break that cannot continue the member, or — with `stopAtEquals` — the
   * `=` that starts an initializer. Angle brackets are counted as in {@link declaratorEnd}.
   */
  memberEnd(start: number, close: number, stopAtEquals: boolean): number {
    let angles = 0;
    let cursor = start;
    while (cursor < close) {
      const value = this.value(cursor) as string;
      if (value === ";") return cursor;
      if (angles === 0 && stopAtEquals && value === "=") return cursor;
      const token = this.tokens[cursor] as JsToken;
      if (cursor > start && token.newlineBefore && angles === 0 && !CONTINUES_MEMBER.has(this.value(cursor - 1) ?? "") && this.isMemberName(cursor) && value !== "*") {
        return cursor;
      }
      if (value === "<") angles += 1;
      else if (value === ">" && angles > 0) angles -= 1;
      cursor = this.step(cursor);
    }
    return close;
  }

  /**
   * The signatures of a class body's public members between the braces at `open` and `close`: the
   * constructor's parameter list, each method's parameters and return type, each property's type
   * (and a function initializer's signature), each with its modifiers. A body, an initializer value
   * and a `private`, `protected` or `#` member are not part of the contract. `null` for a member form
   * this reader does not know.
   */
  publicMembers(open: number, close: number): string[] | null {
    const members: string[] = [];
    let cursor = open + 1;
    while (cursor < close) {
      if (this.value(cursor) === ";") {
        cursor += 1;
        continue;
      }
      if (this.value(cursor) === "static" && this.value(cursor + 1) === "{") {
        cursor = this.step(cursor + 1);
        continue;
      }
      while (this.value(cursor) === "@") {
        cursor += 1;
        while (this.isIdentifier(cursor) || this.value(cursor) === ".") cursor += 1;
        if (this.value(cursor) === "(") cursor = this.step(cursor);
      }
      const modifiers: string[] = [];
      while (MEMBER_MODIFIERS.has(this.value(cursor) ?? "") && this.isMemberName(cursor + 1)) {
        modifiers.push(this.value(cursor) as string);
        cursor += 1;
      }
      if (this.value(cursor) === "*") {
        modifiers.push("*");
        cursor += 1;
      }
      if (!this.isMemberName(cursor)) return null;
      const hidden = modifiers.some((modifier) => NON_PUBLIC_MODIFIERS.has(modifier)) || this.tokens[cursor]?.type === "private-name";
      const nameStart = cursor;
      cursor = this.step(cursor);
      if (this.value(cursor) === "?" || this.value(cursor) === "!") cursor += 1;
      let signatureEnd: number;
      let initializer = "";
      if (this.value(cursor) === "(" || this.value(cursor) === "<") {
        let parameters = cursor;
        if (this.value(parameters) === "<") parameters = this.skipAngles(parameters);
        if (this.value(parameters) !== "(") return null;
        const body = this.bodyStart(this.step(parameters), close);
        signatureEnd = body >= 0 ? body : this.memberEnd(this.step(parameters), close, false);
        cursor = body >= 0 ? this.step(body) : signatureEnd;
      } else {
        signatureEnd = this.memberEnd(cursor, close, true);
        cursor = signatureEnd;
        if (this.value(cursor) === "=") {
          const end = this.memberEnd(cursor + 1, close, false);
          const signature = this.functionValueSignature(cursor + 1, end);
          if (signature !== "") initializer = ` = ${signature}`;
          cursor = end;
        }
      }
      if (!hidden) members.push(`${[...modifiers, this.text(nameStart, signatureEnd)].join(" ")}${initializer}`);
      if (this.value(cursor) === ";") cursor += 1;
    }
    return members;
  }

  /** `interface` / `enum` name … { … } — the signature is everything after the name, body included. */
  bracedTypeDeclaration(index: number): Parsed | null {
    const nameIndex = index + 1;
    if (!this.isIdentifier(nameIndex)) return null;
    const body = this.bodyStart(nameIndex + 1);
    if (body < 0) return null;
    const next = this.step(body);
    return { declared: [{ name: this.value(nameIndex) as string, signature: this.text(nameIndex + 1, next) }], next };
  }

  /** `type` name [<…>] = … ; — `null` when `type` is not declaring an alias here. */
  typeAlias(index: number): Parsed | null {
    const nameIndex = index + 1;
    if (!this.isIdentifier(nameIndex) || !["=", "<"].includes(this.value(nameIndex + 1) ?? "")) return null;
    const end = this.statementEnd(nameIndex + 1);
    return { declared: [{ name: this.value(nameIndex) as string, signature: this.text(nameIndex + 1, end) }], next: end };
  }

  /** Whether the value at `index` is a class expression, whose members the reader does not read. */
  isClassExpression(index: number): boolean {
    return this.value(index) === "class" || (this.value(index) === "abstract" && this.value(index + 1) === "class");
  }

  /**
   * The parameter list and return type of a function expression or an arrow function between
   * `start` and `end`, or `""` when the value is not a function.
   */
  functionValueSignature(start: number, end: number): string {
    let cursor = start;
    if (this.value(cursor) === "async" && this.value(cursor + 1) !== "=>") cursor += 1;
    if (this.value(cursor) === "function") {
      cursor += 1;
      if (this.value(cursor) === "*") cursor += 1;
      if (this.isIdentifier(cursor)) cursor += 1;
      const from = cursor;
      if (this.value(cursor) === "<") cursor = this.skipAngles(cursor);
      if (this.value(cursor) !== "(") return "";
      const body = this.bodyStart(this.step(cursor), end);
      return this.text(from, body >= 0 ? body : end);
    }
    if (this.isIdentifier(cursor) && this.value(cursor + 1) === "=>") return this.text(cursor, cursor + 1);
    const from = cursor;
    if (this.value(cursor) === "<") cursor = this.skipAngles(cursor);
    if (this.value(cursor) !== "(") return "";
    cursor = this.step(cursor);
    if (this.value(cursor) === ":") {
      while (cursor < end && this.value(cursor) !== "=>") cursor = this.step(cursor);
    }
    return this.value(cursor) === "=>" && cursor < end ? this.text(from, cursor) : "";
  }

  /** `const` / `let` / `var` declarators: each name with its annotation and any function signature. */
  variableDeclaration(index: number): Parsed | null {
    const declared: Declared[] = [];
    let cursor = index + 1;
    for (;;) {
      if (!this.isIdentifier(cursor)) return null;
      const name = this.value(cursor) as string;
      cursor += 1;
      if (this.value(cursor) === "!") cursor += 1;
      const parts: string[] = [];
      if (this.value(cursor) === ":") {
        const annotationEnd = this.declaratorEnd(cursor + 1, true);
        parts.push(`: ${this.text(cursor + 1, annotationEnd)}`);
        cursor = annotationEnd;
      }
      if (this.value(cursor) === "=") {
        if (this.isClassExpression(cursor + 1)) return null;
        const end = this.declaratorEnd(cursor + 1);
        const signature = this.functionValueSignature(cursor + 1, end);
        if (signature !== "") parts.push(`= ${signature}`);
        cursor = end;
      }
      declared.push({ name, signature: parts.join(" ") });
      if (this.value(cursor) !== ",") return { declared, next: cursor };
      cursor += 1;
    }
  }

  /** A declaration starting at `index`, whether or not it is exported; `null` when it is not one. */
  declaration(index: number): Parsed | null {
    const value = this.value(index);
    if (value === "declare") return this.declaration(index + 1);
    if (value === "async" && this.value(index + 1) === "function") return this.functionDeclaration(index + 1);
    if (value === "abstract" && this.value(index + 1) === "class") return this.classDeclaration(index + 1);
    if (value === "const" && this.value(index + 1) === "enum") return this.bracedTypeDeclaration(index + 1);
    if (value === "function") return this.functionDeclaration(index);
    if (value === "class") return this.classDeclaration(index);
    if (value === "interface" || value === "enum") return this.bracedTypeDeclaration(index);
    if (value === "type") return this.typeAlias(index);
    if (value === "const" || value === "let" || value === "var") return this.variableDeclaration(index);
    return null;
  }

  /**
   * `export default …` at `index` (the `default` token): a function or class declaration, or an
   * expression — a function value is compared by its signature, any other value by name only, as an
   * exported `const` is. A bare identifier is returned as `local` so it resolves like `export { x }`.
   */
  defaultExport(index: number): (Parsed & { readonly local?: string }) | null {
    const value = this.value(index + 1);
    if (["interface", "enum", "namespace", "module", "declare", "type"].includes(value ?? "")) return null;
    const start = value === "async" && this.value(index + 2) === "function" ? index + 2 : value === "abstract" ? index + 2 : index + 1;
    if (this.value(start) === "function") return this.functionDeclaration(start, "default");
    if (this.value(start) === "class") return this.classDeclaration(start, "default");
    const end = this.statementEnd(index + 1);
    if (this.isIdentifier(index + 1) && end === index + 2) return { declared: [], next: end, local: this.value(index + 1) as string };
    return { declared: [{ name: "default", signature: this.functionValueSignature(index + 1, end) }], next: end };
  }

  /**
   * `import …` at `index`: each binding it declares, with the signature an `export { … } from` of
   * the same name gets, so re-exporting an import reads like re-exporting from its module.
   * `null` when the statement is not an import declaration (`import(…)`, `import.meta`) or is one
   * whose bindings the reader does not know (`import x = require(…)`).
   */
  importDeclaration(index: number): Parsed | null {
    let cursor = index + 1;
    if (this.value(cursor) === "(" || this.value(cursor) === ".") return null;
    if (this.value(cursor) === "type" && this.value(cursor + 1) !== "," && this.value(cursor + 1) !== "from") cursor += 1;
    const end = this.statementEnd(cursor);
    if (this.tokens[cursor]?.type === "string") return { declared: [], next: end };
    const fromIndex = this.value(end - 2) === "from" ? end - 2 : -1;
    if (fromIndex < 0) return null;
    const module = this.value(fromIndex + 1) as string;
    const bindings: Array<{ imported: string; local: string }> = [];
    while (cursor < fromIndex) {
      if (this.isIdentifier(cursor)) {
        bindings.push({ imported: "default", local: this.value(cursor) as string });
        cursor += 1;
      } else if (this.value(cursor) === "*" && this.value(cursor + 1) === "as" && this.isIdentifier(cursor + 2)) {
        bindings.push({ imported: "*", local: this.value(cursor + 2) as string });
        cursor += 3;
      } else if (this.value(cursor) === "{") {
        const close = this.step(cursor) - 1;
        const entries = exportList(this, cursor, close);
        if (entries === null) return null;
        for (const entry of entries) bindings.push({ imported: entry.local, local: entry.name });
        cursor = close + 1;
      } else return null;
      if (this.value(cursor) === ",") cursor += 1;
    }
    return { declared: bindings.map((binding) => ({ name: binding.local, signature: `from ${module} ${binding.imported}` })), next: end };
  }
}

/** Whether the token at `index` refers to the CommonJS `exports` object (`exports` or `module.exports`). */
function isExportsReference(reader: SurfaceReader, index: number): boolean {
  if (reader.value(index) !== "exports") return false;
  return isBindingReference(reader.tokens, index) || (reader.value(index - 1) === "." && reader.value(index - 2) === "module");
}

interface ListExport {
  readonly name: string;
  readonly local: string;
  readonly source: string | null;
}

/** `{ a, b as c, type d }` between the braces at `open` and `close`. */
function exportList(reader: SurfaceReader, open: number, close: number): ListExport[] | null {
  const sourceIndex = reader.value(close + 1) === "from" ? close + 2 : -1;
  const source = sourceIndex >= 0 ? (reader.value(sourceIndex) ?? null) : null;
  const entries: ListExport[] = [];
  let cursor = open + 1;
  while (cursor < close) {
    if (reader.value(cursor) === "type" && reader.value(cursor + 1) !== "," && reader.value(cursor + 1) !== "as" && cursor + 1 < close) cursor += 1;
    const local = reader.value(cursor);
    if (local === undefined) return null;
    cursor += 1;
    let name = local;
    if (reader.value(cursor) === "as") {
      name = reader.value(cursor + 1) ?? "";
      cursor += 2;
    }
    entries.push({ name, local, source });
    if (reader.value(cursor) === ",") cursor += 1;
    else if (cursor !== close) return null;
  }
  return entries;
}

/** The export surface of a lexed module, or `null` when it uses a form this reader does not know. */
export function exportSurface(source: JsSource): ExportSurface | null {
  const reader = new SurfaceReader(source.tokens);
  // A list export names a local binding declared anywhere in the module, so its signature is
  // resolved after the walk; keeping it in place keeps the surface in source order.
  type Entry = string | ListExport;
  const exported = new Map<string, Entry[]>();
  const declared = new Map<string, Entry[]>();
  const record = (map: Map<string, Entry[]>, name: string, item: Entry): void => {
    map.set(name, [...(map.get(name) ?? []), item]);
  };
  const recordAll = (map: Map<string, Entry[]>, entries: readonly Declared[]): void => {
    for (const entry of entries) record(map, entry.name, entry.signature);
  };
  // Every `export` keyword and `exports` reference a recognized form consumed; one left over is a
  // form outside the list.
  const consumed = new Set<number>();
  let index = 0;
  while (index < source.tokens.length) {
    const value = reader.value(index);
    const afterDot = reader.value(index - 1) === ".";
    if (value === "export" && !afterDot) {
      consumed.add(index);
      let cursor = index + 1;
      if (reader.value(cursor) === "declare") cursor += 1;
      if (reader.value(cursor) === "type" && reader.value(cursor + 1) === "{") cursor += 1;
      const head = reader.value(cursor);
      if (head === "default") {
        const parsed = reader.defaultExport(cursor);
        if (parsed === null) return null;
        recordAll(exported, parsed.declared);
        if (parsed.local !== undefined) record(exported, "default", { name: "default", local: parsed.local, source: null });
        index = parsed.next;
      } else if (head === "*") {
        const aliased = reader.value(cursor + 1) === "as";
        const from = aliased ? cursor + 3 : cursor + 1;
        if (reader.value(from) !== "from") return null;
        const module = reader.value(from + 1) ?? "";
        recordAll(exported, [aliased ? { name: reader.value(cursor + 2) ?? "", signature: `from ${module}` } : { name: `* from ${module}`, signature: "" }]);
        index = reader.statementEnd(from + 1);
      } else if (head === "{") {
        const close = source.tokens[cursor]?.match ?? -1;
        const entries = exportList(reader, cursor, close);
        if (entries === null) return null;
        for (const entry of entries) record(exported, entry.name, entry);
        index = reader.statementEnd(close + 1);
      } else {
        const parsed = reader.declaration(cursor);
        if (parsed === null) return null;
        recordAll(exported, parsed.declared);
        recordAll(declared, parsed.declared);
        index = parsed.next;
      }
    } else if (!afterDot && (isExportsReference(reader, index) || (value === "module" && isExportsReference(reader, index + 2)))) {
      const exportsIndex = value === "exports" ? index : index + 2;
      const parsed = commonJsExport(reader, exportsIndex);
      if (parsed === null) return null;
      consumed.add(exportsIndex);
      consumed.add(index);
      recordAll(exported, parsed.declared);
      index = parsed.next;
    } else if (value === "import" && !afterDot) {
      const parsed = reader.importDeclaration(index);
      if (parsed !== null) recordAll(declared, parsed.declared);
      index = parsed !== null ? parsed.next : index + 1;
    } else {
      const parsed = afterDot ? null : reader.declaration(index);
      if (parsed !== null) recordAll(declared, parsed.declared);
      index = parsed !== null ? Math.max(parsed.next, index + 1) : reader.step(index);
    }
  }
  // A file's own binding named `module` (`for (const module of names)`) is that binding.
  const checked = localBindings(source.tokens).has("module") ? ["export", "exports"] : ["export", "exports", "module"];
  for (let cursor = 0; cursor < source.tokens.length; cursor += 1) {
    const exportToken = checked.includes(reader.value(cursor) ?? "") && isBindingReference(source.tokens, cursor);
    if (exportToken && !consumed.has(cursor)) return null;
  }
  const unresolved = [...exported.values()].flat().some((item) => typeof item !== "string" && item.source === null && !declared.has(item.local));
  if (unresolved) return null;
  const resolve = (item: Entry): Entry[] =>
    typeof item === "string" ? [item] : item.source !== null ? [`from ${item.source} ${item.local}`] : (declared.get(item.local) as Entry[]);
  return new Map([...exported].map(([name, items]) => [name, items.flatMap(resolve).join(" ; ")]));
}

/** `exports.x = …`, `module.exports.x = …` or `module.exports = …` with `index` at `exports`. */
function commonJsExport(reader: SurfaceReader, index: number): Parsed | null {
  if (reader.value(index + 1) === "=") {
    const start = index + 2;
    const end = reader.statementEnd(start);
    if (reader.isClassExpression(start)) return null;
    if (reader.value(start) === "{") return objectLiteralExports(reader, start, end);
    return { declared: [{ name: "default", signature: reader.functionValueSignature(start, end) }], next: end };
  }
  if (reader.value(index + 1) !== "." || !reader.isIdentifier(index + 2) || reader.value(index + 3) !== "=" || reader.isClassExpression(index + 4)) return null;
  const end = reader.statementEnd(index + 4);
  return { declared: [{ name: reader.value(index + 2) as string, signature: reader.functionValueSignature(index + 4, end) }], next: end };
}

/**
 * `module.exports = { a, b: …, c(…) {…} }` — each key, with a function value's signature; `null`
 * for an entry outside that list (a spread, a computed key, a class value).
 */
function objectLiteralExports(reader: SurfaceReader, open: number, end: number): Parsed | null {
  const close = reader.step(open) - 1;
  const declared: Declared[] = [];
  let cursor = open + 1;
  while (cursor < close) {
    const key = reader.value(cursor) ?? "";
    if (!reader.isIdentifier(cursor) && !reader.isString(cursor)) return null;
    if (reader.value(cursor + 1) === ":" && reader.isClassExpression(cursor + 2)) return null;
    const entryEnd = reader.declaratorEnd(cursor);
    const after = reader.value(cursor + 1);
    const signature =
      after === ":" ? reader.functionValueSignature(cursor + 2, entryEnd) : after === "(" ? reader.text(cursor + 1, reader.bodyStart(cursor + 1, entryEnd)) : "";
    declared.push({ name: key.replace(/^["']|["']$/g, ""), signature });
    cursor = reader.value(entryEnd) === "," ? entryEnd + 1 : close;
  }
  return { declared, next: end };
}
