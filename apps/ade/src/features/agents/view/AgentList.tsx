import type { AgentSummary } from "@lervo/session-host-contract";
import { useEffect, useMemo, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { ListRow } from "../../../ui/ListRow";
import { AgentMark } from "./AgentMark";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { StatusRing } from "../../../ui/StatusRing";
import { useDepartingInPlace } from "../../../ui/departing";
import { useItemSpace } from "../../../ui/space";
import { statusMessages, useWorkspaceStore } from "../../workspaces";
import { hireAgent, showProjectAgents } from "../model/controller";
import { agentActivity, managesAgents, productOwnerRole, teamAgents } from "../model/decisions";
import { openProfile, useAgentStore } from "../model/store";
import styles from "./AgentList.module.css";
import { roleSummary } from "./role-summary";

function AgentRow(props: { agent: AgentSummary; leaving: boolean }) {
  const intl = useIntl();
  const { agent } = props;
  const activity = useWorkspaceStore((store) =>
    agentActivity(agent.agentId, store.workspaces, store.statuses),
  );
  const arrived = useAgentStore((store) => store.arrived.has(agent.agentId));
  const open = useAgentStore((store) => store.profile === agent.agentId);
  // An agent hired while the person watches arrives with the space it takes, and one that leaves
  // the team fades out where it was and gives its space back (ADE motion, 11 and 12).
  const space = useItemSpace<HTMLDivElement>(arrived, props.leaving);
  return (
    <div
      ref={space}
      data-arrived={arrived ? "true" : undefined}
      data-leaving={props.leaving ? "" : undefined}
      aria-hidden={props.leaving ? true : undefined}
      inert={props.leaving}
      className={styles.agent}
    >
      <ListRow
        current={open}
        quiet={agent.status === "suspended"}
        onClick={() => openProfile(agent.agentId)}
        leading={
          <StatusRing
            tone={activity === null ? null : activity === "working" ? "working" : "attention"}
            label={activity === null ? null : intl.formatMessage(statusMessages[activity])}
          >
            <AgentMark agent={agent} size="sm" />
          </StatusRing>
        }
        label={
          <>
            {agent.displayName}
            <span className={styles.role}>
              {intl.formatMessage({ id: "agents.role" }, { role: agent.roleName })}
            </span>
          </>
        }
      />
    </div>
  );
}

/**
 * The team's rows. Each project's list keeps its own departures, so switching projects, which
 * crossfades the whole list, never reads as agents leaving.
 */
function AgentRows(props: { team: readonly AgentSummary[] }) {
  const shown = useDepartingInPlace(props.team, agentKey);
  return shown.map(({ item, leaving }) => (
    <AgentRow key={item.agentId} agent={item} leaving={leaving} />
  ));
}

const agentKey = (agent: AgentSummary) => agent.agentId;

/**
 * The selected project's team under the switcher (Lervo ADE agents, "The sidebar"), in the order it
 * was hired, and the plus that hires by role from the interface's own menu, hung below it. Lervo's
 * own maintenance agents are not the team and do not show. A project without team agents
 * offers one row that hires a product owner. An older core that answers no agent command shows
 * nothing.
 */
export function AgentList(props: { projectId: string | null }) {
  const commands = useApplicationCommands();
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  const managed = managesAgents(advertised);
  const loaded = useAgentStore((store) => store.loaded);
  const shown = useAgentStore((store) => store.projectId);
  const { projectId } = props;

  // The lists reload on every connection and after each change; the agents follow them, so a
  // list asked before the session host connected never stays unanswered.
  useEffect(() => {
    if (managed && projectId !== null) void showProjectAgents(commands, projectId);
  }, [advertised, commands, managed, projectId]);

  // Nothing shows until the first list is known, so no heading stands over nothing. The list
  // then opens its space as it fades in, together with the conversations' heading, so the rows
  // below slide once instead of jumping (ADE motion, "Space").
  const ready = managed && projectId !== null && loaded && shown !== null;
  return <Presence>{ready ? <Agents shown={shown} /> : null}</Presence>;
}

/** The team's rows, the hire menu, and a failure, once the project's list is known. */
function Agents(props: { shown: string }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const { agents, roles, failure } = useAgentStore();
  const [menuAt, setMenuAt] = useState<{ rect: DOMRect; byKey: boolean } | null>(null);
  const { shown } = props;
  // Kept as one array per change of the agents, so its rows can tell departures from renders.
  const team = useMemo(() => teamAgents(agents), [agents]);
  const owner = productOwnerRole(roles);
  const hire = (roleId: string) => void hireAgent(commands, shown, roleId);

  return (
    <section aria-label={intl.formatMessage({ id: "agents.label" })}>
      <SectionHeading
        label={intl.formatMessage({ id: "agents.label" })}
        add={{
          label: intl.formatMessage({ id: "agents.hire" }),
          onClick: (event) =>
            setMenuAt({
              rect: event.currentTarget.getBoundingClientRect(),
              byKey: event.detail === 0,
            }),
        }}
      />
      <Presence contentKey={shown}>
        <div className={styles.rows}>
          <AgentRows team={team} />
          <Presence>
            {team.length === 0 && owner !== undefined ? (
              <ListRow
                current={false}
                quiet
                onClick={() => hire(owner.roleId)}
                leading={<PlusIcon size="md" />}
                label={<FormattedMessage id="agents.hireProductOwner" />}
              />
            ) : null}
          </Presence>
        </div>
      </Presence>
      <Presence className={styles.failure}>
        {failure === null ? null : (
          <InlineAlert size="caption">
            <FormattedMessage id="agents.failed" values={{ code: failure }} />
          </InlineAlert>
        )}
      </Presence>
      {/* motion: Overlays: command palette, menus, popovers */}
      {menuAt === null || roles.length === 0 ? null : (
        <PopoverMenu
          anchor={menuAt.rect}
          label={intl.formatMessage({ id: "agents.hire" })}
          openedByKey={menuAt.byKey}
          wide
          items={roles.map((role) => ({
            text: role.name,
            detail: roleSummary(intl, role.roleId, role.description),
            ...(role.source === "repository"
              ? { shortcut: intl.formatMessage({ id: "agents.thisProject" }) }
              : {}),
            run: () => hire(role.roleId),
          }))}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  );
}
