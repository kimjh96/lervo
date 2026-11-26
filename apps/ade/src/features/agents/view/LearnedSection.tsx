import { useEffect } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { loadLearned } from "../model/learned";
import { useAgentStore } from "../model/store";
import styles from "./LearnedSection.module.css";
import profile from "./AgentProfile.module.css";

/** Each memory kind's words; a kind this interface does not know reads as a note. */
const KINDS: Readonly<Record<string, MessageDescriptor>> = {
  work_outcome: { id: "agents.profile.learned.kind.work_outcome" },
  working_preference: { id: "agents.profile.learned.kind.working_preference" },
  decision_rationale: { id: "agents.profile.learned.kind.decision_rationale" },
  relationship: { id: "agents.profile.learned.kind.relationship" },
  expertise: { id: "agents.profile.learned.kind.expertise" },
  conversation_note: { id: "agents.profile.learned.kind.conversation_note" },
};

const kindMessage = (kind: string): MessageDescriptor =>
  (Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined) ?? {
    id: "agents.profile.learned.kind.other",
  };

/**
 * What the agent has learned (Lervo ADE agents, "The profile"): its active context entries,
 * newest first, as the core reads them. Each shows its words, then what kind of note it is and
 * when it was observed. A restricted entry says that its words stay with the agent.
 */
export function LearnedSection(props: { projectId: string; agentId: string }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const { projectId, agentId } = props;
  useEffect(() => {
    void loadLearned(commands, projectId, agentId);
  }, [commands, projectId, agentId]);
  const learned = useAgentStore((store) =>
    store.learned?.agentId === agentId ? store.learned : null,
  );
  const entries = learned?.entries ?? null;
  const failure = learned?.failure ?? null;
  const shown =
    failure !== null
      ? "failed"
      : entries === null
        ? "loading"
        : entries.length === 0
          ? "none"
          : "listed";
  return (
    <section className={profile.section}>
      <SectionHeading label={intl.formatMessage({ id: "agents.profile.learned" })} />
      <Presence contentKey={shown}>
        {failure !== null ? (
          <p className={profile.note}>
            <FormattedMessage id="agents.profile.learned.failed" values={{ code: failure }} />
          </p>
        ) : entries === null ? null : entries.length === 0 ? (
          <p className={profile.note}>
            <FormattedMessage id="agents.profile.learned.none" />
          </p>
        ) : (
          <ul className={styles.entries}>
            {entries.map((entry) => (
              <li key={entry.entryId} className={styles.entry}>
                {/* motion: History loads or a workspace reopens */}
                {entry.summary === null ? (
                  <p className={styles.kept}>
                    <FormattedMessage id="agents.profile.learned.restricted" />
                  </p>
                ) : (
                  <p className={styles.text}>{entry.summary}</p>
                )}
                <p className={styles.meta}>
                  <FormattedMessage
                    id="agents.profile.learned.meta"
                    values={{
                      kind: intl.formatMessage(kindMessage(entry.kind)),
                      date: intl.formatDate(entry.observedAt, { dateStyle: "medium" }),
                    }}
                  />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Presence>
    </section>
  );
}
