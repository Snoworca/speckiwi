import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// @req FR-NODE-108 AC-5 — `computeResumeState` performs no git, filesystem or network access.
//
// VE-1 says this half of the criterion is carried by nothing: determinism and injection both hold
// even if a kernel read a file that exists, and the only scan that looks for impurity —
// resume.fr-node-150.test.ts:26 — reads `resume.ts`'s own text and stops there. A module it imports
// could open a socket and every assertion would stay green.
//
// A committed handoff read the criterion as FALSE on the strength of `resume-card.ts` →
// `waves-journal.ts` → `jsonl.ts` → `node:fs/promises`. Four independent measurements refuted it:
// both edges into `waves-journal` are `import type` and are erased before anything runs. The
// criterion is true and was unevidenced, which is a different repair from unticking it.
//
// So: walk the closure the compiler actually emits, and assert over the whole of it. The oracle is
// SUBSET, not a denylist — `node:child_process` is not on a list of banned specifiers, it is simply
// not `node:crypto`. A denylist would need extending every time Node grows a module; a subset test
// fails for a dependency nobody has thought of yet.
//
// Limitation, stated rather than left to be found: this reads TypeScript source, not the emitted
// JavaScript. It is a static over-approximation of what loads — a value import behind a branch that
// never runs still counts as reachable — which errs toward reporting impurity that does not execute
// rather than missing impurity that does.

const REPO_ROOT = process.cwd();
const ENTRY = path.join(REPO_ROOT, "src", "core", "orchestrator", "resume.ts");

/** The one external specifier the closure is permitted to reach. Anything else fails the subset. */
const PERMITTED_EXTERNALS = ["node:crypto"];

