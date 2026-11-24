import { PaneHeader } from "../../../ui/PaneHeader";
import { Presence } from "../../../ui/Presence";
import { useWorkspaceStore } from "../../workspaces";
import { BranchControl } from "./BranchControl";
import { RetireControl } from "./RetireControl";

/**
 * The selected workspace's title (approved mockup "2a"), with its branch behind an icon. The
 * workspace list and the working line show the live status, so the header does not repeat it.
 * Its other control removes the workspace, when the core answers `workspace.retire`.
 */
export function WorkspaceHeader(props: {
  workspaceId: string;
  /** Skips the arrival when the header replaces the pending workspace's, which looks the same. */
  continues: boolean;
}) {
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((item) => item.workspaceId === props.workspaceId),
  );
  const retirable = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("workspace.retire") === true,
  );
  if (workspace === undefined) return null;
  return (
    <PaneHeader title={workspace.title ?? workspace.branch} arrive={!props.continues}>
      <BranchControl branch={workspace.branch} />
      <Presence as="span">
        {retirable ? (
          <RetireControl key={workspace.workspaceId} workspaceId={workspace.workspaceId} />
        ) : null}
      </Presence>
    </PaneHeader>
  );
}
