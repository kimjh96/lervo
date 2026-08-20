import {
  validateSchema,
  type DeliberationArtifactRecordedEventPayload,
  type EventType,
  type KnowledgeCandidateCreatedEventPayload,
  type KnowledgeCandidateReviewedEventPayload,
  type KnowledgeStaleDetectedEventPayload,
  type KnowledgeVerifiedEventPayload,
  type RunCompletedEventPayload,
  type SchemaName,
  type VerificationCompletedEventPayload,
} from "@lervo/schemas";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const eventPayloadAllowlists = {
  "run.requested": ["requestDigest", "role", "risk"],
  "run.resolved": ["role", "risk", "policyVersion"],
  "run.completed": ["resultDigest", "artifactIds", "verificationStatus"],
  "run.failed": ["failureCode", "retryable", "diagnosticDigest"],
  "context.recommended": [
    "recommendationId",
    "batchId",
    "sourceAttemptId",
    "engineId",
    "engineVersion",
    "indexId",
    "resultSetHash",
    "documentId",
    "sourceContentHash",
    "rank",
    "score",
    "selectionPolicyId",
    "selectionPolicyVersion",
    "selectionMaximum"
  ],
  "context.selected": ["documentId", "reasonCode", "ruleId", "required", "scope"],
  "document.loaded": [
    "evidenceReceiptId",
    "documentId",
    "contentHash",
    "byteCount",
    "scope",
    "sourceRevision"
  ],
  "context.injected": [
    "receiptId",
    "evidenceReceiptIds",
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
  "verification.started": ["suiteId", "suiteHash", "repositoryRevision"],
  "verification.completed": [
    "verificationId",
    "suiteId",
    "suiteHash",
    "repositoryRevision",
    "status",
    "resultArtifactId",
    "resultContentHash",
    "nonPassedCommandIds"
  ],
  "deliberation.started": [
    "deliberationId",
    "policyId",
    "policyHash",
    "participantRoleIds",
    "maxRounds"
  ],
  "deliberation.artifact.recorded": [
    "deliberationId",
    "deliberationArtifactId",
    "kind",
    "round",
    "producerRoleId",
    "artifactId",
    "contentHash",
    "writingPermitId"
  ],
  "deliberation.completed": [
    "deliberationId",
    "outcomeId",
    "status",
    "lastRound",
    "decisionArtifactId",
    "unresolvedBlockingObjectionIds",
    "failurePhase",
    "failureCode"
  ],
  "knowledge.candidate.created": [
    "candidateId",
    "claimDigest",
    "paths",
    "evidenceIds",
    "sourceOutcomeId",
    "decisionArtifactId",
    "verificationArtifactIds",
    "verifiedRevision",
    "candidateArtifactId",
    "candidateContentHash"
  ],
  "knowledge.candidate.reviewed": [
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalArtifactId",
    "approvalContentHash",
    "decision",
    "policyId",
    "policyVersion",
    "repositoryRevision",
    "resolvedConflictCandidateIds"
  ],
  "knowledge.verified": [
    "knowledgeId",
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalContentHash",
    "claimDigest",
    "paths",
    "verifiedRevision",
    "knowledgeArtifactId",
    "knowledgeContentHash"
  ],
  "knowledge.stale.detected": [
    "knowledgeId",
    "resultId",
    "verifiedRevision",
    "currentRevision",
    "reasons",
    "changedPaths",
    "missingPaths",
    "resultArtifactId",
    "resultContentHash"
  ],
  "document.stale.detected": ["documentId", "reason", "verifiedRevision", "currentRevision"],
  "document.migration.applied": [
    "migrationKind",
    "planId",
    "approvalId",
    "approvalDigest",
    "beforeLayoutHash",
    "afterLayoutHash",
    "sourceHashes",
    "candidateArtifactHashes",
    "sourceRegistryHash",
    "entryArtifactHashes",
    "archiveContentHash",
    "sidecars",
    "appliedAt"
  ],
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
  | "invalid_payload"
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

  const schemaName = eventPayloadSchemas[type];
  const invalidSchema = schemaName !== undefined && !validateSchema(schemaName, sanitized).valid;
  const invalidArtifactCoordinate = !invalidSchema && type === "deliberation.artifact.recorded" &&
    !deliberationArtifactCoordinateMatches(
      sanitized as unknown as DeliberationArtifactRecordedEventPayload,
    );
  const invalidCandidateCoordinate = !invalidSchema && type === "knowledge.candidate.created" &&
    !knowledgeCandidateCoordinateMatches(
      sanitized as unknown as KnowledgeCandidateCreatedEventPayload,
    );
  const invalidKnowledgeCoordinate = !invalidSchema && (
    (type === "knowledge.candidate.reviewed" && !reviewCoordinateMatches(
      sanitized as unknown as KnowledgeCandidateReviewedEventPayload,
    )) ||
    (type === "knowledge.verified" && !verifiedCoordinateMatches(
      sanitized as unknown as KnowledgeVerifiedEventPayload,
    )) ||
    (type === "knowledge.stale.detected" && !staleCoordinateMatches(
      sanitized as unknown as KnowledgeStaleDetectedEventPayload,
    ))
  );
  const invalidVerificationCoordinate = !invalidSchema &&
    type === "verification.completed" && !verificationCoordinateMatches(
      sanitized as unknown as VerificationCompletedEventPayload,
    );
  const invalidRunCompletedCoordinate = !invalidSchema &&
    type === "run.completed" && !runCompletedCoordinateMatches(
      sanitized as unknown as RunCompletedEventPayload,
    );
  if (
    invalidSchema || invalidArtifactCoordinate || invalidCandidateCoordinate ||
    invalidKnowledgeCoordinate || invalidVerificationCoordinate ||
    invalidRunCompletedCoordinate
  ) {
    throw new RedactionError(
      "invalid_payload",
      "$",
      `${type} payload가 필수 좌표와 상태 계약을 충족하지 않습니다.`,
    );
  }

  return { payload: sanitized, redactions };
}

const eventPayloadSchemas: Partial<Record<EventType, SchemaName>> = {
  "context.recommended": "contextRecommendationEventPayload",
  "run.completed": "runCompletedEventPayload",
  "deliberation.started": "deliberationStartedEventPayload",
  "deliberation.artifact.recorded": "deliberationArtifactRecordedEventPayload",
  "deliberation.completed": "deliberationCompletedEventPayload",
  "knowledge.candidate.created": "knowledgeCandidateCreatedEventPayload",
  "knowledge.candidate.reviewed": "knowledgeCandidateReviewedEventPayload",
  "knowledge.verified": "knowledgeVerifiedEventPayload",
  "knowledge.stale.detected": "knowledgeStaleDetectedEventPayload",
  "verification.started": "verificationStartedEventPayload",
  "verification.completed": "verificationCompletedEventPayload",
};

function deliberationArtifactCoordinateMatches(
  payload: DeliberationArtifactRecordedEventPayload,
): boolean {
  return payload.artifactId === `art_${payload.contentHash.slice("sha256:".length)}`;
}

function knowledgeCandidateCoordinateMatches(
  payload: KnowledgeCandidateCreatedEventPayload,
): boolean {
  return payload.candidateArtifactId ===
    `art_${payload.candidateContentHash.slice("sha256:".length)}`;
}

function reviewCoordinateMatches(payload: KnowledgeCandidateReviewedEventPayload): boolean {
  return payload.approvalArtifactId ===
    `art_${payload.approvalContentHash.slice("sha256:".length)}`;
}

function verifiedCoordinateMatches(payload: KnowledgeVerifiedEventPayload): boolean {
  return payload.knowledgeArtifactId ===
    `art_${payload.knowledgeContentHash.slice("sha256:".length)}`;
}

function staleCoordinateMatches(payload: KnowledgeStaleDetectedEventPayload): boolean {
  return payload.resultArtifactId ===
    `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function verificationCoordinateMatches(payload: VerificationCompletedEventPayload): boolean {
  return payload.resultArtifactId ===
    `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function runCompletedCoordinateMatches(payload: RunCompletedEventPayload): boolean {
  const resultArtifactId = `art_${payload.resultDigest.slice("sha256:".length)}`;
  return payload.artifactIds.includes(resultArtifactId) &&
    (payload.verificationStatus === "not_run"
      ? payload.artifactIds.length === 1
      : payload.artifactIds.length >= 2);
}
