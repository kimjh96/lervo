import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";

export type ServiceProvider = "codex" | "claude";

export interface ServiceToolDirectories {
  /** Directories, in tool order, to place in the service PATH. */
  directories: string[];
  /** Required tools that no directory of the search path provides. */
  missing: string[];
  /** Optional tools that are absent; the feature they serve reports itself unavailable. */
  missingOptional: string[];
}

async function executable(path: string): Promise<boolean> {
  try {
    // Provider installs are usually symbolic links; the directory, not the target, is recorded.
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * ADR-0470: resolves the executables a resident service runs — each provider its checkouts use,
 * `git`, and optionally `gh` for publication — against the planning shell's `PATH`. A service
 * manager starts services without a login shell, so these directories are rendered into the
 * service definition and bound by its hash; a missing required tool is a planning blocker.
 */
export async function resolveServiceToolDirectories(input: {
  providers: readonly ServiceProvider[];
  searchPath: string | undefined;
  isExecutable?: (path: string) => Promise<boolean>;
}): Promise<ServiceToolDirectories> {
  const isExecutable = input.isExecutable ?? executable;
  const search = (input.searchPath ?? "")
    .split(delimiter)
    .filter((entry) => isAbsolute(entry) && resolve(entry) === entry && !entry.includes(":"));
  const required = [...new Set(input.providers)].sort();
  const result: ServiceToolDirectories = { directories: [], missing: [], missingOptional: [] };
  for (const [name, optional] of [
    ...required.map((name) => [name, false] as const),
    ["git", false] as const,
    ["gh", true] as const,
  ]) {
    let found: string | null = null;
    for (const directory of search)
      if (await isExecutable(resolve(directory, name))) {
        found = directory;
        break;
      }
    if (found === null) (optional ? result.missingOptional : result.missing).push(name);
    else if (!result.directories.includes(found)) result.directories.push(found);
  }
  return result;
}
