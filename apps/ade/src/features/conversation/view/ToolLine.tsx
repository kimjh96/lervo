import type { ConversationItem, ToolDetail } from "@lervo/session-host-contract";
import { Fragment } from "react";
import { FormattedMessage } from "react-intl";

import { ChevronDownIcon } from "../../../ui/icons";
import { Presence } from "../../../ui/Presence";
import { LervoSentence } from "./LervoSentence";
import { toolCountMessages, toolMessages } from "./messages";
import styles from "./ToolLine.module.css";
import { useToolLine } from "./ToolLinesProvider";

type ToolItem = Extract<ConversationItem, { kind: "tool_activity" }>;
type Preview = NonNullable<ToolDetail["preview"]>;

/** Subjects shown in the mono face, and those shown in quotes. */
const MONO = new Set(["path", "command", "pattern", "url"]);
const QUOTED = new Set(["pattern", "query"]);

function Subject({ subject }: { subject: ToolDetail["subject"] }) {
  const quoted = QUOTED.has(subject.kind);
  return (
    <span className={styles.subject} data-mono={MONO.has(subject.kind) ? "true" : undefined}>
      {quoted ? `"${subject.text}"` : subject.text}
    </span>
  );
}

/** What the line shows at its end: a failure, lines added and removed, or a count. */
function Result({ tool }: { tool: ToolItem["tool"] }) {
  if (tool.status === "failed")
    return (
      <span className={styles.result} data-status="failed">
        <FormattedMessage id="conversation.tool.result.failed" />
      </span>
    );
  const counts = tool.detail?.counts;
  if (counts === undefined) return null;
  const added = counts.added ?? 0;
  const removed = counts.removed ?? 0;
  // Only the side that changed shows: a new file shows what it added.
  if (added > 0 || removed > 0)
    return (
      <span className={styles.result}>
        {/* motion: A message arrives live */}
        {added > 0 ? (
          <span className={styles.added}>
            <FormattedMessage id="conversation.tool.added" values={{ count: added }} />
          </span>
        ) : null}
        {/* motion: A message arrives live */}
        {removed > 0 ? (
          <span className={styles.removed}>
            <FormattedMessage id="conversation.tool.removed" values={{ count: removed }} />
          </span>
        ) : null}
      </span>
    );
  for (const [name, message] of toolCountMessages) {
    const count = counts[name];
    if (count !== undefined)
      return (
        <span className={styles.result}>
          <FormattedMessage {...message} values={{ count }} />
        </span>
      );
  }
  return null;
}

function lineChange(format: Preview["format"], line: string): string | undefined {
  if (format !== "diff") return undefined;
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return undefined;
}

function Omitted({ count }: { count: number }) {
  return (
    <div className={styles.omitted}>
      <FormattedMessage id="conversation.tool.omitted" values={{ count }} />
    </div>
  );
}

type Hits = NonNullable<NonNullable<ToolDetail["lervo"]>["hits"]>;

/** What a Lervo search found, in rank order: each document's title and path, and stale ones. */
function SearchHits(props: { hits: Hits; found: number }) {
  const more = props.found - props.hits.length;
  return (
    <ol className={styles.hits}>
      {props.hits.map((hit) => (
        <li key={hit.path} className={styles.hit}>
          <span className={styles.hitTitle}>
            {hit.title}
            {/* motion: Disclosure: tool activity, details */}
            {hit.freshness === "stale" ? (
              <span className={styles.stale}>
                <FormattedMessage id="conversation.lervo.stale" />
              </span>
            ) : null}
          </span>
          <span className={styles.hitPath}>{hit.path}</span>
        </li>
      ))}
      {/* motion: Disclosure: tool activity, details */}
      {more > 0 ? (
        <li className={styles.omitted}>
          <FormattedMessage id="conversation.lervo.more" values={{ count: more }} />
        </li>
      ) : null}
    </ol>
  );
}

