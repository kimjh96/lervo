import { PaneHeader } from "../../../ui/PaneHeader";
import { useWorkspaceStore } from "../../workspaces";
import { WorkspaceControls } from "./WorkspaceControls";

/**
 * The workspace's title (approved mockup "2a"), with its branch behind an icon. The workspace
 * list and the working line show the live status, so the header does not repeat it. Its other
 * control removes the workspace, when the core answers `workspace.retire`. While the core creates
 * the workspace of work just sent, it is that work's header: the instruction's first line and the
 * repository, which gives way to the controls once the workspace exists.
 */
export function WorkspaceHeader(props: {
  workspaceId: string | null;
  /** The work being started, while its workspace does not exist yet or continues it. */
  starting: { title: string; repositoryName: string } | null;
}) {
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  const retirable = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("workspace.retire") === true,
  );
  const title =
    workspace === undefined ? props.starting?.title : (workspace.title ?? workspace.branch);
  if (title === undefined) return null;
  return (
    <PaneHeader
      title={title}
      detail={workspace === undefined ? props.starting?.repositoryName : undefined}
    >
      {/* motion: Starting work from the start screen */}
      {workspace === undefined ? null : (
        <WorkspaceControls
          key={workspace.workspaceId}
          workspaceId={workspace.workspaceId}
          branch={workspace.branch}
          retirable={retirable}
        />
      )}
    </PaneHeader>
  );
}
