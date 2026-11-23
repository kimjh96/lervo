import { PaneHeader } from "../../../ui/PaneHeader";
import { useWorkspaceStore } from "../../workspaces";

/**
 * The selected workspace's title and branch (approved mockup "2a"). The workspace list and the
 * working line show the live status, so the header does not repeat it.
 */
export function WorkspaceHeader(props: {
  workspaceId: string;
  /** Skips the arrival when the header replaces the pending workspace's, which looks the same. */
  continues: boolean;
}) {
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  if (workspace === undefined) return null;
  return (
    <PaneHeader
      title={workspace.title ?? workspace.branch}
      detail={workspace.branch}
      arrive={!props.continues}
    />
  );
}
