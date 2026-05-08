import type { CliIo } from "./index.js";
import { formatJsonOutput } from "../core/format/json.js";
import { formatHumanOutput } from "../core/format/text.js";

export function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${formatJsonOutput(value)}\n`);
}

export function writeHuman(io: CliIo, value: unknown): void {
  io.stdout.write(`${formatHumanOutput(value)}\n`);
}
