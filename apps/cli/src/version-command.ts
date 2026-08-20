import { createRequire } from "node:module";

import type { CliIo } from "./types.js";

const require = createRequire(import.meta.url);
const semanticVersionPattern = /^\d+\.\d+\.\d+$/;

function readCliPackageVersion(): string {
  const manifest = require("../package.json") as { version?: unknown };
  if (typeof manifest.version !== "string" || !semanticVersionPattern.test(manifest.version)) {
    throw new Error("invalid CLI package version");
  }
  return manifest.version;
}

export const versionUsage = "  lervo --version";

export function runVersionCommand(args: string[], io: CliIo): number {
  if (args.length > 0) {
    io.stderr("--version에는 다른 인자를 함께 사용할 수 없습니다.\n");
    return 1;
  }

  try {
    io.stdout(`lervo ${readCliPackageVersion()}\n`);
    return 0;
  } catch {
    io.stderr("Lervo CLI 버전을 확인할 수 없습니다. (cli_version_unavailable)\n");
    return 1;
  }
}
