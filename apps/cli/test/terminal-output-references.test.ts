import { expect, it } from "vitest";
import {
  messageMentionsSelectedPath,
  observedTerminalReferences,
} from "../src/terminal-output-references.js";
import type { PreparedTerminalDocument } from "../src/terminal-prompt-context.js";

const path = "docs/decisions/0541-turn-use.md";
const selected = {
  documentId: "doc_path_0123456789abcdef01234567",
  path,
  contentHash: `sha256:${"a".repeat(64)}`,
};

it.each([
  path,
  `Read ${path} next`,
  `\`${path}\``,
  `"${path}"`,
  `'${path}'`,
  `[${path}]`,
  `“${path}”`,
  `‘${path}’`,
  `(${path})`,
  `<${path}>`,
  `${path}.`,
  `${path},`,
  `${path};`,
  `${path}:42`,
  `\`${path}:42\``,
  `[source](${path}:42)`,
])("observes a selected path bounded alone: %s", (message) => {
  expect(messageMentionsSelectedPath(message, path)).toBe(true);
});

it.each([
  `prefix/${path}`,
  `/${path}`,
  `./${path}`,
  `long-${path}`,
  `_${path}`,
  `${path}.bak`,
  `${path}/child`,
  `${path}-extra`,
  `${path}_extra`,
  `${path}x`,
  `${path}:42x`,
  `${path}:42/child`,
  `https://host/${path}`,
  path.toUpperCase(),
])("rejects a substring or different spelling: %s", (message) => {
  expect(messageMentionsSelectedPath(message, path)).toBe(false);
});

it("matches literal brackets and spaces without interpreting regex syntax", () => {
  expect(
    messageMentionsSelectedPath("`app/[lang]/some file.md:8`", "app/[lang]/some file.md"),
  ).toBe(true);
  expect(messageMentionsSelectedPath("app/l/some file.md", "app/[lang]/some file.md")).toBe(false);
});

it("records each selected path once and never records an unselected path", () => {
  expect(
    observedTerminalReferences({
      lastAssistantMessage: `${path} ${path}:7 docs/unselected.md`,
      loaded: [],
      selected: [selected],
    }),
  ).toEqual([{ ...selected, scope: "full", referenceKind: "path_mention" }]);
  expect(
    observedTerminalReferences({
      lastAssistantMessage: "docs/unselected.md",
      loaded: [],
      selected: [selected],
    }),
  ).toEqual([]);
  expect(
    observedTerminalReferences({ lastAssistantMessage: null, loaded: [], selected: [selected] }),
  ).toEqual([]);
});

it("preserves hash-bound output citations independently of path mentions", () => {
  const loaded = {
    conceptId: `concept_${"b".repeat(24)}`,
    path,
    contentHash: selected.contentHash,
    scope: "prefix",
    deliveredByteCount: 10,
    assurance: "unreviewed",
    freshness: "current",
  } satisfies PreparedTerminalDocument;
  const token = `lervo-ref:${loaded.conceptId}:${loaded.contentHash}`;
  const references = observedTerminalReferences({
    lastAssistantMessage: `${token} ${token} ${path}`,
    loaded: [loaded],
    selected: [selected],
  });
  expect(references.map((reference) => reference.referenceKind)).toEqual([
    "output_citation",
    "path_mention",
  ]);
  expect(
    observedTerminalReferences({ lastAssistantMessage: token, loaded: [], selected: [selected] }),
  ).toEqual([]);
});
