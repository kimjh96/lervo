import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
  registerRepository,
  RepositoryRegistryError,
  resolveRegisteredRepository,
  unregisterRepository,
} from "@lervo/repository-registry";

import { onboardKnowledgeContinuity } from "./knowledge-continuity-onboarding.js";
import { formatNodeFleetStatus } from "./node-fleet-status-format.js";
import type { CliIo } from "./types.js";
import { repositoryHoldUsage, runRepositoryHoldCommand } from "./repository-hold-command.js";
import {
  applyNodeFleetOnboarding,
  inspectNodeFleetStatus,
  NodeFleetApplyError,
} from "./node-fleet-apply.js";

export const repositoryUsage = [
  "  lervo repository register --root <absolute-path> [--registry <absolute-path>] --write [--json]",
  "  lervo repository list [--registry <absolute-path>] [--json]",
  "  lervo repository resolve --project <project-id> [--registry <absolute-path>] [--json]",
  "  lervo repository unregister --project <project-id> [--registry <absolute-path>] --write [--json]",
  "  lervo repository node plan --root <absolute-path> --node <node-id> --destination <destination-id> --runtime-version <semver> --manager <systemd|launchd> [--registry <absolute-path>] [--home <absolute-path>] [--json]",
  "  lervo repository node apply --root <absolute-path> --node <node-id> --destination <destination-id> --runtime-version <semver> --manager <systemd|launchd> --config <absolute-path> --apply <plan-id> --write [--transition-legacy] [--registry <absolute-path>] [--home <absolute-path>] [--json]",
  "  lervo repository node status [--registry <absolute-path>] [--home <absolute-path>] [--json]",
  repositoryHoldUsage,
].join("\n");

