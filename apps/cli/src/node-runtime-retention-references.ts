import type { ProcessObservation } from "@lervo/node-runtime";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";
import { runtimeReferences } from "./node-runtime-reference-text.js";
import { rollbackPins } from "./node-runtime-rollback-pins.js";
import { collectRuntimeProcessBindings } from "./node-runtime-process-references.js";
import { collectRuntimeServiceReferences } from "./node-runtime-service-references.js";
const execute = promisify(execFile);

/** Observe all user services and their configs, including stopped services and resident launchers. */
export async function protectedRuntimeReferences(input: {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  processCommands?: () => Promise<string>;
  observeProcess?: (pid: number) => ProcessObservation;
}): Promise<Set<string>> {
  const home = input.homeDirectory ?? homedir();
  const platform = input.platform ?? process.platform;
  const root = nodeRuntimesDirectory(home, platform);
  if (platform !== "darwin" && platform !== "linux")
    throw new Error("Runtime process inspection is unavailable.");
  const commands = await (
    input.processCommands ??
    (async () =>
      (
        await execute("/bin/ps", ["-axww", "-o", "pid=,command="], {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 5000,
        })
      ).stdout)
  )();
  const protectedNames = new Set(runtimeReferences(commands, root, platform));
  await collectRuntimeProcessBindings(
    root,
    commands,
    protectedNames,
    platform,
    input.observeProcess,
  );
  for (const names of Object.values(await rollbackPins(home, platform)))
    for (const name of names) protectedNames.add(name);
  await collectRuntimeServiceReferences(home, platform, root, protectedNames);
  return protectedNames;
}
