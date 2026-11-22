import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * ADR-0612: which provider, model, and reasoning effort each role uses, in one record. Callers
 * name a role and resolve it when they make a call, so a change takes effect at the next call,
 * with no configuration rewrite, restart, rebind, or re-review. A null model or effort means the
 * provider CLI's default, or the role's built-in default effort.
 */
export const MODEL_ROLES = ["routine", "reasoning", "review", "background"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export const MODEL_PROVIDERS = ["codex", "claude"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export const MODEL_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];

export interface ModelRoute {
  provider: ModelProvider;
  model: string | null;
  reasoningEffort: ModelReasoningEffort | null;
}

export interface ModelSelection {
  schemaVersion: 1;
  /** Incremented on every change; the newest revision wins across hosts (ADR-0612 M3). */
  revision: number;
  changedAt: string | null;
  /** The ordered routes of each role; a role without routes uses the provider defaults. */
  roles: Partial<Record<ModelRole, ModelRoute[]>>;
  /**
   * Roles a newer Lervo wrote that this one does not know, kept byte for byte so a write here never
   * erases them. Readers ignore them.
   */
  unknownRoles?: Record<string, unknown>;
}

/** The selection of a host that never chose: every role on the provider defaults. */
export const DEFAULT_MODEL_SELECTION: ModelSelection = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  changedAt: null,
  roles: Object.freeze({}),
}) as ModelSelection;

/**
 * The effort a role uses when its route names none. Background knowledge calls stay at `low`,
 * as before ADR-0612, so an unset selection changes nothing. Reasoning and review default to their
 * quality floor, `high`; routine keeps the provider default.
 */
export const DEFAULT_ROLE_REASONING_EFFORT: Readonly<
  Record<ModelRole, ModelReasoningEffort | null>
> = Object.freeze({ routine: null, reasoning: "high", review: "high", background: "low" });

/** Reasoning and review keep the execution-profile quality floor whichever route serves them. */
const MINIMUM_EFFORT: Readonly<Partial<Record<ModelRole, ModelReasoningEffort>>> = Object.freeze({
  reasoning: "high",
  review: "high",
});

export const MODEL_SELECTION_FILE = "model-selection.json";
const MAXIMUM_ROUTES = 4;
const MAXIMUM_FILE_BYTES = 64 * 1024;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,127}$/u;

