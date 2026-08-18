import type { EventType } from "@roven/schemas";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const eventPayloadAllowlists = {
  "run.requested": ["requestDigest", "role", "risk"],
  "run.resolved": ["role", "risk", "policyVersion"],
  "run.completed": ["resultDigest", "artifactIds", "verificationStatus"],
  "run.failed": ["failureCode", "retryable", "diagnosticDigest"],
  "context.selected": ["documentId", "reasonCode", "ruleId", "required", "scope"],
  "document.loaded": ["documentId", "contentHash", "byteCount", "scope", "sourceRevision"],
  "context.injected": [
    "receiptId",
    "envelopeId",
    "documentIds",
    "targetTurnId",
    "contextGeneration"
  ],
  "context.invalidated": ["documentIds", "reason", "contextGeneration"],
  "context.published": [
    "sharedContextId",
    "documentId",
    "contentHash",
    "producerRoleId",
    "audienceMode",
    "allowedRoleIds",
    "expiresAt"
  ],
  "handoff.created": [
    "handoffId",
    "fromRoleId",
    "toRoleId",
    "sharedContextIds",
    "evidenceEventIds",
    "requestDigest"
  ],
  "adapter.started": [
    "adapterId",
    "adapterVersion",
    "providerSessionId",
    "executionMode",
    "capabilities"
  ],
  "adapter.stopped": ["adapterId", "providerSessionId", "status"],
  "capability.requested": ["capability", "targetDigest", "risk"],
  "capability.decided": ["capability", "decision", "policyRuleId", "approvalId"],
  "tool.called": ["toolName", "inputDigest", "status", "durationMs"],
  "command.executed": [
    "commandDigest",
    "cwdRelative",
    "status",
    "exitCode",
    "outputDigest",
    "durationMs"
  ],
  "file.changed": ["path", "beforeHash", "afterHash", "changeKind"],
  "skill.resolved": ["skillId", "source", "version", "contentHash", "trustStatus"],
  "skill.invoked": ["skillId", "version", "inputDigest", "capabilities"],
  "skill.completed": ["skillId", "version", "status", "artifactIds", "outputDigest"],
  "verification.started": ["verificationId", "commandDigest", "suite"],
  "verification.completed": [
    "verificationId",
    "status",
    "exitCode",
    "outputDigest",
    "artifactId"
  ],
  "knowledge.candidate.created": ["candidateId", "claimDigest", "paths", "evidenceIds"],
  "document.stale.detected": ["documentId", "reason", "verifiedRevision", "currentRevision"],
  "unmanaged_change.detected": ["paths", "beforeRevision", "afterRevision", "detectedAt"],
  "sync.acknowledged": ["eventIds", "hubId", "acknowledgedAt"],
} as const satisfies Record<EventType, readonly string[]>;

const sensitiveFragments = [
  "authorization",
  "cookie",
  "credential",
  "documentbody",
  "password",
  "prompt",
  "rawcontent",
  "secret",
  "token",
  "apikey",
  "toolinput",
] as const;

const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export type RedactionErrorCode =
  | "cyclic_payload"
  | "non_finite_number"
  | "unsupported_value";

export class RedactionError extends Error {
  constructor(
    readonly code: RedactionErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "RedactionError";
  }
}

export interface RedactionRecord {
  path: string;
  reason: "not_allowlisted" | "sensitive_key" | "unsafe_key";
}

export interface SanitizedPayload {
  payload: Record<string, JsonValue>;
  redactions: RedactionRecord[];
}

function normalizedKey(key: string): string {
  return key.normalize("NFKC").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitivePayloadKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

function sanitizeNested(
  value: unknown,
  path: string,
  redactions: RedactionRecord[],
  ancestors: WeakSet<object>,
): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RedactionError(
        "non_finite_number",
        path,
        `${path}에는 유한한 숫자만 저장할 수 있습니다.`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new RedactionError(
      "unsupported_value",
      path,
      `${path}의 ${typeof value} 값은 event payload에 저장할 수 없습니다.`,
    );
  }
  if (ancestors.has(value)) {
    throw new RedactionError("cyclic_payload", path, `${path}에서 순환 참조를 발견했습니다.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        sanitizeNested(item, `${path}[${index}]`, redactions, ancestors),
      );
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RedactionError(
        "unsupported_value",
        path,
        `${path}에는 일반 JSON 객체만 저장할 수 있습니다.`,
      );
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (unsafeObjectKeys.has(key)) {
        redactions.push({ path: nestedPath, reason: "unsafe_key" });
        continue;
      }
      if (isSensitivePayloadKey(key)) {
        redactions.push({ path: nestedPath, reason: "sensitive_key" });
        continue;
      }
      output[key] = sanitizeNested(nestedValue, nestedPath, redactions, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeEventPayload(
  type: EventType,
  payload: Readonly<Record<string, unknown>>,
): SanitizedPayload {
  const allowed = new Set<string>(eventPayloadAllowlists[type]);
  const sanitized: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  const redactions: RedactionRecord[] = [];
  const ancestors = new WeakSet<object>();

  for (const [key, value] of Object.entries(payload)) {
    const path = `$.${key}`;
    if (!allowed.has(key)) {
      redactions.push({ path, reason: "not_allowlisted" });
      continue;
    }
    if (unsafeObjectKeys.has(key)) {
      redactions.push({ path, reason: "unsafe_key" });
      continue;
    }
    if (isSensitivePayloadKey(key)) {
      redactions.push({ path, reason: "sensitive_key" });
      continue;
    }
    sanitized[key] = sanitizeNested(value, path, redactions, ancestors);
  }

  return { payload: sanitized, redactions };
}
