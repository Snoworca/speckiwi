/**
 * The Node arguments a child process needs to import a `.ts` module directly.
 *
 * Node strips types without a flag from 22.18 and 23.6 on. `engines` admits every Node 22, and on
 * 22.6–22.17 the same stripping sits behind `--experimental-strip-types`: a child spawned there
 * without it dies with ERR_UNKNOWN_FILE_EXTENSION before it runs the module under test, so a
 * cross-process case reads as a missing outcome rather than as the property it checks.
 */
export const TYPE_STRIPPING_ARGS: readonly string[] = process.features.typescript ? [] : ["--experimental-strip-types"];
