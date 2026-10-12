import { validateSchema } from "./validate.js";

/** Ordinary package and terminal consumers retain the complete validation map. */
export default function validateCoordinateData(value: unknown): boolean {
  return validateSchema("eventWriterCoordinate", value).valid;
}
