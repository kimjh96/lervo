import { conversationItemSchema, conversationItemSchemas } from "./conversation.js";
import { conversationModeSchema } from "./session.js";
import {
  clientMessageSchema,
  clientMessageSchemas,
  hostMessageSchema,
  hostMessageSchemas,
} from "./messages.js";
import {
  codeSchema,
  epochMillisecondsSchema,
  identifierSchema,
  parametersSchema,
  sequenceSchema,
} from "./primitives.js";

type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };

/** Named definitions, in the order the exported document lists them. */
const definitions: readonly (readonly [string, object])[] = [
  ["Identifier", identifierSchema],
  ["Sequence", sequenceSchema],
  ["EpochMilliseconds", epochMillisecondsSchema],
  ["Code", codeSchema],
  ["Parameters", parametersSchema],
  ["ConversationMode", conversationModeSchema],
  ["ClientMessage", clientMessageSchema],
  ["HostMessage", hostMessageSchema],
  ["ConversationItem", conversationItemSchema],
  ...[...clientMessageSchemas, ...hostMessageSchemas, ...conversationItemSchemas].map(
    (schema) => [schema.title, schema] as const,
  ),
];

/** Replaces every nested occurrence of a named schema with a `$ref` to its definition. */
function withReferences(value: JsonValue, names: ReadonlyMap<object, string>): JsonValue {
  if (Array.isArray(value)) return value.map((item) => withReferenceOrSelf(item, names));
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value as JsonObject))
    result[key] = withReferenceOrSelf(child, names);
  return result;
}

function withReferenceOrSelf(value: JsonValue, names: ReadonlyMap<object, string>): JsonValue {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const name = names.get(value);
    if (name !== undefined) return { $ref: `#/$defs/${name}` };
  }
  return withReferences(value, names);
}

/**
 * The protocol as one JSON Schema document. The Rust types are generated from this document, so
 * every named schema appears once under `$defs` and every other use refers to it.
 */
export function sessionHostProtocolDocument(): JsonObject {
  const names = new Map<object, string>(definitions.map(([name, schema]) => [schema, name]));
  const defs: Record<string, JsonValue> = {};
  for (const [name, schema] of definitions) defs[name] = withReferences(schema as JsonValue, names);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://schemas.lervo.dev/v1/session-host-protocol.schema.json",
    title: "SessionHostProtocolMessage",
    oneOf: [{ $ref: "#/$defs/ClientMessage" }, { $ref: "#/$defs/HostMessage" }],
    $defs: defs,
  };
}
