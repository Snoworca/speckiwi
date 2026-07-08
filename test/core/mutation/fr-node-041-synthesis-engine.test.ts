import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { synthesizeStepSrs } from "../../../src/core/mutation/synthesis.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-041 — vibe-to-SRS synthesis engine. RED suite (one test case per AC).
//
// The synthesis engine merges a task intent.md, the per-session trace shards, the step
// task-name code comments, and the final git diff into step SRS under
// docs/spec/steps/<TaskName>/, is idempotent (no-op when the step directory already exists),
// caps diff size, excludes gitignored paths, redacts recognized secret patterns, and merges
// the trace shards in timestamp order while recovering from a torn trailing JSONL line.
//
// Every test exercises the real filesystem (no mocks); a throwaway workspace is created under
// os.tmpdir() and removed afterwards.

const TASK_NAME = "AddLoginRateLimit";

const exists = (p: string): Promise<boolean> => access(p).then(() => true).catch(() => false);

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-041-"));
  // A .git marker so resolveProjectRoot stops here, plus the spec tree.
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "spec", "00.index.md"),
    "# Index\n\n| Field | Value |\n|---|---|\n| Document Type | index |\n",
    "utf8"
  );
  return root;
}

/** Lay down the per-task vibe inputs the synthesis engine reads. */
async function seedStepInputs(
  root: string,
  task: string,
  opts: {
    intent?: string;
    shards?: { name: string; body: string }[];
    sourceFiles?: { rel: string; body: string }[];
    diff?: string;
    gitignore?: string;
  } = {}
): Promise<string> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  const traceDir = path.join(stepDir, "trace");
  await mkdir(traceDir, { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), opts.intent ?? `# ${task}\n\nIntent body.\n`, "utf8");
  for (const shard of opts.shards ?? []) {
    await writeFile(path.join(traceDir, shard.name), shard.body, "utf8");
  }
  for (const file of opts.sourceFiles ?? []) {
    const abs = path.join(root, file.rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.body, "utf8");
  }
  if (opts.diff !== undefined) {
    await writeFile(path.join(stepDir, "diff.patch"), opts.diff, "utf8");
  }
  if (opts.gitignore !== undefined) {
    await writeFile(path.join(root, ".gitignore"), opts.gitignore, "utf8");
  }
  return stepDir;
}

const stepSrsPath = (root: string, task: string): string =>
  path.join(root, "docs", "spec", "steps", task, `${task}.srs.md`);

