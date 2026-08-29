import { valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

export const providerShadowV2CanonicalCandidateFields = [
  "documentId",
  "contentHash",
  "byteCount",
  "classes",
];
export const providerShadowV2TerminalStateKinds = [
  "attempt",
  "execution",
  "failure",
  "review",
  "observation",
  "recovery",
];
export const providerShadowSelectionViolationCodes = [
  "duplicate_e4_marker",
  "invalid_structured_selection_shape",
  "malformed_structured_selection",
  "non_standalone_or_malformed_e4_marker",
  "provider_shadow_prose_present",
  "too_many_selected_sources",
  "unknown_e4_marker",
];
const providerShadowSelectionViolationCodeSet = new Set(providerShadowSelectionViolationCodes);
const unavailableCoordinateNames = ["providerSessionId", "adapterReceiptId", "providerTurnId"];
const unavailableStages = [
  "prepared",
  "session_started",
  "context_injected",
  "turn_accepted",
  "turn_completed",
];

function coordinatePrefix(contract) {
  const prefix = contract.sourcePopulation.coordinatePrefix ?? "psv2";
  assert(
    [
      "psv2",
      "psv3",
      "psv4",
      "psv5",
      "psv6",
      "psv7",
      "psv8",
      "psv9",
      "psv10",
      "psv11",
      "psv12",
      "psv13",
      "psv14",
      "psv15",
      "psv16",
      "psv17",
      "psv18",
    ].includes(prefix),
    "The provider-shadow coordinate prefix is invalid.",
  );
  return prefix;
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertExactKeys(value, expectedKeys, name) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${name} is invalid.`,
  );
  assert(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort()),
    `${name} must contain only the canonical fields.`,
  );
}

export function validateProviderShadowSelectionViolationCodes(codes) {
  assert(Array.isArray(codes), "Selection violation codes must be an array.");
  assert(
    codes.every((code) => providerShadowSelectionViolationCodeSet.has(code)),
    "A selection violation code is invalid.",
  );
  return [...new Set(codes)].sort();
}

export function createProviderShadowV2Schedule(contract, eligibleCases) {
  const prefix = coordinatePrefix(contract);
  const schedule = eligibleCases.flatMap((item) =>
    Array.from({ length: contract.sourcePopulation.expectedRepetitionsPerCase }, (_, index) => {
      const repetition = index + (contract.sourcePopulation.repetitionStart ?? 1);
      const coordinate = `${item.caseId}_r${repetition}`;
      return {
        sampleId: `${prefix}_${coordinate}`,
        caseId: item.caseId,
        repetition,
        shadowRunId: `run_${prefix}_${coordinate}`,
        sessionId: `ses_${prefix}_${coordinate}`,
        targetTurnId: `psturn_${prefix}_${coordinate}`,
      };
    }),
  );
  assert(
    schedule.length === contract.sourcePopulation.expectedShadowSampleCount,
    "The provider-shadow source schedule has an invalid sample count.",
  );
  for (const field of ["sampleId", "shadowRunId", "sessionId", "targetTurnId"]) {
    assert(
      new Set(schedule.map((item) => item[field])).size === schedule.length,
      `${field} values must be unique.`,
    );
    assert(
      schedule.every((item) => item[field].includes(`${prefix}_`)),
      `${field} values must use fresh provider-shadow coordinates.`,
    );
  }
  return schedule;
}

export function createProviderShadowV2AttemptSchedule(contract, eligibleCases) {
  const prefix = coordinatePrefix(contract);
  const sourceSchedule = createProviderShadowV2Schedule(contract, eligibleCases);
  const configuredArms =
    contract.provider.ordering === "alternate_starting_provider_by_source_sample_claude_first"
      ? [...contract.provider.arms].reverse()
      : contract.provider.arms;
  const attempts = sourceSchedule.flatMap((source, sourceIndex) => {
    const arms = sourceIndex % 2 === 0 ? configuredArms : [...configuredArms].reverse();
    return arms.map((arm) => {
      const coordinate = `${arm.provider}_${source.caseId}_r${source.repetition}`;
      return {
        sourceSampleId: source.sampleId,
        sampleId: `${prefix}_${coordinate}`,
        caseId: source.caseId,
        repetition: source.repetition,
        provider: arm.provider,
        model: arm.model,
        shadowRunId: `run_${prefix}_${coordinate}`,
        sessionId: `ses_${prefix}_${coordinate}`,
        targetTurnId: `psturn_${prefix}_${coordinate}`,
      };
    });
  });
  assert(
    attempts.length === contract.sourcePopulation.expectedProviderObservationCount,
    "The provider-shadow v2 provider-attempt schedule is invalid.",
  );
  for (const arm of contract.provider.arms) {
    assert(
      attempts.filter((item) => item.provider === arm.provider).length ===
        arm.maximumProviderInvocations,
      `The ${arm.provider} provider-attempt count is invalid.`,
    );
  }
  for (const field of ["sampleId", "shadowRunId", "sessionId", "targetTurnId"]) {
    assert(
      new Set(attempts.map((item) => item[field])).size === attempts.length,
      `${field} values must be unique across provider arms.`,
    );
  }
  return attempts;
}

export function canonicalizeProviderShadowV2Candidate(source) {
  assert(
    typeof source.sourceId === "string" && source.sourceId.length > 0,
    "A registered sourceId is required at the preparation boundary.",
  );
  assert(
    typeof source.contentHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(source.contentHash),
    "A candidate content hash is invalid.",
  );
  assert(
    Number.isSafeInteger(source.byteCount) && source.byteCount >= 0,
    "A candidate byte count is invalid.",
  );
  assert(
    Array.isArray(source.classes) && source.classes.every((item) => typeof item === "string"),
    "Candidate classes are invalid.",
  );
  return {
    documentId: source.sourceId,
    contentHash: source.contentHash,
    byteCount: source.byteCount,
    classes: [...source.classes],
  };
}

export function validateProviderShadowV2Candidate(candidate) {
  assertExactKeys(
    candidate,
    providerShadowV2CanonicalCandidateFields,
    "A provider-shadow v2 candidate",
  );
  assert(
    typeof candidate.documentId === "string" && candidate.documentId.length > 0,
    "A documentId is invalid.",
  );
  assert(
    typeof candidate.contentHash === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(candidate.contentHash),
    "A content hash is invalid.",
  );
  assert(
    Number.isSafeInteger(candidate.byteCount) && candidate.byteCount >= 0,
    "A byte count is invalid.",
  );
  assert(
    Array.isArray(candidate.classes) && candidate.classes.every((item) => typeof item === "string"),
    "Candidate classes are invalid.",
  );
  return structuredClone(candidate);
}

export function parseProviderShadowV2Selection(rawContent, candidates, maximumSelectedSources) {
  const validated = candidates.map(validateProviderShadowV2Candidate);
  const tokenByDocumentId = new Map(
    validated.map((candidate) => [
      `lervo-e4:${candidate.documentId}:${candidate.contentHash}`,
      { documentId: candidate.documentId, contentHash: candidate.contentHash },
    ]),
  );
  const occurrences = [...rawContent.matchAll(/(lervo-e4:[^\s<>]+)/gu)].map((match) => match[1]);
  const standalone = [
    ...rawContent.matchAll(/^[\t ]*<!--[\t ]*(lervo-e4:[^\s<>]+)[\t ]*-->[\t ]*$/gmu),
  ].map((match) => match[1]);
  const remainder = rawContent
    .replace(/^[\t ]*<!--[\t ]*lervo-e4:[^\s<>]+[\t ]*-->[\t ]*$/gmu, "")
    .trim();
  const violations = [];
  if (occurrences.length !== standalone.length)
    violations.push("non_standalone_or_malformed_e4_marker");
  if (remainder.length > 0) violations.push("provider_shadow_prose_present");
  if (standalone.some((token) => !tokenByDocumentId.has(token)))
    violations.push("unknown_e4_marker");
  if (new Set(standalone).size !== standalone.length) violations.push("duplicate_e4_marker");
  if (standalone.length > maximumSelectedSources) violations.push("too_many_selected_sources");
  return {
    selected: standalone.flatMap((token) => {
      const candidate = tokenByDocumentId.get(token);
      return candidate === undefined ? [] : [candidate];
    }),
    violations,
    passed: violations.length === 0,
  };
}

export function createProviderShadowV2StructuredSelectionSchema(
  candidates,
  maximumSelectedSources,
) {
  const tokens = candidates.map((candidate) => {
    const validated = validateProviderShadowV2Candidate(candidate);
    return `lervo-e4:${validated.documentId}:${validated.contentHash}`;
  });
  return {
    type: "object",
    properties: {
      evidenceTokens: {
        type: "array",
        items: { type: "string", enum: tokens },
        maxItems: maximumSelectedSources,
      },
    },
    required: ["evidenceTokens"],
    additionalProperties: false,
  };
}

export function parseProviderShadowV2StructuredSelection(
  rawContent,
  candidates,
  maximumSelectedSources,
) {
  const validated = candidates.map(validateProviderShadowV2Candidate);
  const byToken = new Map(
    validated.map((candidate) => [
      `lervo-e4:${candidate.documentId}:${candidate.contentHash}`,
      { documentId: candidate.documentId, contentHash: candidate.contentHash },
    ]),
  );
  let value;
  try {
    value = JSON.parse(rawContent);
  } catch {
    return { selected: [], violations: ["malformed_structured_selection"], passed: false };
  }
  const validShape =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["evidenceTokens"]) &&
    Array.isArray(value.evidenceTokens) &&
    value.evidenceTokens.every((token) => typeof token === "string");
  if (!validShape) {
    return { selected: [], violations: ["invalid_structured_selection_shape"], passed: false };
  }
  const tokens = value.evidenceTokens;
  const violations = [];
  if (tokens.some((token) => !byToken.has(token))) violations.push("unknown_e4_marker");
  if (new Set(tokens).size !== tokens.length) violations.push("duplicate_e4_marker");
  if (tokens.length > maximumSelectedSources) violations.push("too_many_selected_sources");
  return {
    selected: tokens.flatMap((token) => {
      const candidate = byToken.get(token);
      return candidate === undefined ? [] : [candidate];
    }),
    violations,
    passed: violations.length === 0,
  };
}

export function providerShadowV2ExecutionDisposition(persistedStateCounts) {
  assertExactKeys(
    persistedStateCounts,
    providerShadowV2TerminalStateKinds,
    "Provider-shadow v2 state counts",
  );
  for (const kind of providerShadowV2TerminalStateKinds) {
    assert(
      Number.isSafeInteger(persistedStateCounts[kind]) && persistedStateCounts[kind] >= 0,
      `The ${kind} state count is invalid.`,
    );
  }
  const persistedKinds = providerShadowV2TerminalStateKinds.filter(
    (kind) => persistedStateCounts[kind] > 0,
  );
  return persistedKinds.length === 0
    ? {
        status: "fresh",
        executionAuthorized: false,
        maySeekExecutionAuthority: true,
        persistedKinds,
      }
    : {
        status: "non_resumable",
        executionAuthorized: false,
        maySeekExecutionAuthority: false,
        persistedKinds,
      };
}

export function buildProviderShadowV2UnavailableObservation(input) {
  assert(
    input.providerInvocationCount === 1,
    "An unavailable post-turn observation requires exactly one accepted provider invocation.",
  );
  assert(unavailableStages.includes(input.availabilityStage), "An availability stage is required.");
  assert(
    Array.isArray(input.missingCoordinates) &&
      input.missingCoordinates.every((item) => unavailableCoordinateNames.includes(item)),
    "Missing coordinates must be bounded names.",
  );
  assert(
    input.failureCode === "provider_shadow_observation_unavailable" ||
      input.failureCode === "provider_shadow_attempt_state_invalid",
    "The unavailable observation failure code is invalid.",
  );
  assert(
    typeof input.lastDurableAttemptDigest === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(input.lastDurableAttemptDigest),
    "The last durable attempt digest is invalid.",
  );
  assert(
    typeof input.observationId === "string" &&
      /^psv(?:[2-9]|1[0-8])obs_[a-z0-9_]+$/u.test(input.observationId),
    "The unavailable observation identifier is invalid.",
  );
  assert(
    typeof input.sampleId === "string" && /^psv(?:[2-9]|1[0-8])_/u.test(input.sampleId),
    "The unavailable sample identifier is invalid.",
  );
  const record = {
    recordKind: input.recordKind ?? "linked_evidence_provider_shadow_observation.v2",
    observationId: input.observationId,
    sampleId: input.sampleId,
    status: "unavailable",
    availabilityStage: input.availabilityStage,
    missingCoordinates: [...new Set(input.missingCoordinates)].sort(),
    failureCode: input.failureCode,
    lastDurableAttemptDigest: input.lastDurableAttemptDigest,
    providerInvocationCount: 1,
    providerSessionId: input.providerSessionId ?? null,
    adapterReceiptId: input.adapterReceiptId ?? null,
    providerTurnId: input.providerTurnId ?? null,
  };
  return { record, recordDigest: valueDigest(record) };
}
