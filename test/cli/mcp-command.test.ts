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
    let started = false;
    registerMcpCommand(command2, { io: valid }, async () => {
      started = true;
    });
    await command2.parseAsync(["mcp", "--transport", "stdio"], { from: "user" });
    expect(started).toBe(true);
    expect(valid.stdout.read()).toBeNull();
  });

  it("IR-CLI-045 AC-7: `speckiwi --root <path> mcp` 는 서버를 시작하지 않고 exit code 2 로 종료한다", async () => {
    const s = io();
    const command = buildCommand({ io: s });
    let started = false;
    registerMcpCommand(command, { io: s }, async () => {
      started = true;
    });
    await expect(command.parseAsync(["--root", "C:/tmp/some-root", "mcp"], { from: "user" })).rejects.toMatchObject({ exitCode: 2 });
    expect(started).toBe(false);
    const errText = String(s.stderr.read() ?? "");
    expect(errText).toMatch(/--root/);
    expect(errText).toMatch(/working directory|cwd/i);
  });

  it("IR-CLI-045 AC-7: `speckiwi mcp --root <path>` 형태도 서버를 시작하지 않고 exit code 2 로 종료한다", async () => {
    const s = io();
    const command = buildCommand({ io: s });
    let started = false;
    registerMcpCommand(command, { io: s }, async () => {
      started = true;
    });
    await expect(command.parseAsync(["mcp", "--root", "C:/tmp/some-root"], { from: "user" })).rejects.toMatchObject({ exitCode: 2 });
    expect(started).toBe(false);
  });

  it("IR-CLI-045 AC-8: starter 는 root 키 없이 transport 만 전달받는다", async () => {
    const s = io();
    const command = buildCommand({ io: s });
    let received: Record<string, unknown> | undefined;
    registerMcpCommand(command, { io: s }, async (options) => {
      received = options as Record<string, unknown>;
    });
    await command.parseAsync(["mcp"], { from: "user" });
    expect(received).toBeDefined();
    expect(Object.keys(received ?? {})).toEqual(["transport"]);
    expect("root" in (received ?? {})).toBe(false);
  });
});
