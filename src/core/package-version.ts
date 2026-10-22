import { createRequire } from "node:module";

interface PackageManifest {
  version: string;
  engines?: { node?: string };
}

const manifest = createRequire(import.meta.url)("../../package.json") as PackageManifest;

/** The version of the installed speckiwi package, read once from its package.json. */
export const PACKAGE_VERSION: string = manifest.version;

/** A Node version as [major, minor, patch]. */
export type NodeVersionTuple = readonly [number, number, number];

// @req IR-CLI-065 AC-5
/** The lowest Node version a semver range admits, read from its first version; undefined for `*` and the like. */
export function engineFloorVersion(range: string): NodeVersionTuple | undefined {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

// @req IR-CLI-065 AC-5
/** A Node floor: the `engines.node` range it was read from and the lowest version that range admits. */
export interface NodeFloor {
  range: string;
  version: NodeVersionTuple;
}

/** The floor a range declares; a range with no version in it is refused, because it states no floor. */
export function parseNodeFloor(range: string): NodeFloor {
  const version = engineFloorVersion(range);
  if (version === undefined) throw new Error(`engines.node range states no Node floor: ${range}`);
  return { range, version };
}

// @req IR-CLI-065 AC-5
/** The `engines.node` range of the installed speckiwi package, verbatim. */
export const NODE_ENGINES_RANGE: string = manifest.engines?.node ?? "";

// A package shipped without a Node floor is a release defect, not a runtime condition to tolerate.
/** The Node floor the installed speckiwi package declares. */
export const NODE_FLOOR: NodeFloor = parseNodeFloor(NODE_ENGINES_RANGE);
