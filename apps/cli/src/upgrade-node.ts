import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  listNodeFleetInstances,
  type NodeFleetOnboardingPlan,
} from "@lervo/repository-registry";

import { applyNodeFleetOnboarding, inspectNodeFleetStatus } from "./node-fleet-apply.js";

export interface NodeUpgradeStage {
  disposition: "current" | "safe_apply" | "pending_authority" | "blocked";
  registered: boolean;
  planId: string | null;
  runtimeVersion: { current: string | null; desired: string };
  runtimeBuildHash: string | null;
  configPathDigest: string | null;
  serviceTargetHash: string | null;
  reason: string;
}

export interface NodeUpgradeInspection {
  stage: NodeUpgradeStage;
  plan: NodeFleetOnboardingPlan | null;
  configPath: string | null;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stage(input: {
  disposition: NodeUpgradeStage["disposition"];
  registered: boolean;
  planId: string | null;
  currentVersion: string | null;
  desiredVersion: string;
  runtimeBuildHash?: string | null;
  configPath?: string | null;
  serviceTargetHash?: string | null;
  reason: string;
}): NodeUpgradeStage {
  return {
    disposition: input.disposition,
    registered: input.registered,
    planId: input.planId,
    runtimeVersion: { current: input.currentVersion, desired: input.desiredVersion },
    runtimeBuildHash: input.runtimeBuildHash ?? null,
    configPathDigest:
      input.configPath === undefined || input.configPath === null ? null : sha256(input.configPath),
    serviceTargetHash: input.serviceTargetHash ?? null,
    reason: input.reason,
  };
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function decodeSystemd(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\") {
      const next = value[index + 1];
      if (next !== "\\" && next !== '"') return null;
      decoded += next;
      index += 1;
    } else if (character === "%" && value[index + 1] === "%") {
      decoded += "%";
      index += 1;
    } else decoded += character;
  }
  return decoded;
}

