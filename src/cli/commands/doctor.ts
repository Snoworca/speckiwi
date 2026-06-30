import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { runPackageDoctor } from "../../doctor/package-doctor.js";
import type { CliContext } from "../command.js";
import { writeHuman, writeJson } from "../formatters.js";

export function registerDoctorCommand(command: Command, context: CliContext): void {
  command.command("doctor").option("--json", "JSON output").action(async (options) => {
    const root = await resolveProjectRoot(process.cwd(), command.opts().root);
    const report = await runPackageDoctor(root);
    if (options.json || command.opts().json) writeJson(context.io, report);
    else writeHuman(context.io, report);
    if (!report.ok) command.setOptionValue("exitCode", 5);
  });
}
