import { useIntl } from "react-intl";

import { Mark } from "../../../ui/Mark";
import { useAgentStore } from "../model/store";
import styles from "./ParticipantsChip.module.css";

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
  if (shown.length === 0) return null;
  const names = shown.map((agent) => agent.displayName).join(", ");
  return (
    <span
      className={styles.marks}
      role="img"
      aria-label={intl.formatMessage({ id: "agents.participants.label" }, { names })}
      title={names}
    >
      {shown.map((agent) => (
        <Mark
          key={agent.agentId}
          id={agent.agentId}
          name={agent.displayName}
          src={null}
          size="sm"
          shape="round"
        />
      ))}
    </span>
  );
}
