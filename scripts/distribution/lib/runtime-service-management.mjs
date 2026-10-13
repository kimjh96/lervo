import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  createRuntimeServiceDefinition,
  runtimeServiceIdentity,
  runtimeServiceStopTimeoutMs,
  runtimeServiceTargetPath,
} from "../render-runtime-service.mjs";
import {
  NodeSupervisionUpgradeFenceError,
  withNodeSupervisionUpgradeFence,
} from "./node-supervision-upgrade-fence.mjs";
import { NodeWorkUpgradeFenceError, withNodeWorkUpgradeFence } from "./node-work-upgrade-fence.mjs";
import { nodeUpgradePredecessorConfig } from "./node-upgrade-predecessor-config.mjs";
import {
  NodeCliConfigurationTransitionError,
  selectNodeConfigurationTransition,
} from "./node-cli-configuration-transition.mjs";
import { findMigratedConfigPredecessors } from "./node-executable-path-rewrites.mjs";

const MAXIMUM_DEFINITION_BYTES = 131_072;
const SERVICE_STABILITY_OBSERVATIONS = 3;
const SERVICE_STABILITY_INTERVAL_MS = 500;
// `launchctl bootout` returns before the job leaves the domain: the job stays printable
// while its process handles SIGTERM, and `bootstrap` fails with EIO until it is gone.
// Stop observation therefore spans the canonical graceful stop bound, not a fixed few probes.
const SERVICE_STOP_MAXIMUM_OBSERVATIONS =
  Math.ceil(runtimeServiceStopTimeoutMs / SERVICE_STABILITY_INTERVAL_MS) +
  SERVICE_STABILITY_OBSERVATIONS;
const SERVICE_STOP_COMMAND_TIMEOUT_MS = runtimeServiceStopTimeoutMs + 30_000;

export class RuntimeServiceManagementError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "RuntimeServiceManagementError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeServiceManagementError(code, message);
}

function parse(args) {
  const values = new Map();
  let write = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--write") {
      if (write) fail("invalid_arguments", "--write was provided more than once.");
      write = true;
      continue;
    }
    const value = args[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(key)
    ) {
      fail("invalid_arguments", "A service management argument is invalid.");
    }
    values.set(key, value);
    index += 1;
  }
  const allowed = new Set([
    "--action",
    "--manager",
    "--runtime",
    "--instance",
    "--definition",
    "--previous-definition",
    "--executable",
    "--node-executable",
    "--path-directories",
    "--config",
    "--configuration-source",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    fail("invalid_arguments", "An unknown service management argument was provided.");
  }
  const action = values.get("--action");
  const manager = values.get("--manager");
  const runtime = values.get("--runtime");
  if (!["install", "upgrade", "rollback", "status", "remove"].includes(action)) {
    fail("invalid_arguments", "The service action is invalid.");
  }
  if (manager !== "systemd" && manager !== "launchd") {
    fail("invalid_arguments", "The service manager is invalid.");
  }
  if (!["hub", "node", "knowledge-host", "repository-replica"].includes(runtime)) {
    fail("invalid_arguments", "The runtime is invalid.");
  }
  const instance = values.get("--instance");
  if (
    (runtime === "node" && (instance === undefined || !/^nfi_[a-f0-9]{24}$/u.test(instance))) ||
    (runtime !== "node" && instance !== undefined)
  )
    fail(
      "invalid_arguments",
      "A Node service requires one valid instance ID; other services do not accept one.",
    );
  if (action === "status") {
    const expectedSize = runtime === "node" ? 4 : 3;
    if (write || values.size !== expectedSize) {
      fail("invalid_arguments", "Status does not accept write arguments or a definition.");
    }
    return { action, manager, runtime, instance: instance ?? null };
  }
  const nodeExecutable = values.get("--node-executable");
  const configurationSource = values.get("--configuration-source");
  if (configurationSource !== undefined && (runtime !== "node" || action !== "upgrade"))
    fail("invalid_arguments", "CLI configuration replacement requires a Node upgrade.");
  const expectedSize =
    (runtime === "node" ? 7 : 6) +
    (["upgrade", "rollback"].includes(action) ? 1 : 0) +
    (nodeExecutable === undefined ? 0 : 1) +
    (values.has("--path-directories") ? 1 : 0) +
    (configurationSource === undefined ? 0 : 1);
  if (!write || values.size !== expectedSize) {
    fail("write_not_authorized", "Install and remove require canonical input and --write.");
  }
  const definition = values.get("--definition");
  const previousDefinition = values.get("--previous-definition");
  const executable = values.get("--executable");
  const config = values.get("--config");
  for (const value of [
    definition,
    executable,
    ...(nodeExecutable === undefined ? [] : [nodeExecutable]),
    config,
    ...(configurationSource === undefined ? [] : [configurationSource]),
    ...(["upgrade", "rollback"].includes(action) ? [previousDefinition] : []),
  ]) {
    if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/u.test(value)) {
      fail("invalid_arguments", "A service source must be an absolute path without line breaks.");
    }
  }
  return {
    action,
    manager,
    runtime,
    instance: instance ?? null,
    definition: resolve(definition),
    previousDefinition: previousDefinition === undefined ? null : resolve(previousDefinition),
    executable: resolve(executable),
    nodeExecutable: nodeExecutable === undefined ? null : resolve(nodeExecutable),
    pathDirectories: values.get("--path-directories")?.split(":") ?? [],
    config: resolve(config),
    ...(configurationSource === undefined
      ? {}
      : { configurationSource: resolve(configurationSource) }),
  };
}

