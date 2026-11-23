import { useIntl } from "react-intl";

import { WorkingLine } from "../../../ui/WorkingLine";
import { Composer, ConversationItemView } from "../../conversation";
import type { PendingStart } from "../model/store";
import styles from "./PendingWorkspace.module.css";

/**
 * The workspace of work just sent, while the core creates it (ADE motion, "Starting work"). It has
 * the workspace's layout, the instruction already lands as the first message, and the working
 * line says what happens, so the new workspace replaces it without a visible change.
 */
export function PendingWorkspace(props: { pending: PendingStart }) {
  const intl = useIntl();
  const { instruction, repositoryName } = props.pending;
  return (
    <div className={styles.workspace}>
      <header className={styles.header} data-tauri-drag-region>
        <h1 className={styles.title} data-tauri-drag-region>
          {instruction.split("\n")[0]}
        </h1>
        <span className={styles.repository} data-tauri-drag-region>
          {repositoryName}
        </span>
      </header>
      <div className={styles.conversation}>
        <div className={styles.first}>
          <ConversationItemView
            item={{
              kind: "user_message",
              itemId: "pending",
              createdAtMs: 0,
              state: "complete",
              text: instruction,
            }}
          />
        </div>
      </div>
      <div className={styles.dock}>
        <WorkingLine
          className={styles.working}
          label={intl.formatMessage({ id: "start.pending" })}
        />
        <Composer
          onSend={() => Promise.resolve()}
          waiting={intl.formatMessage({ id: "start.pending.reply" })}
        />
      </div>
    </div>
  );
}
