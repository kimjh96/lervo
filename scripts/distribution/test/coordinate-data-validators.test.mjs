import { expect, it } from "vitest";
import { coordinateDataValidatorIds } from "../../../packages/schemas/scripts/coordinate-data-validators.mjs";

function schema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    oneOf: [1, 2, 3, 4, 5, 6].map((version) => ({
      type: "object",
      required: ["selectedEventSchemaVersion"],
      properties: { selectedEventSchemaVersion: { type: "integer", const: version } },
    })),
  };
}

it("refuses a branch set unless required discriminator values prove exclusivity", () => {
  for (const change of [
    (value) => {
      value.additionalProperties = false;
    },
    (value) => {
      value.oneOf.pop();
    },
    (value) => {
      value.oneOf[0].required = [];
    },
    (value) => {
      value.oneOf[0].properties.selectedEventSchemaVersion.type = "string";
    },
    (value) => {
      value.oneOf[0].properties.selectedEventSchemaVersion.const = 2;
    },
    (value) => {
      value.oneOf[0].type = "array";
    },
  ]) {
    const value = schema();
    change(value);
    expect(() =>
      coordinateDataValidatorIds(
        {
          addSchema() {
            throw new Error("must not compile");
          },
        },
        value,
      ),
    ).toThrow("schema_coordinate_discriminator_invalid");
  }
});
