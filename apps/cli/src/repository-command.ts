import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
  registerRepository,
  RepositoryRegistryError,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import type { CliIo } from "./types.js";

export const repositoryUsage = [
  "  lervo repository register --root <absolute-path> [--registry <absolute-path>] --write [--json]",
  "  lervo repository list [--registry <absolute-path>] [--json]",
  "  lervo repository resolve --project <project-id> [--registry <absolute-path>] [--json]",
].join("\n");

function registryPath(value: string | undefined): string {
  if (value === undefined) return defaultRepositoryRegistryPath();
  if (!isAbsolute(value) || /[\0\r\n]/u.test(value)) throw new RepositoryRegistryError("repository_registry_path_invalid", "The registry path must be a safe absolute path.");
  return resolve(value);
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      project: { type: "string" },
      registry: { type: "string" },
      write: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

export async function runRepositoryCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parse(args);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${repositoryUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${repositoryUsage}\n`);
    return 0;
  }
  const action = parsed.positionals[0];
  if (parsed.positionals.length !== 1 || !["register", "list", "resolve"].includes(action ?? "")) {
    io.stderr(`The repository action is invalid.\n${repositoryUsage}\n`);
    return 1;
  }
  try {
    const path = registryPath(parsed.values.registry);
    if (action === "register") {
      if (parsed.values.write !== true || parsed.values.root === undefined || parsed.values.project !== undefined) {
        throw new RepositoryRegistryError("repository_write_required", "Repository registration requires --root and explicit --write.");
      }
      const result = await registerRepository({ registryPath: path, repositoryRoot: parsed.values.root });
      io.stdout(parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Repository ${result.registration.projectId}: ${result.change}\n  ${result.registration.name}\n  ${result.registration.repositoryRoot}\n`);
      return 0;
    }
    if (parsed.values.write === true || parsed.values.root !== undefined) {
      throw new RepositoryRegistryError("repository_arguments_invalid", "Read commands do not accept --write or --root.");
    }
    if (action === "list") {
      if (parsed.values.project !== undefined) throw new RepositoryRegistryError("repository_arguments_invalid", "The list action does not select a project.");
      const repositories = await listRegisteredRepositories(path);
      io.stdout(parsed.values.json
        ? `${JSON.stringify({ verification: "stored_only", repositories }, null, 2)}\n`
        : repositories.length === 0
          ? "No repositories are registered.\n"
          : `${repositories.map((entry) => `${entry.projectId} · ${entry.name}\n  ${entry.repositoryRoot}`).join("\n")}\n`);
      return 0;
    }
    if (parsed.values.project === undefined) throw new RepositoryRegistryError("repository_arguments_invalid", "The resolve action requires --project.");
    const registration = await resolveRegisteredRepository({ registryPath: path, projectId: parsed.values.project });
    io.stdout(parsed.values.json
      ? `${JSON.stringify({ verification: "manifest_revalidated", registration }, null, 2)}\n`
      : `Repository ${registration.projectId}: verified\n  ${registration.name}\n  ${registration.repositoryRoot}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof RepositoryRegistryError ? error.code : "repository_command_failed";
    io.stderr(`Repository command failed (${code}).\n`);
    return 1;
  }
}
