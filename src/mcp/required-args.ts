import type { z } from "zod";
import { mcpFailure } from "./errors.js";

/**
 * @req FR-NODE-240 AC-3, FR-NODE-242 AC-2, IR-MCP-006 AC-1, FR-NODE-243 AC-6 — a required argument
 * the input leaves out is a usage error, as the CLI makes a missing argument one, never an empty
 * string that then fails as "not found". `shape` is the tool's input schema, the one place its
 * arguments are declared. Returns the failure to answer with, or undefined when nothing is missing.
 */
export function missingRequiredArguments(
  tool: string,
  shape: Readonly<Record<string, z.ZodTypeAny>>,
  input: Readonly<Record<string, unknown>>
): ReturnType<typeof mcpFailure> | undefined {
  const missing = Object.entries(shape)
    .filter(([key, schema]) => !schema.isOptional() && input[key] === undefined)
    .map(([key]) => key);
  return missing.length === 0 ? undefined : mcpFailure("USAGE", `${tool} requires ${missing.join(", ")}`, { metadata: { missing } });
}
