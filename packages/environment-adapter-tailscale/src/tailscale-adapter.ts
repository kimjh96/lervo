import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AdapterEnvironmentSnapshot,
  EnvironmentEndpoint,
  EnvironmentSourceAdapter,
  EnvironmentSubject,
} from "@lervo/environment";

const execFileAsync = promisify(execFile);

interface TailscalePeer {
  ID?: unknown;
  HostName?: unknown;
  DNSName?: unknown;
  OS?: unknown;
  Online?: unknown;
  Active?: unknown;
  TailscaleIPs?: unknown;
}

interface TailscaleStatus {
  BackendState?: unknown;
  Self?: unknown;
  Peer?: unknown;
}

export interface TailscaleCommandRunner {
  (executable: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string }>;
}

function subjectId(peer: TailscalePeer): string {
  const stable = typeof peer.ID === "string" ? peer.ID : `${peer.DNSName ?? ""}\0${peer.HostName ?? ""}`;
  return `sub_${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

function endpoint(host: string, addressKind: EnvironmentEndpoint["addressKind"]): EnvironmentEndpoint | null {
  const normalized = addressKind === "dns" ? host.replace(/\.$/, "") : host;
  return normalized.length === 0 ? null : { transport: "overlay", addressKind, host: normalized };
}

function normalizePeer(peer: TailscalePeer): EnvironmentSubject | null {
  const hostname = typeof peer.HostName === "string" ? peer.HostName : undefined;
  const dnsName = typeof peer.DNSName === "string" ? peer.DNSName : undefined;
  if (hostname === undefined && dnsName === undefined) return null;
  const online = peer.Online === true;
  const endpoints = online
    ? [
      ...(dnsName === undefined ? [] : [endpoint(dnsName, "dns")]),
      ...(Array.isArray(peer.TailscaleIPs)
        ? peer.TailscaleIPs.filter((item): item is string => typeof item === "string").map((item) => endpoint(item, "ip"))
        : []),
    ].filter((item): item is EnvironmentEndpoint => item !== null)
    : [];
  return {
    subjectId: subjectId(peer),
    kind: "device",
    labels: {
      ...(hostname === undefined ? {} : { "device.hostname": hostname }),
      ...(dnsName === undefined ? {} : { "network.dns_name": dnsName.replace(/\.$/, "") }),
      ...(typeof peer.OS === "string" ? { "device.os": peer.OS } : {}),
      "network.online": String(online),
      "network.active": String(peer.Active === true),
    },
    capabilities: online ? ["network.peer"] : [],
    endpoints,
  };
}

const defaultRunner: TailscaleCommandRunner = async (executable, args, signal) => {
  const result = await execFileAsync(executable, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
    windowsHide: true,
    signal,
  });
  return { stdout: result.stdout };
};

function unavailable(failureCode: string): AdapterEnvironmentSnapshot {
  return {
    status: "unavailable",
    subjects: [],
    verification: [{ kind: "source_session", status: "unavailable", failureCode }],
  };
}

export class TailscaleEnvironmentAdapter implements EnvironmentSourceAdapter {
  readonly id = "tailscale";
  readonly #runner: TailscaleCommandRunner;
  readonly #executables: string[];

  constructor(input: { runner?: TailscaleCommandRunner; executables?: string[] } = {}) {
    this.#runner = input.runner ?? defaultRunner;
    this.#executables = input.executables ?? [
      "tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/opt/homebrew/bin/tailscale",
      "/usr/local/bin/tailscale",
    ];
  }

  async query(input: Parameters<EnvironmentSourceAdapter["query"]>[0]): Promise<AdapterEnvironmentSnapshot> {
    let stdout: string | undefined;
    for (const executable of this.#executables) {
      try {
        stdout = (await this.#runner(executable, ["status", "--json"], input.signal)).stdout;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        return unavailable(code === "ETIMEDOUT" || code === "ABORT_ERR" ? "source_timeout" : "source_command_failed");
      }
    }
    if (stdout === undefined) return unavailable("source_executable_not_found");
    let status: TailscaleStatus;
    try {
      status = JSON.parse(stdout) as TailscaleStatus;
    } catch {
      return unavailable("source_output_invalid");
    }
    if (status.BackendState !== "Running") return unavailable("source_session_unavailable");
    const rawPeers = [
      ...(typeof status.Self === "object" && status.Self !== null ? [status.Self as TailscalePeer] : []),
      ...(typeof status.Peer === "object" && status.Peer !== null
        ? Object.values(status.Peer as Record<string, TailscalePeer>)
        : []),
    ].slice(0, 256);
    const subjects = rawPeers.map(normalizePeer).filter((peer): peer is EnvironmentSubject => peer !== null);
    return {
      status: "available",
      subjects,
      verification: [{ kind: "source_session", status: "verified" }],
    };
  }
}
