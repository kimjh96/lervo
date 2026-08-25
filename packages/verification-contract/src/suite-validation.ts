import { isAbsolute } from "node:path";

import { validateSchema, type VerificationSuite } from "@lervo/schemas";

import { VerificationError } from "./types.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const BARE_EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function invalidSuite(message: string): never {
  throw new VerificationError("invalid_verification_suite", message);
}

function isSafeRelativePath(path: string): boolean {
  if (path === ".") return true;
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.endsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function validateVerificationSuite(suite: VerificationSuite): void {
  if (!validateSchema("verificationSuite", suite).valid) {
    invalidSuite("The verification suite does not satisfy its schema.");
  }
  const commandIds = new Set<string>();
  for (const command of suite.commands) {
    if (commandIds.has(command.commandId)) {
      invalidSuite("The verification suite contains a duplicate command ID.");
    }
    commandIds.add(command.commandId);
    if (
      command.executable.includes("\0") ||
      command.arguments.some((item) => item.includes("\0")) ||
      !(
        BARE_EXECUTABLE.test(command.executable) ||
        (command.executable.startsWith("./") && isSafeRelativePath(command.executable.slice(2)))
      )
    ) {
      invalidSuite(
        "The verification executable or argument does not satisfy the safe execution contract.",
      );
    }
    if (!isSafeRelativePath(command.cwd)) {
      invalidSuite("The verification command cwd is not a safe repository-relative path.");
    }
  }
}

export function validateRepositoryRevision(revision: string): void {
  if (!SHA256.test(revision)) {
    throw new VerificationError(
      "invalid_verification_request",
      "The verification repository revision must be a SHA-256 snapshot.",
    );
  }
}
