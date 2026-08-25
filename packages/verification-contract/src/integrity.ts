import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { VerificationCommand, VerificationResult, VerificationSuite } from "@lervo/schemas";

export function verificationSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function verificationSuiteHash(suite: VerificationSuite): string {
  return verificationSha256(canonicalJson(suite));
}

export function verificationCommandDigest(command: VerificationCommand): string {
  return verificationSha256(canonicalJson(command));
}

export function calculateVerificationId(
  result: Omit<VerificationResult, "verificationId"> | VerificationResult,
): string {
  const value = result as Partial<VerificationResult> & Record<string, unknown>;
  const { verificationId: _verificationId, ...content } = value;
  return `ver_${verificationSha256(canonicalJson(content)).slice("sha256:".length, 23)}`;
}

export function verificationResultBytes(result: VerificationResult): Uint8Array {
  return Buffer.from(canonicalJson(result), "utf8");
}
