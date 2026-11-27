import type { AgentSummary } from "@lervo/session-host-contract";
import { type KeyboardEvent, useMemo, useState } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import {
  failureCode,
  useApplicationCommands,
  useChoosers,
  useFiles,
  useImages,
  useMenus,
  useProjectMemory,
} from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { ListRow } from "../../../ui/ListRow";
import { AgentMark } from "./AgentMark";
import { Presence } from "../../../ui/Presence";
import { SectionHeading } from "../../../ui/SectionHeading";
import { Select } from "../../../ui/Select";
import { useWorkspaceStore } from "../../workspaces";
import { renameAgent, setAgentModel, setAgentStatus } from "../model/controller";
import { chooseAgentMark, clearAgentMark } from "../model/marks";
import { useAgentStore } from "../model/store";
import styles from "./AgentProfile.module.css";
import { ContextSections } from "./LearnedSection";
import { PauseSection } from "./PauseSection";

/** Each effort's words, lowest first. */
const EFFORTS: readonly { value: string; message: MessageDescriptor }[] = [
  { value: "low", message: { id: "agents.profile.effort.low" } },
  { value: "medium", message: { id: "agents.profile.effort.medium" } },
  { value: "high", message: { id: "agents.profile.effort.high" } },
  { value: "xhigh", message: { id: "agents.profile.effort.xhigh" } },
  { value: "max", message: { id: "agents.profile.effort.max" } },
];

/**
 * The agent's name, renamed in place (ADE craft rules, 12): pressing it turns it into a field with
 * the same type; Return or leaving the field renames, and Escape keeps the name.
 */
function Name(props: { agent: AgentSummary; onRename: ((name: string) => void) | undefined }) {
  const intl = useIntl();
  const { agent, onRename } = props;
  const [editing, setEditing] = useState(false);
  if (onRename === undefined) return <h1 className={styles.name}>{agent.displayName}</h1>;
  const finish = (value: string) => {
    setEditing(false);
    const name = value.trim();
    if (name !== "" && name !== agent.displayName) onRename(name);
  };
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") finish(event.currentTarget.value);
    if (event.key === "Escape") setEditing(false);
  };
  return editing ? (
    <input
      className={styles.name}
      data-editing=""
      aria-label={intl.formatMessage({ id: "agents.profile.rename" })}
      defaultValue={agent.displayName}
      maxLength={40}
      // The field replaces the name the person just pressed, so it takes the focus at once.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={key}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  ) : (
    <h1 className={styles.heading}>
      <button
        type="button"
        className={styles.name}
        title={intl.formatMessage({ id: "agents.profile.rename" })}
        onClick={() => setEditing(true)}
      >
        {agent.displayName}
      </button>
    </h1>
  );
}

/**
 * An agent's profile (Lervo ADE agents, "The profile"): its mark, name, and role; the model and
 * effort its sessions run with; and the conversations it takes part in. What the core cannot
 * change yet shows as text.
 */
