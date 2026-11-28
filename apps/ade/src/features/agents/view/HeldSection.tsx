import { FormattedMessage, useIntl } from "react-intl";

import type { Held } from "../model/learned";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { useAgentStore } from "../model/store";
import styles from "./HeldSection.module.css";
import profile from "./AgentProfile.module.css";

/** Paths whole, one per line, with a line counting those beyond the list. */
function PathList(props: { paths: Held }) {
  const more = props.paths.total - props.paths.paths.length;
  return (
    <ul className={styles.paths}>
      {props.paths.paths.map((path) => (
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
  );
}

/**
 * The paths the agent holds (Lervo ADE agents, "The profile"), as the core's `agent.context` last
 * answered: those under its live write leases, then those its conversations changed and have not
 * sealed yet, which also keep other conversations off them. Each shows whole and relative to the
 * repository, never cut off (ADE craft rules, 8). A core that does not read leases answers none,
 * and the section stays out.
 */
export function HeldSection(props: { agentId: string }) {
  const intl = useIntl();
  const learned = useAgentStore((store) =>
    store.learned?.agentId === props.agentId ? store.learned : null,
  );
  const held = learned?.held ?? null;
  const changed = learned?.changed ?? null;
  // `ContextSections` shows this section only once the paths are known, and fades it.
  if (held === null) return null;
  const unsealed = changed !== null && changed.total > 0;
  return (
    <section className={profile.section}>
      <SectionHeading label={intl.formatMessage({ id: "agents.profile.held" })} />
      <Presence contentKey={held.total === 0 && !unsealed ? "none" : "listed"}>
        {held.total === 0 && !unsealed ? (
          <p className={profile.note}>
            <FormattedMessage id="agents.profile.held.none" />
          </p>
        ) : (
          <div className={styles.lists}>
            {/* motion: History loads or a workspace reopens */}
            {held.total === 0 ? null : <PathList paths={held} />}
            {/* motion: History loads or a workspace reopens */}
            {unsealed ? (
              <div className={styles.changed}>
                <p className={styles.label}>
                  <FormattedMessage id="agents.profile.changed" />
                </p>
                <PathList paths={changed} />
              </div>
            ) : null}
          </div>
        )}
      </Presence>
    </section>
  );
}
