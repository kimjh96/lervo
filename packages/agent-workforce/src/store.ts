import { createHash, randomUUID } from "node:crypto";
import { resolveCapabilities } from "@lervo/capabilities";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, posix, resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { assertRoleContractBinding, resolveRoleContract, roleProfileHash } from "@lervo/roles";

import {
  AgentWorkforceError,
  type AgentStatus,
  type WorkforceAgent,
  type WorkforceArtifactReference,
  type WorkforceAssignment,
  type WorkforceEvent,
  type WorkforceEventRecorder,
  type WorkforceHandoff,
  type WorkforceProvider,
} from "./types.js";
import { workforceLimits } from "./limits.js";
import {
  createAssignmentCancellationPlan,
  type AssignmentCancellationStep,
} from "./assignment-graph.js";
import {
  preparedCompletionMatchesAssignment,
  reconciledCompletionPayload,
  validAssignmentCompletionReconciliation,
  type AssignmentCompletionReconciliation,
} from "./assignment-completion-reconciliation.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ROLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const AGENT_ID = /^agt_[a-f0-9]{24}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const HANDOFF_ID = /^hnd_[a-f0-9]{24}$/u;
const SESSION_ID = /^ses_[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{8,128}$/u;
const WORKSTREAM_ID = /^wks_[a-f0-9]{24}$/u;
const MAXIMUM_STATE_BYTES = 2 * 1024 * 1024;
const MINIMUM_LEASE_MS = 5_000;
const MAXIMUM_LEASE_MS = 30 * 60_000;
const STALE_LOCK_MS = 60_000;

interface AgentRegistry {
  schemaVersion: 1;
  kind: "lervo_agent_registry";
  agents: WorkforceAgent[];
}

function fail(
  code: ConstructorParameters<typeof AgentWorkforceError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new AgentWorkforceError(code, message, cause === undefined ? undefined : { cause });
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function id(prefix: "agt" | "asn" | "hnd" | "lse", material: unknown): string {
  return `${prefix}_${createHash("sha256").update(stableJson(material)).digest("hex").slice(0, 24)}`;
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function boundedStrings(value: unknown, maximum: number, pattern?: RegExp): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 1_024 &&
        (pattern === undefined || pattern.test(item)),
    ) &&
    new Set(value).size === value.length
  );
}

function safePath(value: string): boolean {
  return (
    value === "*" ||
    (value.length <= 1_024 &&
      value.length > 0 &&
      posix.normalize(value) === value &&
      !value.startsWith("/") &&
      !value.includes("../") &&
      !value.includes("\\") &&
      !value.includes("\0"))
  );
}

function validAgent(agent: unknown, projectId: string): agent is WorkforceAgent {
  if (agent === null || typeof agent !== "object" || Array.isArray(agent)) return false;
  const value = agent as WorkforceAgent;
  return (
    value.schemaVersion === 1 &&
    AGENT_ID.test(value.agentId) &&
    value.projectId === projectId &&
    ROLE_ID.test(value.roleId) &&
    value.roleId.length <= 100 &&
    (value.roleVersion === undefined || ROLE_VERSION.test(value.roleVersion)) &&
    (value.roleContractHash === undefined || HASH.test(value.roleContractHash)) &&
    HASH.test(value.roleProfileHash) &&
    HASH.test(value.capabilityHash) &&
    ["codex", "claude", "any"].includes(value.provider) &&
    boundedStrings(value.skillIds, 32) &&
    (value.capabilityPackages === undefined ||
      (Array.isArray(value.capabilityPackages) &&
        value.capabilityPackages.length <= 64 &&
        value.capabilityPackages.every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u.test(item.capabilityId) &&
            ["skill", "mcp_server", "provider_plugin", "bundle"].includes(item.kind) &&
            ROLE_VERSION.test(item.version) &&
            HASH.test(item.contentHash) &&
            ["project", "user"].includes(item.sourceKind),
        ))) &&
    boundedStrings(value.responsibilityPaths, 64) &&
    value.responsibilityPaths.every(safePath) &&
    (value.parentAgentId === null || AGENT_ID.test(value.parentAgentId)) &&
    Number.isSafeInteger(value.delegationDepth) &&
    value.delegationDepth >= 0 &&
    value.delegationDepth <= workforceLimits.maximumDelegationDepth &&
    ["active", "suspended", "retired"].includes(value.status) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validTime(value.createdAt) &&
    validTime(value.updatedAt)
  );
}

function validArtifact(value: unknown): value is WorkforceArtifactReference {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ARTIFACT_ID.test((value as WorkforceArtifactReference).artifactId) &&
    HASH.test((value as WorkforceArtifactReference).contentHash)
  );
}

function validHandoff(value: unknown): value is WorkforceHandoff {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceHandoff;
  return (
    HANDOFF_ID.test(item.handoffId) &&
    AGENT_ID.test(item.fromAgentId) &&
    AGENT_ID.test(item.toAgentId) &&
    HASH.test(item.requestDigest) &&
    Array.isArray(item.artifactReferences) &&
    item.artifactReferences.length <= 32 &&
    item.artifactReferences.every(validArtifact) &&
    boundedStrings(item.contextEvidenceEventIds, 64, EVENT_ID) &&
    validTime(item.createdAt) &&
    (item.acknowledgedAt === null || validTime(item.acknowledgedAt))
  );
}

