import { type KeyboardEvent, type RefObject, useState } from "react";
import { useIntl } from "react-intl";

import { caretPoint } from "../../../ui/caret";
import { type Suggestion, SuggestionList, suggestionId } from "../../../ui/SuggestionList";
import { AgentMark } from "../../agents";
import type { Mentionable } from "../model/mentionables";

/** The `@` being typed: where it starts, where the caret is, and what follows it. */
interface Query {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly anchor: { readonly left: number; readonly top: number };
}

/** An `@` at the start or after a space or bracket, and the name typed after it so far. */
const TYPED_MENTION = /(?:^|[\s(])@([\p{L}\p{N}_-]{0,40})$/u;
/** How many agents the list offers at once. */
const MAXIMUM_SUGGESTIONS = 8;
const LIST_ID = "mention-suggestions";

/**
 * The reply card's `@` (Lervo ADE rooms, "The ADE"): typing it offers the conversation's agents,
 * then the rest of the team, who join when mentioned. Typing narrows the list; Up and Down move,
 * Return or Tab chooses, and Escape closes it. Choosing writes `@Name ` in place.
 */
export function useMentions(input: {
  text: string;
  setText: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  mentionables: readonly Mentionable[];
}) {
  const intl = useIntl();
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);
  const typed = query?.text.toLocaleLowerCase() ?? "";
  const offered = input.mentionables
    .filter((agent) => agent.displayName.toLocaleLowerCase().startsWith(typed))
    .slice(0, MAXIMUM_SUGGESTIONS);
  const open = query !== null && offered.length > 0;

  /** Reads the field after a change: an `@` before the caret opens or narrows the list. */
  const update = () => {
    const field = input.field.current;
    if (field === null || input.mentionables.length === 0) return setQuery(null);
    const end = field.selectionEnd;
    const match = TYPED_MENTION.exec(field.value.slice(0, end));
    if (match === null) return setQuery(null);
    const text = match[1] ?? "";
    // The list hangs above the reply card, at the caret's left, so it never covers the card.
    const caret = caretPoint(field);
    const card = field.closest("form")?.getBoundingClientRect().top ?? caret.top;
    const anchor = { left: caret.left, top: Math.min(caret.top, card) };
    setQuery({ start: end - text.length - 1, end, text, anchor });
    setActive(0);
  };

  const choose = (agentId: string) => {
    const agent = input.mentionables.find((candidate) => candidate.agentId === agentId);
    if (query === null || agent === undefined) return;
    const written = `@${agent.displayName} `;
    input.setText(input.text.slice(0, query.start) + written + input.text.slice(query.end));
    setQuery(null);
    const caret = query.start + written.length;
    requestAnimationFrame(() => input.field.current?.setSelectionRange(caret, caret));
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown") setActive((index) => (index + 1) % offered.length);
    else if (event.key === "ArrowUp")
      setActive((index) => (index - 1 + offered.length) % offered.length);
    else if (event.key === "Enter" || event.key === "Tab") choose(offered[active]?.agentId ?? "");
    else if (event.key === "Escape") setQuery(null);
    else return false;
    return true;
  };

  const suggestion = (agent: Mentionable): Suggestion => ({
    key: agent.agentId,
    text: agent.displayName,
    leading: <AgentMark agent={agent} size="sm" />,
    detail: agent.participant
      ? agent.roleName
      : intl.formatMessage({ id: "conversation.mention.joins" }, { role: agent.roleName }),
  });
  const here = offered.filter((agent) => agent.participant);
  const team = offered.filter((agent) => !agent.participant);
  const list = (
    <SuggestionList
      id={LIST_ID}
      label={intl.formatMessage({ id: "conversation.mention.label" })}
      open={open}
      anchor={query?.anchor ?? { left: 0, top: 0 }}
      groups={[
        ...(here.length === 0
          ? []
          : [
              {
                label: intl.formatMessage({ id: "conversation.mention.participants" }),
                items: here.map(suggestion),
              },
            ]),
        ...(team.length === 0
          ? []
          : [
              {
                label: intl.formatMessage({ id: "conversation.mention.team" }),
                items: team.map(suggestion),
              },
            ]),
      ]}
      active={active}
      onActive={setActive}
      onChoose={(item) => choose(item.key)}
    />
  );
  return {
    update,
    close: () => setQuery(null),
    onKey,
    list,
    aria: {
      id: LIST_ID,
      expanded: open,
      activeId: open ? suggestionId(LIST_ID, active) : undefined,
    },
  };
}
