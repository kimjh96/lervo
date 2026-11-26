// An agent's questions with choices, as the conversation carries them (Lervo ADE sessions,
// "Questions").
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

const choiceTextSchema = { type: "string", maxLength: 1024 } as const;

/** The questions of one request and their options; one answer settles them all. */
export const choicesSchema = {
  title: "Choices",
  type: "object",
  additionalProperties: false,
  required: ["requestId", "questions"],
  properties: {
    /** The provider's request, which the answer names. */
    requestId: identifierSchema,
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "header", "multiSelect", "options"],
        properties: {
          question: choiceTextSchema,
          header: choiceTextSchema,
          multiSelect: { type: "boolean" },
          options: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: { label: choiceTextSchema, description: choiceTextSchema },
            },
          },
        },
      },
    },
  },
} as const;

/** The person's answers, each by its question's text; several labels of one question join by ", ". */
export const choiceAnswersSchema = {
  type: "object",
  maxProperties: 4,
  additionalProperties: { type: "string", minLength: 1, maxLength: 4096 },
} as const;

export type Choices = FromSchema<typeof choicesSchema>;