function validAssignment(value: unknown, projectId: string): value is WorkforceAssignment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as WorkforceAssignment;
  const lease = item.lease;
  return (
    item.schemaVersion === 1 &&
    ASSIGNMENT_ID.test(item.assignmentId) &&
    item.projectId === projectId &&
    /^[a-z][a-z0-9._-]{1,99}$/u.test(item.taskType) &&
    ROLE_ID.test(item.roleId) &&
    item.roleId.length <= 100 &&
    (item.roleVersion === undefined || ROLE_VERSION.test(item.roleVersion)) &&
    (item.roleContractHash === undefined || HASH.test(item.roleContractHash)) &&
    ["queued", "leased", "blocked", "completed", "failed", "cancelled"].includes(item.status) &&
    Number.isSafeInteger(item.priority) &&
    item.priority >= 0 &&
    item.priority <= 100 &&
    boundedStrings(item.dependencyIds, 64, ASSIGNMENT_ID) &&
    !item.dependencyIds.includes(item.assignmentId) &&
    boundedStrings(item.acceptanceCriteria, 32) &&
    boundedStrings(item.verificationSuiteIds, 32) &&
    boundedStrings(item.approvalRequirements, 32) &&
    boundedStrings(item.expectedPaths, 128) &&
    item.expectedPaths.every(safePath) &&
    (item.workstreamId === null || WORKSTREAM_ID.test(item.workstreamId)) &&
    (item.assigneeAgentId === null || AGENT_ID.test(item.assigneeAgentId)) &&
    (lease === null ||
      (/^lse_[a-f0-9]{24}$/u.test(lease.leaseId) &&
        AGENT_ID.test(lease.agentId) &&
        SESSION_ID.test(lease.sessionId) &&
        Number.isSafeInteger(lease.generation) &&
        lease.generation >= 1 &&
        validTime(lease.acquiredAt) &&
        validTime(lease.expiresAt))) &&
    Array.isArray(item.handoffs) &&
    item.handoffs.length <= 256 &&
    item.handoffs.every(validHandoff) &&
    Array.isArray(item.resultArtifacts) &&
    item.resultArtifacts.length <= 64 &&
    item.resultArtifacts.every(validArtifact) &&
    (item.failureCode === null || /^[a-z][a-z0-9_]{1,99}$/u.test(item.failureCode)) &&
    Number.isSafeInteger(item.revision) &&
    item.revision >= 1 &&
    validTime(item.createdAt) &&
    validTime(item.updatedAt)
  );
}

async function state(root: string) {
  const manifest = await loadProjectManifest(root);
  const base = (await resolveRepositoryCoordinationHome(root)).workforce;
  await mkdir(resolve(base, "assignments"), { recursive: true, mode: 0o700 });
  return { base, manifest };
}

async function readBounded(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAXIMUM_STATE_BYTES ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      fail("workforce_state_invalid", "A workforce state file is unsafe.");
    return readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof AgentWorkforceError) throw error;
    fail("workforce_state_invalid", "A workforce state file could not be read.", error);
  }
}

