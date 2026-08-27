import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import { defaultNodeFleetRegistryPath, RepositoryRegistryError } from "@lervo/repository-registry";

import {
  executeInstalledOrganizationNodeRolloutDelivery,
  recoverInstalledOrganizationNodeRolloutDelivery,
} from "./organization-node-rollout-delivery.js";
import {
  executeInstalledOrganizationNodeRollbackDelivery,
  recoverInstalledOrganizationNodeRollbackDelivery,
} from "./organization-node-rollback-delivery.js";
import type { CliIo } from "./types.js";

export const repositoryNodeRolloutUsage =
  "  lervo repository node rollout <execute|recover|rollback|rollback-recover> --root <absolute-path> --node <node-id> --destination <destination-id> --manager <systemd|launchd> --config <absolute-path> (--executable <absolute-path>|--failed-executable <absolute-path> --predecessor-executable <absolute-path>) --request <absolute-path> --trust <absolute-path> --write [--registry <absolute-path>] [--replay-store <absolute-path>] [--home <absolute-path>] [--json]";

function safeAbsolutePath(value: string | undefined): value is string {
  return value !== undefined && isAbsolute(value) && !/[\0\r\n]/u.test(value);
}

function optionalSafeAbsolutePath(value: string | undefined): boolean {
  return value === undefined || safeAbsolutePath(value);
}

export async function runRepositoryNodeRolloutCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        registry: { type: "string" },
        node: { type: "string" },
        destination: { type: "string" },
        manager: { type: "string" },
        home: { type: "string" },
        config: { type: "string" },
        executable: { type: "string" },
        "failed-executable": { type: "string" },
        "predecessor-executable": { type: "string" },
        request: { type: "string" },
        trust: { type: "string" },
        "replay-store": { type: "string" },
        write: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${repositoryNodeRolloutUsage}\n`);
      return 0;
    }
    const action = parsed.positionals[2];
    if (
      parsed.positionals.length !== 3 ||
      parsed.positionals[0] !== "node" ||
      parsed.positionals[1] !== "rollout" ||
      !["execute", "recover", "rollback", "rollback-recover"].includes(action ?? "") ||
      parsed.values.write !== true ||
      parsed.values.node === undefined ||
      parsed.values.destination === undefined ||
      (parsed.values.manager !== "systemd" && parsed.values.manager !== "launchd") ||
      !safeAbsolutePath(parsed.values.root) ||
      !safeAbsolutePath(parsed.values.config) ||
      !safeAbsolutePath(parsed.values.request) ||
      !safeAbsolutePath(parsed.values.trust) ||
      !optionalSafeAbsolutePath(parsed.values.registry) ||
      !optionalSafeAbsolutePath(parsed.values.home) ||
      !optionalSafeAbsolutePath(parsed.values["replay-store"]) ||
      ((action === "execute" || action === "recover") &&
        (!safeAbsolutePath(parsed.values.executable) ||
          parsed.values["failed-executable"] !== undefined ||
          parsed.values["predecessor-executable"] !== undefined)) ||
      ((action === "rollback" || action === "rollback-recover") &&
        (parsed.values.executable !== undefined ||
          !safeAbsolutePath(parsed.values["failed-executable"]) ||
          !safeAbsolutePath(parsed.values["predecessor-executable"])))
    ) {
      throw new RepositoryRegistryError(
        "node_rollout_delivery_arguments_invalid",
        "Authenticated Node rollout execution requires exact local binding, signed request, trust, and --write.",
      );
    }
    const replayPath =
      parsed.values["replay-store"] ??
      resolve(parsed.values.root, ".lervo/data/organization-rollout-replay.sqlite");
    const serviceManager: "systemd" | "launchd" = parsed.values.manager;
    const commonBinding = {
      registryPath:
        parsed.values.registry === undefined
          ? defaultNodeFleetRegistryPath()
          : resolve(parsed.values.registry),
      repositoryRoot: parsed.values.root,
      nodeId: parsed.values.node,
      destinationId: parsed.values.destination,
      serviceManager,
      configPath: parsed.values.config,
      ...(parsed.values.home === undefined ? {} : { homeDirectory: parsed.values.home }),
    };
    if (action === "rollback" || action === "rollback-recover") {
      const rollbackInput = {
        requestPath: parsed.values.request,
        trustPath: parsed.values.trust,
        replayPath,
        binding: {
          ...commonBinding,
          failedExecutablePath: parsed.values["failed-executable"]!,
          predecessorExecutablePath: parsed.values["predecessor-executable"]!,
        },
      };
      const result =
        action === "rollback"
          ? await executeInstalledOrganizationNodeRollbackDelivery(rollbackInput)
          : await recoverInstalledOrganizationNodeRollbackDelivery(rollbackInput);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : action === "rollback"
            ? `Organization Node rollback delivery ${result.status}.\ndelivery: ${result.receipt.deliveryId}\nrollback: ${"rollbackReceipt" in result.receipt ? result.receipt.rollbackReceipt.rollbackReceiptId : "not_replayed"}\n`
            : `Organization Node rollback recovery ${result.status}.\ndelivery: ${result.receipt.deliveryId}\nclassification: ${"classification" in result.receipt ? result.receipt.classification : "completed"}\nNo rollback effect was replayed.\n`,
      );
      return action === "rollback-recover" &&
        "classification" in result.receipt &&
        result.receipt.classification === "unknown"
        ? 2
        : 0;
    }
    const deliveryInput = {
      requestPath: parsed.values.request,
      trustPath: parsed.values.trust,
      replayPath,
      binding: { ...commonBinding, executablePath: parsed.values.executable! },
    };
    if (action === "recover") {
      const result = await recoverInstalledOrganizationNodeRolloutDelivery(deliveryInput);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Organization Node rollout recovery ${result.status}.\ndelivery: ${result.receipt.deliveryId}\nclassification: ${result.receipt.classification}\nrecovery: ${result.receipt.recoveryReceiptId}\nNo rollout effect was replayed.\n`,
      );
      return result.receipt.classification === "unknown" ? 2 : 0;
    }
    const result = await executeInstalledOrganizationNodeRolloutDelivery(deliveryInput);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Organization Node rollout delivery ${result.status}.\ndelivery: ${result.receipt.deliveryId}\nexecution: ${result.receipt.executionReceipt.executionReceiptId}\n`,
    );
    return 0;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "node_rollout_delivery_failed";
    io.stderr(`Organization Node rollout delivery failed (${code}).\n`);
    return 1;
  }
}
