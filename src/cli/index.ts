import { runCli } from "./program.js";

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return runCli(argv, env);
}

export { buildProgram, runCli } from "./program.js";
