import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const MAX_CHANGED_PATHS = 4096;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

function parseNullTerminatedPaths(output) {
  if (output.length === 0) return [];
  return output.split("\0").filter((path) => path.length > 0);
}

async function gitPaths(repositoryRoot, arguments_) {
  const result = await execFile("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return parseNullTerminatedPaths(result.stdout);
}

export async function collectChangedRepositoryPaths(repositoryRoot) {
  let trackedPaths;
  let untrackedPaths;
  try {
    [trackedPaths, untrackedPaths] = await Promise.all([
      gitPaths(repositoryRoot, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
      gitPaths(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
  } catch (error) {
    throw new Error("Changed repository paths could not be observed from Git.", { cause: error });
  }

  const paths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  if (paths.length > MAX_CHANGED_PATHS)
    throw new Error(`Changed repository path count exceeds ${MAX_CHANGED_PATHS}.`);
  return paths;
}