async function regularFile(path, { required, ownerOnly = false } = { required: true }) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAXIMUM_DEFINITION_BYTES ||
    (ownerOnly && process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  )
    fail("unsafe_service_definition", "The service definition file is unsafe.");
  return readFile(path);
}

async function exactDefinition(input) {
  let expected;
  try {
    expected = Buffer.from(await createRuntimeServiceDefinition(input), "utf8");
  } catch (error) {
    throw new RuntimeServiceManagementError(
      "invalid_service_definition",
      "The canonical service definition could not be created.",
      { cause: error },
    );
  }
  let actual;
  try {
    actual = await regularFile(input.definition, { required: true, ownerOnly: true });
  } catch (error) {
    if (error instanceof RuntimeServiceManagementError) throw error;
    throw new RuntimeServiceManagementError(
      "unsafe_service_definition",
      "The service definition could not be read safely.",
      { cause: error },
    );
  }
  if (!actual.equals(expected)) {
    fail("service_definition_mismatch", "The service definition differs from the canonical input.");
  }
  return expected;
}

function defaultRunCommand(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: options.captureOutput === true ? 65_536 : 4_096,
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
      },
      (error, stdout) => {
        const output = options.captureOutput === true ? { stdout } : {};
        if (error === null) resolvePromise({ exitCode: 0, ...output });
        else
          resolvePromise({
            exitCode: typeof error.code === "number" ? error.code : null,
            ...output,
          });
      },
    );
  });
}

function defaultWait(durationMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs));
}

async function command(runCommand, executable, args, options) {
  try {
    const result = await runCommand(executable, args, options);
    return result?.exitCode === null ? null : Number(result?.exitCode);
  } catch {
    return null;
  }
}

async function commandOutput(runCommand, executable, args) {
  try {
    const result = await runCommand(executable, args, { captureOutput: true });
    if (result?.exitCode === null || result?.exitCode === undefined) return null;
    return {
      exitCode: Number(result.exitCode),
      stdout: typeof result.stdout === "string" ? result.stdout : "",
    };
  } catch {
    return null;
  }
}

/**
 * `launchctl print` exits 0 for any loaded job, running or not. Only the job's own top-level
 * state line, indented by one tab, says whether its process runs.
 */
function launchdJobRunning(output) {
  return /^\tstate = running$/mu.test(output);
}

async function serviceStatus(input, context) {
  const installedBytes = await regularFile(context.target, { required: false });
  if (input.manager === "systemd") {
    const [enabled, active] = await Promise.all([
      command(context.runCommand, "systemctl", ["--user", "is-enabled", context.identity.name]),
      command(context.runCommand, "systemctl", ["--user", "is-active", context.identity.name]),
    ]);
    return {
      manager: input.manager,
      runtime: input.runtime,
      instance: input.instance,
      serviceIdentity: context.identity.name,
      managerAvailable: enabled !== null && active !== null,
      installed: installedBytes !== null,
      enabled: enabled === 0,
      // systemd stops and starts units without unloading them; loaded mirrors active there.
      loaded: active === 0,
      active: active === 0,
    };
  }
  const printed = await commandOutput(context.runCommand, "launchctl", [
    "print",
    `${context.identity.domain}/${context.identity.label}`,
  ]);
  return {
    manager: input.manager,
    runtime: input.runtime,
    instance: input.instance,
    serviceIdentity: context.identity.label,
    managerAvailable: printed !== null,
    installed: installedBytes !== null,
    enabled: null,
    loaded: printed?.exitCode === 0,
    active: printed?.exitCode === 0 && launchdJobRunning(printed.stdout),
  };
}

