import type { ConversationItem } from "@lervo/session-host-contract";
import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";

import { useWorkspaceStore } from "../../workspaces";
import styles from "./renderers.module.css";

/**
 * After a tool call Lervo stopped, who holds its path (Lervo ADE coordination, "What the owner
 * sees"): "Ciel was stopped at `src/retry.ts` · Arin holds it in Log format", where the holder's
 * conversation opens. A path with no holder, such as one outside the lead's responsibility, names
 * the core's code instead.
 */
export function ClaimLine({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  const workspaceId = String(item.parameters.workspace ?? "");
  const known = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === workspaceId),
  );
  const select = useWorkspaceStore((store) => store.select);
  const agent = String(item.parameters.agent ?? "");
  const holder = String(item.parameters.holder ?? "");
  const code = (chunks: ReactNode) => <code className={styles.roomCode}>{chunks}</code>;
  const values = { agent, holder, path: String(item.parameters.path ?? ""), code };
  const title = known?.title ?? known?.branch ?? null;
  if (holder === "")
    return (
      <p className={styles.roomLine}>
        <FormattedMessage
          id="room.claimRefused"
          values={{ ...values, reason: String(item.parameters.code ?? "") }}
        />
      </p>
    );
  if (title === null)
    return (
      <p className={styles.roomLine}>
        <FormattedMessage id="room.claimConflictHeld" values={values} />
      </p>
    );
  const link = (chunks: ReactNode) => (
    <button type="button" className={styles.roomLink} onClick={() => select(workspaceId)}>
      {chunks}
    </button>
  );
  return (
    <p className={styles.roomLine}>
      <FormattedMessage id="room.claimConflict" values={{ ...values, title, link }} />
    </p>
  );
}
