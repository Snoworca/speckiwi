import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import { registerMcpCommand } from "../../src/cli/commands/mcp.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("speckiwi mcp CLI command", () => {
  it("rejects invalid transports and leaves stdout clean for stdio startup", async () => {
    const invalid = io();
    const command = buildCommand({ io: invalid });
    registerMcpCommand(command, { io: invalid }, async () => {});
    await expect(command.parseAsync(["mcp", "--transport", "invalid"], { from: "user" })).rejects.toMatchObject({ exitCode: 2 });

    const valid = io();
    const command2 = buildCommand({ io: valid });
    let receivedRoot: string | undefined;
    registerMcpCommand(command2, { io: valid }, async (options) => {
      receivedRoot = options.root;
    });
    await command2.parseAsync(["mcp", "--transport", "stdio"], { from: "user" });
    expect(receivedRoot).toBeUndefined();
    expect(valid.stdout.read()).toBeNull();
  });
});
