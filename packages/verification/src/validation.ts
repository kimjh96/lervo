import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { VerificationSuite } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { VerificationError } from "./types.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BARE_EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function invalidSuite(message: string): never {
  throw new VerificationError("invalid_verification_suite", message);
}

export function validateVerificationSuite(suite: VerificationSuite): void {
  if (!validateSchema("verificationSuite", suite).valid) {
    invalidSuite("Verification suite가 schema를 통과하지 못했습니다.");
  }
  const commandIds = new Set<string>();
  for (const command of suite.commands) {
    if (commandIds.has(command.commandId)) {
      invalidSuite("Verification suite에 중복된 command ID가 있습니다.");
    }
    commandIds.add(command.commandId);
    if (
      command.executable.includes("\0") || command.arguments.some((item) => item.includes("\0")) ||
      !(BARE_EXECUTABLE.test(command.executable) ||
        (command.executable.startsWith("./") && isSafeRelativePath(command.executable.slice(2))))
    ) {
      invalidSuite("Verification executable 또는 argument가 안전한 실행 계약에 맞지 않습니다.");
    }
    if (!isSafeRelativePath(command.cwd)) {
      invalidSuite("Verification command cwd가 안전한 저장소 상대 경로가 아닙니다.");
    }
  }
}

export function validateRepositoryRevision(revision: string): void {
  if (!SHA256.test(revision)) {
    throw new VerificationError(
      "invalid_verification_request",
      "Verification repository revision은 SHA-256 snapshot이어야 합니다.",
    );
  }
}

function isSafeRelativePath(path: string): boolean {
  if (path === ".") return true;
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    !path.endsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

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
