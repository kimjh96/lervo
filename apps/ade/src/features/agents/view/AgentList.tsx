import type { AgentSummary } from "@lervo/session-host-contract";
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { ChevronDownIcon, PlusIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { ListRow } from "../../../ui/ListRow";
import { Mark } from "../../../ui/Mark";
import { PopoverMenu } from "../../../ui/PopoverMenu";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { useItemSpace } from "../../../ui/space";
import { useWorkspaceStore } from "../../workspaces";
import { hireAgent, showProjectAgents } from "../model/controller";
import { lervoAgents, managesAgents, productOwnerRole, teamAgents } from "../model/decisions";
import { useAgentStore } from "../model/store";
import styles from "./AgentList.module.css";
import { roleSummary } from "./role-summary";

function AgentRow(props: { agent: AgentSummary; quiet?: boolean }) {
  const intl = useIntl();
  const { agent } = props;
  const arrived = useAgentStore((store) => store.arrived.has(agent.agentId));
  // An agent hired while the person watches arrives with the space it takes (ADE motion, 12).
  const space = useItemSpace<HTMLDivElement>(arrived, false);
  return (
    <div ref={space} data-arrived={arrived ? "true" : undefined} className={styles.agent}>
      <ListRow
        current={false}
        quiet={props.quiet}
        leading={
          <Mark id={agent.agentId} name={agent.displayName} src={null} size="sm" shape="round" />
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
 * The selected project's agents under the switcher (Lervo ADE agents, "The sidebar"): the team in
 * the order it was hired, Lervo's own agents folded into one row that opens in place, and the plus
 * that hires by role from the interface's own menu, hung below it. A project without team agents
 * offers one row that hires a product owner. An older core that answers no agent command shows
 * nothing.
 */
export function AgentList(props: { projectId: string | null }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  const managed = managesAgents(advertised);
  const { agents, roles, loaded, failure, lervoOpen, projectId: shown } = useAgentStore();
  const [menuAt, setMenuAt] = useState<{ rect: DOMRect; byKey: boolean } | null>(null);
  const { projectId } = props;

  // The lists reload on every connection and after each change; the agents follow them, so a
  // list asked before the session host connected never stays unanswered.
  useEffect(() => {
    if (managed && projectId !== null) void showProjectAgents(commands, projectId);
  }, [advertised, commands, managed, projectId]);

  // Nothing shows until the first list is known, so no heading stands over nothing.
  if (!managed || projectId === null || !loaded || shown === null) return null;
  const team = teamAgents(agents);
  const lervos = lervoAgents(agents);
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
          {team.map((agent) => (
            <AgentRow key={agent.agentId} agent={agent} />
          ))}
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
          <Presence>
            {lervos.length === 0 ? null : (
              <ListRow
                current={false}
                quiet
                expanded={lervoOpen}
                onClick={() => useAgentStore.setState({ lervoOpen: !lervoOpen })}
                leading={
                  <span className={styles.disclosure} data-open={lervoOpen ? "" : undefined}>
                    <ChevronDownIcon size="sm" />
                  </span>
                }
                label={<FormattedMessage id="agents.lervo" values={{ count: lervos.length }} />}
              />
            )}
          </Presence>
          <Presence>
            {lervoOpen && lervos.length > 0 ? (
              <div>
                {lervos.map((agent) => (
                  <AgentRow key={agent.agentId} agent={agent} quiet />
                ))}
              </div>
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