async function acquireLock(path: string, now: Date): Promise<() => Promise<void>> {
  const create = async () => {
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, pid: process.pid, hostname: hostname(), createdAt: now.toISOString() })}\n`,
    );
    await handle.sync();
    return handle;
  };
  let handle;
  try {
    handle = await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      const lock = JSON.parse((await readBounded(path)) ?? "null") as {
        pid?: unknown;
        hostname?: unknown;
        createdAt?: unknown;
      } | null;
      const age =
        lock !== null && validTime(lock.createdAt) ? now.getTime() - Date.parse(lock.createdAt) : 0;
      let alive = true;
      if (
        lock?.hostname === hostname() &&
        typeof lock.pid === "number" &&
        Number.isSafeInteger(lock.pid)
      ) {
        try {
          process.kill(lock.pid, 0);
        } catch (processError) {
          alive = (processError as NodeJS.ErrnoException).code !== "ESRCH";
        }
      }
      if (age > STALE_LOCK_MS && !alive) {
        await rm(path);
        handle = await create();
      } else fail("workforce_busy", "Another workforce transition is in progress.");
    } catch (lockError) {
      if (lockError instanceof AgentWorkforceError) throw lockError;
      fail("workforce_busy", "The workforce lock cannot be recovered safely.", lockError);
    }
  }
  return async () => {
    await handle!.close();
    await rm(path, { force: true });
  };
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function transition<T>(input: {
  path: string;
  lockPath: string;
  now: Date;
  content: string;
  event: WorkforceEvent;
  recordEvent?: WorkforceEventRecorder;
  result: T;
  expectedBefore?: string | null;
}): Promise<T> {
  const release = await acquireLock(input.lockPath, input.now);
  let before: string | null;
  try {
    before = await readBounded(input.path);
    if (Object.hasOwn(input, "expectedBefore") && before !== input.expectedBefore)
      fail("agent_state_conflict", "The workforce state changed before apply.");
    await atomicWrite(input.path, input.content);
    try {
      await input.recordEvent?.(input.event);
    } catch (error) {
      if (before === null) await rm(input.path, { force: true });
      else await atomicWrite(input.path, before);
      fail("workforce_write_failed", "The workforce event failed and state was restored.", error);
    }
    return input.result;
  } finally {
    await release();
  }
}

async function normalizeAgent(root: string, agent: WorkforceAgent): Promise<WorkforceAgent> {
  const contract = await resolveRoleContract(root, agent.roleId);
  const currentProfileHash = roleProfileHash(contract.definition.profile);
  const legacyCapabilityHash = digest(stableJson(contract.definition.profile.capabilities));
  if (agent.roleVersion === undefined || agent.roleContractHash === undefined) {
    if (
      contract.sourceKind !== "built_in" ||
      agent.roleProfileHash !== currentProfileHash ||
      agent.capabilityHash !== legacyCapabilityHash ||
      agent.capabilityPackages !== undefined
    ) {
      fail(
        "workforce_state_invalid",
        `Legacy agent ${agent.agentId} cannot be bound to the current built-in role contract.`,
      );
    }
    return { ...agent, roleVersion: contract.version, roleContractHash: contract.contractHash };
  }
  try {
    assertRoleContractBinding(contract, agent);
  } catch (error) {
    fail(
      "agent_state_conflict",
      `Agent ${agent.agentId} is bound to a stale role contract.`,
      error,
    );
  }
  if (agent.capabilityPackages === undefined) {
    if (agent.capabilityHash !== legacyCapabilityHash)
      fail("agent_state_conflict", `Agent ${agent.agentId} capability binding is stale.`);
    return agent;
  }
  const current = await resolveCapabilities({
    repositoryRoot: root,
    projectId: agent.projectId,
    capabilityIds: agent.capabilityPackages.map((item) => item.capabilityId),
    provider: agent.provider,
    platform: process.platform,
    generatedAt: agent.updatedAt,
    allowedPermissions: Object.entries(contract.definition.profile.capabilities)
      .filter(([, decision]) => decision === "allow")
      .map(([permission]) => permission),
  });
  const packages = current.selected.map(
    ({ capabilityId, kind, version, contentHash, sourceKind }) => ({
      capabilityId,
      kind,
      version,
      contentHash,
      sourceKind,
    }),
  );
  if (stableJson(packages) !== stableJson(agent.capabilityPackages))
    fail("agent_state_conflict", `Agent ${agent.agentId} capability package binding is stale.`);
  const currentCapabilityHash = digest(
    stableJson({
      permissions: contract.definition.profile.capabilities,
      packages: packages.map(({ capabilityId, version, contentHash }) => ({
        capabilityId,
        version,
        contentHash,
      })),
    }),
  );
  if (agent.capabilityHash !== currentCapabilityHash)
    fail("agent_state_conflict", `Agent ${agent.agentId} capability binding is stale.`);
  return agent;
}

async function registry(root: string): Promise<{
  path: string;
  lockPath: string;
  source: string | null;
  value: AgentRegistry;
  projectId: string;
}> {
  const current = await state(root);
  const path = resolve(current.base, "agents.json");
  const source = await readBounded(path);
  const value =
    source === null
      ? { schemaVersion: 1 as const, kind: "lervo_agent_registry" as const, agents: [] }
      : (JSON.parse(source) as AgentRegistry);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_agent_registry" ||
    !Array.isArray(value.agents) ||
    value.agents.length > workforceLimits.maximumAgents ||
    !value.agents.every((agent) => validAgent(agent, current.manifest.projectId))
  )
    fail("workforce_state_invalid", "The agent registry is invalid.");
  const ids = value.agents.map((agent) => agent.agentId);
  if (
    new Set(ids).size !== ids.length ||
    value.agents.some((agent) => agent.parentAgentId !== null && !ids.includes(agent.parentAgentId))
  )
    fail(
      "workforce_state_invalid",
      "The agent registry contains duplicate or missing parent identities.",
    );
  const normalized = await Promise.all(value.agents.map((agent) => normalizeAgent(root, agent)));
  return {
    path,
    lockPath: resolve(current.base, "agents.lock"),
    source,
    value: { ...value, agents: normalized },
    projectId: current.manifest.projectId,
  };
}

async function retryConcurrent<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof AgentWorkforceError) ||
        !["workforce_busy", "agent_state_conflict"].includes(error.code) ||
        attempt === 7
      )
        throw error;
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5 * (attempt + 1)));
    }
  }
  throw new AgentWorkforceError(
    "workforce_busy",
    "The workforce transition could not acquire a stable snapshot.",
  );
}

async function assignmentPath(
  root: string,
  assignmentId: string,
): Promise<{ path: string; lockPath: string; projectId: string }> {
  if (!ASSIGNMENT_ID.test(assignmentId))
    fail("assignment_invalid", "The assignment ID is invalid.");
  const current = await state(root);
  return {
    path: resolve(current.base, "assignments", `${assignmentId}.json`),
    lockPath: resolve(current.base, "scheduler.lock"),
    projectId: current.manifest.projectId,
  };
}

async function readAssignmentState(
  root: string,
  assignmentId: string,
): Promise<{ value: WorkforceAssignment; source: string }> {
  const target = await assignmentPath(root, assignmentId);
  const source = await readBounded(target.path);
  if (source === null) fail("assignment_not_found", "The assignment does not exist.");
  const value = JSON.parse(source) as WorkforceAssignment;
  if (!validAssignment(value, target.projectId) || value.assignmentId !== assignmentId)
    fail("workforce_state_invalid", "The assignment state is invalid.");
  const contract = await resolveRoleContract(root, value.roleId);
  if (value.roleVersion === undefined || value.roleContractHash === undefined) {
    if (contract.sourceKind !== "built_in")
      fail("workforce_state_invalid", "A legacy assignment cannot bind to a repository role.");
    return {
      source,
      value: { ...value, roleVersion: contract.version, roleContractHash: contract.contractHash },
    };
  }
  if (value.roleVersion !== contract.version || value.roleContractHash !== contract.contractHash)
    fail(
      "assignment_lease_conflict",
      `Assignment ${assignmentId} is bound to a stale role contract.`,
    );
  return { source, value };
}

async function readAssignment(root: string, assignmentId: string): Promise<WorkforceAssignment> {
  return (await readAssignmentState(root, assignmentId)).value;
}

export async function listAgents(root: string): Promise<WorkforceAgent[]> {
  return structuredClone((await registry(root)).value.agents);
}

async function registerAgentOnce(input: {
  repositoryRoot: string;
  roleId: string;
  provider?: WorkforceProvider;
  responsibilityPaths?: string[];
  skillIds?: string[];
  capabilityPackageIds?: string[];
  parentAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const definition = contract.definition;
  const parent =
    input.parentAgentId === undefined
      ? null
      : (current.value.agents.find((agent) => agent.agentId === input.parentAgentId) ?? null);
  if (input.parentAgentId !== undefined && (parent === null || parent.status !== "active"))
    fail("agent_state_conflict", "A subagent requires an active parent agent.");
  const delegationDepth = parent === null ? 0 : parent.delegationDepth + 1;
  if (delegationDepth > workforceLimits.maximumDelegationDepth)
    fail("agent_state_conflict", "The maximum subagent delegation depth was reached.");
  const responsibilityPaths = [...new Set(input.responsibilityPaths ?? ["*"])].sort();
  const skillIds = [...new Set(input.skillIds ?? definition.profile.defaultSkills)].sort();
  const capabilityPackageIds = [
    ...new Set(
      input.capabilityPackageIds ??
        parent?.capabilityPackages?.map((item) => item.capabilityId) ??
        definition.profile.defaultCapabilityPackages ??
        [],
    ),
  ].sort();
  if (
    parent !== null &&
    capabilityPackageIds.some(
      (id) => !parent.capabilityPackages?.some((item) => item.capabilityId === id),
    )
  )
    fail(
      "agent_state_conflict",
      "A subagent cannot expand its parent's capability package authority.",
    );
  if (
    !boundedStrings(responsibilityPaths, 64) ||
    !responsibilityPaths.every(safePath) ||
    !boundedStrings(skillIds, 32)
  )
    fail("agent_invalid", "Agent skills or responsibility paths are invalid.");
  const resolvedCapabilities = await resolveCapabilities({
    repositoryRoot: input.repositoryRoot,
    projectId: current.projectId,
    capabilityIds: capabilityPackageIds,
    provider: input.provider ?? "any",
    platform: process.platform,
    generatedAt: now.toISOString(),
    allowedPermissions: Object.entries(definition.profile.capabilities)
      .filter(([, decision]) => decision === "allow")
      .map(([permission]) => permission),
  });
  if (current.value.agents.length >= workforceLimits.maximumAgents)
    fail("agent_state_conflict", "The repository agent limit was reached.");
  const roleHash = roleProfileHash(definition.profile);
  const createdAt = now.toISOString();
  const agent: WorkforceAgent = {
    schemaVersion: 1,
    agentId: id("agt", { projectId: current.projectId, nonce: randomUUID() }),
    projectId: current.projectId,
    roleId: input.roleId,
    roleVersion: contract.version,
    roleContractHash: contract.contractHash,
    roleProfileHash: roleHash,
    provider: input.provider ?? "any",
    capabilityHash: digest(
      stableJson({
        permissions: definition.profile.capabilities,
        packages: resolvedCapabilities.selected.map(({ capabilityId, version, contentHash }) => ({
          capabilityId,
          version,
          contentHash,
        })),
      }),
    ),
    skillIds,
    capabilityPackages: resolvedCapabilities.selected.map(
      ({ capabilityId, kind, version, contentHash, sourceKind }) => ({
        capabilityId,
        kind,
        version,
        contentHash,
        sourceKind,
      }),
    ),
    responsibilityPaths,
    parentAgentId: parent?.agentId ?? null,
    delegationDepth,
    status: "active",
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const next = {
    ...current.value,
    agents: [...current.value.agents, agent].sort((a, b) => a.agentId.localeCompare(b.agentId)),
  };
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.registered",
      occurredAt: createdAt,
      actorAgentId: parent?.agentId ?? null,
      payload: {
        agentId: agent.agentId,
        roleId: agent.roleId,
        roleVersion: agent.roleVersion,
        roleContractHash: agent.roleContractHash,
        roleProfileHash: agent.roleProfileHash,
        capabilityHash: agent.capabilityHash,
        provider: agent.provider,
        parentAgentId: agent.parentAgentId,
        delegationDepth,
      },
    },
  });
}

export function registerAgent(input: {
  repositoryRoot: string;
  roleId: string;
  provider?: WorkforceProvider;
  responsibilityPaths?: string[];
  skillIds?: string[];
  capabilityPackageIds?: string[];
  parentAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  return retryConcurrent(() => registerAgentOnce(input));
}

export async function changeAgentStatus(input: {
  repositoryRoot: string;
  agentId: string;
  expectedRevision: number;
  status: AgentStatus;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (!AGENT_ID.test(input.agentId) || !["active", "suspended", "retired"].includes(input.status))
    fail("agent_invalid", "The agent transition is invalid.");
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = current.value.agents[index]!;
  if (
    existing.revision !== input.expectedRevision ||
    existing.status === "retired" ||
    existing.status === input.status
  )
    fail("agent_state_conflict", "The agent revision or lifecycle transition is stale.");
  const agent = {
    ...existing,
    status: input.status,
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  };
  const agents = [...current.value.agents];
  agents[index] = agent;
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.status.changed",
      occurredAt: agent.updatedAt,
      actorAgentId: input.actorAgentId ?? null,
      payload: {
        agentId: agent.agentId,
        previousStatus: existing.status,
        status: agent.status,
        revision: agent.revision,
      },
    },
  });
}

export async function listAssignments(root: string): Promise<WorkforceAssignment[]> {
  const current = await state(root);
  const names = (await readdir(resolve(current.base, "assignments")))
    .filter((name) => /^asn_[a-f0-9]{24}\.json$/u.test(name))
    .sort();
  if (names.length > workforceLimits.maximumAssignments)
    fail("workforce_state_invalid", "The assignment limit was exceeded.");
  return Promise.all(names.map((name) => readAssignment(root, name.slice(0, -5))));
}

async function createAssignmentOnce(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  priority?: number;
  dependencyIds?: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements?: string[];
  expectedPaths: string[];
  workstreamId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const current = await state(input.repositoryRoot);
  const assignments = await listAssignments(input.repositoryRoot);
  if (
    assignments.length >= workforceLimits.maximumAssignments ||
    !/^[a-z][a-z0-9._-]{1,99}$/u.test(input.taskType)
  )
    fail("assignment_invalid", "The task type or assignment capacity is invalid.");
  const dependencyIds = [...new Set(input.dependencyIds ?? [])].sort();
  const expectedPaths = [...new Set(input.expectedPaths)].sort();
  const verificationSuiteIds = [...new Set(input.verificationSuiteIds)].sort();
  const approvalRequirements = [...new Set(input.approvalRequirements ?? [])].sort();
  if (
    !boundedStrings(dependencyIds, workforceLimits.maximumAssignmentDependencies, ASSIGNMENT_ID) ||
    !boundedStrings(input.acceptanceCriteria, 32) ||
    !boundedStrings(verificationSuiteIds, 32) ||
    !boundedStrings(approvalRequirements, 32) ||
    !boundedStrings(expectedPaths, 128) ||
    !expectedPaths.every(safePath) ||
    input.acceptanceCriteria.length === 0 ||
    verificationSuiteIds.length === 0 ||
    expectedPaths.length === 0 ||
    (input.workstreamId !== undefined && !WORKSTREAM_ID.test(input.workstreamId))
  )
    fail(
      "assignment_invalid",
      "Assignment dependencies, criteria, verification, approval, paths, or workstream are invalid.",
    );
  if (
    dependencyIds.some(
      (dependencyId) => !assignments.some((assignment) => assignment.assignmentId === dependencyId),
    )
  )
    fail("assignment_invalid", "An assignment dependency does not exist.");
  const createdAt = now.toISOString();
  const assignment: WorkforceAssignment = {
    schemaVersion: 1,
    assignmentId: id("asn", { projectId: current.manifest.projectId, nonce: randomUUID() }),
    projectId: current.manifest.projectId,
    taskType: input.taskType,
    roleId: input.roleId,
    roleVersion: contract.version,
    roleContractHash: contract.contractHash,
    status: "queued",
    priority: input.priority ?? 50,
    dependencyIds,
    acceptanceCriteria: [...input.acceptanceCriteria],
    verificationSuiteIds,
    approvalRequirements,
    expectedPaths,
    workstreamId: input.workstreamId ?? null,
    assigneeAgentId: null,
    lease: null,
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  if (!validAssignment(assignment, current.manifest.projectId))
    fail("assignment_invalid", "The assignment is invalid.");
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(assignment, null, 2)}\n`,
    result: structuredClone(assignment),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.created",
      occurredAt: createdAt,
      actorAgentId: null,
      payload: {
        assignmentId: assignment.assignmentId,
        taskType: assignment.taskType,
        roleId: assignment.roleId,
        roleVersion: assignment.roleVersion,
        roleContractHash: assignment.roleContractHash,
        priority: assignment.priority,
        dependencyIds,
        expectedPathDigest: digest(stableJson(expectedPaths)),
        acceptanceDigest: digest(stableJson(input.acceptanceCriteria)),
        verificationDigest: digest(stableJson(verificationSuiteIds)),
        workstreamId: assignment.workstreamId,
      },
    },
  });
}

