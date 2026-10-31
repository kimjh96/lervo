import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";
import { runProviderCliCommand, type ProviderCliCommandResult } from "./provider-cli-command.js";
import { executableRealPath } from "./provider-cli-identity.js";
import { providerCliBins } from "./provider-cli-locations.js";
export { executableRealPath, identifyProviderCli } from "./provider-cli-identity.js";
export type { BackgroundProvider, ProviderCliIdentity } from "./provider-cli-identity.js";
import type { BackgroundProvider } from "./provider-cli-identity.js";

export interface ProviderCliDetectionPorts {
  home: string;
  shell: string;
  prefixes?: readonly string[];
  command(
    executable: string,
    args: string[],
    timeoutMs: number,
    environment?: NodeJS.ProcessEnv,
  ): Promise<ProviderCliCommandResult>;
}
export function defaultProviderCliDetectionPorts(): ProviderCliDetectionPorts {
  let account: { homedir?: string; shell?: string | null } = {};
  try {
    account = userInfo();
  } catch {
    /* System directories remain available without an account entry. */
  }
  return {
    home: process.env.HOME?.trim() || account.homedir || homedir() || "/",
    shell: process.env.SHELL?.trim() || account.shell || "/bin/sh",
    command: runProviderCliCommand,
  };
}

// Names are positional parameters. Shell startup customizations cannot substitute an alias or function.
export const PROVIDER_CLI_LOOKUP =
  'unalias -a 2>/dev/null; for name do unset -f "$name" 2>/dev/null; done; printf "\\0%s\\0" "$PATH"; for name do command -v "$name" || :; done';

export async function detectProviderCliPaths(ports: ProviderCliDetectionPorts): Promise<{
  paths: Record<BackgroundProvider, string[]>;
  environment: NodeJS.ProcessEnv;
  failure: "login_shell_failed" | "login_shell_timed_out" | null;
}> {
  const paths: Record<BackgroundProvider, string[]> = { codex: [], claude: [] };
  const bins = await providerCliBins(ports.home, ports.prefixes);
  const environment = {
    HOME: ports.home,
    SHELL: ports.shell,
    PATH: bins.join(":") + ":/usr/bin:/bin",
  };
  const shell = await executableRealPath(ports.shell);
  const lookup =
    shell === null
      ? { status: "failed" as const, stdout: "" }
      : await ports.command(
          shell,
          ["-lc", PROVIDER_CLI_LOOKUP, "lervo-provider-lookup", "codex", "claude"],
          3_000,
          environment,
        );
  const fields = lookup.stdout.split("\0");
  const loginPath = fields.at(-2);
  const valid =
    lookup.status === "completed" &&
    fields.length >= 3 &&
    loginPath !== undefined &&
    loginPath.length > 0 &&
    loginPath.length <= 8192 &&
    !/[\x00-\x1f\x7f]/u.test(loginPath);
  const failure = valid
    ? null
    : lookup.status === "timed_out"
      ? "login_shell_timed_out"
      : "login_shell_failed";
  if (valid) {
    environment.PATH = loginPath;
    for (const line of fields.at(-1)!.split(/\r?\n/u)) {
      if ((await executableRealPath(line)) === null) continue;
      const name = line.split("/").at(-1);
      if (name === "codex" || name === "claude") paths[name].push(line);
    }
  }
  for (const provider of ["codex", "claude"] as const)
    for (const directory of bins) paths[provider].push(resolve(directory, provider));
  return {
    paths: {
      codex: [...new Set(paths.codex)].slice(0, 16),
      claude: [...new Set(paths.claude)].slice(0, 16),
    },
    environment,
    failure,
  };
}
