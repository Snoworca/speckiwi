import { createRequire } from "node:module";

/** The version of the installed speckiwi package, read once from its package.json. */
export const PACKAGE_VERSION: string = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
