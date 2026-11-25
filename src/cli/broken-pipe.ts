import type { EventEmitter } from "node:events";

/**
 * A reader that stops early (`speckiwi ... | head`) closes the pipe, and the next write fails with
 * EPIPE. Nothing is left to say to that reader, so the CLI ends quietly; any other write error is
 * rethrown, as an unhandled stream error would be. @req FR-NODE-325 AC-1 AC-2
 */
export function endQuietlyOnBrokenPipe(stream: EventEmitter): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    throw error;
  });
}
