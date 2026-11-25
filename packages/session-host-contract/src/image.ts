import type { FromSchema } from "json-schema-to-ts";

/** The image formats a native conversation takes, as Claude's vision input does. */
export const imageMediaTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Images one message carries at most. */
export const MAX_SENT_IMAGES = 3;

/**
 * Base64 characters one sent image holds at most, about 180 KB of image. The interface scales a
 * pasted image down to fit, so a message with every image and its text stays within one frame.
 */
export const MAX_SENT_IMAGE_CHARACTERS = 240_000;

/** An image sent with a message: its format and its bytes as Base64. */
export const sentImageSchema = {
  title: "SentImage",
  type: "object",
  additionalProperties: false,
  required: ["mediaType", "data"],
  properties: {
    mediaType: { type: "string", enum: imageMediaTypes },
    data: { type: "string", minLength: 1, maxLength: MAX_SENT_IMAGE_CHARACTERS },
  },
} as const;

export const sentImagesSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_SENT_IMAGES,
  items: sentImageSchema,
} as const;

/**
 * What the conversation keeps of an image a message carried: its format and size, never its
 * bytes, so the conversation index stays small. A size the reader could not tell is left out.
 */
export const imageMarkSchema = {
  title: "ImageMark",
  type: "object",
  additionalProperties: false,
  required: ["mediaType"],
  properties: {
    mediaType: { type: "string", enum: imageMediaTypes },
    width: { type: "integer", minimum: 1, maximum: 65535 },
    height: { type: "integer", minimum: 1, maximum: 65535 },
  },
} as const;

export const imageMarksSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_SENT_IMAGES,
  items: imageMarkSchema,
} as const;

export type ImageMediaType = (typeof imageMediaTypes)[number];
export type SentImage = FromSchema<typeof sentImageSchema>;
export type ImageMark = FromSchema<typeof imageMarkSchema>;
