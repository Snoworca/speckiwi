import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { registerTarget, setActiveTarget, setTargetDescription } from "../../../src/core/mutation/set-active-target.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-276 — a registered target's Target Map description is replaced through one mutation, under
// the SRS mutation lock, and `set-active-target --description` no longer drops a description silently.

const INDEX = path.join("docs", "spec", "00.index.md");

async function workspace(): Promise<{ rootPath: string; read: () => Promise<string> }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  return { rootPath, read: () => readFile(path.join(rootPath, INDEX), "utf8") };
}

async function holdLock(rootPath: string): Promise<void> {
  await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
  const now = Date.now();
  await writeFile(
    path.join(rootPath, "kiwi", ".srs.lock"),
    JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
    "utf8"
  );
}

describe("FR-NODE-276 AC-1 — only the Target Map cell changes", () => {
  // @req FR-NODE-276 AC-1
  it("rewrites the description cell of the named row and leaves every other line byte-identical", async () => {
    const { rootPath, read } = await workspace();
    const before = await read();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Replaced description" });
    expect(result.ok).toBe(true);
    const after = await read();
    expect(after).toBe(before.replace("| v1.1.0 | version | planned | Next fixture target |", "| v1.1.0 | version | planned | Replaced description |"));
  });

  // @req FR-NODE-276 AC-1
  it("keeps the other cells of a padded row byte-identical", async () => {
    const { rootPath, read } = await workspace();
    const padded = "|  v1.1.0  |  version |planned|   Next fixture target   |";
    await writeFile(path.join(rootPath, INDEX), (await read()).replace("| v1.1.0 | version | planned | Next fixture target |", padded), "utf8");
    const before = await read();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Replaced description" });
    expect(result.ok).toBe(true);
    expect(await read()).toBe(before.replace(padded, "|  v1.1.0  |  version |planned|   Replaced description   |"));
  });
});

describe("FR-NODE-276 AC-2 — the result and the lock", () => {
  // @req FR-NODE-276 AC-2
  it("returns the target, the previous and the new description, and written true", async () => {
    const { rootPath } = await workspace();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Replaced description" });
    expect(result.value).toEqual({ target: "v1.1.0", previousDescription: "Next fixture target", description: "Replaced description", written: true });
  });

  // @req FR-NODE-276 AC-2
  it("writes nothing on a dry run and reports written false", async () => {
    const { rootPath, read } = await workspace();
    const before = await read();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Replaced description", dryRun: true });
    expect(result.value).toEqual({ target: "v1.1.0", previousDescription: "Next fixture target", description: "Replaced description", written: false });
    expect(await read()).toBe(before);
  });

  // @req FR-NODE-276 AC-2
  it("reports written false when the description is unchanged", async () => {
    const { rootPath, read } = await workspace();
    const before = await read();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Next fixture target" });
    expect(result.value).toEqual({ target: "v1.1.0", previousDescription: "Next fixture target", description: "Next fixture target", written: false });
    expect(await read()).toBe(before);
  });

  // @req FR-NODE-276 AC-2
  it("takes the SRS mutation lock: refused while another mutation holds it, written with ignoreLock", async () => {
    const { rootPath, read } = await workspace();
    await holdLock(rootPath);
    const before = await read();
    const root = await resolveProjectRoot(rootPath);
    expect(await setTargetDescription(root, { target: "v1.1.0", description: "Replaced description" })).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    expect(await read()).toBe(before);
    expect(await setTargetDescription(root, { target: "v1.1.0", description: "Replaced description", ignoreLock: true })).toMatchObject({ ok: true, value: { written: true } });
  });
});

describe("FR-NODE-276 AC-3 — refusals", () => {
  const cases: Array<[string, string, string]> = [
    ["an unregistered target", "v9.9.9", "Some description"],
    ["an empty description", "v1.1.0", ""],
    ["a blank description", "v1.1.0", "   "],
    ["a description holding a pipe", "v1.1.0", "left | right"],
    ["a description holding a newline", "v1.1.0", "first\nsecond"],
    ["a description holding a carriage return", "v1.1.0", "first\rsecond"],
    ["a description holding a tab", "v1.1.0", "first\tsecond"],
    ["a description holding a control character", "v1.1.0", "bell\u0007"],
    ["a description holding DEL", "v1.1.0", "del\u007f"],
    ["a description holding a C1 control character (U+0085 NEXT LINE)", "v1.1.0", "first\u0085second"],
    ["a description holding the first C1 control character (U+0080)", "v1.1.0", "pad\u0080"],
    ["a description holding the last C1 control character (U+009F)", "v1.1.0", "apc\u009f"]
  ];
  for (const [label, target, description] of cases) {
    // @req FR-NODE-276 AC-3
    it(`refuses ${label} with a USAGE error and no write`, async () => {
      const { rootPath, read } = await workspace();
      const before = await read();
      const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target, description });
      expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
      expect(await read()).toBe(before);
    });
  }
});

