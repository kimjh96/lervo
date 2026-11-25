import type { ConversationItem, ToolDetail } from "@lervo/session-host-contract";
import { Fragment } from "react";
import { FormattedMessage } from "react-intl";

import { ChevronDownIcon } from "../../../ui/icons";
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

function PreviewLines({ preview }: { preview: Preview }) {
  const omitted = preview.omittedLines > 0;
  return (
    <div className={styles.preview}>
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
 * or a change opens at once to its preview, which fades in; its height never animates (ADE
 * motion, "Disclosure"). A line without detail, such as one stored before details existed, shows
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
  const summary = (
    <>
      <span className={styles.name}>{tool.name}</span>
      <Subject subject={detail.subject} />
      <Result tool={tool} />
    </>
  );
  if (detail.preview === undefined)
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
      {/* motion: Disclosure: tool activity, details */}
      {opened ? <PreviewLines preview={detail.preview} /> : null}
    </div>
  );
}
