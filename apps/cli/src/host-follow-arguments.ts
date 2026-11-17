import { isAbsolute } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import { releaseTagVersion } from "./host-follow-policy.js";
import { isRepositoryCoordinate } from "./host-release-source.js";

export const hostFollowUsage = `  lervo host upgrade --follow [--apply [--once]] [--repository <owner/name>] [--bin-directory <path>] [--json]
  lervo host upgrade --follow --pause | --resume | --pin <tag> [--json]
  lervo host upgrade --follow --status [--json]
  lervo host upgrade --follow --service <install|remove> [--apply] [--repository <owner/name>] [--json]`;

export type HostFollowMode =
  | { kind: "run"; once: boolean }
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "pin"; tag: string }
  | { kind: "service"; operation: "install" | "remove" };

export interface HostFollowArguments {
  mode: HostFollowMode;
  apply: boolean;
  json: boolean;
  repository?: string;
  binDirectory?: string;
  /** The service's configuration file; set only by the rendered service definition. */
  config?: string;
}

function invalid(message: string): never {
  throw new CommandFailure("host_upgrade_arguments_invalid", message);
}

const flagNames = ["--follow", "--apply", "--once", "--json", "--status", "--pause", "--resume"];
const valueNames = ["--pin", "--service", "--repository", "--bin-directory", "--config"];

/** Parses the arguments after `host upgrade`, which include `--follow`. */
export function parseHostFollowArguments(args: readonly string[]): HostFollowArguments {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (flagNames.includes(argument)) flags.add(argument);
    else if (valueNames.includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) invalid(`${argument} needs a value.`);
      values.set(argument, value);
      index += 1;
    } else invalid(`Unknown follow argument: ${argument}`);
  }
  const pin = values.get("--pin");
  const service = values.get("--service");
  const selected = [
    flags.has("--status") ? "--status" : null,
    flags.has("--pause") ? "--pause" : null,
    flags.has("--resume") ? "--resume" : null,
    pin === undefined ? null : "--pin",
    service === undefined ? null : "--service",
  ].filter((value) => value !== null);
  if (selected.length > 1) invalid(`Pass at most one of ${selected.join(", ")}.`);
  let mode: HostFollowMode;
  if (pin !== undefined) {
    if (releaseTagVersion(pin) === null) invalid(`${pin} is not a v<major>.<minor>.<patch> tag.`);
    mode = { kind: "pin", tag: pin };
  } else if (service !== undefined) {
    if (service !== "install" && service !== "remove")
      invalid("--service takes install or remove.");
    mode = { kind: "service", operation: service };
  } else if (flags.has("--status")) mode = { kind: "status" };
  else if (flags.has("--pause")) mode = { kind: "pause" };
  else if (flags.has("--resume")) mode = { kind: "resume" };
  else mode = { kind: "run", once: flags.has("--once") };

  const repository = values.get("--repository");
  const binDirectory = values.get("--bin-directory");
  const config = values.get("--config");
  const control = ["pause", "resume", "pin"].includes(mode.kind);
  if (flags.has("--once") && mode.kind !== "run") invalid("--once applies only to following.");
  if (flags.has("--once") && !flags.has("--apply"))
    invalid("--once needs --apply; without it the command already plans one cycle.");
  if (flags.has("--apply") && (control || mode.kind === "status"))
    invalid(`--apply does not apply to --${mode.kind}; it takes effect at once.`);
  if (control && (repository !== undefined || binDirectory !== undefined))
    invalid("--pause, --resume, and --pin take no other option.");
  if (config !== undefined && (mode.kind !== "run" || !flags.has("--apply")))
    invalid("--config is passed only by the follower service.");
  if (config !== undefined && (repository !== undefined || binDirectory !== undefined))
    invalid("--config already names the repository and the bin directory.");
  if (mode.kind === "service" && mode.operation === "remove" && repository !== undefined)
    invalid("--repository does not apply to removing the service.");
  if (repository !== undefined && !isRepositoryCoordinate(repository))
    invalid(`${repository} is not an <owner/name> repository coordinate.`);
  for (const [name, path] of [
    ["--bin-directory", binDirectory],
    ["--config", config],
  ] as const)
    if (path !== undefined && !isAbsolute(path)) invalid(`${name} must be an absolute path.`);
  return {
    mode,
    apply: flags.has("--apply"),
    json: flags.has("--json"),
    ...(repository === undefined ? {} : { repository }),
    ...(binDirectory === undefined ? {} : { binDirectory }),
    ...(config === undefined ? {} : { config }),
  };
}