describe("FR-NODE-276 AC-3 — registration applies the same description check", () => {
  const refused: Array<[string, string]> = [
    ["an empty description", ""],
    ["a blank description", "   "],
    ["a description holding a pipe", "left | right"],
    ["a description holding a newline", "first\nsecond"],
    ["a description holding a trailing newline", "trailing\n"],
    ["a description holding a carriage return", "first\rsecond"],
    ["a description holding a tab", "first\tsecond"],
    ["a description holding a control character", "bell\u0007"],
    ["a description holding DEL", "del\u007f"],
    ["a description holding a C1 control character (U+0085 NEXT LINE)", "first\u0085second"],
    ["a description holding the first C1 control character (U+0080)", "pad\u0080"],
    ["a description holding the last C1 control character (U+009F)", "apc\u009f"]
  ];
  for (const [label, description] of refused) {
    // @req FR-NODE-276 AC-3
    it(`register-target refuses ${label} with a USAGE error and no write`, async () => {
      const { rootPath, read } = await workspace();
      const before = await read();
      const result = await registerTarget(await resolveProjectRoot(rootPath), { target: "v9.9.9", description });
      expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
      expect(await read()).toBe(before);
    });

    // @req FR-NODE-276 AC-3
    it(`set-active-target --create refuses ${label} with a USAGE error and no write`, async () => {
      const { rootPath, read } = await workspace();
      const before = await read();
      const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v9.9.9", create: true, description });
      expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
      expect(await read()).toBe(before);
    });
  }

  // @req FR-NODE-276 AC-3 — control: the check passes a plain description and U+00A0, and registration
  // without a description still writes the default one.
  it("registers a plain description, one holding U+00A0, and the default when none is given", async () => {
    const { rootPath, read } = await workspace();
    const root = await resolveProjectRoot(rootPath);
    expect(await registerTarget(root, { target: "v9.9.7", description: "  plain  " })).toMatchObject({ ok: true, value: { description: "plain" } });
    expect(await registerTarget(root, { target: "v9.9.8", description: "nbsp here" })).toMatchObject({ ok: true, value: { description: "nbsp here" } });
    expect(await registerTarget(root, { target: "v9.9.9" })).toMatchObject({ ok: true, value: { description: "Registered target v9.9.9" } });
    expect(await read()).toContain("| v9.9.8 | version | planned | nbsp here |");
  });
});

describe("FR-NODE-276 AC-3 — the control-character refusal ends at the C1 range", () => {
  // @req FR-NODE-276 AC-3 — control: U+00A0 (no-break space) is not a control character and is written.
  it("accepts a description holding U+00A0, the first code point past the C1 range", async () => {
    const { rootPath, read } = await workspace();
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "nbsp here" });
    expect(result.ok).toBe(true);
    expect(await read()).toContain("nbsp here");
  });
});

describe("FR-NODE-276 AC-4 — set-active-target refuses a description for a registered target", () => {
  // @req FR-NODE-276 AC-4
  it("refuses with a message naming set-target-description and writes nothing", async () => {
    const { rootPath, read } = await workspace();
    const before = await read();
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "Replaced description" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("set-target-description");
    expect(await read()).toBe(before);
  });

  // @req FR-NODE-276 AC-4
  it("refuses with --create too when the target is already registered", async () => {
    const { rootPath, read } = await workspace();
    const before = await read();
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0", create: true, description: "Replaced description" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("set-target-description");
    expect(await read()).toBe(before);
  });

  // @req FR-NODE-276 AC-4 — control: without a description, and when creating, the command works as before.
  it("still activates a registered target without a description and creates a new one with its description", async () => {
    const { rootPath, read } = await workspace();
    const root = await resolveProjectRoot(rootPath);
    expect((await setActiveTarget(root, { target: "v1.1.0" })).ok).toBe(true);
    expect((await setActiveTarget(root, { target: "v2.0.0", create: true, description: "Brand new" })).ok).toBe(true);
    expect(await read()).toContain("| v2.0.0 | version | active | Brand new |");
  });
});
