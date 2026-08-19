import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { VerificationCommand, VerificationSuite } from "@lervo/schemas";

export const REPOSITORY_REVISION = `sha256:${"a".repeat(64)}`;
export const temporaryRoots: string[] = [];

export async function temporaryRepository(): Promise<{
  root: string;
  artifacts: FileSystemCas;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-verification-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
  const artifacts = await FileSystemCas.open(resolve(root, ".cas"));
  return { root, artifacts };
}

export async function removeTemporaryRepositories(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export function command(
  commandId: string,
  source: string,
  overrides: Partial<VerificationCommand> = {},
): VerificationCommand {
  return {
    commandId,
    executable: "node",
    arguments: ["-e", source],
    cwd: ".",
    timeoutMs: 5_000,
    maxOutputBytes: 1024 * 1024,
    environmentVariableNames: [],
    ...overrides,
  };
}

export function suite(commands: VerificationCommand[]): VerificationSuite {
  return {
    schemaVersion: 1,
    suiteId: "project.check",
    stopOnFailure: true,
    commands,
  };
}

export async function stableRepositoryRevision(): Promise<string> {
  return REPOSITORY_REVISION;
}