export class ModelSelectionError extends Error {
  constructor(
    readonly code: "model_selection_invalid" | "model_route_invalid" | "model_selection_changed",
    message: string,
  ) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

function invalid(message: string): never {
  throw new ModelSelectionError("model_selection_invalid", message);
}

function effortRank(effort: ModelReasoningEffort): number {
  return MODEL_REASONING_EFFORTS.indexOf(effort);
}

/** Validates one route of a role, including the role's quality floor. */
export function validateModelRoute(role: ModelRole, value: unknown): ModelRoute {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ModelSelectionError("model_route_invalid", "A model route is an object.");
  const route = value as Record<string, unknown>;
  if (Object.keys(route).sort().join(",") !== "model,provider,reasoningEffort")
    throw new ModelSelectionError(
      "model_route_invalid",
      "A model route has exactly provider, model, and reasoningEffort.",
    );
  if (!(MODEL_PROVIDERS as readonly unknown[]).includes(route.provider))
    throw new ModelSelectionError(
      "model_route_invalid",
      `A model route provider is one of ${MODEL_PROVIDERS.join(", ")}.`,
    );
  if (route.model !== null && (typeof route.model !== "string" || !MODEL_NAME.test(route.model)))
    throw new ModelSelectionError("model_route_invalid", "A model name is a plain model id.");
  if (
    route.reasoningEffort !== null &&
    !(MODEL_REASONING_EFFORTS as readonly unknown[]).includes(route.reasoningEffort)
  )
    throw new ModelSelectionError(
      "model_route_invalid",
      `A reasoning effort is one of ${MODEL_REASONING_EFFORTS.join(", ")}.`,
    );
  const floor = MINIMUM_EFFORT[role];
  if (
    floor !== undefined &&
    route.reasoningEffort !== null &&
    effortRank(route.reasoningEffort as ModelReasoningEffort) < effortRank(floor)
  )
    throw new ModelSelectionError(
      "model_route_invalid",
      `The ${role} role needs reasoning effort ${floor} or more.`,
    );
  return {
    provider: route.provider as ModelProvider,
    model: route.model as string | null,
    reasoningEffort: route.reasoningEffort as ModelReasoningEffort | null,
  };
}

export function parseModelSelection(value: unknown): ModelSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid("The model selection is an object.");
  const selection = value as Record<string, unknown>;
  if (selection.schemaVersion !== 1) invalid("The model selection schema version is unsupported.");
  if (!Number.isSafeInteger(selection.revision) || (selection.revision as number) < 0)
    invalid("The model selection revision is invalid.");
  if (
    selection.changedAt !== null &&
    (typeof selection.changedAt !== "string" || !Number.isFinite(Date.parse(selection.changedAt)))
  )
    invalid("The model selection change time is invalid.");
  const roles = selection.roles;
  if (roles === null || typeof roles !== "object" || Array.isArray(roles))
    invalid("The model selection roles are an object.");
  const parsed: ModelSelection["roles"] = {};
  const unknownRoles: Record<string, unknown> = {};
  for (const [role, routes] of Object.entries(roles as Record<string, unknown>)) {
    if (!(MODEL_ROLES as readonly string[]).includes(role)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/u.test(role)) invalid(`Invalid model role name: ${role}.`);
      unknownRoles[role] = routes;
      continue;
    }
    if (!Array.isArray(routes) || routes.length === 0 || routes.length > MAXIMUM_ROUTES)
      invalid(`The ${role} role has 1 to ${MAXIMUM_ROUTES} routes.`);
    const validated = routes.map((route) => validateModelRoute(role as ModelRole, route));
    if (new Set(validated.map((route) => route.provider)).size !== validated.length)
      invalid(`The ${role} role names each provider once.`);
    parsed[role as ModelRole] = validated;
  }
  return {
    schemaVersion: 1,
    revision: selection.revision as number,
    changedAt: selection.changedAt as string | null,
    roles: parsed,
    ...(Object.keys(unknownRoles).length === 0 ? {} : { unknownRoles }),
  };
}

/** The file form: known and preserved unknown roles together under `roles`. */
function serialized(selection: ModelSelection): unknown {
  return {
    schemaVersion: 1,
    revision: selection.revision,
    changedAt: selection.changedAt,
    roles: { ...(selection.unknownRoles ?? {}), ...selection.roles },
  };
}

export function modelSelectionPath(stateDirectory: string): string {
  return resolve(stateDirectory, MODEL_SELECTION_FILE);
}

export interface ModelSelectionRead {
  selection: ModelSelection;
  /** Why the file could not be used, or null; an unusable file means the provider defaults. */
  issue: string | null;
}

const cache = new Map<string, { key: string; read: ModelSelectionRead }>();

/**
 * Reads the selection. A missing file is the default selection; an unreadable or invalid one is
 * the default too, with its issue, so a damaged file never stops provider work. A long-running
 * process calls this before each provider call: an unchanged file costs one `stat`.
 */
