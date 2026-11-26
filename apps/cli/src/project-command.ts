import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { ProjectProfileError } from "@lervo/project";
import { RepositoryRegistryError } from "@lervo/repository-registry";

import {
  addProject,
  ProjectAddError,
  projectsLocation,
  setProjectsLocation,
} from "./project-add.js";
import {
  addedProjectView,
  clearReportedProjectMark,
  renameReportedProject,
  setReportedProjectMark,
  showProject,
} from "./project-service.js";
import type { CliIo } from "./types.js";

export const projectUsage = [
  "  lervo project add (--folder <absolute-path> | --clone <url> [--into <absolute-path>] | --new <display-name> [--into <absolute-path>]) --write [--json]",
  "  lervo project location [--set <absolute-path> --write] [--json]",
  "  lervo project show --project <project-id> [--registry <absolute-path>] [--json]",
  "  lervo project rename --project <project-id> --name <display-name> --write [--registry <absolute-path>] [--json]",
  "  lervo project mark set --project <project-id> --image <file> --write [--registry <absolute-path>] [--json]",
  "  lervo project mark clear --project <project-id> --write [--registry <absolute-path>] [--json]",
].join("\n");

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      name: { type: "string" },
      folder: { type: "string" },
      clone: { type: "string" },
      new: { type: "string" },
      into: { type: "string" },
      set: { type: "string" },
      image: { type: "string" },
      registry: { type: "string" },
      write: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

class ProjectCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0)
    throw new ProjectCommandError("project_argument_missing", `${flag} is required.`);
  return value;
}

/** `add` and `location`, which need no registered project (Lervo ADE projects, "Adding a project"). */
async function runProjectSetup(
  verb: "add" | "location",
  values: ReturnType<typeof parse>["values"],
  io: CliIo,
): Promise<number> {
  const json = values.json === true;
  const print = (value: object, text: string) => {
    io.stdout(json ? `${JSON.stringify(value)}\n` : `${text}\n`);
    return 0;
  };
  if (verb === "location") {
    if (values.set === undefined) {
      const path = await projectsLocation();
      return print({ path }, path);
    }
    if (values.write !== true)
      throw new ProjectCommandError("write_required", "Setting the location needs --write.");
    const path = await setProjectsLocation(values.set);
    return print({ path }, path);
  }
  if (values.write !== true)
    throw new ProjectCommandError("write_required", "Adding a project needs --write.");
  const chosen = [values.folder, values.clone, values.new].filter((value) => value !== undefined);
  if (chosen.length !== 1)
    throw new ProjectCommandError(
      "project_argument_missing",
      "Give exactly one of --folder, --clone, or --new.",
    );
  const into = values.into ?? (await projectsLocation());
  const added = await addProject(
    values.folder !== undefined
      ? { kind: "folder", path: values.folder }
      : values.clone !== undefined
        ? { kind: "clone", url: values.clone, into }
        : { kind: "new", name: values.new!, into },
  );
  const view = addedProjectView(added);
  return print(view, `${view.displayName} is a project at ${view.root}`);
}

async function run(args: string[], io: CliIo): Promise<number> {
  const parsed = parse(args);
  const [verb, sub] = parsed.positionals;
  const values = parsed.values;
  const json = values.json === true;
  if (verb === "add" || verb === "location") return runProjectSetup(verb, values, io);
  const projectId = required(values.project, "--project");
  const output = (value: object, text: string) => {
    io.stdout(json ? `${JSON.stringify(value)}\n` : `${text}\n`);
    return 0;
  };
  if (verb === "show") {
    const shown = await showProject(projectId, values.registry);
    return output(shown, `${shown.displayName}${shown.mark === null ? "" : " (mark)"}`);
  }
  if (values.write !== true)
    throw new ProjectCommandError(
      "write_required",
      "This command changes the project; pass --write.",
    );
  if (verb === "rename") {
    const view = await renameReportedProject(
      projectId,
      required(values.name, "--name"),
      values.registry,
    );
    return output(view, `Renamed to ${view.displayName}`);
  }
  if (verb === "mark" && sub === "set") {
    const file = required(values.image, "--image");
    if (file.includes("\0"))
      throw new ProjectCommandError("project_mark_invalid", "The image path is invalid.");
    const view = await setReportedProjectMark(
      projectId,
      await readFile(resolve(file)),
      values.registry,
    );
    return output(view, "Mark set");
  }
  if (verb === "mark" && sub === "clear")
    return output(await clearReportedProjectMark(projectId, values.registry), "Mark cleared");
  throw new ProjectCommandError(
    "project_command_unknown",
    `Unknown project command.\n${projectUsage}`,
  );
}

/** `lervo project`: a project's display name and mark (Lervo ADE projects, "Project profile"). */
export async function runProjectCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    io.stdout(`${projectUsage}\n`);
    return args.length === 0 ? 1 : 0;
  }
  try {
    return await run(args, io);
  } catch (error) {
    const code =
      error instanceof ProjectProfileError ||
      error instanceof ProjectAddError ||
      error instanceof RepositoryRegistryError ||
      error instanceof ProjectCommandError
        ? error.code
        : "project_command_failed";
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(
      args.includes("--json")
        ? `${JSON.stringify({ error: code, message })}\n`
        : `${code}: ${message}\n`,
    );
    return 1;
  }
}
