import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  createRuntimeServiceDefinition,
  runtimeServiceIdentity,
} from "./render-runtime-service.mjs";

const MAXIMUM_DEFINITION_BYTES = 131_072;
const SERVICE_STABILITY_OBSERVATIONS = 3;
const SERVICE_STABILITY_INTERVAL_MS = 500;
const SERVICE_STOP_MAXIMUM_OBSERVATIONS = 6;

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
    "--config",
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
  if (runtime !== "hub" && runtime !== "node") {
    fail("invalid_arguments", "The runtime is invalid.");
  }
  const instance = values.get("--instance");
  if (
    (runtime === "node" && (instance === undefined || !/^nfi_[a-f0-9]{24}$/u.test(instance))) ||
    (runtime === "hub" && instance !== undefined)
  )
    fail(
      "invalid_arguments",
      "A Node service requires one valid instance ID; a Hub service does not accept one.",
    );
  if (action === "status") {
    const expectedSize = runtime === "node" ? 4 : 3;
    if (write || values.size !== expectedSize) {
      fail("invalid_arguments", "Status does not accept write arguments or a definition.");
    }
    return { action, manager, runtime, instance: instance ?? null };
  }
  const nodeExecutable = values.get("--node-executable");
  const expectedSize =
    (runtime === "node" ? 7 : 6) +
    (["upgrade", "rollback"].includes(action) ? 1 : 0) +
    (nodeExecutable === undefined ? 0 : 1);
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
    config: resolve(config),
  };
}

function targetPath(input, homeDirectory, serviceIdentity) {
  return input.manager === "systemd"
    ? resolve(homeDirectory, ".config", "systemd", "user", serviceIdentity.name)
    : resolve(homeDirectory, "Library", "LaunchAgents", serviceIdentity.name);
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

function defaultRunCommand(command, args) {
  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: 4_096,
        timeout: 30_000,
        windowsHide: true,
      },
      (error) => {
        if (error === null) resolvePromise({ exitCode: 0 });
        else resolvePromise({ exitCode: typeof error.code === "number" ? error.code : null });
      },
    );
  });
}

function defaultWait(durationMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs));
}

async function command(runCommand, executable, args) {
  try {
    const result = await runCommand(executable, args);
    return result?.exitCode === null ? null : Number(result?.exitCode);
  } catch {
    return null;
  }
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
      active: active === 0,
    };
  }
  const loaded = await command(context.runCommand, "launchctl", [
    "print",
    `${context.identity.domain}/${context.identity.label}`,
  ]);
  return {
    manager: input.manager,
    runtime: input.runtime,
    instance: input.instance,
    serviceIdentity: context.identity.label,
    managerAvailable: loaded !== null,
    installed: installedBytes !== null,
    enabled: null,
    active: loaded === 0,
  };
}

function isOperationalServiceStatus(status) {
  return status.managerAvailable && status.installed && status.active && status.enabled !== false;
}

function isStoppedServiceStatus(status) {
  return status.managerAvailable && !status.active && status.enabled !== true;
}

