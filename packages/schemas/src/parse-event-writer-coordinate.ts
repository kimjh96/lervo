import validateCoordinateData from "#coordinate-data-validation";
import type { EventWriterCoordinate } from "./event-writer-coordinate.js";

/** Own parsing so branch dispatch never replaces arbitrary-object validation or its errors. */
export function parseEventWriterCoordinateJson(content: string): EventWriterCoordinate | null {
  const value: unknown = JSON.parse(content);
  return validateCoordinateData(value) ? (value as EventWriterCoordinate) : null;
}
