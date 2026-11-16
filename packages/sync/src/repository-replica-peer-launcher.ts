/**
 * Launchers that start a whole operating-system environment for every command. On Windows,
 * `wsl.exe` and the Ubuntu distribution executables boot or attach to the WSL virtual machine each
 * time, so a peer reached through one of them pays that launch on every replica step and wakes a
 * stopped WSL again. `bash.exe` is excluded: the same name also belongs to Git for Windows.
 */
const PER_CALL_LAUNCHER = /^(?:wsl|wsl\.exe|ubuntu[0-9.]*\.exe)$/u;

/** Advisory code for a replica peer whose every step goes through a per-call launcher. */
export const REPOSITORY_REPLICA_PER_CALL_LAUNCHER = "repository_replica_peer_per_call_launcher";

/**
 * ADR-0570: the per-call launcher in a replica peer's remote command, by executable name, or null.
 * Only the name is returned, never a path. A configuration that is not a coordinator peer yields
 * null, because the coordinator validates the rest itself.
 */
export function repositoryReplicaPeerLauncher(peer: unknown): string | null {
  if (typeof peer !== "object" || peer === null || Array.isArray(peer)) return null;
  const { remoteCommandPrefix, remoteNodeExecutable } = peer as Record<string, unknown>;
  const command = [
    ...(Array.isArray(remoteCommandPrefix) ? remoteCommandPrefix : []),
    remoteNodeExecutable,
  ];
  for (const item of command) {
    if (typeof item !== "string") continue;
    const name = item.split(/[\\/]/u).at(-1)!.toLowerCase();
    if (PER_CALL_LAUNCHER.test(name)) return name;
  }
  return null;
}

/** The operator guidance shown wherever the per-call launcher advisory surfaces. */
export function repositoryReplicaPerCallLauncherGuidance(launcher: string): string {
  return `Each replica peer step launches ${launcher} on the peer host, which boots or wakes WSL every time. Point peer.destination at the WSL sshd itself (for example an ~/.ssh/config alias with ProxyJump) and remove peer.remoteCommandPrefix.`;
}
