import { constants } from "node:fs";
import { access, chmod, lstat, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function parse(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(key)
    ) {
      fail(
        "Usage: --manager <systemd|launchd> --runtime <hub|node> [--instance <nfi-id>] --executable <absolute-path> [--node-executable <absolute-path>] --config <absolute-path> --output <new-absolute-path>",
      );
    }
    values.set(key, value);
  }
  const allowed = new Set([
    "--manager",
    "--runtime",
    "--instance",
    "--executable",
    "--node-executable",
    "--config",
    "--output",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    fail("A required service-render argument is missing or an unknown argument was provided.");
  }
  const manager = values.get("--manager");
  const runtime = values.get("--runtime");
  if (manager !== "systemd" && manager !== "launchd") fail("The service manager is invalid.");
  if (runtime !== "hub" && runtime !== "node") fail("The runtime is invalid.");
  const nodeExecutable = values.get("--node-executable");
  if (values.size !== (runtime === "node" ? 6 : 5) + (nodeExecutable === undefined ? 0 : 1)) {
    fail("A required service-render argument is missing or an unexpected argument was provided.");
  }
  const instance = values.get("--instance");
  if (
    (runtime === "node" && (instance === undefined || !/^nfi_[a-f0-9]{24}$/u.test(instance))) ||
    (runtime === "hub" && instance !== undefined)
  )
    fail("A Node service requires one valid instance ID; a Hub service does not accept one.");
  const executable = values.get("--executable");
  const config = values.get("--config");
  const output = values.get("--output");
  for (const [label, value] of [
    ["executable", executable],
    ...(nodeExecutable === undefined ? [] : [["Node executable", nodeExecutable]]),
    ["config", config],
    ["output", output],
  ]) {
    if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/u.test(value)) {
      fail(`${label} path must be absolute and contain no line breaks.`);
    }
  }
  return {
    manager,
    runtime,
    instance: instance ?? null,
    executable: resolve(executable),
    nodeExecutable: nodeExecutable === undefined ? null : resolve(nodeExecutable),
    config: resolve(config),
    output: resolve(output),
  };
}

export function runtimeServiceIdentity(input) {
  if (input.manager !== "systemd" && input.manager !== "launchd") {
    fail("The service manager is invalid.");
  }
  if (input.runtime !== "hub" && input.runtime !== "node") fail("The runtime is invalid.");
  if (input.runtime === "node" && !/^nfi_[a-f0-9]{24}$/u.test(input.instance ?? "")) {
    fail("A Node service requires one valid instance ID.");
  }
  if (input.runtime === "hub" && input.instance !== null && input.instance !== undefined) {
    fail("A Hub service does not accept an instance ID.");
  }
  const suffix = input.runtime === "node" ? `-node-${input.instance.slice(4)}` : "-hub";
  return input.manager === "systemd"
    ? { name: `lervo${suffix}.service`, domain: null, label: null }
    : {
        name: `com.lervo${suffix.replaceAll("-", ".")}.plist`,
        domain: null,
        label: `com.lervo${suffix.replaceAll("-", ".")}`,
      };
}

async function assertInputs(input) {
  const [executable, nodeExecutable, config] = await Promise.all([
    lstat(input.executable),
    input.nodeExecutable === null ? null : lstat(input.nodeExecutable),
    lstat(input.config),
  ]);
  if (
    !executable.isFile() ||
    executable.isSymbolicLink() ||
    (nodeExecutable !== null && (!nodeExecutable.isFile() || nodeExecutable.isSymbolicLink())) ||
    !config.isFile() ||
    config.isSymbolicLink()
  )
    fail(
      "The executable, optional Node executable, and config must be real regular files, not symbolic links.",
    );
  await access(input.nodeExecutable ?? input.executable, constants.X_OK);
}

function systemdEscape(value) {
  return `"${value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemd(input) {
  const title = input.runtime === "hub" ? "Lervo Hub" : `Lervo Node ${input.instance}`;
  const command = [input.nodeExecutable, input.executable]
    .filter((value) => value !== null)
    .map(systemdEscape)
    .join(" ");
  return `[Unit]\nDescription=${title}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${command} --config ${systemdEscape(input.config)}\nExecReload=/bin/kill -HUP $MAINPID\nKillSignal=SIGTERM\nRestart=on-failure\nRestartSec=5s\nTimeoutStopSec=120s\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
}

function launchd(input) {
  const label = runtimeServiceIdentity(input).label;
  const nodeArgument =
    input.nodeExecutable === null ? "" : `    <string>${xml(input.nodeExecutable)}</string>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${label}</string>\n  <key>ProgramArguments</key>\n  <array>\n${nodeArgument}    <string>${xml(input.executable)}</string>\n    <string>--config</string>\n    <string>${xml(input.config)}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ProcessType</key>\n  <string>Background</string>\n  <key>ThrottleInterval</key>\n  <integer>5</integer>\n  <key>Umask</key>\n  <integer>63</integer>\n</dict>\n</plist>\n`;
}

export async function createRuntimeServiceDefinition(input) {
  const instanceArgs =
    input.instance === undefined || input.instance === null ? [] : ["--instance", input.instance];
  const normalized = parse([
    "--manager",
    input.manager,
    "--runtime",
    input.runtime,
    ...instanceArgs,
    "--executable",
    input.executable,
    ...(input.nodeExecutable === undefined || input.nodeExecutable === null
      ? []
      : ["--node-executable", input.nodeExecutable]),
    "--config",
    input.config,
    "--output",
    resolve(input.config, "..", ".lervo-definition-validation-only"),
  ]);
  await assertInputs(normalized);
  return normalized.manager === "systemd" ? systemd(normalized) : launchd(normalized);
}

export async function renderRuntimeService(args) {
  const input = parse(args[0] === "--" ? args.slice(1) : args);
  await assertInputs(input);
  const content = await createRuntimeServiceDefinition(input);
  let handle;
  try {
    handle = await open(input.output, "wx", 0o600);
    await handle.writeFile(content, "utf8");
  } finally {
    await handle?.close();
  }
  await chmod(input.output, 0o600);
  return {
    manager: input.manager,
    runtime: input.runtime,
    instance: input.instance,
    output: input.output,
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename.endsWith("/render-runtime-service.mjs") &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  try {
    const result = await renderRuntimeService(process.argv.slice(2));
    process.stdout.write(
      `Created the Lervo ${result.runtime} ${result.manager} service definition.\n`,
    );
  } catch {
    process.stderr.write("The Lervo service definition could not be created.\n");
    process.exitCode = 1;
  }
}