function isInactiveServiceStatus(status) {
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

async function stabilizedInactiveServiceStatus(input, context, initial) {
  let status = initial;
  let consecutive = 0;
  for (let index = 0; index < SERVICE_STOP_MAXIMUM_OBSERVATIONS; index += 1) {
    consecutive = isInactiveServiceStatus(status) ? consecutive + 1 : 0;
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
  if (current === null && (observed.active || observed.enabled === true)) {
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
      (before.active ||
        (await command(context.runCommand, "launchctl", [
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
    await command(context.runCommand, "systemctl", [
      "--user",
      "disable",
      "--now",
      context.identity.name,
    ]);
  } else {
    await command(context.runCommand, "launchctl", [
      "bootout",
      `${context.identity.domain}/${context.identity.label}`,
    ]);
    await command(context.runCommand, "launchctl", [
      "disable",
      `${context.identity.domain}/${context.identity.label}`,
    ]);
  }
  const status = await serviceStatus(input, context);
  if (!status.managerAvailable || status.active || status.enabled === true) return false;
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
    if (status.active || status.enabled === true) {
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
      (await command(context.runCommand, "systemctl", [
        "--user",
        "disable",
        "--now",
        context.identity.name,
      ])) !== 0
    )
      fail("service_remove_failed", "The service could not be stopped and disabled.");
  } else if (before.active) {
    if (
      (await command(context.runCommand, "launchctl", [
        "bootout",
        `${context.identity.domain}/${context.identity.label}`,
      ])) !== 0
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
      (await command(context.runCommand, "systemctl", [
        "--user",
        "stop",
        context.identity.name,
      ])) === 0
    );
  }
  return (
    (await command(context.runCommand, "launchctl", [
      "bootout",
      `${context.identity.domain}/${context.identity.label}`,
    ])) === 0
  );
}

async function upgrade(input, expected, previous, context) {
  const current = await currentTarget(context.target);
  if (current === null || !current.equals(previous) || current.equals(expected)) {
    fail(
      "service_state_conflict",
      "The installed service does not match the exact upgrade predecessor.",
    );
  }
  const before = await stabilizedServiceStatus(input, context, await serviceStatus(input, context));
  const wasOperational = isOperationalServiceStatus(before);
  const isRecoverableInactive = before.managerAvailable && before.installed && !before.active;
  if (!wasOperational && !isRecoverableInactive) {
    fail(
      "service_state_conflict",
      "Only an exact operational or inactive installed service can be upgraded in place.",
    );
  }
  if (wasOperational) {
    if (!(await stopForUpgrade(input, context))) {
      fail("service_upgrade_failed", "The previous service could not be stopped for upgrade.");
    }
    const stopped = await stabilizedInactiveServiceStatus(
      input,
      context,
      await serviceStatus(input, context),
    );
    if (!isInactiveServiceStatus(stopped)) {
      fail("service_upgrade_unknown", "The previous service stop could not be verified.");
    }
  }
  await replaceTarget(context.target, expected);
  let activated = await activate(input, context);
  let after = await serviceStatus(input, context);
  if (activated && isOperationalServiceStatus(after))
    after = await stabilizedServiceStatus(input, context, after);
  if (activated && isOperationalServiceStatus(after)) return { ...after, change: "upgraded" };
  if (after.active) {
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
    target: targetPath(input, homeDirectory, serviceIdentity),
    runCommand: options.runCommand ?? defaultRunCommand,
    wait: options.wait ?? defaultWait,
  };
  if (input.action === "status") return serviceStatus(input, context);
  const expected = await exactDefinition(input);
  const previous = ["upgrade", "rollback"].includes(input.action)
    ? await regularFile(input.previousDefinition, { required: true, ownerOnly: true })
    : null;
  if (input.action === "upgrade") return upgrade(input, expected, previous, context);
  if (input.action === "rollback") {
    const restored = await upgrade(input, previous, expected, context);
    return { ...restored, change: "rolled_back" };
  }
  return input.action === "install"
    ? install(input, expected, context)
    : remove(input, expected, context);
}

function statusText(result) {
  if (!result.managerAvailable) return "manager_unavailable";
  if (!result.installed && !result.active && result.enabled !== true) return "not_installed";
  if (result.installed && result.active && result.enabled !== false) return "active";
  return "inactive_or_inconsistent";
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename.endsWith("/manage-runtime-service.mjs") &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  try {
    const result = await manageRuntimeService(process.argv.slice(2));
    process.stdout.write(
      `Lervo ${result.runtime} ${result.manager} user service status: ${statusText(result)}.\n`,
    );
  } catch (error) {
    const code =
      error instanceof RuntimeServiceManagementError ? error.code : "service_management_failed";
    process.stderr.write(`Lervo user service operation failed (${code}).\n`);
    process.exitCode = 1;
  }
}
