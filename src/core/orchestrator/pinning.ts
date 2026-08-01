import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Handoff pinning — harvest H1 from the deferred multi-root branch's
 * `src/core/workflow/wave-agent-instructions.ts`.
 *
 * @req FR-NODE-101 — the port, proven test-first against the replaced dependency.
 * @req FR-NODE-134 — a real `git_blob_oid` beside the sha256, size caps, and a re-proof that fails
 *   under inode, ancestor-directory, symlink, hardlink and Windows junction substitution.
 *
 * Two deliberate departures from the source module, both required by
 * `docs/research/kiwi-orchestrator/06.deferred-multiroot-audit.md`:
 *
 * 1. The branch's trusted git invocation wrapper is dropped (`06:160`, `06:330`). `06` §5.1
 *    Defect B reproduced that wrapper accepting a clean fixture from a cwd outside any repository
 *    and rejecting it from inside a worktree, deterministically, because its dynamic command
 *    overrides spawn git with no `cwd` option at all. Every git call here is plain `git` with an
 *    explicit `cwd`, and `GitRunner` takes that `cwd` as a required positional argument so a
 *    cwd-less spawn cannot be written by accident.
 * 2. The source module located the repository's own agent-notes files by scanning the tree. The
 *    orchestrator pins the handoff *it authored*, so the caller names the documents and this module
 *    has no tree-scanning entry point at all.
 */

const execFileAsync = promisify(execFile);
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const GIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const PIN_LIMITS = Object.freeze({
  maxDocuments: 32,
  maxDocumentBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxPathBytes: 1024,
  maxTreeListingBytes: 32 * 1024 * 1024
});

export interface PinnedDocument {
  readonly path: string;
  readonly gitBlobOid: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly text: string;
}

export interface PinnedHandoff {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly expectedHead: string;
  readonly documents: readonly PinnedDocument[];
  readonly topologySha256: string;
}

export interface PinHandoffInput {
  readonly root: string;
  readonly expectedHead: string;
  readonly documentPaths: readonly string[];
}

/** A git invocation bound to an explicit working directory. `cwd` is positional, never optional. */
export type GitRunner = (cwd: string, args: readonly string[], maxBuffer: number) => Promise<Buffer>;

export class HandoffPinError extends Error {
  /** §13's critical gate for a handoff whose pin cannot be established or re-proved. */
  readonly gate = "handoff-pin-untrusted";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HandoffPinError";
  }
}

interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly gitBlobOid: string;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly nlink: number;
}

interface DirectoryIdentity {
  readonly absolutePath: string;
  readonly realPath: string;
  readonly dev: number;
  readonly ino: number;
}

interface RootIdentity {
  readonly absolutePath: string;
  readonly realPath: string;
  readonly dev: number;
  readonly ino: number;
}

interface ObservedDocument extends PinnedDocument {
  readonly mode: string;
  readonly leafIdentity: FileIdentity;
  readonly ancestors: readonly DirectoryIdentity[];
}

interface Observation {
  readonly root: string;
  readonly expectedHead: string;
  readonly rootIdentity: RootIdentity;
  readonly documents: readonly ObservedDocument[];
  readonly topologySha256: string;
}

interface Pin {
  readonly observation: Observation;
  readonly documentPaths: readonly string[];
  readonly git: GitRunner;
  readonly publishedSha256: string;
}

/**
 * A pin is remembered against the exact snapshot object the pin API returned. A structurally
 * identical literal assembled by a caller is therefore not a pin, which is what makes a forged
 * snapshot detectable rather than merely improbable.
 */
const pins = new WeakMap<object, Pin>();

export const runGit: GitRunner = async (cwd, args, maxBuffer) => {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "buffer",
    windowsHide: true,
    maxBuffer
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function comparable(value: string): string {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function fail(message: string, cause?: unknown): never {
  throw new HandoffPinError(message, cause === undefined ? undefined : { cause });
}

function wrap(error: unknown, message: string): HandoffPinError {
  return error instanceof HandoffPinError ? error : new HandoffPinError(message, { cause: error });
}

function decodeStrictUtf8(bytes: Uint8Array, label: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch (error) {
    return fail(`${label} is not strict UTF-8`, error);
  }
}

function canonicalText(bytes: Uint8Array, label: string): string {
  if (bytes.includes(0)) fail(`${label} contains NUL`);
  return decodeStrictUtf8(bytes, label).replaceAll("\r\n", "\n");
}

/**
 * A requested path must be exactly what git records: repo-relative, POSIX, NFC, no traversal, and
 * never inside git's own administration directory under any casing.
 */
function assertCanonicalPath(relativePath: string): void {
  if (
    typeof relativePath !== "string" || relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) || relativePath.includes("\\") ||
    relativePath.normalize("NFC") !== relativePath ||
    utf8(relativePath).byteLength > PIN_LIMITS.maxPathBytes ||
    path.posix.normalize(relativePath) !== relativePath
  ) fail(`Pinned handoff path is noncanonical: ${relativePath}`);

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail(`Pinned handoff path is noncanonical: ${relativePath}`);
  }
  for (const segment of segments) {
    if (segment.toLowerCase() === ".git") {
      fail(`Pinned handoff path enters git's administration state: ${relativePath}`);
    }
    const forbidden = [...segment].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f || "<>:\"|?*".includes(character);
    });
    if (forbidden || /[ .]$/u.test(segment)) {
      fail(`Pinned handoff path is not a portable canonical path: ${relativePath}`);
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)) {
      fail(`Pinned handoff path uses a reserved path segment: ${relativePath}`);
    }
  }
}

