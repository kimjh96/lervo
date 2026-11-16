import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Seconds an idle Lervo-managed master connection stays open after its last peer step. */
export const SSH_CONTROL_PERSIST_SECONDS = 600;
/** macOS `sun_path` holds 104 bytes with its terminator; Linux holds 108. */
const SOCKET_PATH_LIMIT = 103;
/** OpenSSH binds a master at `<ControlPath>.<16 random characters>` and then renames it. */
const MASTER_TEMPORARY_SUFFIX = 17;
/** `%C` expands to a 40-character hash of the local host, remote host, port, and user. */
const CONNECTION_HASH_LENGTH = 40;
/** The fallback socket name: a hash of the configured transport. */
const TRANSPORT_HASH_LENGTH = 16;
const MULTIPLEXING_OPTIONS = new Set(["controlmaster", "controlpath", "controlpersist"]);

/**
 * How the coordinator reuses its SSH transport (ADR-0570). `managed`: Lervo multiplexes every peer
 * step over one master connection through a private control socket. `configured`: the coordinator
 * configuration already sets multiplexing, and Lervo adds none of it. `unavailable`: each step
 * opens its own connection, for the stated reason.
 */
export type SshConnectionReuse =
  | { mode: "managed"; controlPath: string }
  | { mode: "configured" }
  | {
      mode: "unavailable";
      reason:
        | "client_not_openssh"
        | "platform_unsupported"
        | "control_path_unsupported"
        | "control_directory_unsafe";
    };

/** Lowercased option keywords the configured arguments already set, including `-M` and `-S`. */
function configuredSshOptions(args: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    let option: string | undefined;
    if (argument === "-o") option = args[(index += 1)];
    else if (argument.startsWith("-o")) option = argument.slice(2);
    else if (argument === "-M") keys.add("controlmaster");
    else if (argument.startsWith("-S")) {
      keys.add("controlpath");
      if (argument === "-S") index += 1;
    }
    const keyword = option?.trim().split(/[=\s]/u)[0]?.toLowerCase();
    if (keyword !== undefined && keyword.length > 0) keys.add(keyword);
  }
  return keys;
}

/** Whether the transport executable is an OpenSSH client, the only one Lervo adds options to. */
export function isOpenSshClient(executable: string): boolean {
  const name = executable.split(/[\\/]/u).at(-1)!.toLowerCase();
  return name === "ssh" || name === "ssh.exe";
}

/**
 * Pure: the control socket path for a transport, or null when none fits. `%C` keeps one master per
 * resolved host, port, and user; a directory too long for it falls back to a hash of the
 * configured transport. OpenSSH tokenizes `-o` values like configuration lines, so a path with
 * whitespace is quoted and `%` is escaped.
 */
export function sshControlPath(
  directory: string,
  transport: { executable: string; arguments: readonly string[]; destination: string },
): string | null {
  if (/["\0\r\n]/u.test(directory)) return null;
  const escaped = directory.replaceAll("%", "%%");
  const budget = SOCKET_PATH_LIMIT - MASTER_TEMPORARY_SUFFIX;
  const fixed = createHash("sha256")
    .update(JSON.stringify([transport.executable, transport.arguments, transport.destination]))
    .digest("hex")
    .slice(0, TRANSPORT_HASH_LENGTH);
  const candidates = [
    {
      path: join(escaped, "%C"),
      length: Buffer.byteLength(join(directory, "x".repeat(CONNECTION_HASH_LENGTH))),
    },
    { path: join(escaped, fixed), length: Buffer.byteLength(join(directory, fixed)) },
  ];
  const fitting = candidates.find((candidate) => candidate.length <= budget);
  if (fitting === undefined) return null;
  return /\s/u.test(fitting.path) ? `"${fitting.path}"` : fitting.path;
}

/** Pure: the reuse mode for a transport, given the control path a private directory offers. */
export function planSshConnectionReuse(input: {
  executable: string;
  arguments: readonly string[];
  platform: NodeJS.Platform;
  controlPath: string | null;
}): SshConnectionReuse {
  if (!isOpenSshClient(input.executable))
    return { mode: "unavailable", reason: "client_not_openssh" };
  const configured = configuredSshOptions(input.arguments);
  if ([...MULTIPLEXING_OPTIONS].some((option) => configured.has(option)))
    return { mode: "configured" };
  // Windows OpenSSH has no connection multiplexing.
  if (input.platform === "win32") return { mode: "unavailable", reason: "platform_unsupported" };
  if (input.controlPath === null)
    return { mode: "unavailable", reason: "control_path_unsupported" };
  return { mode: "managed", controlPath: input.controlPath };
}

/**
 * Pure: the configured arguments followed by the options Lervo owns. Every option the
 * configuration sets itself wins and is never repeated. Keepalives let a master on a dead link exit
 * within 45 seconds, so the next step connects afresh instead of waiting on it until its deadline.
 */
export function sshTransportArguments(
  executable: string,
  configuredArguments: readonly string[],
  reuse: SshConnectionReuse,
): string[] {
  if (!isOpenSshClient(executable)) return [...configuredArguments];
  const configured = configuredSshOptions(configuredArguments);
  const owned: Array<[string, string]> = [
    ["ConnectTimeout", "15"],
    ["ServerAliveInterval", "15"],
    ["ServerAliveCountMax", "3"],
    ...(reuse.mode === "managed"
      ? ([
          ["ControlMaster", "auto"],
          ["ControlPath", reuse.controlPath],
          ["ControlPersist", String(SSH_CONTROL_PERSIST_SECONDS)],
        ] as Array<[string, string]>)
      : []),
  ];
  return [
    ...configuredArguments,
    ...owned
      .filter(([keyword]) => !configured.has(keyword.toLowerCase()))
      .flatMap(([keyword, value]) => ["-o", `${keyword}=${value}`]),
  ];
}

/**
 * Creates the control socket directory owner-only. A control socket grants command execution on
 * the peer to anyone who can connect to it, so an existing directory must be a real directory
 * owned by this user with no group or other access.
 */
export async function prepareSshControlDirectory(directory: string): Promise<boolean> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    const owner = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    return metadata.isDirectory() && metadata.uid === owner && (metadata.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** The SSH arguments the coordinator runs every peer step with, and how they reuse connections. */
export async function resolveSshTransport(input: {
  executable: string;
  arguments: readonly string[];
  destination: string;
  platform: NodeJS.Platform;
  controlDirectory: string;
}): Promise<{ arguments: string[]; reuse: SshConnectionReuse }> {
  const candidate = planSshConnectionReuse({
    ...input,
    controlPath: sshControlPath(input.controlDirectory, input),
  });
  const reuse: SshConnectionReuse =
    candidate.mode === "managed" && !(await prepareSshControlDirectory(input.controlDirectory))
      ? { mode: "unavailable", reason: "control_directory_unsafe" }
      : candidate;
  return { arguments: sshTransportArguments(input.executable, input.arguments, reuse), reuse };
}
