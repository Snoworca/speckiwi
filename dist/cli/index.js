import { runCli } from "./program.js";
export async function main(argv, env = process.env) {
    return runCli(argv, env);
}
export { buildProgram, runCli } from "./program.js";
//# sourceMappingURL=index.js.map