export function AgentProfile(props: { agentId: string }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const menus = useMenus();
  const markDependencies = {
    commands,
    images: useImages(),
    memory: useProjectMemory(),
    files: useFiles(),
    choosers: useChoosers(),
  };
  const agent = useAgentStore((store) =>
    store.agents.find((candidate) => candidate.agentId === props.agentId),
  );
  const projectId = useAgentStore((store) => store.projectId);
  const models = useAgentStore((store) => store.models);
  const advertised = useWorkspaceStore((store) => store.advertisedCommands);
  // The store gives one list; the agent's conversations are derived from it, so the selector
  // never returns a new array on each read.
  const workspaces = useWorkspaceStore((store) => store.workspaces);
  const conversations = useMemo(
    () =>
      workspaces.filter(
        (workspace) =>
          workspace.projectId === projectId &&
          (workspace.participants?.includes(props.agentId) === true ||
            workspace.sessions?.some((session) => session.agentId === props.agentId) === true),
      ),
    [workspaces, projectId, props.agentId],
  );
  const select = useWorkspaceStore((store) => store.select);
  const [failure, setFailure] = useState<string | null>(null);
  if (agent === undefined || projectId === null) return null;
  const run = (change: () => Promise<void>) => {
    setFailure(null);
    change().catch((error: unknown) => setFailure(failureCode(error)));
  };
  const renames = advertised?.includes("agent.rename") === true;
  const pauses = advertised?.includes("agent.status") === true;
  const learns = advertised?.includes("agent.context") === true;
  const { model } = agent;
  const choosesModel =
    advertised?.includes("agent.model") === true && model !== undefined && models.length > 0;
  const choosesMark = advertised?.includes("agent.mark.set") === true;
  const chooseImage = () =>
    run(() =>
      chooseAgentMark(
        markDependencies,
        projectId,
        agent,
        intl.formatMessage({ id: "agents.profile.image.title" }, { name: agent.displayName }),
      ),
    );
  // An agent without an image opens the image panel at once; one with an image offers to change
  // or remove it, as a project's mark does.
  const editMark = () => {
    if (agent.mark === null || agent.mark === undefined) {
      chooseImage();
      return;
    }
    void menus.show([
      { text: intl.formatMessage({ id: "agents.profile.image.choose" }), run: chooseImage },
      {
        text: intl.formatMessage({ id: "agents.profile.image.remove" }),
        run: () => run(() => clearAgentMark(commands, projectId, agent)),
      },
    ]);
  };
  return (
    <div className={styles.profile}>
      <header className={styles.identity}>
        {/* motion: History loads or a workspace reopens */}
        {choosesMark ? (
          <button
            type="button"
            className={styles.markButton}
            aria-label={intl.formatMessage(
              { id: "agents.profile.image.label" },
              { name: agent.displayName },
            )}
            onClick={editMark}
          >
            <AgentMark agent={agent} size="lg" />
          </button>
        ) : (
          <AgentMark agent={agent} size="lg" />
        )}
        <div className={styles.titles}>
          <Name
            agent={agent}
            onRename={
              renames
                ? (name) => run(() => renameAgent(commands, projectId, agent, name))
                : undefined
            }
          />
          <p className={styles.role}>{agent.roleName}</p>
        </div>
      </header>
      {/* motion: History loads or a workspace reopens */}
      {model === undefined ? null : (
        <section className={styles.section}>
          <SectionHeading label={intl.formatMessage({ id: "agents.profile.model" })} />
          <div className={styles.model}>
            {/* motion: History loads or a workspace reopens */}
            {choosesModel ? (
              <>
                <Select
                  label={intl.formatMessage({ id: "agents.profile.model" })}
                  value={model.tier}
                  options={models.map((choice) => ({
                    value: choice.tier,
                    text: choice.displayName,
                  }))}
                  onChange={(tier) =>
                    run(() =>
                      setAgentModel(commands, projectId, agent, { tier, effort: model.effort }),
                    )
                  }
                />
                <Select
                  label={intl.formatMessage({ id: "agents.profile.effort" })}
                  value={model.effort}
                  options={EFFORTS.map((effort) => ({
                    value: effort.value,
                    text: intl.formatMessage(effort.message),
                  }))}
                  onChange={(effort) =>
                    run(() =>
                      setAgentModel(commands, projectId, agent, { tier: model.tier, effort }),
                    )
                  }
                />
              </>
            ) : (
              <p className={styles.value}>{model.displayName ?? model.tier}</p>
            )}
          </div>
          <Presence contentKey={model.source}>
            {model.source === "role" ? (
              <p className={styles.note}>
                <FormattedMessage
                  id="agents.profile.model.role"
                  values={{ role: agent.roleName }}
                />
              </p>
            ) : (
              <p className={styles.note}>
                <FormattedMessage id="agents.profile.model.owner" />
              </p>
            )}
          </Presence>
        </section>
      )}
      <section className={styles.section}>
        <SectionHeading label={intl.formatMessage({ id: "agents.profile.conversations" })} />
        <Presence contentKey={conversations.length === 0 ? "none" : "listed"}>
          {conversations.length === 0 ? (
            <p className={styles.note}>
              <FormattedMessage id="agents.profile.noConversations" />
            </p>
          ) : (
            <div className={styles.rows}>
              {conversations.map((workspace) => (
                <ListRow
                  key={workspace.workspaceId}
                  current={false}
                  onClick={() => select(workspace.workspaceId)}
                  label={workspace.title ?? workspace.branch}
                />
              ))}
            </div>
          )}
        </Presence>
      </section>
      {/* motion: History loads or a workspace reopens */}
      {learns ? <ContextSections projectId={projectId} agentId={agent.agentId} /> : null}
      {/* motion: History loads or a workspace reopens */}
      {pauses ? (
        <PauseSection
          agent={agent}
          onChange={(pause) =>
            run(() => setAgentStatus(commands, projectId, agent, pause ? "suspended" : "active"))
          }
        />
      ) : null}
      <Presence>
        {failure === null ? null : (
          <InlineAlert size="meta">
            <FormattedMessage id="agents.profile.failed" values={{ code: failure }} />
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
