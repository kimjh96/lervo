import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseServiceConfigPath } from "./node-service-coordinate-parser.js";
import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";
import { runtimeReferences } from "./node-runtime-reference-text.js";
const MAXIMUM_REFERENCES = 1024;

/** A drop-in directory systemd merges into a Lervo unit: its own, a prefix one, or `service.d`. */
function systemdDropInDirectory(name: string): boolean {
  return name === "service.d" || (name.includes("lervo") && name.endsWith(".service.d"));
}

/**
 * A drop-in can replace the command, the configuration, or PATH of a unit. Every runtime it names
 * stays protected, and one that sets `ExecStart=` or `--config` stops the plan, because the merged
 * command is no longer the definition that was read.
 */
async function collectDropInReferences(
  directory: string,
  entry: Dirent,
  root: string,
  protectedNames: Set<string>,
): Promise<void> {
  if (!entry.isDirectory())
    throw new Error("Runtime retention cannot inspect a service drop-in directory.");
  const files = await readdir(directory, { withFileTypes: true });
  if (files.length > MAXIMUM_REFERENCES)
    throw new Error("Service drop-in inventory exceeds its bound.");
  for (const file of files) {
    if (!file.name.endsWith(".conf")) continue;
    const text = await readRuntimeReferenceText(resolve(directory, file.name));
    if (text === null) continue;
    if (/^\s*ExecStart\s*=/mu.test(text) || text.includes("--config"))
      throw new Error("A service drop-in replaces the command retention reads.");
    for (const name of runtimeReferences(text, root, "linux")) protectedNames.add(name);
  }
}

export async function collectRuntimeServiceReferences(
  home: string,
  platform: NodeJS.Platform,
  root: string,
  protectedNames: Set<string>,
): Promise<void> {
  const directories =
    platform === "darwin"
      ? [resolve(home, "Library/LaunchAgents")]
      : [resolve(home, ".config/systemd/user")];
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    if (entries.length > MAXIMUM_REFERENCES)
      throw new Error("Service reference inventory exceeds its bound.");
    for (const entry of entries) {
      if (platform !== "darwin" && systemdDropInDirectory(entry.name)) {
        await collectDropInReferences(resolve(directory, entry.name), entry, root, protectedNames);
        continue;
      }
      if (
        !entry.name.includes("lervo") ||
        (!entry.name.endsWith(".service") && !entry.name.endsWith(".plist"))
      )
        continue;
      const text = await readRuntimeReferenceText(resolve(directory, entry.name));
      if (text === null) continue;
      for (const name of runtimeReferences(text, root, platform)) protectedNames.add(name);
      // ADR-0579: every rendered Lervo service, not only a Node, names its configuration last.
      // A definition that mentions --config but cannot be read this way stops the plan.
      const config = parseServiceConfigPath(platform === "darwin" ? "launchd" : "systemd", text);
      if (text.includes("--config") && !config)
        throw new Error("A service configuration cannot be resolved.");
      if (config) {
        const content = await readRuntimeReferenceText(config);
        if (content === null) throw new Error("A service configuration is unavailable.");
        for (const name of runtimeReferences(content, root, platform)) protectedNames.add(name);
      }
    }
  }
}
