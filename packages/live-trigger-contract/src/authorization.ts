import type { AssignmentRoutineTemplateV1 } from "@lervo/application-contract";

import {
  LIVE_TRIGGER_ID,
  LIVE_TRIGGER_VERSION,
  liveTriggerHash,
  liveTriggerId,
} from "./integrity.js";
import { LiveTriggerContractError, type LiveWebhookAuthorizationV1 } from "./types.js";

const PROJECT_ID = /^prj_[a-f0-9]{16}$/u;
const WORKSTREAM_ID = /^wks_[a-f0-9]{24}$/u;

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validTemplate(value: unknown): value is AssignmentRoutineTemplateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const template = value as Partial<AssignmentRoutineTemplateV1>;
  return (
    template.schemaVersion === 1 &&
    typeof template.routineId === "string" &&
    LIVE_TRIGGER_ID.test(template.routineId) &&
    template.routineId.length <= 100 &&
    typeof template.templateVersion === "string" &&
    LIVE_TRIGGER_VERSION.test(template.templateVersion) &&
    Array.isArray(template.nodes) &&
    template.nodes.length > 0 &&
    template.nodes.length <= 32 &&
    template.concurrency !== null &&
    typeof template.concurrency === "object"
  );
}

export function parseLiveWebhookAuthorization(value: unknown): LiveWebhookAuthorizationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LiveTriggerContractError(
      "authorization_invalid",
      "The authorization must be an object.",
    );
  }
  const source = value as Record<string, unknown>;
  const expectedKeys = [
    "acceptedEventTypes",
    "adapterId",
    "adapterVersion",
    "credentialId",
    "expiresAt",
    "kind",
    "maximumAcceptedTriggers",
    "projectId",
    "routine",
    "schemaVersion",
    "sourceId",
    "validFrom",
    "workstreamId",
  ];
  const eventTypes = source.acceptedEventTypes;
  const valid =
    exactKeys(source, expectedKeys) &&
    source.schemaVersion === 1 &&
    source.kind === "lervo_live_webhook_authorization" &&
    typeof source.adapterId === "string" &&
    LIVE_TRIGGER_ID.test(source.adapterId) &&
    source.adapterId.length <= 128 &&
    typeof source.adapterVersion === "string" &&
    LIVE_TRIGGER_VERSION.test(source.adapterVersion) &&
    typeof source.projectId === "string" &&
    PROJECT_ID.test(source.projectId) &&
    typeof source.workstreamId === "string" &&
    WORKSTREAM_ID.test(source.workstreamId) &&
    typeof source.sourceId === "string" &&
    LIVE_TRIGGER_ID.test(source.sourceId) &&
    source.sourceId.length <= 128 &&
    typeof source.credentialId === "string" &&
    LIVE_TRIGGER_ID.test(source.credentialId) &&
    source.credentialId.length <= 128 &&
    Array.isArray(eventTypes) &&
    eventTypes.length > 0 &&
    eventTypes.length <= 32 &&
    eventTypes.every(
      (item) => typeof item === "string" && LIVE_TRIGGER_ID.test(item) && item.length <= 128,
    ) &&
    new Set(eventTypes).size === eventTypes.length &&
    typeof source.validFrom === "string" &&
    Number.isFinite(Date.parse(source.validFrom)) &&
    typeof source.expiresAt === "string" &&
    Number.isFinite(Date.parse(source.expiresAt)) &&
    Date.parse(source.expiresAt) > Date.parse(source.validFrom) &&
    Date.parse(source.expiresAt) - Date.parse(source.validFrom) <= 366 * 24 * 60 * 60_000 &&
    Number.isSafeInteger(source.maximumAcceptedTriggers) &&
    (source.maximumAcceptedTriggers as number) >= 1 &&
    (source.maximumAcceptedTriggers as number) <= 100_000 &&
    validTemplate(source.routine);
  if (!valid) {
    throw new LiveTriggerContractError(
      "authorization_invalid",
      "The live webhook authorization is invalid or exceeds its bounds.",
    );
  }
  return structuredClone(value as LiveWebhookAuthorizationV1);
}

export function liveWebhookAuthorizationHash(authorization: LiveWebhookAuthorizationV1): string {
  return liveTriggerHash(parseLiveWebhookAuthorization(authorization));
}

export function liveWebhookAuthorizationId(authorization: LiveWebhookAuthorizationV1): string {
  return liveTriggerId("lwa", parseLiveWebhookAuthorization(authorization));
}