export function parseNodeServiceCoordinates(
  manager: "systemd" | "launchd",
  content: string,
): { executable: string; config: string } | null {
  if (manager === "launchd") {
    const match =
      /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>\s*<string>--config<\/string>\s*<string>([^<]+)<\/string>\s*<\/array>/u.exec(
        content,
      );
    return match === null
      ? null
      : { executable: decodeXml(match[1]!), config: decodeXml(match[2]!) };
  }
  const line = content.split("\n").find((item) => item.startsWith("ExecStart="));
  const match = /^ExecStart="((?:[^"\\]|\\.)*)" --config "((?:[^"\\]|\\.)*)"$/u.exec(line ?? "");
  if (match === null) return null;
  const executable = decodeSystemd(match[1]!);
  const config = decodeSystemd(match[2]!);
  return executable === null || config === null ? null : { executable, config };
}

async function safeServiceCoordinates(
  plan: NodeFleetOnboardingPlan,
): Promise<{ executable: string; config: string } | null> {
  if (plan.service.targetState !== "present_unverified") return null;
  const metadata = await lstat(plan.service.targetPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > 64 * 1024 ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  )
    return null;
  const coordinates = parseNodeServiceCoordinates(
    plan.desired.serviceManager,
    await readFile(plan.service.targetPath, "utf8"),
  );
  if (
    coordinates === null ||
    !isAbsolute(coordinates.executable) ||
    !isAbsolute(coordinates.config) ||
    /[\0\r\n]/u.test(`${coordinates.executable}${coordinates.config}`)
  )
    return null;
  return { executable: resolve(coordinates.executable), config: resolve(coordinates.config) };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function desiredNodeRuntime(): Promise<{
  hash: string;
  launcher: string;
  payload: string;
  payloadBytes: Buffer;
  launcherContent: string;
}> {
  const bytes = await readFile(new URL("./node-runtime.js", import.meta.url));
  const hash = sha256(bytes);
  const hexadecimal = hash.slice("sha256:".length);
  const directory =
    process.platform === "darwin"
      ? resolve(
          homedir(),
          "Library",
          "Application Support",
          "Lervo",
          "runtimes",
          "node",
          hexadecimal.slice(0, 16),
        )
      : resolve(
          homedir(),
          ".local",
          "share",
          "lervo",
          "runtimes",
          "node",
          hexadecimal.slice(0, 16),
        );
  const payload = resolve(directory, "node-runtime.js");
  const launcher = resolve(directory, `lervo-node-launcher-${hexadecimal.slice(0, 12)}`);
  return {
    hash,
    launcher,
    payload,
    payloadBytes: bytes,
    launcherContent: `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(payload)} "$@"\n`,
  };
}

export async function inspectRegisteredNodeUpgrade(
  root: string,
  projectId: string,
  desiredVersion: string,
): Promise<NodeUpgradeInspection> {
  const registryPath = defaultNodeFleetRegistryPath();
  const physicalRoot = await realpath(root);
  const registration = (await listNodeFleetInstances(registryPath)).find(
    (item) => item.projectId === projectId || item.repositoryRoot === physicalRoot,
  );
  if (registration === undefined)
    return {
      stage: stage({
        disposition: "current",
        registered: false,
        planId: null,
        currentVersion: null,
        desiredVersion,
        reason: "node_not_configured",
      }),
      plan: null,
      configPath: null,
    };
  const common = { registered: true, currentVersion: registration.runtimeVersion, desiredVersion };
  const plan = await createNodeFleetOnboardingPlan({
    registryPath,
    repositoryRoot: physicalRoot,
    nodeId: registration.nodeId,
    destinationId: registration.destinationId,
    runtimeVersion: desiredVersion,
    serviceManager: registration.serviceManager,
  });
  const planFields = {
    ...common,
    planId: plan.planId,
    serviceTargetHash: plan.service.targetContentHash,
  };
  if (plan.service.legacyTargetState !== "absent")
    return {
      stage: stage({
        ...planFields,
        disposition: "pending_authority",
        reason: "legacy_node_transition_requires_explicit_authority",
      }),
      plan,
      configPath: null,
    };
  const coordinates = await safeServiceCoordinates(plan);
  if (coordinates === null)
    return {
      stage: stage({
        ...planFields,
        disposition: plan.service.targetState === "conflict" ? "blocked" : "pending_authority",
        reason:
          plan.service.targetState === "conflict"
            ? "node_service_target_conflict"
            : "node_config_path_recovery_required",
      }),
      plan,
      configPath: null,
    };
  let desired: Awaited<ReturnType<typeof desiredNodeRuntime>>;
  try {
    desired = await desiredNodeRuntime();
  } catch {
    return {
      stage: stage({
        ...planFields,
        disposition: "blocked",
        configPath: coordinates.config,
        reason: "installed_node_runtime_payload_unavailable",
      }),
      plan,
      configPath: coordinates.config,
    };
  }
  const deploymentFields = {
    ...planFields,
    runtimeBuildHash: desired.hash,
    configPath: coordinates.config,
  };
  if (coordinates.executable === desired.launcher) {
    try {
      const [launcher, payload] = await Promise.all([
        readFile(desired.launcher, "utf8"),
        readFile(desired.payload),
      ]);
      if (launcher !== desired.launcherContent || !payload.equals(desired.payloadBytes))
        return {
          stage: stage({
            ...deploymentFields,
            disposition: "blocked",
            reason: "node_runtime_content_conflict",
          }),
          plan,
          configPath: coordinates.config,
        };
    } catch {
      return {
        stage: stage({
          ...deploymentFields,
          disposition: "blocked",
          reason: "node_runtime_content_unavailable",
        }),
        plan,
        configPath: coordinates.config,
      };
    }
  }
  const fleet = await inspectNodeFleetStatus({ registryPath });
  const status = fleet.instances.find((item) => item.projectId === projectId);
  const deploymentCurrent =
    coordinates.executable === desired.launcher && plan.registry.reconciliation === "unchanged";
  if (deploymentCurrent && status?.recoveryAction === "none")
    return {
      stage: stage({ ...deploymentFields, disposition: "current", reason: "exact_runtime_ready" }),
      plan,
      configPath: coordinates.config,
    };
  const hubUnavailableOnly =
    status !== undefined &&
    status.service.managerAvailable &&
    status.service.installed &&
    status.service.active &&
    status.service.enabled !== false &&
    [status.runtime.sync, status.runtime.workstreamReplication, status.runtime.remoteControl].every(
      (value) => ["ready", "disabled", "unavailable:hub_unavailable"].includes(value),
    ) &&
    [status.runtime.sync, status.runtime.workstreamReplication, status.runtime.remoteControl].some(
      (value) => value === "unavailable:hub_unavailable",
    );
  if (deploymentCurrent && hubUnavailableOnly)
    return {
      stage: stage({
        ...deploymentFields,
        disposition: "current",
        reason: "exact_runtime_deployed_hub_unavailable",
      }),
      plan,
      configPath: coordinates.config,
    };
  if (deploymentCurrent && status !== undefined && status.recoveryAction !== "reapply_exact_plan")
    return {
      stage: stage({
        ...deploymentFields,
        disposition: "blocked",
        reason: `node_runtime_${status.recoveryAction}`,
      }),
      plan,
      configPath: coordinates.config,
    };
  return {
    stage: stage({
      ...deploymentFields,
      disposition: "safe_apply",
      reason: deploymentCurrent ? "node_runtime_recovery" : "node_runtime_build_or_version_changed",
    }),
    plan,
    configPath: coordinates.config,
  };
}

export async function applyRegisteredNodeUpgrade(inspection: NodeUpgradeInspection): Promise<void> {
  if (
    inspection.plan === null ||
    inspection.configPath === null ||
    inspection.stage.configPathDigest !== sha256(inspection.configPath)
  )
    throw new Error("The registered Node upgrade inputs could not be revalidated.");
  await applyNodeFleetOnboarding({
    plan: inspection.plan,
    configPath: inspection.configPath,
    allowHubUnavailableReadiness: true,
  });
}
