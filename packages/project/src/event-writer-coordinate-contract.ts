import { validateSchema, type EventWriterCoordinate } from "@lervo/schemas";

import {
  assertEventReaderEvidence,
  createEventWriterActivationId,
} from "./event-writer-evidence.js";
import { failEventWriterActivation } from "./event-writer-errors.js";

export function defaultEventWriterCoordinate(projectId: string): EventWriterCoordinate {
  return {
    schemaVersion: 1,
    projectId,
    selectedEventSchemaVersion: 1,
    activationEvidence: null,
  };
}

export function readEventWriterCoordinate(
  value: unknown,
  expectedProjectId?: string,
): EventWriterCoordinate {
  const validation = validateSchema("eventWriterCoordinate", value);
  if (!validation.valid) {
    failEventWriterActivation(
      "event_writer_coordinate_invalid",
      "The event writer coordinate does not satisfy its versioned contract.",
    );
  }
  const coordinate = value as EventWriterCoordinate;
  if (expectedProjectId !== undefined && coordinate.projectId !== expectedProjectId) {
    failEventWriterActivation(
      "event_writer_coordinate_invalid",
      "The event writer coordinate belongs to another project.",
    );
  }
  if (coordinate.selectedEventSchemaVersion !== 1) {
    assertEventReaderEvidence(
      coordinate.activationEvidence.readers,
      coordinate.selectedEventSchemaVersion,
    );
    const activation = coordinate.activationEvidence;
    const expectedId = createEventWriterActivationId({
      projectId: coordinate.projectId,
      observedAt: activation.observedAt,
      configurationHash: activation.configurationHash,
      readers: activation.readers,
      targetEventSchemaVersion: coordinate.selectedEventSchemaVersion,
    });
    if (activation.activationId !== expectedId) {
      failEventWriterActivation(
        "event_writer_coordinate_invalid",
        "The event writer activation identity does not match its evidence.",
      );
    }
  }
  return structuredClone(coordinate);
}
