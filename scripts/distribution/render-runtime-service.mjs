import { constants } from "node:fs";
import { access, chmod, lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const runtimeServiceStopTimeoutMs = 120_000;

// `knowledge-host` is the ADR-0470 host knowledge resident: one per user, no instance.
const runtimes = new Set(["hub", "node", "knowledge-host"]);

function fail(message) {
  throw new Error(message);
}

const systemExecutableDirectories = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];

/**
 * ADR-0470: directories of the tools a service runs (providers, `gh`, `git`), resolved by the
 * planner to absolute paths. They join the service PATH between the runtime and system
 * directories, so the rendered bytes, and therefore the reviewed plan hash, bind them.
 */
export function parseRuntimeServicePathDirectories(value) {
  if (value === undefined || value === null || value === "") return [];
  const directories = String(value).split(":");
  for (const directory of directories)
    if (
      !isAbsolute(directory) ||
      resolve(directory) !== directory ||
      directory.includes("\0") ||
      /[\r\n]/u.test(directory)
    )
      fail("Each service path directory must be a normalized absolute path.");
  return directories.filter(
    (directory, index) =>
      directories.indexOf(directory) === index && !systemExecutableDirectories.includes(directory),
  );
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
        "Usage: --manager <systemd|launchd> --runtime <hub|node|knowledge-host> [--instance <nfi-id>] --executable <absolute-path> [--node-executable <absolute-path>] [--path-directories <dir:dir>] --config <absolute-path> --output <new-absolute-path>",
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
    "--path-directories",
    "--config",
    "--output",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    fail("A required service-render argument is missing or an unknown argument was provided.");
  }
  const manager = values.get("--manager");
  const runtime = values.get("--runtime");
  if (manager !== "systemd" && manager !== "launchd") fail("The service manager is invalid.");
  if (!runtimes.has(runtime)) fail("The runtime is invalid.");
  const nodeExecutable = values.get("--node-executable");
  const pathDirectories = parseRuntimeServicePathDirectories(values.get("--path-directories"));
  if (
    values.size !==
    (runtime === "node" ? 6 : 5) +
      (nodeExecutable === undefined ? 0 : 1) +
      (values.has("--path-directories") ? 1 : 0)
  ) {
    fail("A required service-render argument is missing or an unexpected argument was provided.");
  }
  const instance = values.get("--instance");
  if (
    (runtime === "node" && (instance === undefined || !/^nfi_[a-f0-9]{24}$/u.test(instance))) ||
    (runtime !== "node" && instance !== undefined)
  )
    fail("A Node service requires one valid instance ID; other services do not accept one.");
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
    pathDirectories,
    config: resolve(config),
    output: resolve(output),
  };
}

export function runtimeServiceIdentity(input) {
  if (input.manager !== "systemd" && input.manager !== "launchd") {
    fail("The service manager is invalid.");
  }
  if (!runtimes.has(input.runtime)) fail("The runtime is invalid.");
  if (input.runtime === "node" && !/^nfi_[a-f0-9]{24}$/u.test(input.instance ?? "")) {
    fail("A Node service requires one valid instance ID.");
  }
  if (input.runtime !== "node" && input.instance !== null && input.instance !== undefined) {
    fail("Only a Node service accepts an instance ID.");
  }
  const suffix =
    input.runtime === "node" ? `-node-${input.instance.slice(4)}` : `-${input.runtime}`;
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

function runtimePath(input) {
  return [
    dirname(input.nodeExecutable ?? input.executable),
    dirname(input.executable),
    ...(input.pathDirectories ?? []),
    ...systemExecutableDirectories,
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(":");
}

/** Fixed words before `--config`: the host knowledge resident runs one CLI subcommand. */
function runtimeSubcommand(input) {
  return input.runtime === "knowledge-host" ? ["knowledge", "worker", "--watch", "--host"] : [];
}

function runtimeArguments(input) {
  return [...runtimeSubcommand(input), "--config", input.config];
}

function title(input) {
  if (input.runtime === "hub") return "Lervo Hub";
  if (input.runtime === "knowledge-host") return "Lervo host knowledge resident";
  return `Lervo Node ${input.instance}`;
}

function systemd(input) {
  const command = [
    ...[input.nodeExecutable, input.executable]
      .filter((value) => value !== null)
      .map(systemdEscape),
    ...runtimeSubcommand(input),
  ].join(" ");
  return `[Unit]\nDescription=${title(input)}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironment=${systemdEscape(`PATH=${runtimePath(input)}`)}\nExecStart=${command} --config ${systemdEscape(input.config)}\nExecReload=/bin/kill -HUP $MAINPID\nKillSignal=SIGTERM\nRestart=on-failure\nRestartSec=5s\nTimeoutStopSec=${runtimeServiceStopTimeoutMs / 1000}s\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
}

function launchd(input) {
  const label = runtimeServiceIdentity(input).label;
  const path = xml(runtimePath(input));
  const nodeArgument =
    input.nodeExecutable === null ? "" : `    <string>${xml(input.nodeExecutable)}</string>\n`;
  const runtimeArgumentLines = runtimeArguments(input)
    .map((value) => `    <string>${xml(value)}</string>\n`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${label}</string>\n  <key>ProgramArguments</key>\n  <array>\n${nodeArgument}    <string>${xml(input.executable)}</string>\n${runtimeArgumentLines}  </array>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>PATH</key>\n    <string>${path}</string>\n  </dict>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ProcessType</key>\n  <string>Background</string>\n  <key>ThrottleInterval</key>\n  <integer>5</integer>\n  <key>Umask</key>\n  <integer>63</integer>\n</dict>\n</plist>\n`;
}

function normalizeDefinitionInput(input) {
  const instanceArgs =
    input.instance === undefined || input.instance === null ? [] : ["--instance", input.instance];
  return parse([
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
    ...((input.pathDirectories ?? []).length === 0
      ? []
      : ["--path-directories", input.pathDirectories.join(":")]),
    "--config",
    input.config,
    "--output",
    resolve(input.config, "..", ".lervo-definition-validation-only"),
  ]);
}

function render(normalized) {
  return normalized.manager === "systemd" ? systemd(normalized) : launchd(normalized);
}

/** Pure canonical bytes for planning, before the executable or config exist. */
export function formatRuntimeServiceDefinition(input) {
  return render(normalizeDefinitionInput(input));
}

/** The fixed per-user target path of a service definition. */
export function runtimeServiceTargetPath(input, homeDirectory) {
  const identity = runtimeServiceIdentity(input);
  return input.manager === "systemd"
    ? resolve(homeDirectory, ".config", "systemd", "user", identity.name)
    : resolve(homeDirectory, "Library", "LaunchAgents", identity.name);
}

export async function createRuntimeServiceDefinition(input) {
  const normalized = normalizeDefinitionInput(input);
  await assertInputs(normalized);
  return render(normalized);
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
