import { createProcessObserver, type ProcessObservation } from "@lervo/node-runtime";
import { readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRuntimeProcessBinding } from "./node-runtime-process-binding.js";
import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";

export async function collectRuntimeProcessBindings(
  root: string,
  commands: string,
  protectedNames: Set<string>,
  platform: NodeJS.Platform = process.platform,
  observeProcess: (pid: number) => ProcessObservation = createProcessObserver(),
): Promise<void> {
  const boundProcesses = new Set<number>();
  const runtimes = await readdir(root, { withFileTypes: true });
  if (runtimes.length > 4096) throw new Error("Runtime process inventory exceeds its bound.");
  for (const runtime of runtimes) {
    if (!runtime.isDirectory() || !/^[a-f0-9]{16}$/u.test(runtime.name)) continue;
    const bindings = resolve(root, runtime.name, ".processes");
    const info = await lstat(bindings).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info === null) continue;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Unsafe runtime process binding directory.");
    const entries = await readdir(bindings).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (entries.length > 256)
      throw new Error("Runtime process binding inventory exceeds its bound.");
    for (const entry of entries) {
      if (!/^[1-9][0-9]*\.json$/u.test(entry)) throw new Error("Invalid runtime process binding.");
      const pid = Number(entry.slice(0, -5));
      const binding = parseRuntimeProcessBinding(
        (await readRuntimeReferenceText(resolve(bindings, entry))) ?? "null",
        runtime.name,
        pid,
      );
      const observed = observeProcess(pid);
      if (observed.status === "absent") continue;
      if (
        observed.status === "present" &&
        binding.processIdentity !== undefined &&
        observed.identity.split(":", 1)[0] === binding.processIdentity.split(":", 1)[0] &&
        observed.identity !== binding.processIdentity
      )
        continue;
      protectedNames.add(runtime.name);
      if (observed.status === "present" && observed.identity === binding.processIdentity)
        boundProcesses.add(pid);
    }
  }
  for (const line of commands.split("\n")) {
    const observed = platform === "darwin" ? line.toLowerCase() : line;
    const comparedRoot = platform === "darwin" ? root.toLowerCase() : root;
    if (!observed.includes(`${comparedRoot}/current/`)) continue;
    const pid = Number(/^\s*([0-9]+)\s/u.exec(line)?.[1]);
    if (!boundProcesses.has(pid))
      throw new Error("A process using current has no physical runtime binding.");
  }
}