describe("FR-NODE-041 vibe-to-SRS synthesis engine", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeWorkspace();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // AC-1: Synthesis writes step SRS under docs/spec/steps/TaskName/ from intent.md,
  // trace shards, step comments, and the final diff.
  it("FR-NODE-041 AC-1: writes step SRS from intent.md, trace shards, step comments, and the diff", async () => {
    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nLimit login attempts to 5 per minute.\n`,
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: "added bucket" })}\n` }
      ],
      sourceFiles: [
        { rel: "src/auth/login.ts", body: `// @step ${TASK_NAME}: enforce per-ip rate limit\nexport const limit = 5;\n` }
      ],
      diff: "diff --git a/src/auth/login.ts b/src/auth/login.ts\n+export const limit = 5;\n"
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ task: TASK_NAME, written: true, skipped: false });

    const outPath = stepSrsPath(root, TASK_NAME);
    expect(await exists(outPath)).toBe(true);
    const srs = await readFile(outPath, "utf8");
    // Content drawn from each of the four input channels must reach the SRS.
    expect(srs).toContain("Limit login attempts to 5 per minute."); // intent.md
    expect(srs).toContain("added bucket"); // trace shard
    expect(srs).toContain("enforce per-ip rate limit"); // step comment
    expect(srs).toContain("export const limit = 5;"); // final diff
  });

  // AC-2: Synthesis is a no-op when the step directory for the task already exists.
  it("FR-NODE-041 AC-2: is an idempotent no-op when the step SRS already exists (byte-identical)", async () => {
    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nFirst body.\n`,
      shards: [{ name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: "one" })}\n` }],
      diff: "diff --git a/x b/x\n+one\n"
    });
    const resolvedRoot = await resolveProjectRoot(root);

    const first = await synthesizeStepSrs(resolvedRoot, { task: TASK_NAME });
    expect(first.ok).toBe(true);
    expect(first.value).toMatchObject({ written: true, skipped: false });
    const afterFirst = await readFile(stepSrsPath(root, TASK_NAME), "utf8");

    // Mutate an input after the first synthesis; a true no-op must ignore it.
    await writeFile(path.join(root, "docs", "spec", "steps", TASK_NAME, "intent.md"), "# changed later\n", "utf8");

    const second = await synthesizeStepSrs(resolvedRoot, { task: TASK_NAME });
    expect(second.ok).toBe(true);
    expect(second.value).toMatchObject({ written: false, skipped: true });

    const afterSecond = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(afterSecond).toBe(afterFirst); // byte-identical: second run wrote nothing
  });

  // AC-3: Synthesis caps the diff size and excludes gitignored paths.
  it("FR-NODE-041 AC-3: caps an oversized diff and excludes gitignored paths", async () => {
    const hugeDiff = [
      "diff --git a/src/keep.ts b/src/keep.ts",
      "+const KEEP_TOKEN = 1;",
      ...Array.from({ length: 5000 }, (_, i) => `+line ${i} padding padding padding padding padding padding`)
    ].join("\n");

    await seedStepInputs(root, TASK_NAME, {
      gitignore: "secret-build/\n",
      shards: [
        // A shard that records a touched gitignored path; it must not surface in the SRS.
        {
          name: "session-1.jsonl",
          body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", path: "secret-build/credentials.env" })}\n`
        }
      ],
      sourceFiles: [
        { rel: "secret-build/credentials.env", body: "DB_PASSWORD=should-never-appear\n" }
      ],
      diff: hugeDiff
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");

    // Diff cap: the embedded diff section is bounded and the engine reports it was capped.
    expect(result.value).toMatchObject({ diffCapped: true });
    expect(Buffer.byteLength(srs, "utf8")).toBeLessThan(64 * 1024);
    expect(srs).not.toContain("line 4999 padding"); // tail of the oversized diff was dropped
    // The cap must announce truncation rather than silently swallowing content.
    expect(srs).toMatch(/truncat|capped|\.\.\./i);

    // Gitignored exclusion: neither the ignored path nor its contents reach the SRS.
    expect(srs).not.toContain("secret-build/credentials.env");
    expect(srs).not.toContain("should-never-appear");
  });

  // AC-4: Synthesis redacts recognized secret patterns from its inputs before writing SRS.
  it("FR-NODE-041 AC-4: redacts recognized secret patterns from intent, shards, comments, and diff", async () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const githubPat = "ghp_0123456789abcdefghijklmnopqrstuvwx12";
    const bearer = "Bearer abcDEF123456ghiJKL789mnoPQR0";
    const privateKeyHeader = "-----BEGIN RSA PRIVATE KEY-----";

    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nDeploy used aws key ${awsKey} once.\n`,
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: `token ${githubPat}` })}\n` }
      ],
      sourceFiles: [
        { rel: "src/auth/login.ts", body: `// @step ${TASK_NAME}: header was "Authorization: ${bearer}"\nexport const x = 1;\n` }
      ],
      diff: `diff --git a/key.pem b/key.pem\n+${privateKeyHeader}\n+MIIEowIBAAKCAQEA\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");

    // No recognized secret may survive verbatim in the committed SRS.
    expect(srs).not.toContain(awsKey);
    expect(srs).not.toContain(githubPat);
    expect(srs).not.toContain(bearer);
    expect(srs).not.toContain(privateKeyHeader);
    // A redaction marker must replace each removed secret.
    expect(srs).toMatch(/\[REDACTED\]|REDACTED|\*{3,}|████/);
    // The engine reports that at least one secret was redacted.
    expect((result.value as { redactions: number }).redactions).toBeGreaterThanOrEqual(4);
  });

  // AC-4 (FND-001): the PEM redaction must cover the whole BEGIN...END block, not just the
  // header line, so the base64 key body never reaches the committed SRS.
  it("FR-NODE-041 AC-4: redacts the full PEM private key block including the base64 body", async () => {
    const keyBody = "MIIEowIBAAKCAQEAsecretbase64bodythatmustnotleakAAAA1234567890";
    const pem = ["-----BEGIN RSA PRIVATE KEY-----", keyBody, "QUJDREVGc2Vjb25kbGluZQ==", "-----END RSA PRIVATE KEY-----"].join(
      "\n"
    );
    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nbody\n`,
      diff: `diff --git a/key.pem b/key.pem\n${pem}\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    // Neither the header nor the base64 body may survive verbatim.
    expect(srs).not.toContain(keyBody);
    expect(srs).not.toContain("QUJDREVGc2Vjb25kbGluZQ==");
    expect(srs).not.toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(srs).not.toContain("-----END RSA PRIVATE KEY-----");
    expect(srs).toMatch(/\[REDACTED\]/);
  });

  // AC-4 (FND-002): additional recognized credential classes (key=value secrets, JWT,
  // Slack, OpenAI, fine-grained GitHub PAT) must not leak verbatim.
  it("FR-NODE-041 AC-4: redacts key=value secrets, JWT, Slack, OpenAI, and fine-grained GitHub PAT", async () => {
    const password = "password=hunter2SuperSecret";
    const apiKey = "api_key: AKfycbxLeakThisKeyValue123";
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";
    const slack = "xoxb-1234567890-0987654321-AbCdEfGhIjKlMnOpQrStUv";
    const openai = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const finePat = "github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890";

    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nDeploy with ${password} and ${apiKey}.\n`,
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: `jwt ${jwt}` })}\n` }
      ],
      sourceFiles: [
        { rel: "src/auth/login.ts", body: `// @step ${TASK_NAME}: slack ${slack} openai ${openai}\nexport const x = 1;\n` }
      ],
      diff: `diff --git a/cfg b/cfg\n+pat ${finePat}\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).not.toContain("hunter2SuperSecret");
    expect(srs).not.toContain("AKfycbxLeakThisKeyValue123");
    expect(srs).not.toContain(jwt);
    expect(srs).not.toContain(slack);
    expect(srs).not.toContain(openai);
    expect(srs).not.toContain(finePat);
    expect(srs).toMatch(/\[REDACTED\]/);
    // All six new-class secrets were redacted (plus prior assertions exercise the legacy four).
    expect((result.value as { redactions: number }).redactions).toBeGreaterThanOrEqual(6);
  });

  // AC-4 (NF-001): key=value redaction must target plausible literal credentials, not normal
  // code expressions or prose that happen to contain a key word. A value that is a code
  // expression (parens, semicolons, whitespace+word, comparison operators) must survive verbatim.
  it("FR-NODE-041 AC-4: does not redact key-words used in code or prose (no over-redaction)", async () => {
    const callExpr = "this.token = computeToken();"; // code: function call value
    const comparison = "if (password === storedHash)"; // code: comparison operator
    const prose = "The token: design uses a refresh"; // prose: word value after colon+space
    const assignment = "const api_key = config.apiKey;"; // code: dotted member, semicolon

    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\n${prose}\n`,
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: comparison })}\n` }
      ],
      sourceFiles: [
        { rel: "src/auth/login.ts", body: `// @step ${TASK_NAME}: ${callExpr}\nexport const x = 1;\n` }
      ],
      diff: `diff --git a/cfg.ts b/cfg.ts\n+${assignment}\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    // None of these legitimate code/prose fragments may be redacted.
    expect(srs).toContain("computeToken();");
    expect(srs).toContain("password === storedHash");
    expect(srs).toContain("token: design uses a refresh");
    expect(srs).toContain("config.apiKey;");
    // The four code/prose fragments contributed no redaction.
    expect((result.value as { redactions: number }).redactions).toBe(0);
  });

  // AC-4 (NF-001): genuine key=value credentials must still be redacted after the precision
  // tightening — a no-space assignment, a colon+space token with digits, and a quoted value.
  it("FR-NODE-041 AC-4: still redacts genuine key=value credentials (no under-redaction)", async () => {
    const noSpace = "password=hunter2"; // no-space assignment
    const colonSpaceToken = "api_key: sk_live_abc123XYZ"; // colon + space + credential token
    const quoted = 'token: "ghp_xxxxYYYYzzzz1234"'; // quoted value

    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nDeploy with ${noSpace}.\n`,
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: colonSpaceToken })}\n` }
      ],
      sourceFiles: [
        { rel: "src/auth/login.ts", body: `// @step ${TASK_NAME}: ${quoted}\nexport const x = 1;\n` }
      ],
      diff: `diff --git a/cfg b/cfg\n+${noSpace}\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).not.toContain("hunter2");
    expect(srs).not.toContain("sk_live_abc123XYZ");
    expect(srs).not.toContain("ghp_xxxxYYYYzzzz1234");
    expect(srs).toMatch(/\[REDACTED\]/);
    // Each of the three genuine credentials was redacted.
    expect((result.value as { redactions: number }).redactions).toBeGreaterThanOrEqual(3);
  });

  // AC-4 (NF-002): a lowercase PEM private key block must be redacted just like the uppercase
  // form — the PEM patterns are case-insensitive (full block + bare header/footer fallback).
  it("FR-NODE-041 AC-4: redacts a lowercase PEM private key block", async () => {
    const keyBody = "MIIEowIBAAKCAQEAlowercasepemBodyThatMustNotLeak1234567890";
    const pem = ["-----begin private key-----", keyBody, "-----end private key-----"].join("\n");
    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nbody\n`,
      diff: `diff --git a/key.pem b/key.pem\n${pem}\n`
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).not.toContain(keyBody);
    expect(srs).not.toContain("-----begin private key-----");
    expect(srs).not.toContain("-----end private key-----");
    expect(srs).toMatch(/\[REDACTED\]/);
  });

  // AC-3 (FND-003): a diff hunk whose `diff --git` header references a gitignored path must be
  // dropped from the SRS, the same way trace/comment channels exclude gitignored paths.
  it("FR-NODE-041 AC-3: drops diff hunks for gitignored paths", async () => {
    const diff = [
      "diff --git a/src/keep.ts b/src/keep.ts",
      "+const KEEP_TOKEN = 1;",
      "diff --git a/secret-build/credentials.env b/secret-build/credentials.env",
      "+DB_PASSWORD_SENTINEL=should-never-appear",
      "diff --git a/src/also-keep.ts b/src/also-keep.ts",
      "+const ALSO_KEEP = 2;"
    ].join("\n");

    await seedStepInputs(root, TASK_NAME, {
      gitignore: "secret-build/\n",
      diff
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    // Kept hunks survive on both sides of the dropped one.
    expect(srs).toContain("const KEEP_TOKEN = 1;");
    expect(srs).toContain("const ALSO_KEEP = 2;");
    // The gitignored hunk and its contents are excluded.
    expect(srs).not.toContain("secret-build/credentials.env");
    expect(srs).not.toContain("should-never-appear");
  });

  // AC-3 (FND-004): a trailing-glob gitignore entry like `*.env` must exclude matching files
  // and matching diff hunks/trace paths, so common secret-bearing files do not leak.
  it("FR-NODE-041 AC-3: honors a trailing-glob gitignore entry (*.env)", async () => {
    const diff = [
      "diff --git a/src/keep.ts b/src/keep.ts",
      "+const KEEP = 1;",
      "diff --git a/config.env b/config.env",
      "+SECRET_GLOB_SENTINEL=do-not-leak"
    ].join("\n");

    await seedStepInputs(root, TASK_NAME, {
      gitignore: "*.env\n",
      shards: [
        { name: "session-1.jsonl", body: `${JSON.stringify({ ts: "2026-06-17T00:00:01Z", path: "config.env", note: "glob-trace" })}\n` }
      ],
      sourceFiles: [{ rel: "config.env", body: `// @step ${TASK_NAME}: glob-comment-should-not-appear\n` }],
      diff
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).toContain("const KEEP = 1;");
    // The *.env-matched file is excluded across diff, trace, and comment channels.
    expect(srs).not.toContain("config.env");
    expect(srs).not.toContain("do-not-leak");
    expect(srs).not.toContain("glob-comment-should-not-appear");
  });

  // AC-5: Synthesis merges the per-session trace shards in timestamp order and recovers from a
  // partially written trailing JSONL line by discarding only that torn line.
  it("FR-NODE-041 AC-5: merges shards in timestamp order and discards only a torn trailing line", async () => {
    // Two shards whose interleaving only resolves correctly when sorted by ts (not filename).
    const shardB = [
      JSON.stringify({ ts: "2026-06-17T00:00:01Z", note: "alpha-first" }),
      JSON.stringify({ ts: "2026-06-17T00:00:09Z", note: "delta-last" })
    ].join("\n") + "\n";
    const shardA = [
      JSON.stringify({ ts: "2026-06-17T00:00:03Z", note: "beta-second" }),
      JSON.stringify({ ts: "2026-06-17T00:00:06Z", note: "gamma-third" }),
      // Torn trailing line: a half-written JSON object with no newline. Only this line is dropped.
      '{"ts":"2026-06-17T00:00:12Z","note":"torn-tail'
    ].join("\n");

    await seedStepInputs(root, TASK_NAME, {
      intent: `# ${TASK_NAME}\n\nbody\n`,
      // Filenames deliberately ordered opposite to timestamps to prove ts-based sorting.
      shards: [
        { name: "z-session.jsonl", body: shardB },
        { name: "a-session.jsonl", body: shardA }
      ],
      diff: "diff --git a/x b/x\n+x\n"
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");

    // The four well-formed entries appear in timestamp order regardless of filename order.
    const orderOf = (needle: string): number => srs.indexOf(needle);
    expect(orderOf("alpha-first")).toBeGreaterThanOrEqual(0);
    expect(orderOf("beta-second")).toBeGreaterThan(orderOf("alpha-first"));
    expect(orderOf("gamma-third")).toBeGreaterThan(orderOf("beta-second"));
    expect(orderOf("delta-last")).toBeGreaterThan(orderOf("gamma-third"));

    // The torn trailing line is discarded — only that line, and synthesis still succeeds.
    expect(srs).not.toContain("torn-tail");
    expect(result.value).toMatchObject({ written: true });
    // The four intact entries survived (the torn one is the only casualty).
    expect((result.value as { traceEntries: number }).traceEntries).toBe(4);
  });
});
