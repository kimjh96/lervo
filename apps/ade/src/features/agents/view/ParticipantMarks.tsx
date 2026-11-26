import { useIntl } from "react-intl";

import { AgentMark } from "./AgentMark";
import { useAgentStore } from "../model/store";
import styles from "./ParticipantsChip.module.css";
import { Presence } from "../../../ui/Presence";

/**
 * A conversation's participants in its header (Lervo ADE agents, "Participants and sessions"):
 * their marks, overlapping, the writing agent first. Agents the sidebar does not know, such as
 * another project's, are left out.
 */
export function ParticipantMarks(props: { participants: readonly string[] | undefined }) {
  const intl = useIntl();
  const agents = useAgentStore((store) => store.agents);
  const shown = (props.participants ?? [])
    .map((id) => agents.find((agent) => agent.agentId === id))
    .filter((agent) => agent !== undefined);
  const names = new Intl.ListFormat(intl.locale, { type: "unit", style: "short" }).format(
    shown.map((agent) => agent.displayName),
  );
  // The marks arrive with the agents' list, so the header never pops them in.
  return (
    <Presence as="span" justify="end">
      {shown.length === 0 ? null : (
        <span
          className={styles.marks}
          role="img"
          aria-label={intl.formatMessage({ id: "agents.participants.label" }, { names })}
          title={names}
        >
          {shown.map((agent) => (
            <AgentMark key={agent.agentId} agent={agent} size="sm" />
          ))}
        </span>
      )}
    </Presence>
  );
}
