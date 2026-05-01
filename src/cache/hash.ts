import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

export function hashJson(value: unknown): string {
  return `sha256:${sha256(stableJson(value))}`;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return "null";
}