/**
 * What an opened line shows: the Lervo command it ran, if any, what a search found, and its
 * output or change.
 */
function PreviewLines(props: {
  command: string | undefined;
  search: { hits: Hits; found: number } | undefined;
  preview: Preview | undefined;
}) {
  const preview = props.preview ?? { format: "output", lines: [], omittedLines: 0, omittedAt: 0 };
  const omitted = preview.omittedLines > 0;
  return (
    <div className={styles.preview}>
      {/* motion: Disclosure: tool activity, details */}
      {props.command === undefined ? null : (
        <div className={styles.commandLine}>{props.command}</div>
      )}
      {/* motion: Disclosure: tool activity, details */}
      {props.search === undefined ? null : <SearchHits {...props.search} />}
      {preview.lines.map((line, index) => (
        // Lines have no identity beyond their order within one immutable item.
        <Fragment key={index}>
          {/* motion: Disclosure: tool activity, details */}
          {omitted && index === preview.omittedAt ? <Omitted count={preview.omittedLines} /> : null}
          <div className={styles.line} data-change={lineChange(preview.format, line)}>
            {line.length === 0 ? " " : line}
          </div>
        </Fragment>
      ))}
      {/* motion: Disclosure: tool activity, details */}
      {omitted && preview.omittedAt >= preview.lines.length ? (
        <Omitted count={preview.omittedLines} />
      ) : null}
    </div>
  );
}

/**
 * One tool call as a quiet line: the tool, what it acted on, and its result. A call with output
 * or a change opens to its preview. Opening and closing move the details' space with their fade
 * (ADE motion, "Disclosure"). A line without detail, such as one stored before details existed, shows
 * the tool and its status. `ToolLinesProvider` keeps which lines are open.
 */
export function ToolLine({ item }: { item: ToolItem }) {
  const [opened, toggle] = useToolLine(item.itemId);
  const { tool } = item;
  const detail = tool.detail;
  if (detail === undefined)
    return (
      <p className={styles.plain} data-status={tool.status}>
        <FormattedMessage
          {...toolMessages[tool.status]}
          values={{ name: tool.name, calls: tool.calls }}
        />
      </p>
    );
  const lervo = detail.lervo;
  // A Lervo command reads as what Lervo did, and opens to the exact command it ran.
  const summary =
    lervo === undefined ? (
      <>
        <span className={styles.name}>{tool.name}</span>
        <Subject subject={detail.subject} />
        <Result tool={tool} />
      </>
    ) : (
      <>
        <LervoSentence lervo={lervo} failed={tool.status === "failed"} />
        {/* motion: A message arrives live */}
        {lervo.found === undefined || tool.status === "failed" ? null : (
          <span className={styles.result}>
            <FormattedMessage id="conversation.lervo.found" values={{ count: lervo.found }} />
          </span>
        )}
      </>
    );
  if (detail.preview === undefined && lervo === undefined)
    return (
      <div className={styles.tool}>
        <p className={styles.summary}>
          <span className={styles.caret} />
          {summary}
        </p>
      </div>
    );
  return (
    <div className={styles.tool}>
      <button type="button" className={styles.summary} aria-expanded={opened} onClick={toggle}>
        <span className={styles.caret} data-open={opened ? "true" : undefined}>
          <ChevronDownIcon size="sm" />
        </span>
        {summary}
      </button>
      {/* Opened details open their space and fade in; closed ones fade out and close it. Details
          open in loaded history show at once (ADE motion, "Disclosure"). */}
      <Presence enterOnMount={false}>
        {opened ? (
          <PreviewLines
            command={lervo === undefined ? undefined : detail.subject.text}
            search={
              lervo?.hits === undefined
                ? undefined
                : { hits: lervo.hits, found: lervo.found ?? lervo.hits.length }
            }
            preview={detail.preview}
          />
        ) : null}
      </Presence>
    </div>
  );
}
