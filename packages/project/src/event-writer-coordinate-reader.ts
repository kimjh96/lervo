import { parseEventWriterCoordinateJson, type EventWriterCoordinate } from "@lervo/schemas";
import { contentHash } from "./filesystem.js";
import { readSmallEntry } from "./small-entry.js";
import {
  defaultEventWriterCoordinate,
  readValidatedEventWriterCoordinate,
} from "./event-writer-coordinate-contract.js";
import { EventWriterActivationError, failEventWriterActivation } from "./event-writer-errors.js";
import { maximumEventWriterCoordinateBytes } from "./event-writer-activation-transaction-io.js";

export async function readEventWriterCoordinateFile(
  path: string,
  projectId: string,
): Promise<{
  coordinate: EventWriterCoordinate;
  contentHash: string | null;
  source: "implicit_default" | "managed_file";
}> {
  const entry = await readSmallEntry(path, maximumEventWriterCoordinateBytes);
  if (entry.kind === "missing") {
    return {
      coordinate: defaultEventWriterCoordinate(projectId),
      contentHash: null,
      source: "implicit_default",
    };
  }
  if (entry.kind !== "file") {
    throw new EventWriterActivationError(
      "event_writer_coordinate_invalid",
      "The event writer coordinate must be a bounded regular file.",
    );
  }
  let value: EventWriterCoordinate | null;
  try {
    value = parseEventWriterCoordinateJson(entry.content);
  } catch (error) {
    throw new EventWriterActivationError(
      "event_writer_coordinate_invalid",
      "The event writer coordinate is not valid JSON.",
      { cause: error },
    );
  }
  if (value === null)
    failEventWriterActivation(
      "event_writer_coordinate_invalid",
      "The event writer coordinate does not satisfy its versioned contract.",
    );
  return {
    coordinate: readValidatedEventWriterCoordinate(value, projectId),
    contentHash: contentHash(entry.content),
    source: "managed_file",
  };
}
