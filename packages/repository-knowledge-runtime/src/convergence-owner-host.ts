import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  parseKnowledgePublicationSettings,
  type KnowledgePublicationSettings,
} from "./knowledge-publication-settings.js";

/**
 * Host-local convergence owner configuration (ADR-0466). It lives under `.lervo/state`, which Git
 * ignores and replica capture excludes, so a peer never receives another host's identity or Hub
 * credential coordinates.
 */
export const CONVERGENCE_OWNER_HOST_PATH = ".lervo/state/knowledge/convergence-owner-host.json";

const HOST_ID = /^hst_[a-f0-9]{32}$/u;
const HOST_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export interface ConvergenceOwnerHubCoordinates {
  baseUrl: string;
  bearerTokenFile: string;
  destinationId: string;
  hubIdentityHash: string;
}

export type ConvergenceOwnerCoordination =
  { mode: "standalone" } | { mode: "hub"; hub: ConvergenceOwnerHubCoordinates };

export interface ConvergenceOwnerHostConfig {
  schemaVersion: 1;
  hostId: string;
  hostLabel: string;
  coordination: ConvergenceOwnerCoordination;
  /** ADR-0466 publication of owner commits to the Git remote; absent disables publication. */
  publication?: KnowledgePublicationSettings;
}

export interface ConvergenceOwnerHost {
  config: ConvergenceOwnerHostConfig;
  /** The only host identity that leaves this host: in leases, commit trailers, and events. */
  hostHash: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validHub(value: unknown): value is ConvergenceOwnerHubCoordinates {
  if (!record(value) || Object.keys(value).length !== 4) return false;
  try {
    const url = new URL(String(value.baseUrl));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  } catch {
    return false;
  }
  return (
    typeof value.bearerTokenFile === "string" &&
    isAbsolute(value.bearerTokenFile) &&
    typeof value.destinationId === "string" &&
    DESTINATION.test(value.destinationId) &&
    typeof value.hubIdentityHash === "string" &&
    HASH.test(value.hubIdentityHash)
  );
}

export function parseConvergenceOwnerHostConfig(value: unknown): ConvergenceOwnerHostConfig {
  if (
    !record(value) ||
    Object.keys(value).length !== ("publication" in value ? 5 : 4) ||
    value.schemaVersion !== 1 ||
    typeof value.hostId !== "string" ||
    !HOST_ID.test(value.hostId) ||
    typeof value.hostLabel !== "string" ||
    !HOST_LABEL.test(value.hostLabel) ||
    !record(value.coordination) ||
    !(
      (value.coordination.mode === "standalone" && Object.keys(value.coordination).length === 1) ||
      (value.coordination.mode === "hub" &&
        Object.keys(value.coordination).length === 2 &&
        validHub(value.coordination.hub))
    )
  )
    throw new KnowledgeConvergenceRuntimeError("convergence_owner_host_invalid");
  const config = value as unknown as ConvergenceOwnerHostConfig;
  if (!("publication" in value)) return config;
  const publication = parseKnowledgePublicationSettings(value.publication);
  if (publication === null)
    throw new KnowledgeConvergenceRuntimeError("convergence_owner_host_invalid");
  return { ...config, publication };
}

async function ensureStateDirectory(root: string): Promise<string> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("host_coordinate_invalid");
  }
  return directory;
}

function hostOf(config: ConvergenceOwnerHostConfig): ConvergenceOwnerHost {
  return { config, hostHash: sha256(`lervo.convergence-owner-host.v1\0${config.hostId}`) };
}

/** Reads the host configuration; null when this host has never been configured or observed. */
export async function readConvergenceOwnerHost(root: string): Promise<ConvergenceOwnerHost | null> {
  const path = resolve(root, CONVERGENCE_OWNER_HOST_PATH);
  let text: string;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 4_096)
      throw new KnowledgeConvergenceRuntimeError("convergence_owner_host_invalid");
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("convergence_owner_host_invalid", { cause: error });
  }
  return hostOf(parseConvergenceOwnerHostConfig(value));
}

/**
 * An unconfigured host becomes a standalone owner with a fresh identity, preserving local
 * operation without a Hub. A concurrent creator wins and its identity is reused.
 */
export async function loadOrCreateConvergenceOwnerHost(
  root: string,
  random: () => string = () => randomBytes(16).toString("hex"),
): Promise<ConvergenceOwnerHost> {
  const existing = await readConvergenceOwnerHost(root);
  if (existing !== null) return existing;
  const directory = await ensureStateDirectory(root);
  const config: ConvergenceOwnerHostConfig = {
    schemaVersion: 1,
    hostId: `hst_${random()}`,
    hostLabel: "local",
    coordination: { mode: "standalone" },
  };
  parseConvergenceOwnerHostConfig(config);
  const path = resolve(directory, "convergence-owner-host.json");
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = await readConvergenceOwnerHost(root);
    if (winner === null) throw error;
    return winner;
  }
  return hostOf(config);
}
