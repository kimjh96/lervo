import { useState } from "react";
import { useIntl } from "react-intl";

import { useApplicationCommands, useListCache } from "../../../ports";
import {
  changesConversations,
  renameConversation,
  TitleField,
  type Workspace,
  useWorkspaceStore,
} from "../../workspaces";
import styles from "./ConversationTitle.module.css";

/**
 * The conversation's title in its header, renamed in place (ADE craft rules, 12): pressing it
 * turns it into a field of the same type; Return or leaving the field renames, and Escape keeps the
 * title. A core that does not rename conversations shows the title as text.
 */
export function ConversationTitle(props: { workspace: Workspace }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const lists = useListCache();
  const renames = useWorkspaceStore(
    (store) => changesConversations(store.advertisedCommands).renames,
  );
  const [editing, setEditing] = useState(false);
  const { workspace } = props;
  const title = workspace.title ?? workspace.branch;
  if (!renames) return title;
  // motion: Renaming in place
  return editing ? (
    <TitleField
      title={title}
      label={intl.formatMessage({ id: "workspaces.rename.label" })}
      className={styles.field}
      onDone={(renamed) => {
        setEditing(false);
        if (renamed !== null)
          void renameConversation({ commands, lists }, workspace.workspaceId, renamed);
      }}
    />
  ) : (
    <button
      type="button"
      className={styles.title}
      title={intl.formatMessage({ id: "workspaces.rename" })}
      onClick={() => setEditing(true)}
    >
      {title}
    </button>
  );
}
