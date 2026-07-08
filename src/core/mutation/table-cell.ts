import type { MutationResult } from "../types.js";
import { mutationFail } from "./guards.js";

const UNSAFE_MARKDOWN_TABLE_CELL = /[|\r\n]/;

export function assertSafeMarkdownTableCell<T = void>(label: string, value: string): MutationResult<T> | undefined {
  if (!UNSAFE_MARKDOWN_TABLE_CELL.test(value)) return undefined;
  return mutationFail("MUTATION_DENIED", `${label} cannot contain pipe or newline characters`) as MutationResult<T>;
}

export function assertSafeStateCell<T = void>(label: string, value: string): MutationResult<T> | undefined {
  if (!UNSAFE_MARKDOWN_TABLE_CELL.test(value)) return undefined;
  return mutationFail("USAGE", `${label} cannot contain pipe, carriage return, or newline characters`) as MutationResult<T>;
}

export function assertSafeMarkdownTableCells<T = void>(cells: Record<string, string>): MutationResult<T> | undefined {
  for (const [label, value] of Object.entries(cells)) {
    const failure = assertSafeMarkdownTableCell<T>(label, value);
    if (failure) return failure;
  }
  return undefined;
}
