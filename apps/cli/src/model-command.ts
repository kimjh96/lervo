import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_ROLE_REASONING_EFFORT,
  MODEL_PROVIDERS,
  MODEL_REASONING_EFFORTS,
  MODEL_ROLES,
  MODEL_SELECTION_NOTICE_FILE,
  ModelSelectionError,
  readModelSelection,
  validateModelRoute,
  writeModelSelectionRole,
  type ModelRole,
  type ModelRoute,
  type ModelSelection,
  type ModelSelectionAdoptionNotice,
} from "@lervo/execution-contract";
import {
  hostModelSelectionDirectory,
  requestKnowledgeResidentCycle,
} from "@lervo/repository-knowledge-runtime";
import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

import { writeCommandError } from "./command-error-output.js";
import type { CliIo } from "./types.js";

export const modelUsage = [
  "  lervo model show [--json]",
  "  lervo model set <routine|reasoning|review|background> <provider>[/<model>][@<effort>]... [--json]",
  "  lervo model unset <routine|reasoning|review|background> [--json]",
].join("\n");

/** `claude`, `claude/claude-opus-5-5`, or `claude/claude-opus-5-5@high`. */
export function parseModelRoute(role: ModelRole, text: string): ModelRoute {
  const at = text.lastIndexOf("@");
  const head = at < 0 ? text : text.slice(0, at);
  const effort = at < 0 ? null : text.slice(at + 1);
  const slash = head.indexOf("/");
  const provider = slash < 0 ? head : head.slice(0, slash);
  const model = slash < 0 ? null : head.slice(slash + 1);
  if (effort !== null && !(MODEL_REASONING_EFFORTS as readonly string[]).includes(effort))
    throw new ModelSelectionError(
      "model_route_invalid",
      `A reasoning effort is one of ${MODEL_REASONING_EFFORTS.join(", ")}.`,
    );
  return validateModelRoute(role, {
    provider,
    model: model === "" ? null : model,
    reasoningEffort: effort,
  });
}

function routeText(route: ModelRoute): string {
  return `${route.provider}${route.model === null ? "" : `/${route.model}`}${route.reasoningEffort === null ? "" : `@${route.reasoningEffort}`}`;
}

function formatSelection(selection: ModelSelection, path: string, issue: string | null): string {
  const lines = MODEL_ROLES.map((role) => {
    const routes = selection.roles[role];
    const fallback = DEFAULT_ROLE_REASONING_EFFORT[role];
    return routes === undefined
      ? `${role}: provider defaults${fallback === null ? "" : ` (effort ${fallback})`}`
      : `${role}: ${routes.map(routeText).join(", then ")}`;
  });
  return [
    `Model selection revision ${selection.revision}${selection.changedAt === null ? "" : `, changed ${selection.changedAt}`} (${path})`,
    ...(issue === null
      ? []
      : [`The file is not usable (${issue}); every role uses the provider defaults.`]),
    ...lines,
    "A route whose provider cannot run on this host, or that a delegation or mandate does not allow, falls through to the next.",
  ].join("\n");
}

/**
 * ADR-0612 M3: the last adoption from another host, when the current selection is the one it
 * adopted; a later local change makes it history, and an unreadable notice is no notice.
 */
async function readAdoptionNotice(
  directory: string,
  selection: ModelSelection,
): Promise<ModelSelectionAdoptionNotice | null> {
  try {
    const notice = JSON.parse(
      await readFile(resolve(directory, MODEL_SELECTION_NOTICE_FILE), "utf8"),
    ) as ModelSelectionAdoptionNotice;
    return notice.adopted?.revision === selection.revision &&
      notice.adopted.changedAt === selection.changedAt
      ? notice
      : null;
  } catch {
    return null;
  }
}

/**
 * ADR-0612 M3: asks each registered repository's resident to publish the changed selection in its
 * host record now, so the other host adopts it without waiting for unrelated work. A repository
 * that cannot be asked keeps the change for its next cycle.
 */
async function announceSelectionChange(environment: NodeJS.ProcessEnv): Promise<void> {
  const repositories = await listRegisteredRepositories(
    defaultRepositoryRegistryPath(environment),
  ).catch(() => []);
  await Promise.all(
    repositories.map((repository) => requestKnowledgeResidentCycle(repository.repositoryRoot)),
  );
}

/**
 * ADR-0612: the one place a model is chosen. A role names an ordered list of routes; every caller
 * of that role resolves it at its next provider call, so no configuration, restart, rebind, or
 * re-review follows a change.
 */
export async function runModelCommand(
  args: string[],
  io: CliIo,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${modelUsage}\n`);
    return 1;
  }
  const json = parsed.values.json === true;
  const [action, role, ...routes] = parsed.positionals;
  const directory = hostModelSelectionDirectory(environment);
  try {
    if (action === "show" && role === undefined) {
      const read = await readModelSelection(directory);
      const adoption = await readAdoptionNotice(directory, read.selection);
      io.stdout(
        json
          ? `${JSON.stringify({ schemaVersion: 1, path: `${directory}/model-selection.json`, issue: read.issue, selection: read.selection, adoption }, null, 2)}\n`
          : `${formatSelection(read.selection, `${directory}/model-selection.json`, read.issue)}\n${adoption === null ? "" : `Adopted from another host at ${adoption.adoptedAt} (revision ${adoption.previous.revision} to ${adoption.adopted.revision}).\n`}`,
      );
      return 0;
    }
    if ((action !== "set" && action !== "unset") || role === undefined)
      throw new Error(`Specify a model action.\n${modelUsage}`);
    if (!(MODEL_ROLES as readonly string[]).includes(role))
      throw new ModelSelectionError(
        "model_route_invalid",
        `A model role is one of ${MODEL_ROLES.join(", ")}.`,
      );
    if (action === "set" && routes.length === 0)
      throw new ModelSelectionError(
        "model_route_invalid",
        `Name at least one route, such as ${MODEL_PROVIDERS[1]} or ${MODEL_PROVIDERS[1]}/<model>@<effort>.`,
      );
    if (action === "unset" && routes.length > 0)
      throw new Error(`model unset takes only a role.\n${modelUsage}`);
    const next = await writeModelSelectionRole({
      stateDirectory: directory,
      role: role as ModelRole,
      routes: routes.map((text) => parseModelRoute(role as ModelRole, text)),
    });
    await announceSelectionChange(environment);
    io.stdout(
      json
        ? `${JSON.stringify({ schemaVersion: 1, selection: next }, null, 2)}\n`
        : `${formatSelection(next, `${directory}/model-selection.json`, null)}\nThe next provider call of each ${role} caller uses this; nothing needs a restart.\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}
