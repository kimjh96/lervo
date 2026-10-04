import { isSensitivePayloadKey } from "./redaction.js";

/** The default bound for a diagnostic digest kept in local logs and receipts. */
export const MAXIMUM_DIAGNOSTIC_TEXT_LENGTH = 512;

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu;
const URL_USER_INFO = /\b([a-z][a-z0-9+.-]{1,31}:\/\/)[^\s/@]+@/giu;
const AUTHORIZATION_SCHEME = /\b(bearer|basic|token)(\s+)[A-Za-z0-9._~+/=-]{8,}/giu;
const KEY_VALUE = /\b([A-Za-z][A-Za-z0-9_.-]{1,63})(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/gu;
const KNOWN_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/gu;
const OPAQUE_RUN = /[A-Za-z0-9+/_-]{40,}={0,2}/gu;
const GIT_OBJECT_OR_DIGEST = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
/** Diagnostic text must not carry terminal controls. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

/**
 * Redacts credential-shaped substrings from bounded diagnostic text such as Git or SSH stderr.
 * The result is one line of at most `maximumLength` characters. It is meant for local logs and
 * receipts only; canonical events never carry diagnostic text.
 */
export function redactDiagnosticText(
  value: string,
  maximumLength = MAXIMUM_DIAGNOSTIC_TEXT_LENGTH,
): string {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 16) {
    throw new RangeError("The diagnostic text bound must be an integer of at least 16.");
  }
  const redacted = value
    .replace(PRIVATE_KEY_BLOCK, "[redacted:private_key]")
    .replace(URL_USER_INFO, "$1[redacted]@")
    .replace(AUTHORIZATION_SCHEME, "$1$2[redacted]")
    .replace(KEY_VALUE, (match: string, key: string, separator: string) =>
      isSensitivePayloadKey(key) ? `${key}${separator}[redacted]` : match,
    )
    .replace(KNOWN_TOKEN, "[redacted:token]")
    .replace(OPAQUE_RUN, (match) =>
      GIT_OBJECT_OR_DIGEST.test(match) ? match : "[redacted:opaque]",
    )
    .replace(CONTROL, " ")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" | ");
  return redacted.length <= maximumLength ? redacted : `${redacted.slice(0, maximumLength - 1)}…`;
}