function compareUtf8Path(left: string, right: string): number {
  const depthDifference = left.split("/").length - right.split("/").length;
  if (depthDifference !== 0) return depthDifference;
  return Buffer.compare(utf8(left), utf8(right));
}

/**
 * The requested set, validated and put in the deterministic order the topology hash depends on.
 * Case-folded collisions are refused before git runs: on a case-insensitive filesystem two such
 * paths name one file, so pinning both would record one document twice under two identities.
 */
function canonicalRequest(documentPaths: readonly string[]): readonly string[] {
  if (!Array.isArray(documentPaths) || documentPaths.length === 0) {
    fail("Pinning a handoff requires at least one document path");
  }
  if (documentPaths.length > PIN_LIMITS.maxDocuments) {
    fail("Pinned handoff document count exceeds its fixed limit");
  }
  for (const relativePath of documentPaths) assertCanonicalPath(relativePath);

  const caseFolded = new Set<string>();
  for (const relativePath of documentPaths) {
    const key = relativePath.toLowerCase();
    if (caseFolded.has(key)) fail(`Pinned handoff paths collide by case: ${relativePath}`);
    caseFolded.add(key);
  }
  return [...documentPaths].sort(compareUtf8Path);
}

function canonicalHead(value: string): string {
  if (typeof value !== "string" || !GIT_OID_PATTERN.test(value)) {
    fail("Pinned handoff expected HEAD must be a canonical full git object id");
  }
  return value;
}

async function readHead(git: GitRunner, root: string): Promise<string> {
  const bytes = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"], 64 * 1024);
  const text = decodeStrictUtf8(bytes, "git HEAD response");
  const match = /^([0-9a-f]{40}|[0-9a-f]{64})\r?\n$/.exec(text);
  if (!match) fail("git returned a noncanonical HEAD");
  return match[1]!;
}

function parseTreeEntries(treeBytes: Buffer, requested: readonly string[]): readonly TreeEntry[] {
  if (treeBytes.byteLength > PIN_LIMITS.maxTreeListingBytes) {
    fail("git tree listing exceeds its byte limit");
  }
  if (treeBytes.byteLength !== 0 && treeBytes[treeBytes.byteLength - 1] !== 0) {
    fail("git tree listing is not NUL terminated");
  }

  const byPath = new Map<string, TreeEntry>();
  let recordStart = 0;
  for (let index = 0; index < treeBytes.byteLength; index += 1) {
    if (treeBytes[index] !== 0) continue;
    const record = treeBytes.subarray(recordStart, index);
    recordStart = index + 1;
    const tab = record.indexOf(0x09);
    if (tab <= 0 || tab === record.byteLength - 1) fail("git tree record is malformed");
    const metadata = decodeStrictUtf8(record.subarray(0, tab), "git tree metadata");
    const metadataMatch = /^(\d{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(metadata);
    if (!metadataMatch) fail("git tree record metadata is noncanonical");
    const relativePath = decodeStrictUtf8(record.subarray(tab + 1), "git tree path");
    if (byPath.has(relativePath)) fail(`git tree lists one path twice: ${relativePath}`);
    byPath.set(relativePath, {
      path: relativePath,
      mode: metadataMatch[1]!,
      gitBlobOid: metadataMatch[3]!
    });
  }

  return requested.map((relativePath) => {
    const entry = byPath.get(relativePath);
    if (!entry) fail(`Pinned handoff document is not tracked at the expected HEAD: ${relativePath}`);
    if ((entry.mode !== "100644" && entry.mode !== "100755")) {
      fail(`Pinned handoff document has a non-regular git mode: ${relativePath}`);
    }
    return entry;
  });
}

async function readTree(
  git: GitRunner,
  root: string,
  expectedHead: string,
  requested: readonly string[]
): Promise<readonly TreeEntry[]> {
  const bytes = await git(
    root,
    ["ls-tree", "-r", "-z", "--full-tree", expectedHead, "--", ...requested],
    PIN_LIMITS.maxTreeListingBytes + 1
  );
  return parseTreeEntries(bytes, requested);
}

async function readBlob(git: GitRunner, root: string, entry: TreeEntry): Promise<Buffer> {
  const sizeBytes = await git(root, ["cat-file", "-s", entry.gitBlobOid], 64 * 1024);
  const sizeText = decodeStrictUtf8(sizeBytes, `git blob size for ${entry.path}`);
  const match = /^(0|[1-9]\d*)\r?\n$/.exec(sizeText);
  if (!match) fail(`git blob size is noncanonical: ${entry.path}`);
  const size = Number(match[1]);
  if (!Number.isSafeInteger(size) || size > PIN_LIMITS.maxDocumentBytes) {
    fail(`Pinned handoff document exceeds its individual byte limit: ${entry.path}`);
  }
  const bytes = await git(root, ["cat-file", "blob", entry.gitBlobOid], PIN_LIMITS.maxDocumentBytes + 1);
  if (bytes.byteLength !== size) fail(`git blob size changed during the bounded read: ${entry.path}`);
  return bytes;
}

function fileIdentity(stat: { dev: number; ino: number; size: number; nlink: number }): FileIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, nlink: stat.nlink };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.nlink === right.nlink;
}

