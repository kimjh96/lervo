import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { VerificationSuite } from "@lervo/schemas";
import {
  validateRepositoryRevision,
  validateVerificationSuite,
  VerificationError,
} from "@lervo/verification-contract";

export { validateRepositoryRevision, validateVerificationSuite };

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

export async function resolveVerificationWorkingDirectories(
  repositoryRoot: string,
  suite: VerificationSuite,
): Promise<ReadonlyMap<string, string>> {
  const root = resolve(repositoryRoot);
  let realRoot: string;
  try {
    const rootStats = await lstat(root);
    realRoot = await realpath(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new Error("unsafe root");
    }
  } catch (error) {
    throw new VerificationError(
      "command_working_directory_invalid",
      "Verification repository root가 안전한 실제 디렉터리가 아닙니다.",
      { cause: error },
    );
  }
  const directories = new Map<string, string>();
  for (const command of suite.commands) {
    const target = resolve(root, command.cwd);
    const expectedRealTarget = resolve(realRoot, command.cwd);
    try {
      const stats = await lstat(target);
      const realTarget = await realpath(target);
      if (
        !isWithin(root, target) || !stats.isDirectory() || stats.isSymbolicLink() ||
        realTarget !== expectedRealTarget
      ) {
        throw new Error("unsafe cwd");
      }
    } catch (error) {
      throw new VerificationError(
        "command_working_directory_invalid",
        `Verification command ${command.commandId}의 cwd가 안전한 실제 디렉터리가 아닙니다.`,
        { cause: error },
      );
    }
    directories.set(command.commandId, expectedRealTarget);
  }
  return directories;
}
