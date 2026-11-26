/**
 * The projects feature's model surface. Other features' models import it here rather than through
 * the feature's index.ts, which also loads its views (ADE convention, "Features in the UI").
 */
export {
  type AddDependencies,
  addFolder,
  addFromSource,
  chooseLocation,
  clearAddFailure,
  readLocation,
  useAddStore,
} from "./add";
export {
  bindProjects,
  bytesOf,
  keepMark,
  closeProjectSheet,
  type ProjectDependencies,
  restoreProjects,
  selectProject,
} from "./controller";
export { currentProject, managesProjects, projectName } from "./decisions";
export { useAddDependencies, useCurrentProject, useMarkThumbnail } from "./hooks";
export { type ProjectSource, projectSourceOf } from "./sources";
export { useProjectStore } from "./store";
