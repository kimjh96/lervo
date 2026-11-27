import type { ConversationItem } from "@lervo/session-host-contract";
import type { ReactNode } from "react";
import { FormattedMessage, type MessageDescriptor } from "react-intl";

import { useWorkspaceStore } from "../../workspaces";
import styles from "./renderers.module.css";

/** Each claim line's words: who holds the path in a listed conversation, elsewhere, or no one. */
const messages: Readonly<
  Record<string, { linked: MessageDescriptor; held: MessageDescriptor; none: MessageDescriptor }>
> = {
  claim_conflict: {
    linked: { id: "room.claimConflict" },
    held: { id: "room.claimConflictHeld" },
    none: { id: "room.claimRefused" },
  },
  claim_unresolved: {
    linked: { id: "room.claimUnresolved" },
    held: { id: "room.claimUnresolvedHeld" },
    none: { id: "room.claimUnresolvedCode" },
  },
};

/** Whether `code` is a claim line this view renders. */
export function isClaimLine(code: string): boolean {
  return Object.hasOwn(messages, code) || code === "claim_unresolved_more";
}

/**
 * A claim's room line (Lervo ADE coordination, "What the ADE shows"): after a tool call Lervo
 * stopped, "Ciel was stopped at `src/retry.ts` · Arin holds it in Log format"; at a turn's end, a
 * path its reconciliation left unresolved, "`src/retry.ts` stays unresolved · Arin holds it", and
 * a count for the rest. The holder's conversation opens; a path with no holder names the core's
 * code instead.
 */
export function ClaimLine({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  const workspaceId = String(item.parameters.workspace ?? "");
  const known = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === workspaceId),
  );
  const select = useWorkspaceStore((store) => store.select);
  if (item.code === "claim_unresolved_more")
    return (
      <p className={styles.roomLine}>
        <FormattedMessage
          id="room.claimUnresolvedMore"
          values={{ count: Number(item.parameters.count ?? 0) }}
        />
      </p>
    );
  const words = messages[item.code] ?? messages.claim_conflict!;
  const agent = String(item.parameters.agent ?? "");
  const holder = String(item.parameters.holder ?? "");
  const code = (chunks: ReactNode) => <code className={styles.roomCode}>{chunks}</code>;
  const values = { agent, holder, path: String(item.parameters.path ?? ""), code };
  const title = known?.title ?? known?.branch ?? null;
  if (holder === "")
    return (
      <p className={styles.roomLine}>
        <FormattedMessage
          {...words.none}
          values={{ ...values, reason: String(item.parameters.code ?? "") }}
        />
      </p>
    );
  if (title === null)
    return (
      <p className={styles.roomLine}>
        <FormattedMessage {...words.held} values={values} />
      </p>
    );
  const link = (chunks: ReactNode) => (
    <button type="button" className={styles.roomLink} onClick={() => select(workspaceId)}>
      {chunks}
    </button>
  );
  return (
    <p className={styles.roomLine}>
      <FormattedMessage {...words.linked} values={{ ...values, title, link }} />
    </p>
  );
}
