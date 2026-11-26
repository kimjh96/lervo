import { useAgentStore, AgentMark } from "../../agents";
import styles from "./SpeakerLine.module.css";

/**
 * The line before an agent's turn when the speaking agent changes (Lervo ADE rooms, "The ADE"):
 * its mark, name, and role. A conversation with one agent never shows it.
 */
export function SpeakerLine(props: { agentId: string }) {
  const agent = useAgentStore((store) =>
    store.agents.find((candidate) => candidate.agentId === props.agentId),
  );
  if (agent === undefined) return null;
  return (
    <p className={styles.speaker}>
      <AgentMark agent={agent} size="sm" />
      <span className={styles.name}>{agent.displayName}</span>
      <span className={styles.role}>{agent.roleName}</span>
    </p>
  );
}