interface Edge {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Type-only edges are erased, so they are not part of what loads. `import { type X }` with no value
 * binding is treated as ERASED only when every named binding carries its own `type`; a mixed clause
 * keeps the statement, and so keeps the edge. When in doubt this counts the edge — over-reporting
 * the closure is the safe direction for a purity claim.
 */
function importEdges(file: string): Edge[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const edges: Edge[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const allNamedAreTypes =
        clause !== undefined &&
        clause.name === undefined &&
        clause.namedBindings !== undefined &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly);
      edges.push({ specifier: node.moduleSpecifier.text, typeOnly: clause?.isTypeOnly === true || allNamedAreTypes });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      // A dynamic import is the obvious way to reach `node:fs` without an import statement.
      edges.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

/** Relative specifier to a file on disk; `null` means the specifier leaves the repository. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface Closure {
  modules: string[];
  externals: Map<string, string[]>;
  unresolved: string[];
}

function walk(entry: string, options: { includeTypeOnly: boolean }): Closure {
  const seen = new Set([entry]);
  const externals = new Map<string, string[]>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const from = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    for (const edge of importEdges(file)) {
      if (edge.typeOnly && !options.includeTypeOnly) continue;
      if (!edge.specifier.startsWith(".")) {
        externals.set(edge.specifier, [...(externals.get(edge.specifier) ?? []), from]);
        continue;
      }
      const resolved = resolveLocal(file, edge.specifier);
      if (resolved === null) {
        unresolved.push(`${from} -> ${edge.specifier}`);
        continue;
      }
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return {
    modules: [...seen].map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/")).sort(),
    externals,
    unresolved,
  };
}

describe("FR-NODE-108 AC-5 — computeResumeState's whole runtime closure is pure", () => {
  it("declares computeResumeState in the module the closure starts from", () => {
    // If the kernel moved, every assertion below would be walking the wrong file and would pass for
    // the wrong reason.
    expect(existsSync(ENTRY), `${ENTRY} does not exist`).toBe(true);
    expect(readFileSync(ENTRY, "utf8")).toContain("export function computeResumeState(");
  });

  it("reaches more than the entry module, so the assertions below are not over an empty set", () => {
    // A resolver that silently returned nothing would make the subset test pass with one module in
    // it. Measured at 13; asserted as a floor so adding a pure module is not a failure.
    const closure = walk(ENTRY, { includeTypeOnly: false });
    expect(closure.modules.length, `closure: ${closure.modules.join(", ")}`).toBeGreaterThanOrEqual(10);
    for (const required of [
      "src/core/orchestrator/resume.ts",
      "src/core/orchestrator/resume-card.ts",
      "src/core/orchestrator/route-lock.ts",
      "src/core/orchestrator/journal-schema.ts",
    ]) {
      expect(closure.modules, `${required} left the closure`).toContain(required);
    }
  });

  it("resolves every relative specifier it meets", () => {
    // An unresolved edge is a hole in the walk, and a hole is indistinguishable from purity.
    const closure = walk(ENTRY, { includeTypeOnly: false });
    expect(closure.unresolved, "the walk could not follow these edges, so it did not read them").toEqual([]);
  });

  it("reaches no external module other than node:crypto", () => {
    const closure = walk(ENTRY, { includeTypeOnly: false });
    const reached = [...closure.externals.keys()].sort();
    const offending = reached
      .filter((specifier) => !PERMITTED_EXTERNALS.includes(specifier))
      .map((specifier) => `${specifier} (via ${[...new Set(closure.externals.get(specifier) ?? [])].join(", ")})`);
    expect(offending, "an impure module is reachable from computeResumeState").toEqual([]);
    expect(reached).toEqual(PERMITTED_EXTERNALS);
  });

  it("depends on type-erasure to stay pure, and says so", () => {
    // This is the case that makes the walker's own type-only classification load-bearing rather than
    // decorative. Counting type-only edges as real reaches `waves-journal.ts` -> `jsonl.ts` ->
    // `node:fs/promises`, which is exactly the graph a committed handoff read as proof the criterion
    // was false. If the classification broke in the permissive direction the previous case goes red;
    // if it broke in the strict direction the closure collapses and the floor case goes red. So the
    // two closures MUST differ, and they must differ by a filesystem module.
    const strict = walk(ENTRY, { includeTypeOnly: false });
    const permissive = walk(ENTRY, { includeTypeOnly: true });
    expect(permissive.modules.length, "no edge in this graph is type-only, so erasure decides nothing").toBeGreaterThan(
      strict.modules.length
    );
    const permissiveExternals = [...permissive.externals.keys()];
    expect(
      permissiveExternals.filter((specifier) => /^node:fs/.test(specifier)),
      "the type-only edges reach no filesystem module, so this case is asserting nothing"
    ).not.toEqual([]);
  });

  it("AC-1: every kernel argument is annotated with a named type that some source module exports", () => {
    // AC-1's leading sentence demands "a named, exported type for every argument", and its own
    // enumerated list writes `planDuplicationAudit`'s second argument with no type name at all. An
    // independent pass measured the criterion contradicting itself; the Statement makes the same
    // demand, so what was wrong was the code, not the sentence. This is the sentence, checked.
    //
    // A structural annotation — `Record<string, string[]>` written inline — is what this refuses. It
    // is not a weaker type, it is an UNNAMEABLE one: a fixture author cannot import it, which is the
    // property the requirement exists to guarantee.
    const KERNELS: Array<[file: string, name: string]> = [
      ["verification-gate.ts", "evaluateRound"],
      ["lane-plan.ts", "computeLanePlan"],
      ["duplication-audit.ts", "planDuplicationAudit"],
      ["substrate.ts", "planStageCoupling"],
      ["resume.ts", "computeResumeState"],
      ["auto-gate.ts", "decideAutoGate"],
    ];

    /** `LaneDiff[]` and `ReadonlyArray<LaneDiff>` are named; `Record<string, string[]>` is not. */
    const namedTypeOf = (node: ts.TypeNode | undefined): string | undefined => {
      if (node === undefined) return undefined;
      if (ts.isArrayTypeNode(node)) return namedTypeOf(node.elementType);
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        if (node.typeName.text === "Record" || node.typeName.text === "Map" || node.typeName.text === "Set") return undefined;
        return node.typeName.text;
      }
      return undefined;
    };

    const exportedNames = new Set<string>();
    const sourceDir = path.join(REPO_ROOT, "src", "core", "orchestrator");
    for (const entry of readdirSync(sourceDir)) {
      if (!entry.endsWith(".ts")) continue;
      for (const match of readFileSync(path.join(sourceDir, entry), "utf8").matchAll(/export\s+(?:type|interface)\s+(\w+)/g)) {
        exportedNames.add(match[1] as string);
      }
    }
    expect(exportedNames.size, "no exported type names were found, so the check below is over an empty set").toBeGreaterThan(10);

