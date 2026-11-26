import { ProjectProfileError } from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  RepositoryRegistryError,
  unregisterRepository,
} from "@lervo/repository-registry";

import { CommandFailure } from "./command-error-output.js";
import {
  addProject,
  ProjectAddError,
  projectsLocation,
  setProjectsLocation,
} from "./project-add.js";
import {
  addedProjectView,
  clearReportedProjectMark,
  readProjectMarkImage,
  renameReportedProject,
  setReportedProjectMark,
} from "./project-service.js";

/**
 * The project commands of the core link (Lervo ADE projects, "Core link"), answered with the same
 * operations as `lervo project`. A clone asked over the link stops after 100 seconds, within the
 * session host's 120-second command deadline, so a slow clone fails cleanly instead of outliving
 * its request.
 */
export const coreLinkProjectCommands = new Set([
  "project.add",
  "project.rename",
  "project.mark.set",
  "project.mark.clear",
  "project.mark.read",
  "project.unregister",
  "projects.location",
]);

const LINK_CLONE_TIMEOUT_MS = 100_000;
/** Base64 characters of a mark: 512 KiB of bytes. */
const MAXIMUM_MARK_CHARACTERS = 700_000;

function text(arguments_: Record<string, unknown>, name: string, maximum = 4096): string {
  const value = arguments_[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    throw new CommandFailure("project_argument_missing", `${name} is required.`);
  return value;
}

function optionalText(arguments_: Record<string, unknown>, name: string): string | undefined {
  return arguments_[name] === undefined ? undefined : text(arguments_, name);
}

async function answer(command: string, arguments_: Record<string, unknown>): Promise<object> {
  if (command === "projects.location") {
    const path = optionalText(arguments_, "path");
    return {
      path: path === undefined ? await projectsLocation() : await setProjectsLocation(path),
    };
  }
  if (command === "project.add") {
    const source = arguments_.source;
    const into = optionalText(arguments_, "into") ?? (await projectsLocation());
    const added = await addProject(
      source === "folder"
        ? { kind: "folder", path: text(arguments_, "path") }
        : source === "clone"
          ? { kind: "clone", url: text(arguments_, "url"), into }
          : source === "new"
            ? { kind: "new", name: text(arguments_, "name", 256), into }
            : (() => {
                throw new CommandFailure(
                  "project_argument_missing",
                  "source is folder, clone, or new.",
                );
              })(),
      { cloneTimeoutMs: LINK_CLONE_TIMEOUT_MS },
    );
    return addedProjectView(added);
  }
  const projectId = text(arguments_, "projectId", 64);
  if (command === "project.rename") {
    const view = await renameReportedProject(projectId, text(arguments_, "name", 256));
    return { projectId, displayName: view.displayName };
  }
  if (command === "project.mark.set") {
    const data = text(arguments_, "data", MAXIMUM_MARK_CHARACTERS);
    const view = await setReportedProjectMark(projectId, Buffer.from(data, "base64"));
    return { projectId, mark: view.mark };
  }
  if (command === "project.mark.clear") {
    await clearReportedProjectMark(projectId);
    return { projectId };
  }
  if (command === "project.mark.read")
    return { projectId, image: await readProjectMarkImage(projectId) };
  await unregisterRepository({ registryPath: defaultRepositoryRegistryPath(), projectId });
  return { projectId };
}

/** Answers one project command, with each failure under its own stable code. */
export async function runCoreLinkProjectCommand(
  command: string,
  arguments_: Record<string, unknown>,
): Promise<object> {
  try {
    return await answer(command, arguments_);
  } catch (error) {
    if (
      error instanceof ProjectProfileError ||
      error instanceof ProjectAddError ||
      error instanceof RepositoryRegistryError
    )
      throw new CommandFailure(error.code, error.message);
    throw error;
  }
}
