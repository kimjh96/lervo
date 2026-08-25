import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  loadEnvironmentObservations,
  loadEnvironmentSource,
  loadEnvironmentSources,
  loadEnvironmentTarget,
  resolveEnvironmentTarget,
  storeEnvironmentObservation,
  validateEnvironmentSourceManifest,
  type EnvironmentObservation,
} from "@lervo/environment";

import type { CliIo, CliServices } from "./types.js";

export const environmentUsage = [
  "  lervo environment query --source <source-id> [--root <path>] [--json]",
  "  lervo environment query --target <target-id> [--root <path>] [--json]",
  "  lervo environment query --adapter <adapter-id> --ephemeral [--json]",
  "  lervo environment resolve --target <target-id> [--capability <capability>] [--root <path>] [--json]",
].join("\n");

function formatObservation(observation: EnvironmentObservation, persisted: boolean): string {
  const lines = [
    `Environment source ${observation.sourceId}: ${observation.status === "available" ? "available" : "unavailable"}`,
    `  adapter: ${observation.adapterId}`,
    `  Valid until: ${observation.validUntil}`,
    `  Subjects: ${observation.subjects.length}`,
    `  Persistence: ${persisted ? "repository-local derived state" : "unpersisted one-time observation"}`,
  ];
  for (const subject of observation.subjects) {
    lines.push(
      `  ${subject.labels["device.hostname"] ?? subject.subjectId} · ${subject.capabilities.join(", ") || "no capabilities"}`,
    );
    for (const endpoint of subject.endpoints)
      lines.push(
        `    ${endpoint.transport}://${endpoint.host}${endpoint.port === undefined ? "" : `:${endpoint.port}`}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

async function runQuery(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "executeEnvironmentQuery">,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        source: { type: "string" },
        target: { type: "string" },
        adapter: { type: "string" },
        ephemeral: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${environmentUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${environmentUsage}\n`);
    return 0;
  }
  const sourceId = parsed.values.source;
  const adapterId = parsed.values.adapter;
  const targetId = parsed.values.target;
  const modeCount = [sourceId, adapterId, targetId].filter((value) => value !== undefined).length;
  if (
    modeCount !== 1 ||
    (adapterId !== undefined && parsed.values.ephemeral !== true) ||
    (adapterId === undefined && parsed.values.ephemeral === true)
  ) {
    io.stderr(
      `Specify one registered source or target, or use --adapter with --ephemeral.\n${environmentUsage}\n`,
    );
    return 1;
  }
  try {
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    if (targetId !== undefined) {
      const target = await loadEnvironmentTarget(repositoryRoot, targetId);
      const sources =
        target.preferredSourceIds.length > 0
          ? await Promise.all(
              target.preferredSourceIds.map((preferredSourceId) =>
                loadEnvironmentSource(repositoryRoot, preferredSourceId),
              ),
            )
          : (await loadEnvironmentSources(repositoryRoot)).filter((source) =>
              target.requiredCapabilities.every((capability) =>
                source.capabilities.includes(capability),
              ),
            );
      const observations: EnvironmentObservation[] = [];
      for (const source of sources) {
        const observation = await services.executeEnvironmentQuery({ source });
        await storeEnvironmentObservation(repositoryRoot, observation);
        observations.push(observation);
      }
      const resolution = resolveEnvironmentTarget({ target, observations });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ persistence: "repository_local_derived_state", observations, resolution }, null, 2)}\n`
          : `Environment target ${target.targetId}: ${resolution.status === "resolved" ? "resolved" : resolution.status === "ambiguous" ? "ambiguous" : "unresolved"}\n  Sources observed: ${observations.length}\n`,
      );
      return resolution.status === "resolved" ? 0 : 1;
    }
    const ephemeral = adapterId !== undefined;
    const source = ephemeral
      ? validateEnvironmentSourceManifest({
          schemaVersion: 1,
          sourceId: "src_ephemeral_query",
          adapterId,
          scope: "project",
          capabilities: ["network.peer"],
          maximumValiditySeconds: 60,
          sharing: "local_only",
          configuration: {},
        })
      : await loadEnvironmentSource(repositoryRoot, sourceId!);
    const observation = await services.executeEnvironmentQuery({ source });
    if (!ephemeral) await storeEnvironmentObservation(repositoryRoot, observation);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ persistence: ephemeral ? "ephemeral" : "repository_local_derived_state", observation }, null, 2)}\n`
        : formatObservation(observation, !ephemeral),
    );
    return observation.status === "available" ? 0 : 1;
  } catch (error) {
    const code =
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "environment_query_failed";
    io.stderr(`${code}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runResolve(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        target: { type: "string" },
        capability: { type: "string", multiple: true },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${environmentUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${environmentUsage}\n`);
    return 0;
  }
  if (parsed.values.target === undefined) {
    io.stderr(`--target is required.\n${environmentUsage}\n`);
    return 1;
  }
  try {
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const resolution = resolveEnvironmentTarget({
      target: await loadEnvironmentTarget(repositoryRoot, parsed.values.target),
      observations: await loadEnvironmentObservations(repositoryRoot),
      ...(parsed.values.capability === undefined
        ? {}
        : { additionalCapabilities: parsed.values.capability }),
    });
    if (parsed.values.json) io.stdout(`${JSON.stringify(resolution, null, 2)}\n`);
    else if (resolution.status === "resolved") {
      io.stdout(
        `Environment target ${resolution.targetId}: resolved\n  Source: ${resolution.candidate.sourceId}\n  Subject: ${resolution.candidate.subject.subjectId}\n`,
      );
    } else {
      io.stdout(
        `Environment target ${resolution.targetId}: ${resolution.status === "ambiguous" ? "ambiguous" : "unresolved"}\n`,
      );
    }
    return resolution.status === "resolved" ? 0 : 1;
  } catch (error) {
    const code =
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "environment_resolution_failed";
    io.stderr(`${code}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runEnvironmentCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "executeEnvironmentQuery">,
): Promise<number> {
  const action = args[0];
  if (action === "query") return runQuery(args.slice(1), io, services);
  if (action === "resolve") return runResolve(args.slice(1), io);
  if (action === "--help" || action === "-h") {
    io.stdout(`${environmentUsage}\n`);
    return 0;
  }
  io.stderr(`Specify an environment command.\n${environmentUsage}\n`);
  return 1;
}

export { formatObservation as formatEnvironmentObservation };
