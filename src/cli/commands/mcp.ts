import type { Command } from "commander";
import type { CliContext } from "../command.js";
import { startMcpServer, type McpServerOptions } from "../../mcp/server.js";

export type McpServerStarter = (options: McpServerOptions) => Promise<void>;

export interface McpCliOptions {
  transport?: string;
  root?: string;
}

export async function runMcp(options: McpCliOptions, starter: McpServerStarter = startMcpServer): Promise<number> {
  if (options.transport && options.transport !== "stdio") return 2;
  await starter({ ...(options.root ? { root: options.root } : {}), transport: "stdio" });
  return 0;
}

export function registerMcpCommand(command: Command, _context: CliContext, starter: McpServerStarter = startMcpServer): void {
  command
    .command("mcp")
    .option("--transport <transport>", "transport", "stdio")
    .action(async (options) => {
      const code = await runMcp({ transport: options.transport, root: command.opts().root }, starter);
      if (code !== 0) {
        command.error("Invalid MCP transport", { exitCode: code });
      }
    });
}
