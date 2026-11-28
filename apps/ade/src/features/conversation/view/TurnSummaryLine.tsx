import type { TurnSummary } from "@lervo/session-host-contract";
import { type ReactNode, useEffect } from "react";
import { FormattedMessage, FormattedNumber, type MessageDescriptor } from "react-intl";

import { ChevronDownIcon } from "../../../ui/icons";
import { Presence } from "../../../ui/Presence";
import styles from "./TurnSummaryLine.module.css";
import { type TurnWindow, useTurnSummary } from "./TurnSummariesProvider";

/**
 * The facts the closed line shows, in order: how long the turn took, then only what it did beyond
 * the usual, so an ordinary turn reads as its time alone.
 */
function facts(summary: TurnSummary, elapsedMs: number | undefined): ReactNode[] {
  const shown: ReactNode[] = [];
  if (elapsedMs !== undefined && elapsedMs >= 1000) {
    const seconds = Math.round(elapsedMs / 1000);
    shown.push(
      <FormattedMessage
        key="took"
        id="conversation.turn.took"
        values={{ minutes: Math.floor(seconds / 60), seconds: seconds % 60 }}
      />,
    );
  }
  const { given, searched, cited, outcome } = summary;
  if (searched.documents > 0)
    shown.push(
      <FormattedMessage
        key="searched"
        id="conversation.turn.searched"
        values={{ count: searched.documents }}
      />,
    );
  if (given.documents > 0)
    shown.push(
      <FormattedMessage
        key="given"
        id="conversation.turn.given"
        values={{ count: given.documents }}
      />,
    );
  if (cited > 0)
    shown.push(
      <FormattedMessage key="cited" id="conversation.turn.cited" values={{ count: cited }} />,
    );
  if ((outcome.changedPaths ?? 0) > 0)
    shown.push(
      <FormattedMessage
        key="files"
        id="conversation.turn.files"
        values={{ count: outcome.changedPaths }}
      />,
    );
  else if (outcome.repositoryChanged)
    shown.push(<FormattedMessage key="changed" id="conversation.turn.changed" />);
  if (updated(summary))
    shown.push(<FormattedMessage key="workstream" id="conversation.turn.workstream" />);
  if (outcome.completion === "blocked")
    shown.push(
      <span key="blocked" className={styles.attention}>
        <FormattedMessage id="conversation.turn.blocked" />
      </span>,
    );
  else if (outcome.ending !== undefined)
    shown.push(<FormattedMessage key="unchecked" id="conversation.turn.unchecked" />);
  return shown;
}

const updated = (summary: TurnSummary) =>
  summary.outcome.workstreamRevision !== undefined &&
  summary.given.workstreamRevision !== undefined &&
  summary.outcome.workstreamRevision > summary.given.workstreamRevision;

function Row(props: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className={styles.label}>{props.label}</dt>
      <dd className={styles.value}>{props.children}</dd>
    </>
  );
}

const compact = (value: number) => (
  <FormattedNumber value={value} notation="compact" maximumFractionDigits={1} />
);

/** How the turn's completion check reads in the card. */
const completionMessages = {
  blocked: { id: "conversation.turn.card.blocked" },
  unchecked: { id: "conversation.turn.card.unchecked" },
} as const satisfies Record<string, MessageDescriptor>;

/** A card part with its rows; a part with no row is left out. */
type CardRow = readonly [label: MessageDescriptor, value: ReactNode];

/**
 * How many owner rules Lervo prepared for the turn, and of how many when some did not fit: never
 * that the agent applied them, which Lervo cannot observe. A turn without rules has no row.
 */
function ownerRulesRow(rules: TurnSummary["given"]["ownerRules"]): CardRow | false {
  if (rules === undefined || rules.prepared + rules.omitted === 0) return false;
  return [
    { id: "conversation.turn.card.rules" },
    rules.omitted === 0 ? (
      <FormattedMessage
        key="rules"
        id="conversation.turn.card.rulesPrepared"
        values={{ prepared: rules.prepared }}
      />
    ) : (
      <FormattedMessage
        key="rules"
        id="conversation.turn.card.rulesCut"
        values={{ prepared: rules.prepared, total: rules.prepared + rules.omitted }}
      />
    ),
  ];
}

function Section(props: { heading: MessageDescriptor; rows: readonly CardRow[] }) {
  if (props.rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <h4 className={styles.heading}>
        <FormattedMessage {...props.heading} />
      </h4>
      <dl className={styles.rows}>
        {props.rows.map(([label, value]) => (
          <Row key={String(label.id)} label={<FormattedMessage {...label} />}>
            {value}
          </Row>
        ))}
      </dl>
    </section>
  );
}

/**
 * What the core recorded about the turn, in up to four parts. Only rows with something to say
 * show: no document, no change, and a passed completion check are the usual and stay out.
 */