function isOperationalServiceStatus(status) {
  return status.managerAvailable && status.installed && status.active && status.enabled !== false;
}

/** Removed from the manager: no process and, under launchd, no loaded job left to boot out. */
function isStoppedServiceStatus(status) {
  return status.managerAvailable && !status.loaded && status.enabled !== true;
}

/** Unloaded, so its definition may be replaced and bootstrapped again. */
function isInactiveServiceStatus(status) {
  return status.managerAvailable && !status.loaded;
}

/** No running process, so the service cannot be doing work; a launchd job may stay loaded. */
function isNotRunningServiceStatus(status) {
  return status.managerAvailable && !status.active;
}

async function stabilizedServiceStatus(input, context, initial) {
  let status = initial;
  for (let index = 1; index < SERVICE_STABILITY_OBSERVATIONS; index += 1) {
    if (!isOperationalServiceStatus(status)) return status;
    await context.wait(SERVICE_STABILITY_INTERVAL_MS);
    status = await serviceStatus(input, context);
  }
  return status;
}

async function stabilizedStoppedServiceStatus(input, context, initial) {
  let status = initial;
  let consecutive = 0;
  for (let index = 0; index < SERVICE_STOP_MAXIMUM_OBSERVATIONS; index += 1) {
    consecutive = isStoppedServiceStatus(status) ? consecutive + 1 : 0;
    if (consecutive === SERVICE_STABILITY_OBSERVATIONS) return status;
    await context.wait(SERVICE_STABILITY_INTERVAL_MS);
    status = await serviceStatus(input, context);
  }
  return status;
}

async function stabilizedInactiveServiceStatus(
  input,
  context,
  initial,
  settled = isInactiveServiceStatus,
) {
  let status = initial;
  let consecutive = 0;
  for (let index = 0; index < SERVICE_STOP_MAXIMUM_OBSERVATIONS; index += 1) {
    consecutive = settled(status) ? consecutive + 1 : 0;
    if (consecutive === SERVICE_STABILITY_OBSERVATIONS) return status;
    await context.wait(SERVICE_STABILITY_INTERVAL_MS);
    status = await serviceStatus(input, context);
  }
  return status;
}

async function writeTarget(path, bytes) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(bytes);
  } finally {
    await handle?.close();
  }
  await chmod(path, 0o600);
}

