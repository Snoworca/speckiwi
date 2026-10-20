// The bounded retry every lock file operation shares. Node-only imports, so the run lock can load it
// under the strip-only TypeScript loader its cross-process suites use.

/** Delays between the retries of one file operation that met EPERM/EBUSY: three retries within 300 ms. */
const BUSY_RETRY_DELAYS_MS = [25, 50, 100] as const;

/** EPERM/EBUSY: a delete-pending file on Windows, or a scanner holding it. */
export function isBusy(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EBUSY";
}

/**
 * @req REL-NODE-009 AC-2 AC-9, FR-NODE-221 — runs one file operation, retrying EPERM/EBUSY on a short
 * schedule. A persistent error is rethrown for the caller to answer.
 */
export async function retryBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (const delay of BUSY_RETRY_DELAYS_MS) {
    try {
      return await operation();
    } catch (error) {
      if (!isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return operation();
}