async function captureRootIdentity(root: string): Promise<RootIdentity> {
  if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root)) {
    fail("Pinned handoff root must be an absolute path");
  }
  const absolutePath = path.resolve(root);
  const lexical = await lstat(absolutePath);
  if (!lexical.isDirectory() || lexical.isSymbolicLink()) {
    fail("Pinned handoff root must be a non-reparse directory");
  }
  const resolved = await realpath(absolutePath);
  if (comparable(resolved) !== comparable(absolutePath)) {
    fail("Pinned handoff root resolves through a reparse point");
  }
  const observed = await lstat(resolved);
  if (
    !observed.isDirectory() || observed.isSymbolicLink() ||
    observed.dev !== lexical.dev || observed.ino !== lexical.ino
  ) fail("Pinned handoff root identity changed during resolution");
  return { absolutePath, realPath: resolved, dev: observed.dev, ino: observed.ino };
}

async function assertRootIdentity(expected: RootIdentity): Promise<void> {
  const observed = await captureRootIdentity(expected.absolutePath);
  if (
    comparable(observed.realPath) !== comparable(expected.realPath) ||
    observed.dev !== expected.dev || observed.ino !== expected.ino
  ) fail("Pinned handoff root identity changed during verification");
}

/**
 * Every directory from the root down to the document's parent, by identity. Without this an
 * attacker swaps an ancestor for a same-byte copy and the leaf still reads correctly.
 */
async function captureAncestors(root: string, relativePath: string): Promise<readonly DirectoryIdentity[]> {
  const segments = relativePath.split("/").slice(0, -1);
  const paths = [root];
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    paths.push(cursor);
  }
  const identities: DirectoryIdentity[] = [];
  for (const absolutePath of paths) {
    const stat = await lstat(absolutePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`Pinned handoff ancestry contains a reparse point or non-directory: ${relativePath}`);
    }
    const resolved = await realpath(absolutePath);
    if (comparable(resolved) !== comparable(absolutePath) || !isContained(root, resolved)) {
      fail(`Pinned handoff ancestry escapes the pinned root: ${relativePath}`);
    }
    const resolvedStat = await lstat(resolved);
    if (
      !resolvedStat.isDirectory() || resolvedStat.isSymbolicLink() ||
      resolvedStat.dev !== stat.dev || resolvedStat.ino !== stat.ino
    ) fail(`Pinned handoff ancestry identity changed: ${relativePath}`);
    identities.push({ absolutePath, realPath: resolved, dev: stat.dev, ino: stat.ino });
  }
  return identities;
}

async function assertAncestors(
  expected: readonly DirectoryIdentity[],
  relativePath: string
): Promise<void> {
  for (const identity of expected) {
    const stat = await lstat(identity.absolutePath);
    const resolved = await realpath(identity.absolutePath);
    if (
      !stat.isDirectory() || stat.isSymbolicLink() ||
      stat.dev !== identity.dev || stat.ino !== identity.ino ||
      comparable(resolved) !== comparable(identity.realPath)
    ) fail(`Pinned handoff ancestry changed during the bounded read: ${relativePath}`);
  }
}

