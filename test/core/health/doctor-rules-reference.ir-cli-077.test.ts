import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import type { DoctorCheck } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { BUNDLED_RULES_VERSION, BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-077 — doctor reports a reference to a rules document that is not installed.
//
// This is the check that would have caught the defect this repository shipped and hand-fixed twice:
// CLAUDE.md, AGENTS.md and three skills pointing at a rules document the release had pruned. The
// existing drift check cannot see it — it reads only the index Rules row.

/** The reference-presence check, distinguished from the index-pointer drift check beside it. */
async function referenceCheck(root: string): Promise<DoctorCheck | undefined> {
  const workspace = await parseWorkspace({ root });
  const report = await diagnoseHealth(workspace);
  return report.checks.find((entry) => /reference/i.test(entry.topic) && /rules/i.test(entry.topic));
}

/** Puts the bundled rules document in place, so only the seeded reference decides the verdict. */
async function installBundledRules(root: string): Promise<void> {
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME),
    `# SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}\n`,
    "utf8"
  );
}

describe("IR-CLI-077 AC-1 — a dangling reference in an agent file warns", () => {
  it("names the referencing file and the document that is missing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installBundledRules(root);
    await writeFile(
      path.join(root, "CLAUDE.md"),
      "# Notes\n\nRead [rules](docs/rule/SRS-MD-Rules-v1.0.0.md).\n",
      "utf8"
    );

    const check = await referenceCheck(root);

    expect(check, "diagnoseHealth must include a rules reference check").toBeDefined();
    expect(check!.state).toBe("warn");
    // The line number is part of the contract, and `toContain("CLAUDE.md")` does not pin it — that
    // passes on the bare file name too, so dropping the line from the message went unnoticed.
    expect(check!.message).toContain("CLAUDE.md:3");
    expect(check!.message).toContain("SRS-MD-Rules-v1.0.0.md");
  });
});

describe("IR-CLI-077 AC-2 — the remediation names the command that repairs it", () => {
  it("points at speckiwi upgrade rather than leaving the reader to guess", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installBundledRules(root);
    await writeFile(path.join(root, "AGENTS.md"), "# Notes\n\nSee SRS-MD Authoring Rules v1.0.0.\n", "utf8");

    const check = await referenceCheck(root);

    expect(check!.state).toBe("warn");
    expect(check!.remediation).toMatch(/speckiwi upgrade/);
  });
});

describe("IR-CLI-077 AC-3 — a project whose references all resolve is ok", () => {
  it("reports ok when every cited rules document is installed", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installBundledRules(root);
    await writeFile(
      path.join(root, "CLAUDE.md"),
      `# Notes\n\nRead [rules](docs/rule/${BUNDLED_SRS_RULES_FILENAME}).\n`,
      "utf8"
    );

    const check = await referenceCheck(root);

    expect(check, "the check must be present even when it has nothing to report").toBeDefined();
    expect(check!.state).toBe("ok");
  });
});

describe("IR-CLI-077 AC-4 — presence, not version, decides the verdict", () => {
  it("stays ok for a non-bundled version whose document is installed", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installBundledRules(root);
    // A consumer pinned to an older rules document that they still keep on disk is not broken. Only a
    // reference with nothing behind it is. Comparing versions here would duplicate the drift check and
    // warn forever at a project that is internally consistent.
    await writeFile(path.join(root, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "# Old rules\n", "utf8");
    await writeFile(
      path.join(root, "CLAUDE.md"),
      "# Notes\n\nRead [rules](docs/rule/SRS-MD-Rules-v1.0.0.md).\n",
      "utf8"
    );

    const check = await referenceCheck(root);

    expect(check!.state).toBe("ok");
  });
});

describe("IR-CLI-077 AC-6 — a missing bundled document is init's job, not the migration's", () => {
  it("names speckiwi init when the reference is already correct and the document is absent", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // docs/rule is empty: the citation names the bundled document, so there is nothing to rewrite.
    await writeFile(
      path.join(root, "CLAUDE.md"),
      `# Notes\n\nRead [rules](docs/rule/${BUNDLED_SRS_RULES_FILENAME}).\n`,
      "utf8"
    );

    const check = await referenceCheck(root);

    expect(check!.state).toBe("warn");
    expect(check!.remediation).toMatch(/speckiwi init/);
    // Naming the migration here would describe an action the tool does not take: the reference is
    // already right, so `upgrade` rewrites nothing and the warning would never clear.
    expect(check!.remediation).not.toMatch(/speckiwi upgrade/);
  });
});

describe("IR-CLI-077 AC-5 — docs/spec is not inspected", () => {
  it("stays silent about a requirement body citing a retired rules version", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await installBundledRules(root);
    await writeFile(path.join(root, "CLAUDE.md"), "# Notes\n\nNothing to see.\n", "utf8");

    // A requirement body is governance content. `upgrade` refuses to rewrite it, so warning about it
    // would be a warning no command can clear.
    const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const body = await readFile(specPath, "utf8");
    await writeFile(specPath, `${body}\n<!-- follows SRS-MD Authoring Rules v1.0.0 -->\n`, "utf8");

    const check = await referenceCheck(root);

    expect(check!.state).toBe("ok");
    expect(check!.message).not.toContain("10.product-architecture.srs.md");
  });
});
