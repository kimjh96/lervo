import type { AgentSummary } from "@lervo/session-host-contract";
import { useState } from "react";
import { useIntl } from "react-intl";

import { ChevronDownIcon } from "../../../ui/icons";
import { Mark } from "../../../ui/Mark";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { toggleParticipant } from "../model/decisions";
import styles from "./ParticipantsChip.module.css";

/** How many marks the chip overlaps before the rest go into a count. */
const SHOWN_MARKS = 3;

/**
 * The start card's participants (Lervo ADE agents, "Participants and sessions"): the chosen team
 * agents' marks and names, which open the interface's own menu below the chip to choose several.
 * The first chosen agent writes; the last one cannot be removed.
 */
export function ParticipantsChip(props: {
  team: readonly AgentSummary[];
  chosen: readonly string[];
  onChange: (chosen: string[]) => void;
}) {
  const intl = useIntl();
  const [menuAt, setMenuAt] = useState<{ rect: DOMRect; byKey: boolean } | null>(null);
  const chosen = props.chosen
    .map((id) => props.team.find((agent) => agent.agentId === id))
    .filter((agent): agent is AgentSummary => agent !== undefined);
  if (chosen.length === 0) return null;
  const names =
    chosen.length <= 2
      ? chosen.map((agent) => agent.displayName).join(", ")
      : intl.formatMessage(
          { id: "agents.participants.more" },
          {
            names: chosen
              .slice(0, 2)
              .map((agent) => agent.displayName)
              .join(", "),
            count: chosen.length - 2,
          },
        );
  return (
    <>
      <button
        type="button"
        className={styles.chip}
        aria-label={intl.formatMessage({ id: "agents.participants.label" }, { names })}
        aria-expanded={menuAt !== null}
        onClick={(event) =>
          setMenuAt({
            rect: event.currentTarget.getBoundingClientRect(),
            byKey: event.detail === 0,
          })
        }
      >
        <span className={styles.marks}>
          {chosen.slice(0, SHOWN_MARKS).map((agent) => (
            <Mark
              key={agent.agentId}
              id={agent.agentId}
              name={agent.displayName}
              src={null}
              size="sm"
              shape="round"
            />
          ))}
        </span>
        <span className={styles.names}>{names}</span>
        <ChevronDownIcon size="sm" />
      </button>
      {/* motion: Overlays: command palette, menus, popovers */}
      {menuAt === null ? null : (
        <PopoverMenu
          anchor={menuAt.rect}
          label={intl.formatMessage({ id: "agents.participants.choose" })}
          openedByKey={menuAt.byKey}
          multiple
          items={props.team.map((agent) => ({
            leading: (
              <Mark
                id={agent.agentId}
                name={agent.displayName}
                src={null}
                size="sm"
                shape="round"
              />
            ),
            text: agent.displayName,
            detail: agent.roleName,
            checked: props.chosen.includes(agent.agentId),
            run: () => props.onChange(toggleParticipant(props.chosen, agent.agentId)),
          }))}
          onClose={() => setMenuAt(null)}
        />
      )}
    </>
  );
}