export function createAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  priority?: number;
  dependencyIds?: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements?: string[];
  expectedPaths: string[];
  workstreamId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => createAssignmentOnce(input));
}

function overlaps(left: string[], right: string[]): boolean {
  if (left.includes("*") || right.includes("*")) return true;
  return left.some((a) =>
    right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)),
  );
}

async function claimAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  if (!AGENT_ID.test(input.agentId) || !SESSION_ID.test(input.sessionId))
    fail("assignment_invalid", "The claim coordinates are invalid.");
  const duration = input.leaseDurationMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(duration) || duration < MINIMUM_LEASE_MS || duration > MAXIMUM_LEASE_MS)
    fail("assignment_invalid", "The lease duration is invalid.");
  const now = input.now ?? new Date();
  const agents = await listAgents(input.repositoryRoot);
  const agent = agents.find((item) => item.agentId === input.agentId);
  if (agent === undefined || agent.status !== "active")
    fail("agent_state_conflict", "Only an active agent can claim an assignment.");
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  const release = await acquireLock(target.lockPath, now);
  try {
    const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
    const assignment = assignmentState.value;
    const all = await listAssignments(input.repositoryRoot);
    if (assignment.roleId !== agent.roleId)
      fail("assignment_lease_conflict", "The agent role does not match the assignment role.");
    if (
      assignment.roleVersion !== agent.roleVersion ||
      assignment.roleContractHash !== agent.roleContractHash
    )
      fail("assignment_lease_conflict", "The agent and assignment role contracts differ.");
    if (
      !agent.responsibilityPaths.includes("*") &&
      !assignment.expectedPaths.every((path) =>
        agent.responsibilityPaths.some((scope) => path === scope || path.startsWith(`${scope}/`)),
      )
    )
      fail("assignment_path_conflict", "The assignment is outside the agent responsibility scope.");
    if (
      assignment.dependencyIds.some(
        (dependencyId) =>
          all.find((item) => item.assignmentId === dependencyId)?.status !== "completed",
      )
    )
      fail("assignment_dependency_blocked", "An assignment dependency is not complete.");
    const currentLeaseActive =
      assignment.lease !== null && Date.parse(assignment.lease.expiresAt) > now.getTime();
    if (currentLeaseActive || !["queued", "leased"].includes(assignment.status))
      fail("assignment_lease_conflict", "The assignment is not claimable.");
    const conflicting = all.find(
      (item) =>
        item.assignmentId !== assignment.assignmentId &&
        item.status === "leased" &&
        item.lease !== null &&
        Date.parse(item.lease.expiresAt) > now.getTime() &&
        overlaps(item.expectedPaths, assignment.expectedPaths),
    );
    if (conflicting !== undefined)
      fail(
        "assignment_path_conflict",
        "Another active assignment owns an overlapping repository path.",
      );
    const generation = (assignment.lease?.generation ?? 0) + 1;
    const lease = {
      leaseId: id("lse", {
        assignmentId: assignment.assignmentId,
        generation,
        nonce: randomUUID(),
      }),
      agentId: agent.agentId,
      sessionId: input.sessionId,
      generation,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + duration).toISOString(),
    };
    const next: WorkforceAssignment = {
      ...assignment,
      status: "leased",
      assigneeAgentId: agent.agentId,
      lease,
      revision: assignment.revision + 1,
      updatedAt: now.toISOString(),
    };
    const before = assignmentState.source;
    await atomicWrite(target.path, `${JSON.stringify(next, null, 2)}\n`);
    try {
      await input.recordEvent?.({
        type: "assignment.claimed",
        occurredAt: next.updatedAt,
        actorAgentId: agent.agentId,
        payload: {
          assignmentId: next.assignmentId,
          agentId: agent.agentId,
          leaseId: lease.leaseId,
          generation,
          expiresAt: lease.expiresAt,
          expectedPathDigest: digest(stableJson(next.expectedPaths)),
        },
      });
    } catch (error) {
      await atomicWrite(target.path, before);
      fail(
        "workforce_write_failed",
        "The assignment claim event failed and state was restored.",
        error,
      );
    }
    return structuredClone(next);
  } finally {
    await release();
  }
}

