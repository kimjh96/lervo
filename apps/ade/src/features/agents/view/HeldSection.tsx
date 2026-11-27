import { FormattedMessage, useIntl } from "react-intl";

import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { useAgentStore } from "../model/store";
import styles from "./HeldSection.module.css";
import profile from "./AgentProfile.module.css";

/**
 * The paths the agent holds under a live write lease (Lervo ADE agents, "The profile"), as the
 * core's `agent.context` last answered: whole and relative to the repository, never cut off
 * (ADE craft rules, 8). A core that does not read leases answers none, and the section stays out.
 */
export function HeldSection(props: { agentId: string }) {
  const intl = useIntl();
  const held = useAgentStore((store) =>
    store.learned?.agentId === props.agentId ? store.learned.held : null,
  );
  // motion: History loads or a workspace reopens
  if (held === null) return null;
  const more = held.total - held.paths.length;
  return (
    <section className={profile.section}>
      <SectionHeading label={intl.formatMessage({ id: "agents.profile.held" })} />
      <Presence contentKey={held.total === 0 ? "none" : "listed"}>
        {held.total === 0 ? (
          <p className={profile.note}>
            <FormattedMessage id="agents.profile.held.none" />
          </p>
        ) : (
          <ul className={styles.paths}>
            {held.paths.map((path) => (
              <li key={path}>
                <code className={styles.path}>{path}</code>
              </li>
            ))}
            {/* motion: History loads or a workspace reopens */}
            {more > 0 ? (
              <li className={styles.more}>
                <FormattedMessage id="agents.profile.held.more" values={{ count: more }} />
              </li>
            ) : null}
          </ul>
        )}
      </Presence>
    </section>
  );
}
