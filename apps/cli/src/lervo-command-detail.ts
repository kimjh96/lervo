// The core recognizes its own CLI in a hosted session's shell calls (ADE session-host protocol,
// "Tool detail"), so the conversation shows what Lervo did instead of a raw `lervo …` command.
// The core link adds the call to decoded tool activity and to transcript pages, so provider
// adapters stay unaware of Lervo's commands. The rule that splits a line is the session-host
// contract's, which the interface reads too.
import type { HostedDecodedContent } from "@lervo/adapter-contract";
import { readLervoShellLine, shortenedText } from "@lervo/session-host-contract";

import { readKnowledgeQueryOutput } from "./knowledge-query-output.js";

/** A search's hits a line carries: the first in rank order, within the detail's bound. */
const MAX_HITS = 10;
const MAX_HIT_TITLE_CHARACTERS = 120;
const MAX_HIT_PATH_CHARACTERS = 240;

/** `content` without what its adapter passed to the core alone: a call's shell output and ID. */
export function withoutShellOutput(content: HostedDecodedContent): HostedDecodedContent {
  if (
    content.kind !== "tool_activity" ||
    (content.output === undefined && content.toolUseId === undefined)
  )
    return content;
  const { output: _output, toolUseId: _toolUseId, ...line } = content;
  return line;
}

/**
 * `content` with the Lervo call its shell command makes, when it makes one, and without its shell
 * output. A knowledge search adds how many documents it found and the first of them; its list
 * then stands in for the output's preview. A line that also ran other commands keeps its preview,
 * since their output is mixed with the search's.
 */
export function withLervoCall(
  content: HostedDecodedContent,
  commands: ReadonlySet<string>,
): HostedDecodedContent {
  const line = withoutShellOutput(content);
  if (line.kind !== "tool_activity" || line.detail?.subject.kind !== "command") return line;
  const read = readLervoShellLine(line.detail.subject.text, commands);
  if (read === undefined) return line;
  const lervo = read.call;
  const output = content.kind === "tool_activity" ? content.output : undefined;
  // A line that also ran other commands mixes their output with the search's.
  const search =
    lervo.command === "knowledge query" &&
    lervo.flag === undefined &&
    read.others === undefined &&
    output !== undefined
      ? readKnowledgeQueryOutput(output)
      : undefined;
  if (search === undefined) return { ...line, detail: { ...line.detail, lervo } };
  const hits = search.hits.slice(0, MAX_HITS).map((hit) => ({
    title: shortenedText(hit.title, MAX_HIT_TITLE_CHARACTERS),
    path: shortenedText(hit.path, MAX_HIT_PATH_CHARACTERS),
    freshness: hit.freshness,
  }));
  const { preview, ...detail } = line.detail;
  return {
    ...line,
    detail: {
      ...(hits.length > 0 || preview === undefined ? detail : { ...detail, preview }),
      lervo: { ...lervo, found: search.found, ...(hits.length > 0 ? { hits } : {}) },
    },
  };
}