    const offending: string[] = [];
    let parametersSeen = 0;
    for (const [file, kernelName] of KERNELS) {
      const filePath = path.join(sourceDir, file);
      const source = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
      let found = false;
      const visit = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === kernelName) {
          found = true;
          for (const parameter of node.parameters) {
            parametersSeen += 1;
            const named = namedTypeOf(parameter.type);
            const label = `${kernelName}(${ts.isIdentifier(parameter.name) ? parameter.name.text : "?"})`;
            if (named === undefined) offending.push(`${label}: annotation is not a named type`);
            else if (!exportedNames.has(named)) offending.push(`${label}: ${named} is not exported by any orchestrator module`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(found, `${kernelName} was not found in ${file}`).toBe(true);
    }

    expect(parametersSeen, "no kernel parameters were read").toBeGreaterThanOrEqual(9);
    expect(offending, "a kernel argument cannot be named by a fixture author").toEqual([]);
  });

  it("AC-6: the fixture test imports type declarations and the six kernels, and no implementation internals", () => {
    // VE-1 records this conjunct as "carried by no assertion at all and is this row's own judgment of
    // the import list". A judgment of an import list is a thing a machine can check, so it is checked:
    // every VALUE binding the fixture test takes from `src/` must be one of the six kernels or a
    // declared exported vocabulary constant. Everything else must be erased at compile time.
    //
    // The criterion's phrase is "no implementation internals". A value import is the only way an
    // internal can be reached at runtime, so the value-import set is exactly the surface to bound.
    const KERNELS = [
      "evaluateRound",
      "computeLanePlan",
      "planDuplicationAudit",
      "planStageCoupling",
      "computeResumeState",
      "decideAutoGate",
    ];
    // Declared, not discovered: `AUTO_GATE_ACTIONS` is the closed action vocabulary AC-4 names, and
    // it is a value because the criterion asks the test to check membership in it.
    const PERMITTED_CONSTANTS = ["AUTO_GATE_ACTIONS"];

    const fixtureFile = path.join(REPO_ROOT, "test", "core", "orchestrator", "kernel-inputs.fr-node-108.test.ts");
    expect(existsSync(fixtureFile), "the fixture-construction test named by VE-1 does not exist").toBe(true);
    const source = ts.createSourceFile(fixtureFile, readFileSync(fixtureFile, "utf8"), ts.ScriptTarget.Latest, true);

    const valueBindings: string[] = [];
    let sourceImports = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (!/\/src\//.test(node.moduleSpecifier.text)) return;
        sourceImports += 1;
        const clause = node.importClause;
        if (clause === undefined || clause.isTypeOnly) return;
        if (clause.name !== undefined) valueBindings.push(`default:${clause.name.text}`);
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) valueBindings.push(element.name.text);
          }
        } else if (bindings !== undefined) {
          valueBindings.push(`namespace:${bindings.name.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    // Without this the case would pass over a file whose imports the walk failed to read at all.
    expect(sourceImports, "no import from src/ was read, so the bound below is over an empty set").toBeGreaterThanOrEqual(6);
    const unexpected = valueBindings.filter((name) => !KERNELS.includes(name) && !PERMITTED_CONSTANTS.includes(name));
    expect(unexpected, "the fixture test imports a runtime value that is neither a kernel nor the declared vocabulary").toEqual([]);
    for (const kernel of KERNELS) {
      expect(valueBindings, `the fixture test does not import ${kernel}, so it cannot be calling it`).toContain(kernel);
    }
  });

  it("uses no impure global that an import walk cannot see", () => {
    // `process.cwd()`, `execSync` and `fetch` need no import. The import closure is blind to them,
    // so the closure is scanned as text too — every module in it, not only the entry.
    const closure = walk(ENTRY, { includeTypeOnly: false });
    const offending: string[] = [];
    for (const relPath of closure.modules) {
      const body = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      for (const token of ["process.cwd", "execSync", "spawnSync", "simple-git", "fetch(", "XMLHttpRequest"]) {
        if (body.includes(token)) offending.push(`${relPath}: ${token}`);
      }
    }
    expect(offending, "a module in the closure reaches impurity through a global").toEqual([]);
  });
});
