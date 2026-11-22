import { conversationItemSchema, conversationItemSchemas } from "./conversation.js";
import {
  coreLaunchSchema,
  coreLinkRequestSchema,
  coreLinkRequestSchemas,
  coreLinkResponseSchema,
  coreLinkResponseSchemas,
  decodedContentSchema,
  decodedContentSchemas,
  decodedEventSchema,
  decodedEventSchemas,
} from "./core-link.js";
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

const primitives: readonly (readonly [string, object])[] = [
  ["Identifier", identifierSchema],
  ["Sequence", sequenceSchema],
  ["EpochMilliseconds", epochMillisecondsSchema],
  ["Code", codeSchema],
  ["Parameters", parametersSchema],
  ["ConversationMode", conversationModeSchema],
];

/** The session-host protocol's named definitions, in the order the document lists them. */
const sessionHostDefinitions: readonly (readonly [string, object])[] = [
  ...primitives,
  ["ClientMessage", clientMessageSchema],
  ["HostMessage", hostMessageSchema],
  ["ConversationItem", conversationItemSchema],
  ...[...clientMessageSchemas, ...hostMessageSchemas, ...conversationItemSchemas].map(
    (schema) => [schema.title, schema] as const,
  ),
];

/** The core link's named definitions. */
const coreLinkDefinitions: readonly (readonly [string, object])[] = [
  ...primitives,
  ["CoreLinkRequest", coreLinkRequestSchema],
  ["CoreLinkResponse", coreLinkResponseSchema],
  ["CoreLaunch", coreLaunchSchema],
  ["DecodedEvent", decodedEventSchema],
  ["DecodedContent", decodedContentSchema],
  ...[
    ...coreLinkRequestSchemas,
    ...coreLinkResponseSchemas,
    ...decodedEventSchemas,
    ...decodedContentSchemas,
  ].map((schema) => [schema.title, schema] as const),
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

/** One JSON Schema document in which every named schema appears once under `$defs`. */
function document(
  id: string,
  title: string,
  roots: readonly string[],
  definitions: readonly (readonly [string, object])[],
): JsonObject {
  const names = new Map<object, string>(definitions.map(([name, schema]) => [schema, name]));
  const defs: Record<string, JsonValue> = {};
  for (const [name, schema] of definitions) defs[name] = withReferences(schema as JsonValue, names);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title,
    oneOf: roots.map((root) => ({ $ref: `#/$defs/${root}` })),
    $defs: defs,
  };
}

/**
 * The protocol between the interface and the session host as one JSON Schema document. The Rust
 * types are generated from this document, so every other use of a named schema refers to it.
 */
export function sessionHostProtocolDocument(): JsonObject {
  return document(
    "https://schemas.lervo.dev/v1/session-host-protocol.schema.json",
    "SessionHostProtocolMessage",
    ["ClientMessage", "HostMessage"],
    sessionHostDefinitions,
  );
}

/** The core link between the session host and the resident Lervo process, as one document. */
export function coreLinkProtocolDocument(): JsonObject {
  return document(
    "https://schemas.lervo.dev/v1/core-link-protocol.schema.json",
    "CoreLinkMessage",
    ["CoreLinkRequest", "CoreLinkResponse"],
    coreLinkDefinitions,
  );
}
