import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseNodeServiceCoordinates } from "./node-service-coordinates.js";
import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";
import { runtimeReferences } from "./node-runtime-reference-text.js";
const MAXIMUM_REFERENCES = 1024;

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
      if (
        !entry.name.includes("lervo") ||
        (!entry.name.endsWith(".service") && !entry.name.endsWith(".plist"))
      )
        continue;
      const text = await readRuntimeReferenceText(resolve(directory, entry.name));
      if (text === null) continue;
      for (const name of runtimeReferences(text, root, platform)) protectedNames.add(name);
      const config = parseNodeServiceCoordinates(
        platform === "darwin" ? "launchd" : "systemd",
        text,
      )?.config;
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