export async function readModelSelection(stateDirectory: string): Promise<ModelSelectionRead> {
  const path = modelSelectionPath(stateDirectory);
  let metadata;
  try {
    // Never follow a link: the record must be this user's own regular file.
    metadata = await lstat(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { selection: DEFAULT_MODEL_SELECTION, issue: null }
      : { selection: DEFAULT_MODEL_SELECTION, issue: "model_selection_unreadable" };
  }
  const key = `${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
  const cached = cache.get(path);
  if (cached !== undefined && cached.key === key) return cached.read;
  let read: ModelSelectionRead;
  try {
    if (
      !metadata.isFile() ||
      metadata.size > MAXIMUM_FILE_BYTES ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    )
      invalid("Not a selection file of this user.");
    read = {
      selection: parseModelSelection(JSON.parse(await readFile(path, "utf8"))),
      issue: null,
    };
  } catch {
    read = { selection: DEFAULT_MODEL_SELECTION, issue: "model_selection_invalid" };
  }
  cache.set(path, { key, read });
  return read;
}

/**
 * Writes one role's routes, or removes them with an empty list, as the next revision. A file that
 * exists but cannot be read is never overwritten, so a damaged or foreign record is repaired by
 * hand rather than silently replaced. The write is a compare-and-swap on the revision: a
 * concurrent change made since this read fails it with `model_selection_changed`, never loses it.
 */
export async function writeModelSelectionRole(input: {
  stateDirectory: string;
  role: ModelRole;
  routes: readonly ModelRoute[];
  now?: Date;
}): Promise<ModelSelection> {
  const current = await readModelSelection(input.stateDirectory);
  if (current.issue !== null)
    throw new ModelSelectionError(
      "model_selection_invalid",
      `${modelSelectionPath(input.stateDirectory)} exists but is not usable (${current.issue}); repair or remove it first.`,
    );
  const roles = { ...current.selection.roles };
  if (input.routes.length === 0) delete roles[input.role];
  else roles[input.role] = input.routes.map((route) => validateModelRoute(input.role, route));
  const next = parseModelSelection(
    serialized({
      ...current.selection,
      revision: current.selection.revision + 1,
      changedAt: (input.now ?? new Date()).toISOString(),
      roles,
    }),
  );
  await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 });
  const path = modelSelectionPath(input.stateDirectory);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(serialized(next), null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const latest = await readModelSelection(input.stateDirectory);
    if (latest.issue !== null || latest.selection.revision !== current.selection.revision)
      throw new ModelSelectionError(
        "model_selection_changed",
        "The model selection changed while this change was prepared; run the command again.",
      );
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
  return next;
}

/** Why a route was passed over for the next one. */
export interface SkippedModelRoute {
  route: ModelRoute;
  reason: "provider_not_allowed" | "provider_unavailable";
}

export interface ResolvedModelRoute {
  /** The route to use, or null when the role has routes and none can run here. */
  route: ModelRoute | null;
  skipped: SkippedModelRoute[];
  /** True when the role has no routes and the caller's own provider choice stands. */
  defaulted: boolean;
}

/**
 * The first route of a role whose provider the caller may use and that can run on this host.
 * A role without routes leaves the caller's provider choice and the provider defaults in place.
 */
export async function resolveModelRoute(input: {
  selection: ModelSelection;
  role: ModelRole;
  allowed?: readonly ModelProvider[];
  available?: (provider: ModelProvider) => boolean | Promise<boolean>;
}): Promise<ResolvedModelRoute> {
  const routes = input.selection.roles[input.role];
  if (routes === undefined || routes.length === 0)
    return { route: null, skipped: [], defaulted: true };
  const skipped: SkippedModelRoute[] = [];
  for (const route of routes) {
    if (input.allowed !== undefined && !input.allowed.includes(route.provider)) {
      skipped.push({ route, reason: "provider_not_allowed" });
      continue;
    }
    if (input.available !== undefined && !(await input.available(route.provider))) {
      skipped.push({ route, reason: "provider_unavailable" });
      continue;
    }
    return { route, skipped, defaulted: false };
  }
  return { route: null, skipped, defaulted: false };
}

/** The model and effort a call on `provider` uses for `role`: the role's route for it, or defaults. */
export function modelRouteFor(
  selection: ModelSelection,
  role: ModelRole,
  provider: ModelProvider,
): { model: string | null; reasoningEffort: ModelReasoningEffort | null } {
  const route = selection.roles[role]?.find((item) => item.provider === provider);
  return {
    model: route?.model ?? null,
    reasoningEffort: route?.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT[role],
  };
}
