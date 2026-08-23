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
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(key)) {
      fail("Usage: --manager <systemd|launchd> --runtime <hub|node> --executable <absolute-path> --config <absolute-path> --output <new-absolute-path>");
    }
    values.set(key, value);
  }
  const allowed = new Set(["--manager", "--runtime", "--executable", "--config", "--output"]);
  if (values.size !== allowed.size || [...values.keys()].some((key) => !allowed.has(key))) {
    fail("A required service-render argument is missing or an unknown argument was provided.");
  }
  const manager = values.get("--manager");
  const runtime = values.get("--runtime");
  if (manager !== "systemd" && manager !== "launchd") fail("The service manager is invalid.");
  if (runtime !== "hub" && runtime !== "node") fail("The runtime is invalid.");
  const executable = values.get("--executable");
  const config = values.get("--config");
  const output = values.get("--output");
  for (const [label, value] of [["executable", executable], ["config", config], ["output", output]]) {
    if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/u.test(value)) {
      fail(`${label} path must be absolute and contain no line breaks.`);
    }
  }
  return { manager, runtime, executable: resolve(executable), config: resolve(config), output: resolve(output) };
}

async function assertInputs(input) {
  const [executable, config] = await Promise.all([lstat(input.executable), lstat(input.config)]);
  if (
    !executable.isFile() || executable.isSymbolicLink() ||
    !config.isFile() || config.isSymbolicLink()
  ) fail("The executable and config must be real regular files, not symbolic links.");
  await access(input.executable, constants.X_OK);
}

function systemdEscape(value) {
  return `"${value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function systemd(input) {
  const title = input.runtime === "hub" ? "Lervo Hub" : "Lervo Node";
  return `[Unit]\nDescription=${title}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${systemdEscape(input.executable)} --config ${systemdEscape(input.config)}\nExecReload=/bin/kill -HUP $MAINPID\nKillSignal=SIGTERM\nRestart=on-failure\nRestartSec=5s\nTimeoutStopSec=120s\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
}

function launchd(input) {
  const label = input.runtime === "hub" ? "com.lervo.hub" : "com.lervo.node";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${label}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>${xml(input.executable)}</string>\n    <string>--config</string>\n    <string>${xml(input.config)}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>ProcessType</key>\n  <string>Background</string>\n  <key>ThrottleInterval</key>\n  <integer>5</integer>\n  <key>Umask</key>\n  <integer>63</integer>\n</dict>\n</plist>\n`;
}

export async function createRuntimeServiceDefinition(input) {
  const normalized = parse([
    "--manager", input.manager,
    "--runtime", input.runtime,
    "--executable", input.executable,
    "--config", input.config,
    "--output", resolve(input.config, "..", ".lervo-definition-validation-only"),
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
  return { manager: input.manager, runtime: input.runtime, output: input.output };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const result = await renderRuntimeService(process.argv.slice(2));
    process.stdout.write(`Created the Lervo ${result.runtime} ${result.manager} service definition.\n`);
  } catch {
    process.stderr.write("The Lervo service definition could not be created.\n");
    process.exitCode = 1;
  }
}
