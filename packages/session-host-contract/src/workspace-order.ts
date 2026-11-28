/** What a conversation's place in the list depends on. */
export interface ConversationPlace {
  /** When the owner pinned it; absent when it is not pinned. */
  readonly pinnedAt?: string | undefined;
  /** Its latest activity; an older core omits it. */
  readonly activeAt?: string | undefined;
}

const later = (left: string | undefined, right: string | undefined) =>
  (right ?? "").localeCompare(left ?? "");

/**
 * The conversation list's order (Lervo ADE sessions, "Renaming and pinning"): the pinned
 * conversations first, the latest pinned on top, then the others by their latest activity. The
 * core lists in it, and the interface applies it to a pin it shows before the core answers, so a
 * conversation moves once, and an unpinned one returns to its place. Conversations without an
 * activity time, from an older core, keep the order given.
 */
export function conversationOrder<T extends ConversationPlace>(conversations: readonly T[]): T[] {
  const pinned = conversations
    .filter((conversation) => conversation.pinnedAt !== undefined)
    .sort((left, right) => later(left.pinnedAt, right.pinnedAt));
  const others = conversations.filter((conversation) => conversation.pinnedAt === undefined);
  const timed = others.every((conversation) => conversation.activeAt !== undefined);
  return [
    ...pinned,
    ...(timed ? others.sort((left, right) => later(left.activeAt, right.activeAt)) : others),
  ];
}