function Card({ summary }: { summary: TurnSummary }) {
  const { given, searched, cited, outcome, usage } = summary;
  const rows = (...entries: (CardRow | false)[]) =>
    entries.filter((entry): entry is CardRow => entry !== false);
  return (
    <div className={styles.card}>
      <Section
        heading={{ id: "conversation.turn.card.given" }}
        rows={rows(
          given.documents > 0 && [
            { id: "conversation.turn.card.documents" },
            <FormattedMessage
              key="documents"
              id="conversation.turn.card.count"
              values={{ count: given.documents }}
            />,
          ],
          given.workstreamRevision !== undefined && [
            { id: "conversation.turn.card.workstream" },
            <FormattedMessage
              key="workstream"
              id="conversation.turn.card.revision"
              values={{ revision: given.workstreamRevision }}
            />,
          ],
          ownerRulesRow(given.ownerRules),
        )}
      />
      <Section
        heading={{ id: "conversation.turn.card.used" }}
        rows={rows(
          searched.documents > 0 && [
            { id: "conversation.turn.card.found" },
            <>
              <FormattedMessage
                id="conversation.turn.card.count"
                values={{ count: searched.documents }}
              />
              {searched.paths.map((path) => (
                <span key={path} className={styles.path}>
                  {path}
                </span>
              ))}
            </>,
          ],
          cited > 0 && [
            { id: "conversation.turn.card.cited" },
            <FormattedMessage
              key="cited"
              id="conversation.turn.card.count"
              values={{ count: cited }}
            />,
          ],
        )}
      />
      <Section
        heading={{ id: "conversation.turn.card.outcome" }}
        rows={rows(
          outcome.repositoryChanged && [
            { id: "conversation.turn.card.files" },
            <FormattedMessage
              key="files"
              id="conversation.turn.card.filesChanged"
              values={{
                count: outcome.changedPaths ?? 0,
                known: outcome.changedPaths === undefined ? "no" : "yes",
              }}
            />,
          ],
          updated(summary) && [
            { id: "conversation.turn.card.workstream" },
            <FormattedMessage
              key="updated"
              id="conversation.turn.card.updated"
              values={{ revision: outcome.workstreamRevision }}
            />,
          ],
          outcome.completion !== "allowed" && [
            { id: "conversation.turn.card.completion" },
            <FormattedMessage
              key="completion"
              {...(outcome.completion === "blocked"
                ? completionMessages.blocked
                : completionMessages.unchecked)}
            />,
          ],
        )}
      />
      {/* motion: Disclosure: tool activity, details */}
      {usage === undefined ? null : (
        <section className={styles.section}>
          <h4 className={styles.heading}>
            <FormattedMessage id="conversation.turn.card.usage" />
          </h4>
          <p className={styles.usage}>
            <FormattedMessage
              id="conversation.turn.card.tokens"
              values={{
                input: compact(usage.inputTokens),
                cached: compact(usage.cachedInputTokens),
                output: compact(usage.outputTokens),
                hasCost: usage.costUsd === undefined ? "no" : "yes",
                cost: (
                  <FormattedNumber
                    value={usage.costUsd ?? 0}
                    style="currency"
                    currency="USD"
                    maximumFractionDigits={2}
                  />
                ),
              }}
            />
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * The quiet line at a turn's end: what Lervo gave, what the agent used, and what changed, from
 * the core's records, read once the turn is over (approved mockup 3, "The Lervo turn summary").
 * It fades in when the core answers, and its card opens and closes like a disclosure.
 */
export function TurnSummaryLine(props: {
  turn: string;
  window: TurnWindow;
  /** How long the turn took, from its message to its last item. */
  elapsedMs?: number | undefined;
}) {
  const { entry, opened, load, toggle } = useTurnSummary(props.turn);
  const { startedAtMs, endedAtMs } = props.window;
  useEffect(() => {
    load(endedAtMs === undefined ? { startedAtMs } : { startedAtMs, endedAtMs });
  }, [load, startedAtMs, endedAtMs]);
  const summary = entry?.state === "ready" ? entry.summary : null;
  // A summary the core could not read says so quietly, where the summary would be.
  const failed = entry?.state === "failed" ? entry.code : null;
  const shown = summary === null ? [] : facts(summary, props.elapsedMs);
  return (
    <Presence
      className={styles.turn}
      contentKey={summary !== null ? "summary" : failed !== null ? "failed" : "none"}
    >
      {summary === null ? (
        failed === null ? null : (
          <p className={styles.failed}>
            <FormattedMessage id="conversation.turn.summaryFailed" values={{ code: failed }} />
          </p>
        )
      ) : (
        <div className={styles.summary}>
          <button type="button" className={styles.line} aria-expanded={opened} onClick={toggle}>
            <span className={styles.caret} data-open={opened ? "true" : undefined}>
              <ChevronDownIcon size="sm" />
            </span>
            <span className={styles.facts}>
              {shown.map((fact) => (
                <span key={(fact as { key: string }).key} className={styles.fact}>
                  {fact}
                </span>
              ))}
              {/* motion: A message arrives live */}
              {shown.length === 0 ? (
                <span className={styles.fact}>
                  <FormattedMessage id="conversation.turn.details" />
                </span>
              ) : null}
            </span>
          </button>
          {/* The card opens its space and fades in, and closes it as it fades out; a card open in
              loaded history shows at once (ADE motion, "Disclosure"). */}
          <Presence enterOnMount={false}>{opened ? <Card summary={summary} /> : null}</Presence>
        </div>
      )}
    </Presence>
  );
}
