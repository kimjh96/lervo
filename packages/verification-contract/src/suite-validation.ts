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
  return path.length > 0 && !isAbsolute(path) && !path.includes("\\") &&
    !path.endsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
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
