import { createHash } from "node:crypto";

import { canonicalJson, readEventReaderCapabilities } from "@lervo/event-contract";
import {
  validateSchema,
  type EventReaderActivationEvidence,
  type EventWriterActivationEvidence,
} from "@lervo/schemas";

import { EventWriterActivationError, failEventWriterActivation } from "./event-writer-errors.js";

export function eventWriterSha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertEventReaderEvidence(
  readers: readonly EventReaderActivationEvidence[],
  targetEventSchemaVersion: 2 | 3 | 4 | 5 = 2,
): void {
  const ids = new Set<string>();
  let previousId: string | undefined;
  let localReaders = 0;
  for (const reader of readers) {
    if (ids.has(reader.readerId) || (previousId !== undefined && previousId >= reader.readerId)) {
      failEventWriterActivation(
        "event_writer_evidence_invalid",
        "Event reader activation evidence must be strictly ordered without duplicate IDs.",
      );
    }
    ids.add(reader.readerId);
    previousId = reader.readerId;
    try {
      const capabilities = readEventReaderCapabilities(reader.capabilities);
      const required =
        targetEventSchemaVersion >= 4
          ? Array.from({ length: targetEventSchemaVersion }, (_, index) => index + 1)
          : targetEventSchemaVersion === 3
            ? [1, 2, 3]
            : [2];
      if (
        !required.every((version) => capabilities.readableEventSchemaVersions.includes(version))
      ) {
        failEventWriterActivation(
          "event_writer_activation_blocked",
          `Configured reader ${reader.readerId} cannot read the required history through event schema version ${targetEventSchemaVersion}.`,
        );
      }
    } catch (error) {
      if (error instanceof EventWriterActivationError) throw error;
      throw new EventWriterActivationError(
        "event_writer_evidence_invalid",
        `Configured reader ${reader.readerId} has invalid capability evidence.`,
        { cause: error },
      );
    }
    if (reader.readerKind === "local") {
      localReaders += 1;
      if (reader.peerIdentityHash !== null) {
        failEventWriterActivation(
          "event_writer_evidence_invalid",
          "Local reader evidence cannot claim a peer identity.",
        );
      }
    } else if (reader.peerIdentityHash === null) {
      failEventWriterActivation(
        "event_writer_evidence_invalid",
        "Remote reader evidence requires a verified peer identity hash.",
      );
    }
  }
  if (localReaders !== 1) {
    failEventWriterActivation(
      "event_writer_evidence_invalid",
      "Event writer activation requires exactly one local reader capability.",
    );
  }
}

export function readEventWriterActivationEvidence(value: unknown): EventWriterActivationEvidence {
  const validation = validateSchema("eventWriterActivationEvidence", value);
  if (!validation.valid) {
    failEventWriterActivation(
      "event_writer_evidence_invalid",
      "The event writer activation evidence does not satisfy its versioned contract.",
    );
  }
  const evidence = value as EventWriterActivationEvidence;
  assertEventReaderEvidence(evidence.readers);
  return structuredClone(evidence);
}

export function createEventWriterActivationId(input: {
  projectId: string;
  observedAt: string;
  configurationHash: string;
  readers: readonly EventReaderActivationEvidence[];
  targetEventSchemaVersion?: 2 | 3 | 4 | 5;
}): string {
  const { targetEventSchemaVersion, ...evidence } = input;
  return `evact_${eventWriterSha256(
    canonicalJson({
      ...evidence,
      ...((targetEventSchemaVersion ?? 2) >= 3 ? { targetEventSchemaVersion } : {}),
    }),
  ).slice(7, 31)}`;
}

export function eventWriterActivationConfigurationHash(input: {
  evidence: EventWriterActivationEvidence;
  hubSyncEnabled: boolean;
}): string {
  return eventWriterSha256(
    canonicalJson({
      projectId: input.evidence.projectId,
      hubSyncEnabled: input.hubSyncEnabled,
      authority: input.evidence.schemaVersion === 2 ? input.evidence.authority : null,
      readers: input.evidence.readers.map(({ readerId, readerKind, peerIdentityHash }) => ({
        readerId,
        readerKind,
        peerIdentityHash,
      })),
    }),
  );
}

export function eventWriterActivationObservationHash(
  evidence: EventWriterActivationEvidence,
): string {
  return eventWriterSha256(
    canonicalJson({
      projectId: evidence.projectId,
      authority: evidence.schemaVersion === 2 ? evidence.authority : null,
      readers: evidence.readers,
    }),
  );
}
