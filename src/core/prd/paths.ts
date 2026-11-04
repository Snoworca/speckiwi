// @req FR-NODE-240, FR-NODE-242 — what makes a path a PRD file, decided here once: the file tools
// (which file they will read) and the citation reader (which reference names a PRD) both ask these
// functions, so a reference coverage counts is a file the tools can open, and the reverse.

export const PRD_DIRECTORY = "docs/prd";
export const PRD_FILE_SUFFIX = ".prd.md";

/**
 * Whether a file name or path ends in `.prd.md`, in lower case only: kiwi-prd names its files
 * `docs/prd/<YYYY-MM-DD>.<slug>.prd.md` and FR-NODE-240/242 name the suffix so. Case-exact, so a
 * reference is or is not a PRD on every platform alike.
 */
export function hasPrdFileSuffix(name: string): boolean {
  return name.endsWith(PRD_FILE_SUFFIX);
}

/**
 * Whether a repository-relative path names a PRD file: under docs/prd, with the PRD suffix. The
 * directory is matched without regard to case, as before; whether it is the same file as another
 * spelling is `sameRepositoryPath`'s call, and a missing file is `links check`'s.
 */
export function isPrdFilePath(path: string): boolean {
  return path.toLowerCase().startsWith(`${PRD_DIRECTORY}/`) && hasPrdFileSuffix(path);
}
