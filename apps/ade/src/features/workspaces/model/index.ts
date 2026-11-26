/**
 * The workspaces feature's model surface. Other features' models import it here rather than through
 * the feature's index.ts, which also loads its views (ADE convention, "Features in the UI").
 */
export { bindWorkspaces, reloadWorkspaces, restoreWorkspaces } from "./controller";
export { visibleStatus } from "./decisions";
export { type RetireStep, retireWorkspace } from "./retire";
export { useWorkspaceStore } from "./store";
export type { Repository, Workspace } from "./types";
