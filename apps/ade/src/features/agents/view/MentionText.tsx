import { teamAgents } from "../model/decisions";
import { mentionParts } from "../model/mentions";
import { useAgentStore } from "../model/store";
import styles from "./MentionText.module.css";

/**
 * Text with each mention of a team agent set apart as a quiet pill (Lervo ADE rooms, "The ADE"),
 * so who was called reads at a glance and never as plain words. Other `@` text stays text. Only
 * the team's agents are set apart, as only they receive a mention. In a field, the pill keeps the
 * text's metrics, so it sits exactly under the field's own glyphs.
 */
export function MentionText(props: { text: string; inField?: boolean }) {
  const agents = useAgentStore((store) => store.agents);
  return mentionParts(props.text, teamAgents(agents)).map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <span key={index} className={props.inField === true ? styles.inField : styles.mention}>
        {part.name}
      </span>
    ),
  );
}
