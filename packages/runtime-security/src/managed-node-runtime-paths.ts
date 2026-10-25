import { homedir } from "node:os";
import { resolve } from "node:path";

/** Shared by runtime activation and physical process bindings on every supported host. */
export function nodeRuntimesDirectory(
  homeDirectory: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const home = resolve(homeDirectory);
  return platform === "darwin"
    ? resolve(home, "Library", "Application Support", "Lervo", "runtimes", "node")
    : resolve(home, ".local", "share", "lervo", "runtimes", "node");
}
