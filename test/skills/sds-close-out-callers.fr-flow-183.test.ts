import { describe, expect, it } from "vitest";

import { normaliseEol, readVariant, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { markdownFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-183, FR-FLOW-184, FR-FLOW-185
//
// Every caller that promotes an SDS's requirements moves the SDS decisions first and deletes the file
// afterwards. The 4.0.0 final verification found the standalone kiwi-coder path promoting with no
// close-out and a next_hint the pipeline tables did not share. The assertions read the call fences,
// the routing-table rows and the caller table, not free prose.

const BUNDLES = ["claude", "codex", "etc"] as const;

const skill = (bundle: string, name: string): string => normaliseEol(stripFrontmatter(readVariant(`skills/${bundle}/${name}/SKILL.md`)));
const shared = (bundle: string, file: string): string => normaliseEol(readVariant(`skills/${bundle}/_shared/kiwi/${file}`));

/** Every markdown file of a skill joined, SKILL.md first. */
function docs(bundle: string, name: string): string {
  const files = markdownFiles(`skills/${bundle}`, name);
  files.sort((a, b) => Number(!a.endsWith("/SKILL.md")) - Number(!b.endsWith("/SKILL.md")));
  return files.map((file) => normaliseEol(readVariant(file))).join("\n\n");
}

/** `last skill → the kiwi-* names its success row hints at`, in cell order. */
function hints(table: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of tableRows(table)) {
    const last = (row.cells[0] ?? "").replace(/`/g, "").trim();
    if (!/TASK_DONE/.test(row.cells[1] ?? "")) continue;
    out.set(last, (row.cells[2] ?? "").match(/kiwi-[a-z-]+/g) ?? []);
  }
  return out;
}

function routingTables(bundle: string): Array<[string, string]> {
  return [
    ["kiwi-pipeline §5.1 T1", section(skill(bundle, "kiwi-pipeline"), /^###\s*5\.1\s/)],
    ["pipeline-event.md §4", section(shared(bundle, "pipeline-event.md"), /^##\s*4\.\s/)],
    ["pipeline-v1.md routing", section(shared(bundle, "pipeline-v1.md"), /^##\s*Routing/)]
  ];
}

describe("FR-FLOW-183 AC-1 — standalone kiwi-coder moves the SDS before it promotes", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-183 AC-1 ${bundle}: §8.4 calls kiwi-sds --close, then the review with --close-reqs only when moved, then kiwi-sds --close again`, () => {
      const handoff = section(docs(bundle, "kiwi-coder"), /^###\s*8\.4\s/);
      expect(handoff, `${bundle}: kiwi-coder has no §8.4 in any of its documents`).not.toBe("");
      // claude writes `Skill(skill="…", args="…")`; codex and etc write `Use $kiwi-… with …`.
      const calls = [...handoff.matchAll(/Skill\(skill="(kiwi-[a-z-]+)", args="([^"]*)"|Use \$(kiwi-[a-z-]+) with ([^\n]*)/g)].map((m) => ({
        skill: (m[1] ?? m[3]) as string,
        args: (m[2] ?? m[4]) as string
      }));
      const order = calls.map((c) => c.skill);
      expect(order, `${bundle}: ${JSON.stringify(order)}`).toEqual(["kiwi-sds", "kiwi-review-fix-loop", "kiwi-sds"]);
      expect(calls[0]?.args, `${bundle}: the first kiwi-sds call is not a close`).toMatch(/^--close /);
      expect(calls[2]?.args, `${bundle}: the last kiwi-sds call is not a close`).toMatch(/^--close /);
      // --close-reqs is conditional on the move having finished.
      expect(handoff, `${bundle}: --close-reqs is not gated on MOVED`).toMatch(/MOVED[^\n]*--close-reqs|--close-reqs[^\n]*MOVED/);
    });

    it(`FR-FLOW-183 AC-1 ${bundle}: kiwi-sds §3.4 lists standalone kiwi-coder as a caller`, () => {
      const callers = section(skill(bundle, "kiwi-sds"), /^###\s*3\.4\s/);
      const row = tableRows(callers).find((r) => (r.cells[0] ?? "").includes("`kiwi-coder`"));
      expect(row, `${bundle}: §3.4 has no kiwi-coder row`).toBeDefined();
    });

    it(`FR-FLOW-184 AC-1 ${bundle}: every routing table sends standalone kiwi-coder to the move before the promoting hop`, () => {
      for (const [name, table] of routingTables(bundle)) {
        const row = [...hints(table).entries()].find(([last]) => /^kiwi-coder\b/.test(last));
        expect(row, `${bundle} ${name}: no kiwi-coder row`).toBeDefined();
        expect(row?.[1][0], `${bundle} ${name}: kiwi-coder's first hint`).toBe("kiwi-sds");
      }
    });
  }
});

