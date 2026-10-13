// The commands of the Connect CLI page (22 §12), from the one source the CLI
// help is generated from too (packages/jobs-contracts/cli-commands.json), so
// the page never drifts from the CLI. Parsed at load: a malformed file fails
// the tests, not the page.

import type { DevicePlatform } from "@pilihpendidikan/jobs-contracts/enums";
import cliCommandsFile from "@pilihpendidikan/jobs-contracts/cli-commands.json";
import { z } from "zod";

const perOs = z.object({
  macos: z.string().min(1),
  linux: z.string().min(1),
  windows: z.string().min(1),
});

const entry = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
});

export const CliCommandsSchema = z.object({
  version: z.literal(1),
  package: z.string().min(1),
  executable: z.string().min(1),
  alias: z.string().min(1),
  requirements: z.string().min(1),
  install_uv: perOs.extend({ docs_url: z.string().url() }),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        commands: perOs,
        note: z.string().optional(),
      })
    )
    .min(1),
  alternatives: z.array(entry.extend({ available: z.boolean() })),
  step_up: z.array(entry),
  troubleshooting: z.array(entry),
  upgrade: z.record(z.string(), z.string()),
  uninstall: z.string().min(1),
});
export type CliCommands = z.infer<typeof CliCommandsSchema>;
export type CliStep = CliCommands["steps"][number];

export const CLI_COMMANDS: CliCommands =
  CliCommandsSchema.parse(cliCommandsFile);

/** Install tab order (12 §7). */
export const INSTALL_PLATFORMS: readonly DevicePlatform[] = [
  "macos",
  "linux",
  "windows",
];

/** The step a command belongs to (`install`, `login`, …), or undefined. */
export function cliStep(id: string): CliStep | undefined {
  return CLI_COMMANDS.steps.find((step) => step.id === id);
}

/** The install command for `platform` (the `C` shortcut copies it). */
export function installCommand(platform: DevicePlatform): string {
  return (
    cliStep("install")?.commands[platform] ??
    CLI_COMMANDS.steps[0]?.commands[platform] ??
    ""
  );
}

/** The troubleshooting command with id `id` (e.g. `sync_status`). */
export function troubleshootingCommand(id: string): string | undefined {
  return CLI_COMMANDS.troubleshooting.find((item) => item.id === id)?.command;
}
