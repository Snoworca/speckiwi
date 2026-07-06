import { Option, type Command } from "commander";
import type { CliContext } from "../command.js";
import { startMcpServer, type McpServerOptions } from "../../mcp/server.js";

export type McpServerStarter = (options: McpServerOptions) => Promise<void>;

export interface McpCliOptions {
  transport?: string;
}

// IR-CLI-045: mcp 는 root 옵션을 지원하지 않는다. project root 는 서버 프로세스 cwd 탐색으로만 해석된다.
const ROOT_REJECTION_MESSAGE =
  "speckiwi mcp does not support --root; start the MCP server from the intended project directory so the project root is resolved from the current working directory";

export async function runMcp(options: McpCliOptions, starter: McpServerStarter = startMcpServer): Promise<number> {
  if (options.transport && options.transport !== "stdio") return 2;
  await starter({ transport: "stdio" });
  return 0;
}

export function registerMcpCommand(command: Command, _context: CliContext, starter: McpServerStarter = startMcpServer): void {
  command
    .command("mcp")
    .option("--transport <transport>", "transport", "stdio")
    .addOption(new Option("--root <path>").hideHelp())
    .action(async (options) => {
      if (options.root !== undefined || command.opts().root !== undefined) {
        command.error(ROOT_REJECTION_MESSAGE, { exitCode: 2 });
      }
      const code = await runMcp({ transport: options.transport }, starter);
      if (code !== 0) {
        command.error("Invalid MCP transport", { exitCode: code });
      }
    });
}
