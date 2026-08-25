import { createRequire } from "node:module";

import type { CliIo } from "./types.js";

const require = createRequire(import.meta.url);
const semanticVersionPattern = /^\d+\.\d+\.\d+$/;

export function readCliPackageVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  if (typeof manifest.version !== "string" || !semanticVersionPattern.test(manifest.version)) {
    throw new Error("invalid CLI package version");
  }
  return manifest.version;
}

export const versionUsage = "  lervo --version";

export function runVersionCommand(args: string[], io: CliIo): number {
  if (args.length > 0) {
    io.stderr("--version does not accept additional arguments.\n");
    return 1;
  }

  try {
    io.stdout(`lervo ${readCliPackageVersion()}\n`);
    return 0;
  } catch {
    io.stderr("Could not determine the Lervo CLI version. (cli_version_unavailable)\n");
    return 1;
  }
}