async function replaceTarget(path, bytes) {
  const temporary = `${path}.${process.pid}.upgrade`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

async function currentTarget(target) {
  try {
    return await regularFile(target, { required: false, ownerOnly: true });
  } catch (error) {
    if (error instanceof RuntimeServiceManagementError) throw error;
    throw new RuntimeServiceManagementError(
      "service_state_conflict",
      "The current service target could not be verified safely.",
      { cause: error },
    );
  }
}

async function install(input, expected, context) {
  const current = await currentTarget(context.target);
  if (current !== null && !current.equals(expected)) {
    fail("service_state_conflict", "The existing service definition cannot be overwritten.");
  }
  const observed = await serviceStatus(input, context);
  if (!observed.managerAvailable) {
    fail("service_manager_unavailable", "The service manager is unavailable.");
  }
  if (current === null && (observed.loaded || observed.enabled === true)) {
    fail(
      "service_state_conflict",
      "A service retained by the manager without a definition will not be overwritten.",
    );
  }
  const created = current === null;
  if (created) await writeTarget(context.target, expected);
  const before = { ...observed, installed: true };
  if (before.managerAvailable && before.installed && before.active && before.enabled !== false) {
    return { ...before, change: created ? "installed" : "unchanged" };
  }
  let applied;
  if (input.manager === "systemd") {
    applied =
      (await command(context.runCommand, "systemctl", ["--user", "daemon-reload"])) === 0 &&
      (await command(context.runCommand, "systemctl", [
        "--user",
        "enable",
        "--now",
        context.identity.name,
      ])) === 0;
  } else {
    applied =
      (await command(context.runCommand, "launchctl", [
        "enable",
        `${context.identity.domain}/${context.identity.label}`,
      ])) === 0 &&
      (before.loaded
        ? // A loaded job that is not running is started again; bootstrapping it twice fails.
          (await command(context.runCommand, "launchctl", [
            "kickstart",
            `${context.identity.domain}/${context.identity.label}`,
          ])) === 0
        : (await command(context.runCommand, "launchctl", [
            "bootstrap",
            context.identity.domain,
            context.target,
          ])) === 0);
  }
  let after = await serviceStatus(input, context);
  if (applied && isOperationalServiceStatus(after)) {
    after = await stabilizedServiceStatus(input, context, after);
  }
  if (applied && isOperationalServiceStatus(after)) {
    return { ...after, change: created ? "installed" : "activated" };
  }
  if (!created) {
    fail(
      "service_apply_unknown",
      "The apply result for the existing service could not be verified.",
    );
  }
  const compensated = await compensateInstall(input, expected, context);
  fail(
    compensated ? "service_apply_failed" : "service_apply_unknown",
    compensated
      ? "The failed service apply was restored to the original uninstalled state."
      : "Neither the service apply result nor the recovery state could be verified.",
  );
}

async function compensateInstall(input, expected, context) {
  if (input.manager === "systemd") {
    await command(
      context.runCommand,
      "systemctl",
      ["--user", "disable", "--now", context.identity.name],
      { timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS },
    );
  } else {
    await command(
      context.runCommand,
      "launchctl",
      ["bootout", `${context.identity.domain}/${context.identity.label}`],
      { timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS },
    );
    await command(context.runCommand, "launchctl", [
      "disable",
      `${context.identity.domain}/${context.identity.label}`,
    ]);
  }
  const status = await serviceStatus(input, context);
  if (!status.managerAvailable || status.loaded || status.enabled === true) return false;
  const current = await currentTarget(context.target);
  if (current === null || !current.equals(expected)) return false;
  try {
    await unlink(context.target);
  } catch {
    return false;
  }
  if (input.manager === "systemd") {
    return (await command(context.runCommand, "systemctl", ["--user", "daemon-reload"])) === 0;
  }
  return true;
}

async function remove(input, expected, context) {
  const current = await currentTarget(context.target);
  if (current === null) {
    const status = await serviceStatus(input, context);
    if (!status.managerAvailable) {
      fail("service_manager_unavailable", "The service manager is unavailable.");
    }
    if (status.loaded || status.enabled === true) {
      fail(
        "service_state_conflict",
        "A service retained by the manager without a definition will not be removed.",
      );
    }
    return { ...status, change: "unchanged" };
  }
  if (!current.equals(expected)) {
    fail(
      "service_state_conflict",
      "A service that differs from the canonical definition will not be removed.",
    );
  }
  const before = await serviceStatus(input, context);
  if (!before.managerAvailable)
    fail("service_manager_unavailable", "The service manager is unavailable.");
  if (input.manager === "systemd") {
    if (
      (before.active || before.enabled) &&
      (await command(
        context.runCommand,
        "systemctl",
        ["--user", "disable", "--now", context.identity.name],
        { timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS },
      )) !== 0
    )
      fail("service_remove_failed", "The service could not be stopped and disabled.");
  } else if (before.loaded) {
    if (
      (await command(
        context.runCommand,
        "launchctl",
        ["bootout", `${context.identity.domain}/${context.identity.label}`],
        { timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS },
      )) !== 0
    )
      fail("service_remove_failed", "The service could not be stopped.");
  }
  if (input.manager === "launchd") {
    await command(context.runCommand, "launchctl", [
      "disable",
      `${context.identity.domain}/${context.identity.label}`,
    ]);
  }
  const stopped = await stabilizedStoppedServiceStatus(
    input,
    context,
    await serviceStatus(input, context),
  );
  if (!isStoppedServiceStatus(stopped)) {
    fail("service_remove_unknown", "The stopped service state could not be verified.");
  }
  const confirmed = await currentTarget(context.target);
  if (confirmed === null || !confirmed.equals(expected)) {
    fail("service_state_conflict", "The service definition changed immediately before removal.");
  }
  await unlink(context.target);
  if (
    input.manager === "systemd" &&
    (await command(context.runCommand, "systemctl", ["--user", "daemon-reload"])) !== 0
  ) {
    fail(
      "service_remove_unknown",
      "The manager reload could not be verified after removing the definition.",
    );
  }
  return {
    ...(await serviceStatus(input, context)),
    installed: false,
    change: "removed",
  };
}

async function activate(input, context) {
  if (input.manager === "systemd") {
    return (
      (await command(context.runCommand, "systemctl", ["--user", "daemon-reload"])) === 0 &&
      (await command(context.runCommand, "systemctl", [
        "--user",
        "start",
        context.identity.name,
      ])) === 0
    );
  }
  return (
    (await command(context.runCommand, "launchctl", [
      "bootstrap",
      context.identity.domain,
      context.target,
    ])) === 0
  );
}

async function stopForUpgrade(input, context) {
  if (input.manager === "systemd") {
    return (
      (await command(context.runCommand, "systemctl", ["--user", "stop", context.identity.name], {
        timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS,
      })) === 0
    );
  }
  return (
    (await command(
      context.runCommand,
      "launchctl",
      ["bootout", `${context.identity.domain}/${context.identity.label}`],
      { timeoutMs: SERVICE_STOP_COMMAND_TIMEOUT_MS },
    )) === 0
  );
}

async function upgrade(input, expected, previous, context) {
  const current = await currentTarget(context.target);
  // A configuration-only transition restarts the same definition under the guarded fence.
  if (
    current === null ||
    !current.equals(previous) ||
    (current.equals(expected) && context.configurationTransition === undefined)
  ) {
    fail(
      "service_state_conflict",
      "The installed service does not match the exact upgrade predecessor.",
    );
  }
  const before = await stabilizedServiceStatus(input, context, await serviceStatus(input, context));
  const wasOperational = isOperationalServiceStatus(before);
  const isRecoverableInactive = before.installed && isNotRunningServiceStatus(before);
  if (!wasOperational && !isRecoverableInactive) {
    fail(
      "service_state_conflict",
      "Only an exact operational or inactive installed service can be upgraded in place.",
    );
  }
  // A stopped launchd job can stay loaded; it is unloaded before its definition is replaced.
  if (wasOperational || before.loaded) {
    const stopReportedSuccess = await stopForUpgrade(input, context);
    const stopped = await stabilizedInactiveServiceStatus(
      input,
      context,
      await serviceStatus(input, context),
    );
    if (!isInactiveServiceStatus(stopped)) {
      fail(
        stopReportedSuccess ? "service_upgrade_unknown" : "service_upgrade_failed",
        "The previous service stop could not be verified.",
      );
    }
  }
  await context.configurationTransition?.apply();
  await replaceTarget(context.target, expected);
  let activated = await activate(input, context);
  let after = await serviceStatus(input, context);
  if (activated && isOperationalServiceStatus(after))
    after = await stabilizedServiceStatus(input, context, after);
  if (activated && isOperationalServiceStatus(after)) {
    await context.configurationTransition?.complete();
    return { ...after, change: "upgraded" };
  }
  if (after.loaded) {
    await stopForUpgrade(input, context);
    const stopped = await stabilizedInactiveServiceStatus(
      input,
      context,
      await serviceStatus(input, context),
    );
    if (!isInactiveServiceStatus(stopped)) {
      fail("service_upgrade_unknown", "The replacement service stop could not be verified.");
    }
  }
  await context.configurationTransition?.restore();
  await replaceTarget(context.target, previous);
  if (wasOperational) activated = await activate(input, context);
  let restored = await serviceStatus(input, context);
  if (wasOperational && activated && isOperationalServiceStatus(restored)) {
    restored = await stabilizedServiceStatus(input, context, restored);
  }
  const restoredExactly = (await currentTarget(context.target))?.equals(previous) === true;
  const recoveryVerified = wasOperational
    ? activated && isOperationalServiceStatus(restored)
    : restoredExactly && restored.managerAvailable && restored.installed && !restored.active;
  fail(
    recoveryVerified ? "service_upgrade_failed" : "service_upgrade_unknown",
    recoveryVerified
      ? `The replacement failed and the previous ${wasOperational ? "operational" : "inactive"} service was restored.`
      : "Neither the replacement nor restoration could be verified as operational.",
  );
}

export async function manageRuntimeService(args, options = {}) {
  const input = parse(args[0] === "--" ? args.slice(1) : args);
  if (
    options.prepareConfigurationTransition &&
    (input.runtime !== "node" || input.action !== "upgrade")
  )
    fail("invalid_arguments", "Configuration replacement requires a guarded Node upgrade.");
  const platform = options.platform ?? process.platform;
  if (
    (input.manager === "systemd" && platform !== "linux") ||
    (input.manager === "launchd" && platform !== "darwin")
  )
    fail(
      "service_manager_mismatch",
      "The service manager does not match the current operating system.",
    );
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  if (input.manager === "launchd" && (!Number.isSafeInteger(uid) || uid < 0)) {
    fail("service_manager_unavailable", "The launchd user domain could not be verified.");
  }
  const baseIdentity = runtimeServiceIdentity(input);
  const serviceIdentity =
    input.manager === "launchd" ? { ...baseIdentity, domain: `gui/${uid}` } : baseIdentity;
  const context = {
    identity: serviceIdentity,
    target: runtimeServiceTargetPath(input, homeDirectory),
    runCommand: options.runCommand ?? defaultRunCommand,
    wait: options.wait ?? defaultWait,
  };
  if (input.action === "status") return serviceStatus(input, context);
  const expected = await exactDefinition(input);
  const previous = ["upgrade", "rollback"].includes(input.action)
    ? await regularFile(input.previousDefinition, { required: true, ownerOnly: true })
    : null;
  if (["upgrade", "rollback"].includes(input.action)) {
    if (
      input.runtime === "node" &&
      input.action === "upgrade" &&
      nodeUpgradePredecessorConfig(input.manager, previous) !== input.config
    )
      fail(
        "service_upgrade_fence_invalid",
        "A Node upgrade must retain the running service's exact configuration path.",
      );
    try {
      return await withNodeSupervisionUpgradeFence(
        {
          ...input,
          openLeases: options.openSupervisionLeases,
          resolveStanding: options.resolveStandingSupervision,
          busyWaitMs: options.supervisionBusyWaitMs,
          sleep: options.supervisionBusySleep,
        },
        (supervisionCoordinates) =>
          withNodeWorkUpgradeFence(
            {
              ...input,
              busyWaitMs: options.nodeWorkBusyWaitMs,
              sleep: options.nodeWorkBusySleep,
              resolveConfigPredecessors: (source) =>
                findMigratedConfigPredecessors(input.config, source.config),
              verifyInactivePredecessor: async () => {
                const installed = await currentTarget(context.target);
                const predecessor = input.action === "upgrade" ? previous : expected;
                if (!installed?.equals(predecessor)) return false;
                const state = await serviceStatus(input, context);
                // No running process means no admitted work; a launchd job may stay loaded.
                return (
                  isNotRunningServiceStatus(state) &&
                  isNotRunningServiceStatus(
                    await stabilizedInactiveServiceStatus(
                      input,
                      context,
                      state,
                      isNotRunningServiceStatus,
                    ),
                  )
                );
              },
              ...(supervisionCoordinates?.sourceDigest === undefined
                ? {}
                : { expectedSourceDigest: supervisionCoordinates.sourceDigest }),
              openAdmission: options.openNodeWorkAdmission,
            },
            async (admission) => {
              const configurationTransition = await selectNodeConfigurationTransition(
                input,
                admission,
                options.prepareConfigurationTransition,
              );
              if (input.action === "upgrade")
                return upgrade(input, expected, previous, { ...context, configurationTransition });
              const restored = await upgrade(input, previous, expected, {
                ...context,
                configurationTransition,
              });
              return { ...restored, change: "rolled_back" };
            },
          ),
      );
    } catch (error) {
      if (
        error instanceof NodeSupervisionUpgradeFenceError ||
        error instanceof NodeWorkUpgradeFenceError ||
        error instanceof NodeCliConfigurationTransitionError
      )
        throw new RuntimeServiceManagementError(error.code, error.message, { cause: error });
      throw error;
    }
  }
  return input.action === "install"
    ? install(input, expected, context)
    : remove(input, expected, context);
}