function registryPath(value: string | undefined): string {
  if (value === undefined) return defaultRepositoryRegistryPath();
  if (!isAbsolute(value) || /[\0\r\n]/u.test(value))
    throw new RepositoryRegistryError(
      "repository_registry_path_invalid",
      "The registry path must be a safe absolute path.",
    );
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
      node: { type: "string" },
      destination: { type: "string" },
      "runtime-version": { type: "string" },
      manager: { type: "string" },
      home: { type: "string" },
      config: { type: "string" },
      apply: { type: "string" },
      "transition-legacy": { type: "boolean" },
      write: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

export async function runRepositoryCommand(args: string[], io: CliIo): Promise<number> {
  // ADR-0561: the owner's per-repository hold has its own small command surface.
  if (["hold", "release", "holds"].includes(args[0] ?? ""))
    return runRepositoryHoldCommand(args, io);
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
  if (parsed.positionals.length === 2 && action === "node" && parsed.positionals[1] === "status") {
    try {
      if (
        parsed.values.write === true ||
        parsed.values.root !== undefined ||
        parsed.values.project !== undefined ||
        parsed.values.node !== undefined ||
        parsed.values.destination !== undefined ||
        parsed.values["runtime-version"] !== undefined ||
        parsed.values.manager !== undefined ||
        parsed.values.config !== undefined ||
        parsed.values.apply !== undefined
      ) {
        throw new RepositoryRegistryError(
          "node_fleet_status_arguments_invalid",
          "Node fleet status accepts only registry, home, and output options.",
        );
      }
      const report = await inspectNodeFleetStatus({
        registryPath:
          parsed.values.registry === undefined
            ? defaultNodeFleetRegistryPath()
            : registryPath(parsed.values.registry),
        ...(parsed.values.home === undefined ? {} : { homeDirectory: parsed.values.home }),
      });
      io.stdout(
        parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : formatNodeFleetStatus(report),
      );
      return report.status === "ready" ? 0 : 1;
    } catch (error) {
      const code =
        error instanceof RepositoryRegistryError || error instanceof NodeFleetApplyError
          ? error.code
          : "repository_node_status_failed";
      io.stderr(`Repository Node status failed (${code}).\n`);
      return 1;
    }
  }
  if (
    parsed.positionals.length === 2 &&
    action === "node" &&
    ["plan", "apply"].includes(parsed.positionals[1] ?? "")
  ) {
    try {
      const nodeAction = parsed.positionals[1];
      if (
        parsed.values.project !== undefined ||
        parsed.values.root === undefined ||
        parsed.values.node === undefined ||
        parsed.values.destination === undefined ||
        parsed.values["runtime-version"] === undefined ||
        (parsed.values.manager !== "systemd" && parsed.values.manager !== "launchd")
      ) {
        throw new RepositoryRegistryError(
          "node_fleet_plan_arguments_invalid",
          "The Node plan requires verified desired coordinates and does not accept --write.",
        );
      }
      if (
        nodeAction === "plan" &&
        (parsed.values.write === true ||
          parsed.values.config !== undefined ||
          parsed.values.apply !== undefined ||
          parsed.values["transition-legacy"] === true)
      ) {
        throw new RepositoryRegistryError(
          "node_fleet_plan_arguments_invalid",
          "The Node plan is read-only and does not accept apply material.",
        );
      }
      if (
        nodeAction === "apply" &&
        (parsed.values.write !== true ||
          parsed.values.config === undefined ||
          parsed.values.apply === undefined ||
          !isAbsolute(parsed.values.config))
      ) {
        throw new RepositoryRegistryError(
          "node_fleet_apply_arguments_invalid",
          "Node apply requires an absolute config path, the exact plan ID, and --write.",
        );
      }
      if (
        parsed.values.home !== undefined &&
        (!isAbsolute(parsed.values.home) || /[\0\r\n]/u.test(parsed.values.home))
      ) {
        throw new RepositoryRegistryError(
          "node_fleet_home_invalid",
          "The service home directory must be a safe absolute path.",
        );
      }
      const path =
        parsed.values.registry === undefined
          ? defaultNodeFleetRegistryPath()
          : registryPath(parsed.values.registry);
      const plan = await createNodeFleetOnboardingPlan({
        registryPath: path,
        repositoryRoot: parsed.values.root,
        nodeId: parsed.values.node,
        destinationId: parsed.values.destination,
        runtimeVersion: parsed.values["runtime-version"],
        serviceManager: parsed.values.manager,
        ...(parsed.values.home === undefined ? {} : { homeDirectory: parsed.values.home }),
      });
      if (nodeAction === "apply") {
        if (parsed.values.apply !== plan.planId)
          throw new NodeFleetApplyError(
            "node_fleet_plan_stale",
            "The exact current Node fleet plan is required.",
          );
        const receipt = await applyNodeFleetOnboarding({
          plan,
          configPath: parsed.values.config!,
          ...(parsed.values.home === undefined ? {} : { homeDirectory: parsed.values.home }),
          ...(parsed.values["transition-legacy"] === true ? { transitionLegacy: true } : {}),
        });
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(receipt, null, 2)}\n`
            : `Repository Node onboarding applied.\nplan: ${receipt.planId}\nservice: ${receipt.service.change}\nreadiness: ${receipt.readiness.status} (${receipt.readiness.observations} observations)\nregistry: ${receipt.registry.change}\n`,
        );
        return 0;
      }
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Repository Node onboarding: ${plan.outcome}\nplan: ${plan.planId}\nregistry: ${plan.registry.reconciliation}\nservice target: ${plan.service.targetState}\nlegacy singleton: ${plan.service.legacyTargetState}\nactivation: ${plan.service.activation}; readiness: ${plan.service.readiness}\nThis plan is read-only. Credentials and service-definition bodies are excluded.\n`,
      );
      return 0;
    } catch (error) {
      const code =
        error instanceof RepositoryRegistryError || error instanceof NodeFleetApplyError
          ? error.code
          : "repository_node_operation_failed";
      // Node fleet messages are bounded and secret-free; they name readiness blockers.
      io.stderr(
        `Repository Node operation failed (${code})${
          error instanceof NodeFleetApplyError ? `: ${error.message}` : "."
        }\n`,
      );
      return 1;
    }
  }
  if (
    parsed.positionals.length !== 1 ||
    !["register", "unregister", "list", "resolve"].includes(action ?? "")
  ) {
    io.stderr(`The repository action is invalid.\n${repositoryUsage}\n`);
    return 1;
  }
  try {
    if (
      parsed.values.node !== undefined ||
      parsed.values.destination !== undefined ||
      parsed.values["runtime-version"] !== undefined ||
      parsed.values.manager !== undefined ||
      parsed.values.home !== undefined ||
      parsed.values.config !== undefined ||
      parsed.values.apply !== undefined ||
      parsed.values["transition-legacy"] === true
    ) {
      throw new RepositoryRegistryError(
        "repository_arguments_invalid",
        "Node plan arguments are not valid for this repository action.",
      );
    }
    const path = registryPath(parsed.values.registry);
    if (action === "register") {
      if (
        parsed.values.write !== true ||
        parsed.values.root === undefined ||
        parsed.values.project !== undefined
      ) {
        throw new RepositoryRegistryError(
          "repository_write_required",
          "Repository registration requires --root and explicit --write.",
        );
      }
      const result = await registerRepository({
        registryPath: path,
        repositoryRoot: parsed.values.root,
      });
      // ADR-0469: a registered checkout joins background knowledge continuity at once.
      const knowledgeContinuity = await onboardKnowledgeContinuity({
        repositoryRoot: result.registration.repositoryRoot,
        register: false,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ ...result, knowledgeContinuity }, null, 2)}\n`
          : `Repository ${result.registration.projectId}: ${result.change}\n  ${result.registration.name}\n  ${result.registration.repositoryRoot}\n${knowledgeContinuity === null ? "" : `  knowledge continuity: delegation ${knowledgeContinuity.delegation} · owner-host ${knowledgeContinuity.ownerHost}\n`}`,
      );
      return 0;
    }
    if (action === "unregister") {
      if (
        parsed.values.write !== true ||
        parsed.values.project === undefined ||
        parsed.values.root !== undefined
      )
        throw new RepositoryRegistryError(
          "repository_write_required",
          "Unregistering requires --project and explicit --write.",
        );
      const result = await unregisterRepository({
        registryPath: path,
        projectId: parsed.values.project,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Repository ${result.registration.projectId}: unregistered on this host; its files stay in place.\n`,
      );
      return 0;
    }
    if (parsed.values.write === true || parsed.values.root !== undefined) {
      throw new RepositoryRegistryError(
        "repository_arguments_invalid",
        "Read commands do not accept --write or --root.",
      );
    }
    if (action === "list") {
      if (parsed.values.project !== undefined)
        throw new RepositoryRegistryError(
          "repository_arguments_invalid",
          "The list action does not select a project.",
        );
      const repositories = await listRegisteredRepositories(path);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ verification: "stored_only", repositories }, null, 2)}\n`
          : repositories.length === 0
            ? "No repositories are registered.\n"
            : `${repositories.map((entry) => `${entry.projectId} · ${entry.name}\n  ${entry.repositoryRoot}`).join("\n")}\n`,
      );
      return 0;
    }
    if (parsed.values.project === undefined)
      throw new RepositoryRegistryError(
        "repository_arguments_invalid",
        "The resolve action requires --project.",
      );
    const registration = await resolveRegisteredRepository({
      registryPath: path,
      projectId: parsed.values.project,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ verification: "manifest_revalidated", registration }, null, 2)}\n`
        : `Repository ${registration.projectId}: verified\n  ${registration.name}\n  ${registration.repositoryRoot}\n`,
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof RepositoryRegistryError ? error.code : "repository_command_failed";
    io.stderr(`Repository command failed (${code}).\n`);
    return 1;
  }
}
