import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { cliInstallsDirectory } from "./cli-install-pointer.js";

/** The executables a host upgrade activates, by link name and package-relative target. */
export const HOST_CLI_LINKS = [
  { name: "lervo", target: "dist/bin.js" },
  { name: "lervo-node", target: "dist/node-runtime.js" },
] as const;

/**
 * ADR-0571: where one host keeps the release files it verified, the side-by-side installs it made
 * from them, and the activation journal. Everything lives beside ADR-0488's `current` CLI pointer;
 * the executable links live in the user's bin directory, `~/.local/bin` by default on every host.
 */
export interface HostUpgradeLayout {
  cliDirectory: string;
  downloadsDirectory: string;
  installsDirectory: string;
  journalPath: string;
  lockPath: string;
  binDirectory: string;
  /** ADR-0575 follower files: its state, the owner's pause or pin, its lock, and its runtime. */
  follow: {
    statePath: string;
    controlPath: string;
    lockPath: string;
    /** A link to the package root the follower service runs; the service definition names it. */
    runtimePointer: string;
    configPath: string;
  };
}

export function hostUpgradeLayout(input: {
  homeDirectory?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  binDirectory?: string | undefined;
}): HostUpgradeLayout {
  const home = input.homeDirectory ?? homedir();
  const cliDirectory = cliInstallsDirectory(home, input.platform ?? process.platform);
  if (input.binDirectory !== undefined && !isAbsolute(input.binDirectory))
    throw new Error("The bin directory must be an absolute path.");
  return {
    cliDirectory,
    downloadsDirectory: resolve(cliDirectory, "downloads"),
    installsDirectory: resolve(cliDirectory, "installs"),
    journalPath: resolve(cliDirectory, "host-activations.json"),
    lockPath: resolve(cliDirectory, "host-upgrade.lock"),
    binDirectory: input.binDirectory ?? resolve(home, ".local", "bin"),
    follow: {
      statePath: resolve(cliDirectory, "host-follow.json"),
      controlPath: resolve(cliDirectory, "host-follow-control.json"),
      lockPath: resolve(cliDirectory, "host-follow.lock"),
      runtimePointer: resolve(cliDirectory, "host-follow-runtime"),
      configPath: resolve(cliDirectory, "host-follow-service.json"),
    },
  };
}

/** One release's directory name: the tag or version and the first 12 hex digits of its commit. */
export function releaseDirectoryName(prefix: string, commit: string): string {
  return `${prefix}-${commit.slice(0, 12)}`;
}
