import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { failNodeFleetApply } from "./node-fleet-apply-contract.js";

function safeAbsolute(value: string): boolean {
  return resolve(value) === value && !/[\0\r\n]/u.test(value);
}

function defaultExecutablePath(): string {
  return fileURLToPath(new URL("./node-runtime.js", import.meta.url));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function assertNodeFleetExecutable(path: string): Promise<string> {
  if (!safeAbsolute(path)) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime path is invalid.",
    );
  }
  const metadata = await lstat(path).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime is unavailable.",
      error,
    ),
  );
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime must be a real regular file.",
    );
  }
  await access(path, constants.X_OK).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime is not executable.",
      error,
    ),
  );
  return realpath(path);
}

export async function materializeInstalledNodeLauncher(homeDirectory?: string): Promise<string> {
  const source = defaultExecutablePath();
  const sourceInfo = await lstat(source).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime payload is unavailable.",
      error,
    ),
  );
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime payload is unsafe.",
    );
  }
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const home = resolve(homeDirectory ?? homedir());
  const directory =
    process.platform === "darwin"
      ? resolve(
          home,
          "Library",
          "Application Support",
          "Lervo",
          "runtimes",
          "node",
          hash.slice(0, 16),
        )
      : resolve(home, ".local", "share", "lervo", "runtimes", "node", hash.slice(0, 16));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const payload = resolve(directory, "node-runtime.js");
  const launcher = resolve(directory, `lervo-node-launcher-${hash.slice(0, 12)}`);
  const launcherContent = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(payload)} "$@"\n`;
  for (const [path, content, mode] of [
    [payload, bytes, 0o600],
    [launcher, launcherContent, 0o700],
  ] as const) {
    try {
      await writeFile(path, content, { flag: "wx", mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path);
      const expected = typeof content === "string" ? Buffer.from(content) : content;
      if (!existing.equals(expected)) {
        failNodeFleetApply(
          "node_fleet_executable_invalid",
          "An installed runtime payload path contains different bytes.",
        );
      }
    }
    await chmod(path, mode);
  }
  return assertNodeFleetExecutable(launcher);
}