export function claimAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  sessionId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => claimAssignmentOnce(input));
}

async function renewAssignmentLeaseOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const duration = input.leaseDurationMs ?? 5 * 60_000;
  if (
    !AGENT_ID.test(input.agentId) ||
    !Number.isSafeInteger(duration) ||
    duration < MINIMUM_LEASE_MS ||
    duration > MAXIMUM_LEASE_MS
  )
    fail("assignment_invalid", "The lease renewal coordinates are invalid.");
  const now = input.now ?? new Date();
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  exactLease(assignment, input.agentId, input.leaseId, now);
  const lease = {
    ...assignment.lease!,
    expiresAt: new Date(now.getTime() + duration).toISOString(),
  };
  const next: WorkforceAssignment = {
    ...assignment,
    lease,
    revision: assignment.revision + 1,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    expectedBefore: assignmentState.source,
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.lease.renewed",
      occurredAt: next.updatedAt,
      actorAgentId: input.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        agentId: input.agentId,
        leaseId: lease.leaseId,
        generation: lease.generation,
        expiresAt: lease.expiresAt,
      },
    },
  });
}

export function renewAssignmentLease(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  leaseDurationMs?: number;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => renewAssignmentLeaseOnce(input));
}

async function cancelAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  reason: AssignmentCancellationStep["reason"];
  expectedPlanId: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  if (!/^acp_[a-f0-9]{24}$/u.test(input.expectedPlanId)) {
    fail("assignment_invalid", "The assignment cancellation plan ID is invalid.");
  }
  const now = input.now ?? new Date();
  const [assignmentState, assignments] = await Promise.all([
    readAssignmentState(input.repositoryRoot, input.assignmentId),
    listAssignments(input.repositoryRoot),
  ]);
  const planAssignments = assignments.map((assignment) =>
    assignment.assignmentId === input.assignmentId ? assignmentState.value : assignment,
  );
  const plan = createAssignmentCancellationPlan({
    assignments: planAssignments,
    assignmentId: input.assignmentId,
    reason: input.reason,
  });
  if (plan.planId !== input.expectedPlanId) {
    fail("agent_state_conflict", "The assignment cancellation plan is stale.");
  }
  if (plan.status !== "ready") {
    fail(
      "assignment_cancellation_blocked",
      `The assignment cancellation is ${plan.status}: ${plan.blockedReason ?? "unknown"}.`,
    );
  }
  const next: WorkforceAssignment = {
    ...assignmentState.value,
    status: "cancelled",
    lease: null,
    revision: assignmentState.value.revision + 1,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, input.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    expectedBefore: assignmentState.source,
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    event: {
      type: "assignment.cancelled",
      occurredAt: next.updatedAt,
      actorAgentId: null,
      payload: {
        assignmentId: next.assignmentId,
        previousStatus: plan.previousStatus,
        reason: plan.reason,
        planId: plan.planId,
        cancelledDependencyIds: plan.cancelledDependencyIds,
        revision: next.revision,
      },
    },
  });
}

