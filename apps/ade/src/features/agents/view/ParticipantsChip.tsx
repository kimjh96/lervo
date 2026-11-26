import type { AgentSummary } from "@lervo/session-host-contract";
import { useState } from "react";
import { useIntl } from "react-intl";

import { ChevronDownIcon } from "../../../ui/icons";
import { Mark } from "../../../ui/Mark";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { HIRE_PRODUCT_OWNER, toggleParticipant } from "../model/decisions";
import styles from "./ParticipantsChip.module.css";

/** An agent the chip offers, or the Product Owner that Lervo would hire. */
type Candidate = Pick<AgentSummary, "agentId" | "displayName" | "roleName">;

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
  /** Whether a Product Owner that Lervo hires is offered first, for a team without one. */
  proposesProductOwner: boolean;
  onChange: (chosen: string[]) => void;
}) {
  const intl = useIntl();
  const [menuAt, setMenuAt] = useState<{ rect: DOMRect; byKey: boolean } | null>(null);
  // The proposed Product Owner names its role, not an agent, until Lervo hires it.
  const candidates: readonly Candidate[] = [
    ...(props.proposesProductOwner
      ? [
          {
            agentId: HIRE_PRODUCT_OWNER,
            displayName: intl.formatMessage({ id: "agents.participants.proposedLead" }),
            roleName: intl.formatMessage({ id: "agents.participants.proposedLeadDetail" }),
          },
        ]
      : []),
    ...props.team,
  ];
  const chosen = props.chosen
    .map((id) => candidates.find((agent) => agent.agentId === id))
    .filter((agent): agent is Candidate => agent !== undefined);
  if (chosen.length === 0) return null;
  const list = (agents: readonly Candidate[]) =>
    new Intl.ListFormat(intl.locale, { type: "unit", style: "short" }).format(
      agents.map((agent) => agent.displayName),
    );
  const names =
    chosen.length <= 2
      ? list(chosen)
      : intl.formatMessage(
          { id: "agents.participants.more" },
          { names: list(chosen.slice(0, 2)), count: chosen.length - 2 },
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
          items={candidates.map((agent) => ({
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
