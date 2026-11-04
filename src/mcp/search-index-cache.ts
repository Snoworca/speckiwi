import { buildRequirementSearchIndex, type RequirementSearchIndex } from "../core/query/search-index.js";
import { computeSrsSpecFingerprint } from "../core/status-cache.js";
import type { ParsedWorkspace, RequirementRecord } from "../core/types.js";

// @req FR-MCP-071 — building the index tokenizes every requirement (tens to hundreds of milliseconds,
// growing with the SRS), and a search session asks many queries over SRS files that do not change
// between them. The index lives in
// memory only: the server writes nothing to keep it (AC-4).

/** How many workspace roots one server keeps an index for; a session rarely spans more. */
export const SEARCH_INDEX_CACHE_MAX_ROOTS = 4;

export interface SearchIndexCacheOptions {
  /** Most roots kept at once; the least recently used root is dropped first. */
  maxRoots?: number;
  build?: (records: readonly RequirementRecord[]) => RequirementSearchIndex;
}

export interface SearchIndexCache {
  /** The index for this parsed workspace, built at most once per root and SRS file hash. */
  index(workspace: ParsedWorkspace): Promise<RequirementSearchIndex>;
}

interface Entry {
  fingerprint: string;
  index: Promise<RequirementSearchIndex>;
}

export function createSearchIndexCache(options: SearchIndexCacheOptions = {}): SearchIndexCache {
  const maxRoots = options.maxRoots ?? SEARCH_INDEX_CACHE_MAX_ROOTS;
  if (!Number.isInteger(maxRoots) || maxRoots < 1) throw new RangeError(`maxRoots must be a positive integer, got ${maxRoots}`);
  const build = options.build ?? buildRequirementSearchIndex;
  // Map insertion order is the recency order. Lookup and insert run in one synchronous turn, so two
  // concurrent calls for the same key always meet the same pending build (AC-3) without a lock.
  const entries = new Map<string, Entry>();

  function remember(root: string, entry: Entry): void {
    entries.delete(root);
    entries.set(root, entry);
    const oldest = entries.keys().next();
    if (entries.size > maxRoots && !oldest.done) entries.delete(oldest.value);
  }

  return {
    index(workspace) {
      const root = workspace.root.root;
      const fingerprint = computeSrsSpecFingerprint(workspace).value;
      const cached = entries.get(root);
      if (cached?.fingerprint === fingerprint) {
        remember(root, cached);
        return cached.index;
      }
      // Deferred by one microtask so every caller in this turn shares the build instead of racing it.
      const index = Promise.resolve().then(() => build(workspace.records));
      const entry = { fingerprint, index };
      remember(root, entry);
      // A failed build must not answer every later call with the same failure.
      index.catch(() => {
        if (entries.get(root) === entry) entries.delete(root);
      });
      return index;
    }
  };
}
