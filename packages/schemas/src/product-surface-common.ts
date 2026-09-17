import type { FromSchema } from "json-schema-to-ts";

export const productSurfaceCoordinateSchema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$",
} as const;

export const productSurfaceReasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

export const productSurfacePrivacyClassSchema = {
  type: "string",
  enum: ["ordinary", "sensitive", "restricted"],
} as const;

export const productSurfaceProjectionStatusSchema = {
  type: "string",
  enum: ["complete", "partial", "unavailable", "invalid"],
} as const;

export const productSurfaceSectionStateSchema = {
  type: "object",
  properties: {
    status: productSurfaceProjectionStatusSchema,
    reasonCode: {
      anyOf: [productSurfaceReasonCodeSchema, { type: "null" }],
    },
    sourceCoordinates: {
      type: "array",
      items: productSurfaceCoordinateSchema,
      maxItems: 64,
      uniqueItems: true,
    },
  },
  required: ["status", "reasonCode", "sourceCoordinates"],
  oneOf: [
    {
      properties: {
        status: { const: "complete" },
        reasonCode: { type: "null" },
      },
      required: ["status", "reasonCode"],
    },
    {
      properties: {
        status: { enum: ["partial", "unavailable", "invalid"] },
        reasonCode: productSurfaceReasonCodeSchema,
      },
      required: ["status", "reasonCode"],
    },
  ],
  additionalProperties: false,
} as const;

export type ProductSurfacePrivacyClass = FromSchema<typeof productSurfacePrivacyClassSchema>;
export type ProductSurfaceProjectionStatus = FromSchema<
  typeof productSurfaceProjectionStatusSchema
>;
export type ProductSurfaceSectionStateV1 = FromSchema<typeof productSurfaceSectionStateSchema>;