async function readWorktreeDocument(root: string, relativePath: string): Promise<{
  readonly bytes: Buffer;
  readonly leafIdentity: FileIdentity;
  readonly ancestors: readonly DirectoryIdentity[];
}> {
  const ancestors = await captureAncestors(root, relativePath);
  const absolutePath = path.join(root, ...relativePath.split("/"));
  if (!isContained(root, absolutePath)) {
    fail(`Pinned handoff path escapes the pinned root: ${relativePath}`);
  }
  const lexicalBefore = await lstat(absolutePath);
  if (
    !lexicalBefore.isFile() || lexicalBefore.isSymbolicLink() || lexicalBefore.nlink !== 1 ||
    !Number.isSafeInteger(lexicalBefore.size) || lexicalBefore.size < 0 ||
    lexicalBefore.size > PIN_LIMITS.maxDocumentBytes
  ) fail(`Pinned handoff leaf is not a bounded singly-linked regular file: ${relativePath}`);
  const realBefore = await realpath(absolutePath);
  if (comparable(realBefore) !== comparable(absolutePath) || !isContained(root, realBefore)) {
    fail(`Pinned handoff leaf resolves outside the pinned root: ${relativePath}`);
  }

  const expectedIdentity = fileIdentity(lexicalBefore);
  const handle = await open(absolutePath, "r");
  let bytes: Buffer;
  try {
    const descriptorBefore = await handle.stat();
    if (!descriptorBefore.isFile() || !sameFileIdentity(expectedIdentity, fileIdentity(descriptorBefore))) {
      fail(`Pinned handoff leaf identity changed before the bounded read: ${relativePath}`);
    }
    const buffer = Buffer.alloc(expectedIdentity.size + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== expectedIdentity.size) {
      fail(`Pinned handoff leaf size changed during the bounded read: ${relativePath}`);
    }
    bytes = buffer.subarray(0, offset);
    const descriptorAfter = await handle.stat();
    if (!descriptorAfter.isFile() || !sameFileIdentity(expectedIdentity, fileIdentity(descriptorAfter))) {
      fail(`Pinned handoff leaf identity changed during the bounded read: ${relativePath}`);
    }
  } finally {
    await handle.close();
  }

  const lexicalAfter = await lstat(absolutePath);
  const realAfter = await realpath(absolutePath);
  if (
    !lexicalAfter.isFile() || lexicalAfter.isSymbolicLink() ||
    !sameFileIdentity(expectedIdentity, fileIdentity(lexicalAfter)) ||
    comparable(realAfter) !== comparable(realBefore)
  ) fail(`Pinned handoff leaf path changed during the bounded read: ${relativePath}`);

  await assertAncestors(ancestors, relativePath);
  return {
    bytes,
    leafIdentity: expectedIdentity,
    ancestors: Object.freeze(ancestors.map((identity) => Object.freeze({ ...identity })))
  };
}

function topologySha256(documents: readonly ObservedDocument[]): string {
  return sha256(utf8(JSON.stringify(documents.map((document) => ({
    path: document.path,
    mode: document.mode,
    git_blob_oid: document.gitBlobOid,
    sha256: document.sha256,
    byte_length: document.byteLength
  })))));
}

async function observe(
  git: GitRunner,
  root: string,
  expectedHead: string,
  requested: readonly string[]
): Promise<Observation> {
  const rootIdentity = await captureRootIdentity(root);
  const head = canonicalHead(expectedHead);
  if (await readHead(git, rootIdentity.realPath) !== head) {
    fail("Pinned handoff expected HEAD does not match the repository HEAD");
  }

  const entries = await readTree(git, rootIdentity.realPath, head, requested);
  const documents: ObservedDocument[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const blobBytes = await readBlob(git, rootIdentity.realPath, entry);
    totalBytes += blobBytes.byteLength;
    if (totalBytes > PIN_LIMITS.maxTotalBytes) {
      fail("Pinned handoff documents exceed their aggregate byte limit");
    }
    const text = canonicalText(blobBytes, `Pinned handoff git blob ${entry.path}`);
    const worktree = await readWorktreeDocument(rootIdentity.realPath, entry.path);
    if (canonicalText(worktree.bytes, `Pinned handoff worktree document ${entry.path}`) !== text) {
      fail(`Pinned handoff worktree text differs from the expected git blob: ${entry.path}`);
    }
    documents.push({
      path: entry.path,
      mode: entry.mode,
      gitBlobOid: entry.gitBlobOid,
      sha256: sha256(blobBytes),
      byteLength: blobBytes.byteLength,
      text,
      leafIdentity: Object.freeze({ ...worktree.leafIdentity }),
      ancestors: worktree.ancestors
    });
  }

  if (await readHead(git, rootIdentity.realPath) !== head) {
    fail("Pinned handoff repository HEAD changed during verification");
  }
  await assertRootIdentity(rootIdentity);

  const frozen = Object.freeze(documents.map((document) => Object.freeze(document)));
  return Object.freeze({
    root: rootIdentity.realPath,
    expectedHead: head,
    rootIdentity: Object.freeze({ ...rootIdentity }),
    documents: frozen,
    topologySha256: topologySha256(frozen)
  });
}