export function cancelAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  reason: AssignmentCancellationStep["reason"];
  expectedPlanId: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => cancelAssignmentOnce(input));
}

function exactLease(
  assignment: WorkforceAssignment,
  agentId: string,
  leaseId: string,
  now: Date,
): void {
  if (
    assignment.status !== "leased" ||
    assignment.lease === null ||
    assignment.lease.agentId !== agentId ||
    assignment.lease.leaseId !== leaseId ||
    Date.parse(assignment.lease.expiresAt) <= now.getTime()
  )
    fail(
      "assignment_lease_conflict",
      "The assignment lease is absent, stale, expired, or owned by another agent.",
    );
}

export async function assertAssignmentExecutionAuthority(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  provider: "codex" | "claude";
  expectedPaths: string[];
  verificationSuiteIds: string[];
  now?: Date;
}): Promise<{ assignment: WorkforceAssignment; agent: WorkforceAgent }> {
  const now = input.now ?? new Date();
  const [assignment, agents] = await Promise.all([
    readAssignment(input.repositoryRoot, input.assignmentId),
    listAgents(input.repositoryRoot),
  ]);
  const agent = agents.find((item) => item.agentId === input.agentId);
  if (
    agent === undefined ||
    agent.status !== "active" ||
    agent.roleId !== assignment.roleId ||
    (agent.provider !== "any" && agent.provider !== input.provider)
  )
    fail(
      "agent_state_conflict",
      "The managed run agent, role, status, or provider does not match the assignment.",
    );
  if (
    agent.roleVersion !== assignment.roleVersion ||
    agent.roleContractHash !== assignment.roleContractHash
  )
    fail("agent_state_conflict", "The managed run agent and assignment role contracts differ.");
  exactLease(assignment, input.agentId, input.leaseId, now);
  const expectedPaths = [...new Set(input.expectedPaths)].sort();
  const suites = [...new Set(input.verificationSuiteIds)].sort();
  if (
    expectedPaths.length !== input.expectedPaths.length ||
    !expectedPaths.every(safePath) ||
    !expectedPaths.every((path) =>
      assignment.expectedPaths.some(
        (scope) => scope === "*" || path === scope || path.startsWith(`${scope}/`),
      ),
    ) ||
    JSON.stringify(suites) !== JSON.stringify([...assignment.verificationSuiteIds].sort())
  )
    fail(
      "assignment_path_conflict",
      "The managed run paths or verification suites differ from the leased assignment.",
    );
  return { assignment: structuredClone(assignment), agent: structuredClone(agent) };
}