describe("FR-FLOW-184 AC-1 — kiwi-pm's next_hint and the routing tables name the same next step", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-184 AC-1 ${bundle}: the kiwi-pm row's first hint is the kiwi-sds move`, () => {
      for (const [name, table] of routingTables(bundle)) {
        expect(hints(table).get("kiwi-pm")?.[0], `${bundle} ${name}`).toBe("kiwi-sds");
      }
    });

    it(`FR-FLOW-184 AC-1 ${bundle}: kiwi-pipeline spawns a kiwi-sds hint after kiwi-pm or kiwi-coder as a close`, () => {
      const body = skill(bundle, "kiwi-pipeline");
      const rule = body.split("\n").find((l) => /^- /.test(l) && l.includes("`kiwi-sds`") && l.includes("`--close <") && l.includes("`kiwi-pm`")) ?? "";
      expect(rule, `${bundle}: no spawn rule attaches --close to a kiwi-sds hint`).not.toBe("");
      expect(/작성 모드|authoring mode/.test(rule), `${bundle}: the rule does not say what a bare kiwi-sds would do`).toBe(true);
    });

    for (const name of ["kiwi-pm", "kiwi-coder"]) {
      it(`FR-FLOW-184 AC-1 ${bundle}/${name}: the emitted event names the kiwi-sds move and the schema's sds_files`, () => {
        const text = docs(bundle, name);
        const hint = text.split("\n").find((l) => /^- `next_hint`/.test(l) || /`next_hint`: /.test(l) && /단독|standalone|CLOSE_SAFE/.test(l)) ?? "";
        expect(hint, `${bundle}/${name}: no next_hint line`).toContain('"kiwi-sds"');
        expect(/`artifacts\.sds_file`/.test(text), `${bundle}/${name}: the singular field survives`).toBe(false);
        expect(text, `${bundle}/${name}`).toContain("`artifacts.sds_files`");
      });
    }
  }
});

describe("FR-FLOW-183 AC-3 — the deleting close hands the run to the commit step", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-183 AC-3 ${bundle}: §3.3 hints kiwi-commit-auto-push when every file was deleted`, () => {
      const event = section(skill(bundle, "kiwi-sds"), /^###\s*3\.3\s/);
      expect(event, `${bundle}`).toContain("kiwi-commit-auto-push");
    });
  }
});

describe("FR-FLOW-182 — kiwi-sds options the callers pass", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-182 AC-2 ${bundle}: the description lists --existing-modules, which PW-2 passes`, () => {
      const description = /^description:\s*"([^"]*)"/m.exec(readVariant(`skills/${bundle}/kiwi-sds/SKILL.md`))?.[1] ?? "";
      expect(description, `${bundle}: no description`).not.toBe("");
      expect(description, `${bundle}`).toContain("--existing-modules");
    });

    it(`FR-FLOW-182 AC-2 ${bundle}: --existing-modules reads the wave's own baseline entry`, () => {
      const row = skill(bundle, "kiwi-sds").split("\n").find((l) => /^\|\s*`--existing-modules <path>`/.test(l)) ?? "";
      expect(row, `${bundle}: no option row`).not.toBe("");
      expect(row, `${bundle}: the row does not key the baseline by the wave`).toContain("`wave-{n}`");
    });
  }
});

describe("FR-FLOW-184 AC-1 — cross references inside the cycle and the chain", () => {
  for (const bundle of BUNDLES) {
    it(`FR-FLOW-184 AC-1 ${bundle}: §2.5.4 points the review hop at item 3`, () => {
      const intro = section(skill(bundle, "kiwi-pipeline"), /^###\s*2\.5\.4\s/).split("\n").find((l) => l.includes("--review-hop-owned-by-parent")) ?? "";
      expect(intro, `${bundle}`).not.toBe("");
      expect(/아래 3번/.test(intro), `${bundle}: ${intro.slice(0, 120)}`).toBe(true);
    });

    for (const name of ["kiwi-pm", "kiwi-coder"]) {
      it(`FR-FLOW-188 AC-7 ${bundle}/${name}: the pass-through chain no longer runs through kiwi-pipeline`, () => {
        expect(docs(bundle, name).includes("kiwi-wave-master → kiwi-pipeline → kiwi-pm"), `${bundle}/${name}`).toBe(false);
      });
    }
  }
});
