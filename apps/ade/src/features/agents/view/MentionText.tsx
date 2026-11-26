import { mentionParts } from "../model/mentions";
import { useAgentStore } from "../model/store";
import styles from "./MentionText.module.css";

/**
 * Text with each mention of a team agent set apart as a quiet pill (Lervo ADE rooms, "The ADE"),
 * so who was called reads at a glance and never as plain words. Other `@` text stays text.
 */
export function MentionText(props: { text: string }) {
  const agents = useAgentStore((store) => store.agents);
  return mentionParts(props.text, agents).map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <span key={index} className={styles.mention}>
        {part.name}
      </span>
    ),
  );
}