async function recordAssignmentHandoffOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  fromAgentId: string;
  toAgentId: string;
  leaseId: string;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  if (
    !AGENT_ID.test(input.fromAgentId) ||
    !AGENT_ID.test(input.toAgentId) ||
    input.fromAgentId === input.toAgentId ||
    !HASH.test(input.requestDigest) ||
    !Array.isArray(input.artifactReferences) ||
    !input.artifactReferences.every(validArtifact) ||
    !boundedStrings(input.contextEvidenceEventIds, 64, EVENT_ID)
  )
    fail("assignment_invalid", "The handoff coordinates are invalid.");
  const agents = await listAgents(input.repositoryRoot);
  const from = agents.find((agent) => agent.agentId === input.fromAgentId);
  const to = agents.find((agent) => agent.agentId === input.toAgentId);
  if (from === undefined || to === undefined || from.status !== "active" || to.status !== "active")
    fail("agent_state_conflict", "A handoff requires two active agents.");
  const fromContract = await resolveRoleContract(input.repositoryRoot, from.roleId);
  const toContract = await resolveRoleContract(input.repositoryRoot, to.roleId);
  try {
    assertRoleContractBinding(fromContract, from);
    assertRoleContractBinding(toContract, to);
  } catch (error) {
    fail("agent_state_conflict", "A handoff agent role contract is stale.", error);
  }
  if (!fromContract.definition.profile.handoff.allowedRoleIds.includes(to.roleId))
    fail("agent_state_conflict", "The source role does not allow this recipient role.");
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  exactLease(assignment, input.fromAgentId, input.leaseId, now);
  const createdAt = now.toISOString();
  const handoff: WorkforceHandoff = {
    handoffId: id("hnd", { assignmentId: assignment.assignmentId, nonce: randomUUID() }),
    fromAgentId: from.agentId,
    toAgentId: to.agentId,
    requestDigest: input.requestDigest,
    artifactReferences: [...input.artifactReferences],
    contextEvidenceEventIds: [...input.contextEvidenceEventIds],
    createdAt,
    acknowledgedAt: null,
  };
  const next = {
    ...assignment,
    handoffs: [...assignment.handoffs, handoff],
    revision: assignment.revision + 1,
    updatedAt: createdAt,
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: assignmentState.source,
    event: {
      type: "assignment.handoff.recorded",
      occurredAt: createdAt,
      actorAgentId: from.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        fromAgentId: from.agentId,
        toAgentId: to.agentId,
        requestDigest: handoff.requestDigest,
        artifactIds: handoff.artifactReferences.map((item) => item.artifactId),
        artifactHashes: handoff.artifactReferences.map((item) => item.contentHash),
        contextEvidenceEventIds: handoff.contextEvidenceEventIds,
      },
    },
  });
}

