import { isAbsolute } from "node:path";

import { readCurrentCliInstall } from "./cli-install-pointer.js";
import { CommandFailure, writeCommandError } from "./command-error-output.js";
import { pnpmInstaller } from "./host-cli-install.js";
import { createGhReleaseSource, type HostReleaseSource } from "./host-release-source.js";
import {
  applyReleaseUpgrade,
  hostUpgradeStatus,
  newHostActivationId,
  planReleaseUpgrade,
  type HostUpgradeDependencies,
} from "./host-upgrade.js";
import {
  formatHostReleasePlan,
  formatHostRollbackResult,
  formatHostUpgradeResult,
  formatHostUpgradeStatus,
} from "./host-upgrade-format.js";
import { hostUpgradeLayout } from "./host-upgrade-layout.js";
import { installedCliProbes } from "./host-link-activation.js";
import { rollbackActivation } from "./host-upgrade-rollback.js";
import type { CliIo } from "./types.js";

export const hostUsage = `  lervo host upgrade --from-release <tag> --repository <owner/name> [--apply] [--bin-directory <path>] [--json]
  lervo host upgrade --rollback <activation-id> [--apply] [--bin-directory <path>] [--json]
  lervo host upgrade --status [--bin-directory <path>] [--json]`;

/** Test seam: the release source, host paths, installer, health probes, and PATH. */
export interface HostCommandOverrides {
  createSource?: (repository: string) => HostReleaseSource;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  installer?: HostUpgradeDependencies["installer"];
  probes?: HostUpgradeDependencies["probes"];
  pathEnvironment?: string;
  now?: () => Date;
  newActivationId?: () => string;
}

type HostUpgradeMode =
  | { kind: "release"; tag: string; repository: string }
  | { kind: "rollback"; activationId: string }
  | { kind: "status" };

interface HostUpgradeArguments {
  mode: HostUpgradeMode;
  apply: boolean;
  json: boolean;
  binDirectory?: string;
}

// Each segment is a GitHub owner or repository name; dot-only segments would change the API path.
const repositoryPattern = /^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/u;
const activationIdPattern = /^hact_[a-f0-9]{24}$/u;

function invalid(message: string): never {
  throw new CommandFailure("host_upgrade_arguments_invalid", message);
}

function parseHostUpgradeArguments(args: string[]): HostUpgradeArguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (["--apply", "--json", "--status"].includes(argument)) flags.add(argument);
    else if (
      ["--from-release", "--repository", "--rollback", "--bin-directory"].includes(argument)
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) invalid(`${argument} needs a value.`);
      values.set(argument, value);
      index += 1;
    } else invalid(`Unknown host upgrade argument: ${argument}`);
  }
  const tag = values.get("--from-release");
  const repository = values.get("--repository");
  const activationId = values.get("--rollback");
  const modes = [tag, activationId, flags.has("--status") ? "status" : undefined].filter(
    (value) => value !== undefined,
  );
  if (modes.length !== 1) invalid("Pass exactly one of --from-release, --rollback, or --status.");
  let mode: HostUpgradeMode;
  if (tag !== undefined) {
    if (repository === undefined || !repositoryPattern.test(repository))
      invalid("--from-release needs --repository <owner/name>.");
    mode = { kind: "release", tag, repository };
  } else if (activationId !== undefined) {
    if (!activationIdPattern.test(activationId))
      invalid(`${activationId} is not an activation id.`);
    mode = { kind: "rollback", activationId };
  } else mode = { kind: "status" };
  if (mode.kind !== "release" && repository !== undefined)
    invalid("--repository applies only to --from-release.");
  if (mode.kind === "status" && flags.has("--apply")) invalid("--status never changes anything.");
  const binDirectory = values.get("--bin-directory");
  if (binDirectory !== undefined && !isAbsolute(binDirectory))
    invalid("--bin-directory must be an absolute path.");
  return {
    mode,
    apply: flags.has("--apply"),
    json: flags.has("--json"),
    ...(binDirectory === undefined ? {} : { binDirectory }),
  };
}

async function runHostUpgrade(
  parsed: HostUpgradeArguments,
  io: CliIo,
  overrides: HostCommandOverrides,
): Promise<number> {
  const platform = overrides.platform ?? process.platform;
  if (platform === "win32")
    throw new CommandFailure(
      "host_upgrade_platform_unsupported",
      "lervo host upgrade supports macOS and Linux hosts.",
    );
  const layout = hostUpgradeLayout({
    homeDirectory: overrides.homeDirectory,
    platform,
    binDirectory: parsed.binDirectory,
  });
  const dependencies: HostUpgradeDependencies = {
    layout,
    installer: overrides.installer ?? pnpmInstaller,
    probes: overrides.probes ?? installedCliProbes,
    now: overrides.now ?? (() => new Date()),
    newActivationId: overrides.newActivationId ?? newHostActivationId,
    readCliPointer: () => readCurrentCliInstall(overrides.homeDirectory, platform),
  };
  const write = (operation: string, result: object, text: string) =>
    io.stdout(
      parsed.json
        ? `${JSON.stringify({ schemaVersion: 1, operation, ...result }, null, 2)}\n`
        : text,
    );
  const { mode } = parsed;
  if (mode.kind === "status") {
    const status = await hostUpgradeStatus(layout);
    write("host_upgrade_status", status, formatHostUpgradeStatus(status));
  } else if (mode.kind === "rollback") {
    const result = await rollbackActivation(mode.activationId, parsed.apply, dependencies);
    write("host_upgrade_rollback", result, formatHostRollbackResult(result));
  } else {
    const source = (overrides.createSource ?? createGhReleaseSource)(mode.repository);
    if (parsed.apply) {
      const result = await applyReleaseUpgrade(source, mode.tag, dependencies);
      write("host_upgrade", result, formatHostUpgradeResult(result));
    } else {
      const plan = await planReleaseUpgrade(source, mode.tag, {
        layout,
        pathEnvironment: overrides.pathEnvironment ?? process.env.PATH,
      });
      write("host_upgrade_plan", plan, formatHostReleasePlan(plan));
    }
  }
  return 0;
}

/** `lervo host upgrade`: install a verified published release on this host (ADR-0571). */
export async function runHostCommand(
  args: string[],
  io: CliIo,
  overrides: HostCommandOverrides = {},
): Promise<number> {
  const json = args.includes("--json");
  try {
    if (args[0] !== "upgrade") invalid(`Usage:\n${hostUsage}`);
    return await runHostUpgrade(parseHostUpgradeArguments(args.slice(1)), io, overrides);
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}