function publishedSha256(snapshot: PinnedHandoff): string {
  return sha256(utf8(JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    root: snapshot.root,
    expectedHead: snapshot.expectedHead,
    documents: snapshot.documents,
    topologySha256: snapshot.topologySha256
  })));
}

function sameDocuments(left: readonly ObservedDocument[], right: readonly ObservedDocument[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((document, index) => {
    const other = right[index];
    return other !== undefined &&
      document.path === other.path && document.mode === other.mode &&
      document.gitBlobOid === other.gitBlobOid && document.sha256 === other.sha256 &&
      document.byteLength === other.byteLength && document.text === other.text &&
      sameFileIdentity(document.leafIdentity, other.leafIdentity) &&
      document.ancestors.length === other.ancestors.length &&
      document.ancestors.every((identity, ancestorIndex) => {
        const otherIdentity = other.ancestors[ancestorIndex];
        return otherIdentity !== undefined &&
          comparable(identity.absolutePath) === comparable(otherIdentity.absolutePath) &&
          comparable(identity.realPath) === comparable(otherIdentity.realPath) &&
          identity.dev === otherIdentity.dev && identity.ino === otherIdentity.ino;
      });
  });
}

function sameRootIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return comparable(left.absolutePath) === comparable(right.absolutePath) &&
    comparable(left.realPath) === comparable(right.realPath) &&
    left.dev === right.dev && left.ino === right.ino;
}

/**
 * Pins the named handoff documents at `expectedHead`, recording for each a real `git_blob_oid` and
 * a sha256 over the same bytes. Never a null placeholder: a null oid makes the pin unprovable, and
 * the pin is what makes the §4.7 drift digest meaningful.
 */
export async function pinHandoff(input: PinHandoffInput, git: GitRunner = runGit): Promise<PinnedHandoff> {
  try {
    if (!input || typeof input !== "object") fail("Pinning a handoff requires an input object");
    const requested = canonicalRequest(input.documentPaths);
    const observation = await observe(git, input.root, input.expectedHead, requested);
    const documents = Object.freeze(observation.documents.map((document) => Object.freeze({
      path: document.path,
      gitBlobOid: document.gitBlobOid,
      sha256: document.sha256,
      byteLength: document.byteLength,
      text: document.text
    })));
    const snapshot: PinnedHandoff = Object.freeze({
      schemaVersion: 1 as const,
      root: observation.root,
      expectedHead: observation.expectedHead,
      documents,
      topologySha256: observation.topologySha256
    });
    pins.set(snapshot, {
      observation,
      documentPaths: requested,
      git,
      publishedSha256: publishedSha256(snapshot)
    });
    return snapshot;
  } catch (error) {
    throw wrap(error, "Unable to pin the handoff");
  }
}

/** Re-proves a pin: same bytes, same blob oids, and the same filesystem identities under them. */
export async function assertPinned(snapshot: PinnedHandoff, git?: GitRunner): Promise<void> {
  try {
    const pin = snapshot && typeof snapshot === "object" ? pins.get(snapshot) : undefined;
    if (!pin) fail("Handoff snapshot was forged or did not originate from the pin API");
    if (
      !Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.documents) ||
      !snapshot.documents.every((document) => Object.isFrozen(document)) ||
      publishedSha256(snapshot) !== pin.publishedSha256
    ) fail("Handoff snapshot was tampered with after pinning");

    const observed = await observe(
      git ?? pin.git,
      pin.observation.rootIdentity.absolutePath,
      pin.observation.expectedHead,
      pin.documentPaths
    );
    if (
      observed.root !== pin.observation.root ||
      observed.expectedHead !== pin.observation.expectedHead ||
      !sameRootIdentity(observed.rootIdentity, pin.observation.rootIdentity) ||
      observed.topologySha256 !== pin.observation.topologySha256 ||
      !sameDocuments(observed.documents, pin.observation.documents)
    ) fail("Handoff topology or bytes changed after pinning");
  } catch (error) {
    throw wrap(error, "Unable to re-prove the pinned handoff");
  }
}
