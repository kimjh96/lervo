import { workspaceTitle } from "@lervo/session-host-contract";
import { useEffect, useLayoutEffect, useRef } from "react";

import { ConnectionStatus, HostUpdateNotice } from "../features/connection";
import { preloadConversation, WorkspaceConversation } from "../features/conversation";
import {
  AgentList,
  AgentProfile,
  listSettled,
  AgentSheets,
  managesAgents,
  useAgentStore,
} from "../features/agents";
import { AddProjectSheet, ProjectSwitcher, useCurrentProject } from "../features/projects";
import { StartScreen, type Surface, useFirstRun, useSurface } from "../features/start";
import { WorkspaceHeader } from "../features/workspace-header";
import { useWorkspaceStore, WorkspaceList } from "../features/workspaces";
import { motion } from "../design/generated/motion";
import { Presence } from "../ui/Presence";
import { moveSpace } from "../ui/space";
import { ViewPresence } from "../ui/ViewPresence";
import styles from "./Frame.module.css";

function Main(props: { surface: Surface }) {
  const { surface } = props;
  if (surface.kind === "agent")
    return (
      <div className={styles.view} data-background={surface.background}>
        <div className={styles.titlebar} data-tauri-drag-region />
        {/* A long profile scrolls under the title bar, which stays a drag region. */}
        <div className={styles.scroll}>
          <AgentProfile agentId={surface.agentId} />
        </div>
      </div>
    );
  if (surface.kind === "start")
    return (
      <div className={styles.view} data-background={surface.background}>
        <div className={styles.titlebar} data-tauri-drag-region />
        <StartScreen />
      </div>
    );
  // Work just sent and the workspace it creates are one view, so only what differs changes, in
  // place (ADE motion, "Starting work from the start screen").
  const workspace = surface.kind === "workspace" ? surface.workspace : null;
  const starting = surface.kind === "pending" ? surface.pending : surface.continuing;
  return (
    <div className={styles.view} data-background={surface.background}>
      <WorkspaceHeader
        workspaceId={workspace?.workspaceId ?? null}
        starting={
          starting === null
            ? null
            : {
                title: workspaceTitle(starting.instruction),
                repositoryName: starting.repositoryName,
              }
        }
      />
      {/* The ADE shows the native conversation only (ADR-0617). A workspace last opened in the
          provider's terminal reopens its session in the native conversation. */}
      <WorkspaceConversation
        workspaceId={workspace?.workspaceId ?? null}
        sessionId={workspace?.sessionId ?? null}
        firstMessage={starting?.instruction}
        firstImages={starting?.images}
        reopenNatively={workspace !== null && workspace.conversationMode !== "native"}
        baseNotice={starting?.baseNotice ?? null}
        hireFailure={starting?.hireFailure ?? null}
        coordinationFailure={starting?.coordinationFailure ?? null}
      />
    </div>
  );
}

/**
 * Moves the sidebar's space when it folds or opens after the first frame (ADE motion, "Space"): it
 * opens over enter and closes over leave on the fade easing, as a disclosure does. The width it
 * opens to is the one it last had, measured while it showed.
 */
function useSidebarFold(folded: boolean) {
  const element = useRef<HTMLElement>(null);
  const shownWidth = useRef(0);
  const wasFolded = useRef(folded);
  useLayoutEffect(() => {
    const sidebar = element.current;
    if (sidebar === null) return;
    if (!folded) shownWidth.current = sidebar.getBoundingClientRect().width;
    if (wasFolded.current === folded) return;
    wasFolded.current = folded;
    moveSpace(sidebar, {
      axis: "inline",
      from: folded ? shownWidth.current : 0,
      to: folded ? 0 : shownWidth.current,
      duration: folded ? motion.leaveMs : motion.enterMs,
      hold: false,
    });
  }, [folded]);
  return element;
}

/**
 * The window (approved mockups "1" and "2a/2b"): the workspace list beside the main area, which
 * shows what `useSurface` decides. It only wires views to the surface.
 */
export function Frame() {
  const surface = useSurface();
  const project = useCurrentProject();
  // An older core answers no agent command: the sidebar then lists conversations alone.
  const agentsManaged = useWorkspaceStore((store) => managesAgents(store.advertisedCommands));
  // The conversations' heading arrives with the agents above it, in the same frame, so the rows
  // below slide once (ADE motion, "Space").
  const agentsShown = useAgentStore(listSettled);
  // With no project yet there is nothing to list, so the sidebar folds away and the first run
  // takes the window; adding a project opens it like a disclosure (ADE motion, "Space").
  const folded = useFirstRun().folded;
  const sidebar = useSidebarFold(folded);
  // The conversation's chunk loads once the start screen has painted.
  useEffect(() => {
    const timer = setTimeout(preloadConversation, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={styles.frame} data-sidebar={folded ? "folded" : undefined}>
      <nav ref={sidebar} className={styles.sidebar}>
        {/* The macOS window controls sit over this strip, which also moves the window. */}
        <div className={styles.titlebar} data-tauri-drag-region />
        {/* The switcher row comes with the first project and goes with the last, as the
            sidebar's other rows do. */}
        <Presence>{project === null ? null : <ProjectSwitcher />}</Presence>
        <WorkspaceList
          projectId={project?.projectId ?? null}
          beforeRows={<AgentList projectId={project?.projectId ?? null} />}
          conversationsHeading={agentsManaged && agentsShown}
        />
        <div className={styles.footer}>
          <ConnectionStatus />
          <HostUpdateNotice />
        </div>
      </nav>
      <main className={styles.content}>
        <ViewPresence view={surface.key}>
          <Main surface={surface} />
        </ViewPresence>
      </main>
      <AddProjectSheet />
      <AgentSheets />
    </div>
  );
}
