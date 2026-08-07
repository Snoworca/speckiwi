import { execFile } from "node:child_process";
import { cp, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { diagnoseHealth, type DoctorCheck } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-179 — doctor reports a project root that is not the git top level.
//
// `SRS root == git top level` is an unwritten invariant enforced today in exactly one place the
// average project never reaches. This check is where a project finds out before the pre-commit hook,
// the pipeline journal and the skill destinations quietly follow a different directory.

const execFileAsync = promisify(execFile);

async function gitInit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
}

/** The root-vs-top-level check, told apart from every other doctor topic. */
async function rootCheck(root: string): Promise<DoctorCheck | undefined> {
  const workspace = await parseWorkspace({ root });
  const report = await diagnoseHealth(workspace);
  return report.checks.find((entry) => /git/i.test(entry.topic) && /root|top level/i.test(entry.topic));
}

/** A fixture workspace that is itself a git top level. */
async function toplevelWorkspace(): Promise<string> {
  const root = await realpath(await copyFixtureWorkspace("valid-basic"));
  await gitInit(root);
  return root;
}

/** A fixture workspace sitting in a sub-directory of a repository — the layout under test. */
async function nestedWorkspace(): Promise<{ repository: string; root: string }> {
  const repository = await realpath(await mkdtemp(path.join(tmpdir(), "speckiwi-nested-root-")));
  await gitInit(repository);
  const source = await copyFixtureWorkspace("valid-basic");
  const root = path.join(repository, "module");
  await cp(source, root, { recursive: true });
  return { repository, root };
}

describe("FR-NODE-179 — doctor sees a root that is not the git top level", () => {
  it("AC-1 reports ok when the root is the top level", async () => {
    const check = await rootCheck(await toplevelWorkspace());

    expect(check, "diagnoseHealth must include a project-root check").toBeDefined();
    expect(check!.state).toBe("ok");
  });

  it("AC-2 warns for a root inside a repository, naming both directories", async () => {
    const { repository, root } = await nestedWorkspace();

    const check = await rootCheck(root);

    expect(check, "diagnoseHealth must include a project-root check").toBeDefined();
    expect(check!.state).toBe("warn");
    // Both paths, because a message naming only one leaves the reader unable to see the difference
    // that is the entire finding. Asserted with the root's own occurrence removed first: the root is
    // nested inside the repository, so `toContain(repository)` alone is satisfied by the root string
    // and would pass on a message that never names the top level.
    expect(check!.message).toContain(path.resolve(root));
    const withoutRoot = check!.message.split(path.resolve(root)).join("");
    expect(withoutRoot, "the top level must be named in its own right, not merely as a prefix of the root").toContain(
      path.resolve(repository)
    );
  });

  it("AC-3 reports ok, not warn, when there is no repository at all", async () => {
    const root = await realpath(await copyFixtureWorkspace("valid-basic"));

    const check = await rootCheck(root);

    expect(check, "diagnoseHealth must include a project-root check").toBeDefined();
    expect(check!.state, "a workspace under no version control is a supported configuration").toBe("ok");
    expect(
      /no git repository|not (?:in|under) (?:a )?git/i.test(check!.message),
      `the message must say no repository was found rather than assert the layout is right: ${check!.message}`
    ).toBe(true);
  });

  it("AC-4 names the surfaces that follow the git top level in its remediation", async () => {
    const { root } = await nestedWorkspace();

    const check = await rootCheck(root);

    const remediation = check!.remediation;
    expect(remediation, "the pre-commit hook is installed at the git top level").toMatch(/pre-commit/i);
    expect(remediation, "the pipeline journal the skills pin is resolved from the git top level").toMatch(
      /pipeline|kiwi\//i
    );
    expect(remediation, "skill destinations follow the git top level too").toMatch(/skill/i);
  });

  it("AC-6 resolves symlinks, so a root reached through one is not called a different directory", async (context) => {
    const real = await toplevelWorkspace();
    const link = path.join(path.dirname(real), `${path.basename(real)}-link`);
    try {
      await symlink(real, link, "junction");
    } catch {
      // Creating a link needs a privilege this host may withhold. Skipped rather than returned: a
      // bare return records a pass, which reports coverage this run did not actually obtain.
      context.skip();
      return;
    }

    const check = await rootCheck(link);

    expect(check!.state, `a symlinked root is the same directory: ${check!.message}`).toBe("ok");
  });

  it("AC-7 reports ok and the reason when git cannot be consulted", async () => {
    const root = await toplevelWorkspace();

    // A resolver that fails the way an absent git fails, injected through the same options bag the
    // other externally-supplied roots travel in rather than by exporting the check itself.
    const report = await diagnoseHealth(await parseWorkspace({ root }), {
      gitToplevelResolver: () => Promise.reject(new Error("spawn git ENOENT"))
    });
    const check = report.checks.find((entry) => /git/i.test(entry.topic) && /root|top level/i.test(entry.topic));

    expect(check!.state, "a host without git must not be told its layout is wrong").toBe("ok");
    expect(check!.message, "and must be told why no claim was made").toContain("ENOENT");
  });

  it("AC-5 is carried by diagnoseHealth beside the existing checks", async () => {
    const workspace = await parseWorkspace({ root: await toplevelWorkspace() });

    const report = await diagnoseHealth(workspace);

    const topics = report.checks.map((entry) => entry.topic);
    expect(topics.filter((topic) => /git/i.test(topic) && /root|top level/i.test(topic))).toHaveLength(1);
    expect(topics, "the existing checks are still reported").toContain("docs spec presence and parseability");
  });
});
