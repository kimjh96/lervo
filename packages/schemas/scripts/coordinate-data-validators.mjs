import { coordinateDataVersions } from "../../../scripts/shared/schema-validator-contract.mjs";

/** Separate only branches whose required discriminator proves oneOf exclusivity. */
export function coordinateDataValidatorIds(ajv, schema) {
  const branches = schema.oneOf;
  if (
    Object.keys(schema).some((key) => !["$schema", "$id", "title", "oneOf"].includes(key)) ||
    !Array.isArray(branches) ||
    branches.length !== coordinateDataVersions.length ||
    branches.some(
      (branch) =>
        branch.type !== "object" ||
        !branch.required?.includes("selectedEventSchemaVersion") ||
        branch.properties?.selectedEventSchemaVersion?.type !== "integer",
    ) ||
    JSON.stringify(
      branches.map((branch) => branch.properties.selectedEventSchemaVersion.const).sort(),
    ) !== JSON.stringify(coordinateDataVersions)
  )
    throw new Error("schema_coordinate_discriminator_invalid");
  return Object.fromEntries(
    branches.map((branch) => {
      const version = branch.properties.selectedEventSchemaVersion.const;
      const id = `urn:lervo:coordinate-data:${version}`;
      ajv.addSchema({ ...branch, $schema: schema.$schema, $id: id }, id);
      return [`v${version}`, id];
    }),
  );
}
