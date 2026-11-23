import { PaneHeader } from "../../../ui/PaneHeader";
import { StartingConversation } from "../../conversation";
import type { PendingStart } from "../model/store";
import styles from "./PendingWorkspace.module.css";

/**
 * The workspace of work just sent, while the core creates it (ADE motion, "Starting work"). It is
 * the workspace's own header and conversation, so the new workspace replaces it without a visible
 * change.
 */
export function PendingWorkspace(props: { pending: PendingStart }) {
  const { instruction, repositoryName } = props.pending;
  return (
    <div className={styles.workspace}>
      <PaneHeader title={instruction.split("\n")[0] ?? ""} detail={repositoryName} arrive={false} />
      <StartingConversation firstMessage={instruction} />
    </div>
  );
}
