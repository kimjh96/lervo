import validators from "../../../packages/schemas/dist/generated/coordinate-data-validators.js";
import { coordinateDataVersions } from "../../shared/schema-validator-contract.mjs";

/** The sole caller owns JSON parsing; public arbitrary-object validation is unchanged. */
export default function validateCoordinateData(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const version = value.selectedEventSchemaVersion;
  if (!coordinateDataVersions.includes(version)) return false;
  return validators[`v${version}`](value);
}
