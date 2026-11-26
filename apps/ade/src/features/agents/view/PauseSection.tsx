import type { AgentSummary } from "@lervo/session-host-contract";
import { FormattedMessage } from "react-intl";

import { Button } from "../../../ui/Button";
import { Presence } from "../../../ui/Presence";
import styles from "./AgentProfile.module.css";

/**
 * Pausing an agent from its profile (Lervo ADE agents, "The profile"): "Pause agent" sets it
 * suspended, "Resume agent" lets it work again, and the line under them says what pausing does.
 * Retiring cannot be undone, so the profile does not offer it.
 */
export function PauseSection(props: { agent: AgentSummary; onChange: (paused: boolean) => void }) {
  const paused = props.agent.status === "suspended";
  return (
    <section className={styles.section}>
      <div className={styles.actions}>
        <Button variant="outlined" onClick={() => props.onChange(!paused)}>
          <Presence as="span" className={styles.label} contentKey={paused ? "resume" : "pause"}>
            {paused ? (
              <FormattedMessage id="agents.profile.resume" />
            ) : (
              <FormattedMessage id="agents.profile.pause" />
            )}
          </Presence>
        </Button>
      </div>
      <Presence contentKey={paused ? "paused" : "active"}>
        {paused ? (
          <p className={styles.note}>
            <FormattedMessage id="agents.profile.paused" />
          </p>
        ) : (
          <p className={styles.note}>
            <FormattedMessage id="agents.profile.pauseNote" />
          </p>
        )}
      </Presence>
    </section>
  );
}