export function recordAssignmentHandoff(input: {
  repositoryRoot: string;
  assignmentId: string;
  fromAgentId: string;
  toAgentId: string;
  leaseId: string;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => recordAssignmentHandoffOnce(input));
}

async function completeAssignmentOnce(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  resultArtifacts: WorkforceArtifactReference[];
  verificationStatus: "passed" | "failed";
  failureCode?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
  reconciliation?: AssignmentCompletionReconciliation;
}): Promise<WorkforceAssignment> {
  const now = input.now ?? new Date();
  if (
    !Array.isArray(input.resultArtifacts) ||
    input.resultArtifacts.length > 64 ||
    !input.resultArtifacts.every(validArtifact) ||
    (input.verificationStatus === "passed" && input.resultArtifacts.length === 0) ||
    (input.failureCode !== undefined && !/^[a-z][a-z0-9_]{1,99}$/u.test(input.failureCode))
  )
    fail("assignment_invalid", "The assignment result is invalid.");
  if (
    input.reconciliation !== undefined &&
    !validAssignmentCompletionReconciliation({
      reconciliation: input.reconciliation,
      verificationStatus: input.verificationStatus,
      resultArtifacts: input.resultArtifacts,
    })
  ) {
    fail("assignment_invalid", "The assignment completion reconciliation is invalid.");
  }
  const assignmentState = await readAssignmentState(input.repositoryRoot, input.assignmentId);
  const assignment = assignmentState.value;
  if (input.reconciliation === undefined) {
    exactLease(assignment, input.agentId, input.leaseId, now);
  } else {
    if (
      !preparedCompletionMatchesAssignment({
        assignment,
        assignmentRevision: input.reconciliation.assignmentRevision,
        agentId: input.agentId,
        leaseId: input.leaseId,
        preparedAt: input.reconciliation.preparedAt,
      })
    ) {
      fail(
        "assignment_lease_conflict",
        "The prepared completion differs from the assignment revision or lease.",
      );
    }
  }
  const status =
    input.verificationStatus === "passed" ? ("completed" as const) : ("failed" as const);
  const next: WorkforceAssignment = {
    ...assignment,
    status,
    lease: null,
    resultArtifacts: [...input.resultArtifacts],
    failureCode: status === "failed" ? (input.failureCode ?? "verification_failed") : null,
    revision: assignment.revision + 1,
    updatedAt: now.toISOString(),
  };
  const target = await assignmentPath(input.repositoryRoot, assignment.assignmentId);
  return transition({
    path: target.path,
    lockPath: target.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(next),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: assignmentState.source,
    event:
      input.reconciliation === undefined
        ? {
            type: "assignment.completed",
            occurredAt: next.updatedAt,
            actorAgentId: input.agentId,
            payload: {
              assignmentId: assignment.assignmentId,
              agentId: input.agentId,
              status,
              verificationStatus: input.verificationStatus,
              artifactIds: next.resultArtifacts.map((item) => item.artifactId),
              artifactHashes: next.resultArtifacts.map((item) => item.contentHash),
              failureCode: next.failureCode,
            },
          }
        : {
            type: "assignment.completion.reconciled",
            occurredAt: next.updatedAt,
            actorAgentId: input.agentId,
            payload: reconciledCompletionPayload({
              reconciliation: input.reconciliation,
              assignmentId: assignment.assignmentId,
              agentId: input.agentId,
              leaseId: input.leaseId,
              resultArtifact: next.resultArtifacts[0]!,
              revision: next.revision,
              reconciledAt: next.updatedAt,
            }),
          },
  });
}

export function completeAssignment(input: {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  resultArtifacts: WorkforceArtifactReference[];
  verificationStatus: "passed" | "failed";
  failureCode?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => completeAssignmentOnce(input));
}

export function reconcileAssignmentCompletion(input: {
  repositoryRoot: string;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  resultArtifact: WorkforceArtifactReference;
  completionEvidenceId: string;
  reconciliationCommandId: string;
  sourceRunId: string;
  preparedAt: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() =>
    completeAssignmentOnce({
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.leaseId,
      resultArtifacts: [input.resultArtifact],
      verificationStatus: "passed",
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
      reconciliation: {
        completionEvidenceId: input.completionEvidenceId,
        reconciliationCommandId: input.reconciliationCommandId,
        sourceRunId: input.sourceRunId,
        assignmentRevision: input.assignmentRevision,
        preparedAt: input.preparedAt,
      },
    }),
  );
}
