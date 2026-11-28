import type { AgentSummary } from "@lervo/session-host-contract";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { Button } from "../../../ui/Button";
import { SectionHeading } from "../../../ui/SectionHeading";
import { Select } from "../../../ui/Select";
import { useWorkspaceStore } from "../../workspaces";
import { moveAgentRole, openRoleSheet, ownRole } from "../model/roles";
import { useAgentStore } from "../model/store";
import styles from "./AgentProfile.module.css";

/**
 * The agent's role in its profile (Lervo ADE agents, "The profile"; ADR-0662): a menu that moves
 * the agent to another role, keeping its name and what it learned, and "Edit Role" for a role the
 * project wrote itself. A core that does not advertise `agent.role` shows none of it; the role's
 * name stays under the agent's name.
 */
export function RoleSection(props: {
  agent: AgentSummary;
  projectId: string;
  run: (change: () => Promise<void>) => void;
}) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const roles = useAgentStore((store) => store.roles);
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  const { agent, projectId, run } = props;
  if (advertised?.includes("agent.role") !== true) return null;
  const role = roles.find((item) => item.roleId === agent.roleId);
  const edits = advertised.includes("role.edit") && ownRole(role);
  const choose = (roleId: string) => {
    const next = roles.find((item) => item.roleId === roleId);
    if (next !== undefined && roleId !== agent.roleId)
      run(() => moveAgentRole(commands, projectId, agent, next));
  };
  return (
    <section className={styles.section}>
      <SectionHeading label={intl.formatMessage({ id: "agents.profile.role" })} />
      <div className={styles.model}>
        <Select
          label={intl.formatMessage({ id: "agents.profile.role" })}
          value={agent.roleId}
          options={roles.map((item) => ({ value: item.roleId, text: item.name }))}
          onChange={choose}
        />
        {/* motion: History loads or a workspace reopens */}
        {edits ? (
          <Button variant="outlined" onClick={() => openRoleSheet(agent.roleId)}>
            <FormattedMessage id="agents.profile.role.edit" />
          </Button>
        ) : null}
      </div>
      <p className={styles.note}>
        <FormattedMessage id="agents.profile.role.note" />
      </p>
    </section>
  );
}
