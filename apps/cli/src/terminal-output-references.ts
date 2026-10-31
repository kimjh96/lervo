import type { PreparedTerminalDocument } from "./terminal-prompt-context.js";
import type { SelectedTerminalDocument } from "./terminal-turn-selection.js";

const EVIDENCE_TOKEN = /lervo-ref:(concept_[a-f0-9]{24}):(sha256:[a-f0-9]{64})/gu;
// Slash, dots, connector punctuation and dashes can continue a path.
const BOUNDARY = /^[\s"'`<>[\](){}:,;!?…“”‘’«»。！？、，；：]$/u;

export function messageMentionsSelectedPath(message: string, path: string): boolean {
  let offset = 0;
  while (offset < message.length) {
    const start = message.indexOf(path, offset);
    if (start === -1) return false;
    offset = start + path.length;
    if (start > 0 && !BOUNDARY.test(message[start - 1]!)) continue;
    let end = offset;
    const suffix = /^:\d+/u.exec(message.slice(end));
    if (suffix !== null) end += suffix[0].length;
    if (end === message.length || BOUNDARY.test(message[end]!)) return true;
    if (message[end] === "." && (end + 1 === message.length || BOUNDARY.test(message[end + 1]!)))
      return true;
  }
  return false;
}

export function observedTerminalReferences(input: {
  lastAssistantMessage: string | null | undefined;
  loaded: PreparedTerminalDocument[];
  selected: SelectedTerminalDocument[];
}): {
  conceptId?: string;
  documentId?: string;
  path: string;
  contentHash: string;
  scope: "full" | "prefix";
  referenceKind: "output_citation" | "path_mention";
}[] {
  const message = input.lastAssistantMessage;
  if (typeof message !== "string") return [];
  const expected = new Map(
    input.loaded.map((document) => [`${document.conceptId}\0${document.contentHash}`, document]),
  );
  const citations = new Map<string, PreparedTerminalDocument>();
  for (const match of message.matchAll(new RegExp(EVIDENCE_TOKEN.source, EVIDENCE_TOKEN.flags))) {
    const key = `${match[1]}\0${match[2]}`;
    const document = expected.get(key);
    if (document !== undefined) citations.set(key, document);
  }
  return [
    ...[...citations.values()].map(({ conceptId, path, contentHash, scope }) => ({
      conceptId,
      path,
      contentHash,
      scope,
      referenceKind: "output_citation" as const,
    })),
    ...input.selected
      .filter((document) => messageMentionsSelectedPath(message, document.path))
      .map((document) => ({
        ...document,
        scope: "full" as const,
        referenceKind: "path_mention" as const,
      })),
  ];
}
