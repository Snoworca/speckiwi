import type { Command } from "commander";
import { findWorkspaceRoot } from "../../io/workspace.js";
import { runMcpServer } from "../../mcp/server.js";

export function registerMcpCommand(program: Command): void {
  const command = program.command("mcp").description("run the SpecKiwi stdio MCP server").option("--root <path>", "workspace root");

  command.action(async () => {
    const rootOption = command.optsWithGlobals().root;
    if (typeof rootOption !== "string" || rootOption.length === 0) {
      throw new Error("speckiwi mcp requires --root <path>.");
    }
    const root = await findWorkspaceRoot(process.cwd(), rootOption);
    await runMcpServer({ root: root.rootPath });
  });
}
