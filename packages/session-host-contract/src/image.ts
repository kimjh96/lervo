import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

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

/** An image's identity: the SHA-256 of its bytes, in lowercase hex. */
export const imageIdSchema = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;

/**
 * What the conversation keeps of an image a message carried: its format, size, and identity,
 * never its bytes, so the conversation index stays small. The session host keeps the bytes of the
 * images it sent under their identity, and `image.read` returns them. A size the reader could not
 * tell is left out.
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
    imageId: imageIdSchema,
  },
} as const;

export const imageMarksSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_SENT_IMAGES,
  items: imageMarkSchema,
} as const;

/**
 * Asks for the bytes of an image a session's message carried. The session host answers with
 * `image.data`, or `request.failed` with `image_not_found` when it keeps no such image, such as
 * one read back from the provider's transcript that this session host never sent.
 */
export const imageReadMessageSchema = {
  title: "ImageReadMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "imageId"],
  properties: {
    kind: { type: "string", enum: ["image.read"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    imageId: imageIdSchema,
  },
} as const;

/** The bytes of an image, as Base64, answering `image.read`. */
export const imageDataMessageSchema = {
  title: "ImageDataMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "imageId", "mediaType", "data"],
  properties: {
    kind: { type: "string", enum: ["image.data"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    imageId: imageIdSchema,
    mediaType: { type: "string", enum: imageMediaTypes },
    data: { type: "string", minLength: 1, maxLength: MAX_SENT_IMAGE_CHARACTERS },
  },
} as const;

export type ImageMediaType = (typeof imageMediaTypes)[number];
export type SentImage = FromSchema<typeof sentImageSchema>;
export type ImageMark = FromSchema<typeof imageMarkSchema>;
