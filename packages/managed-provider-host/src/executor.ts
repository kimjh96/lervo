import {
  hostOutcomeTask,
  observeHostContextOutcomes,
  captureHostOutcomeBaselines,
} from "@lervo/repository-context";
import { createHash, randomUUID } from "node:crypto";

import { normalizeRepositoryPath } from "@lervo/context";
import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";
import { loadDocumentRegistry } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import {
  ManagedProviderHostError,
  type ManagedProviderHost,
  type ManagedProviderHostOptions,
} from "./types.js";
import { prepareManagedProviderHostVerification } from "./verification.js";
import { resolveManagedProviderHostSkills } from "./skills.js";
import {
  managedProviderContinuationContext,
  verifyManagedProviderContinuation,
} from "./continuation.js";
import { verifyManagedProviderHostCompletion } from "./completion.js";

const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultId(prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function sameTarget(
  left: ManagedProviderHostOptions["target"],
  right: ManagedProviderHostOptions["target"],
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

export class ManagedRemoteProviderHost implements ManagedProviderHost {
  private readonly providers: ReadonlySet<string>;
  private readonly roles: ReadonlySet<string>;
  private readonly now: () => Date;
  private readonly createId: NonNullable<ManagedProviderHostOptions["createId"]>;
  private readonly openStorage: NonNullable<ManagedProviderHostOptions["openStorage"]>;
  private readonly loadRegistry: NonNullable<ManagedProviderHostOptions["loadRegistry"]>;
  private readonly resolveSkills: NonNullable<ManagedProviderHostOptions["resolveSkills"]>;
  private readonly prepareVerification: NonNullable<
    ManagedProviderHostOptions["prepareVerification"]
  >;
  private readonly verifyContinuation: NonNullable<
    ManagedProviderHostOptions["verifyContinuation"]
  >;
  private readonly verifyCompletion: NonNullable<ManagedProviderHostOptions["verifyCompletion"]>;
  private running = false;

  constructor(private readonly options: ManagedProviderHostOptions) {
    if (
      options.providers.length < 1 ||
      options.providers.length > 16 ||
      new Set(options.providers).size !== options.providers.length ||
      options.providers.some((provider) => !PROVIDER_PATTERN.test(provider)) ||
      options.roles.length < 1 ||
      options.roles.length > 16 ||
      new Set(options.roles).size !== options.roles.length ||
      options.roles.some((roleId) => !options.roleRegistry.roleIds().includes(roleId))
    ) {
      throw new ManagedProviderHostError(
        "host_configuration_invalid",
        "The managed provider host provider allowlist is invalid.",
      );
    }
    this.providers = new Set(options.providers);
    this.roles = new Set(options.roles);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? defaultId;
    this.openStorage = options.openStorage ?? openProjectStorage;
    this.loadRegistry = options.loadRegistry ?? loadDocumentRegistry;
    this.resolveSkills = options.resolveSkills ?? resolveManagedProviderHostSkills;
    this.prepareVerification =
      options.prepareVerification ?? prepareManagedProviderHostVerification;
    this.verifyContinuation = options.verifyContinuation ?? verifyManagedProviderContinuation;
    this.verifyCompletion = options.verifyCompletion ?? verifyManagedProviderHostCompletion;
  }

  async execute(input: Parameters<ManagedProviderHost["execute"]>[0]) {
    if (this.running) {
      throw new ManagedProviderHostError(
        "managed_execution_failed",
        "The managed provider host executes only one run at a time.",
      );
    }
    this.running = true;
    try {
      return await this.executeOne(input);
    } finally {
      this.running = false;
    }
  }

  private async executeOne(input: Parameters<ManagedProviderHost["execute"]>[0]) {
    const command = input.command;
    if (
      command.action.kind !== "managed_run" ||
      !this.roles.has(command.action.roleId) ||
      !this.providers.has(command.action.provider) ||
      input.request.trim().length === 0 ||
      digest(input.request) !== command.action.request.contentHash ||
      input.policyAuthorization === null
    ) {
      throw new ManagedProviderHostError(
        "managed_command_unsupported",
        "The remote command is outside this managed provider host's execution scope.",
      );
    }
    const resolvedRole = this.options.roleRegistry.resolve(
      command.action.roleId,
      command.action.verificationSuiteIds,
    );
    if (resolvedRole === null) {
      throw new ManagedProviderHostError(
        "managed_command_unsupported",
        "The remote command role differs from the registered verification contract.",
      );
    }
    const continuationContext =
      command.action.continuation === undefined
        ? null
        : managedProviderContinuationContext(resolvedRole);
    const role = continuationContext?.role ?? resolvedRole;
    let expectedPaths: string[];
    try {
      if (input.approvedRepositoryPaths.length < 1 || input.approvedRepositoryPaths.length > 16)
        throw new Error("bounded paths required");
      expectedPaths = input.approvedRepositoryPaths.map(normalizeRepositoryPath);
      if (
        new Set(expectedPaths).size !== expectedPaths.length ||
        expectedPaths.some((path, index) => path !== input.approvedRepositoryPaths[index])
      )
        throw new Error("unique normalized paths required");
    } catch (error) {
      throw new ManagedProviderHostError(
        "managed_approval_scope_invalid",
        "The managed provider host executes only 1 to 16 normalized paths bound to signed approval.",
        { cause: error },
      );
    }

    let storage: ProjectStorage | undefined;
    let executionFailure: unknown;
    let result: { runId: string; completedAt: string } | undefined;
    try {
      storage = await this.openStorage(this.options.repositoryRoot);
      const actualTarget = {
        projectId: storage.manifest.projectId,
        projectIdentityHash: calculateProjectIdentityHash(storage.manifest),
      };
      if (
        !sameTarget(actualTarget, this.options.target) ||
        !sameTarget(command.target, actualTarget)
      ) {
        throw new ManagedProviderHostError(
          "managed_project_mismatch",
          "The managed provider host project identity differs from the remote command.",
        );
      }
      if (command.action.continuation !== undefined) {
        await this.verifyContinuation({
          repositoryRoot: storage.paths.repositoryRoot,
          continuation: command.action.continuation,
        });
      }
      const registry = await this.loadRegistry(storage.paths.repositoryRoot);
      const verification = await this.prepareVerification({
        repositoryRoot: storage.paths.repositoryRoot,
        suiteIds: command.action.verificationSuiteIds,
        artifactStore: storage.artifacts,
        now: this.now,
      });
      const resolvedSkills = await this.resolveSkills({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        provider: command.action.provider,
        role,
        generatedAt: this.now().toISOString(),
        ...(this.options.userSkillRoot === undefined
          ? {}
          : { userSkillRoot: this.options.userSkillRoot }),
      });
      const adapter = this.options.adapterFactory.create({
        provider: command.action.provider,
        repositoryRoot: storage.paths.repositoryRoot,
        resolveArtifact: (uri) => storage!.artifacts.get(uri),
      });
      if (adapter === null || adapter.descriptor.provider !== command.action.provider) {
        throw new ManagedProviderHostError(
          "managed_command_unsupported",
          "The configured provider adapter differs from the remote command provider.",
        );
      }
      const runId = this.createId("run");
      const sessionId = this.createId("ses");
      const coordinator = new ManagedProviderRunCoordinator({
        adapter,
        artifactStore: storage.artifacts,
        events: storage.events,
        coordinates: {
          projectId: storage.manifest.projectId,
          runId,
          sessionId,
          roleId: role.roleId,
        },
        policyVersion: digest(
          JSON.stringify({
            role,
            policySnapshotId: input.policyAuthorization.policySnapshotId,
          }),
        ),
        approvalVerifier: this.options.approvalVerifier,
        createEventId: () => this.createId("evt"),
        projectVerifier: verification.verifier,
        now: this.now,
      });
      const baselines = await captureHostOutcomeBaselines(
        storage.paths.repositoryRoot,
        expectedPaths,
      );
      const run = await coordinator.run({
        repositoryRoot: storage.paths.repositoryRoot,
        requestDigest: command.action.request.contentHash,
        risk: command.action.risk,
        instructions: input.request,
        // ADR-0608: a delegated request is the sender's text, never Lervo's.
        untrustedInstructions: [input.request],
        targetTurnId: this.createId("turn"),
        context: {
          registry,
          role,
          expectedPaths,
          documentRules: continuationContext?.documentRules ?? {},
          ...(continuationContext === null
            ? {}
            : { additionalCandidates: continuationContext.additionalCandidates }),
          publications: [],
          handoffs: [],
          recommendationBatches: [],
          createReceiptId: () => this.createId("ctx"),
        },
        writingPolicy: null,
        resolvedSkills,
        verificationSuites: verification.suites,
        createEnvelopeId: () => this.createId("envelope"),
        createEvidenceReceiptId: () => this.createId("ctx"),
        createTargetTurnId: () => this.createId("turn"),
        approvalAuthorization: input.policyAuthorization,
        ...(command.action.continuation === undefined
          ? {}
          : {
              workCausality: {
                relationship: "root" as const,
                workstreamId: command.action.continuation.workstreamId,
                assignmentId: command.action.continuation.assignmentId,
                agentId: command.action.continuation.agentId,
              },
            }),
      });
      const outcome = await observeHostContextOutcomes({
        repositoryRoot: storage.paths.repositoryRoot,
        origin: "managed_run",
        effects: "read_only",
        coordinates: { runId, sessionId },
        ...(this.options.outcomePolicy ? { policy: this.options.outcomePolicy } : {}),
        task: hostOutcomeTask(input.request, expectedPaths),
        artifacts: [
          ...run.managedChanges.map((change) => ({
            kind: "repository" as const,
            path: change.path,
            ...(change.afterHash ? { expectedDigest: change.afterHash } : {}),
            ...(baselines.has(change.path) ? { baselineBytes: baselines.get(change.path)! } : {}),
          })),
          {
            kind: "immutable",
            ...run.resultArtifact,
            readBytes: () => storage!.artifacts.get(run.resultArtifact.uri),
          },
        ],
      });
      if (!outcome.completionAllowed)
        throw new Error("Required remote-run outcome verification did not pass.");
      await this.verifyCompletion({
        repositoryRoot: storage.paths.repositoryRoot,
        continuation: command.action.continuation,
        run,
      });
      const completedAt = this.now().toISOString();
      if (!Number.isFinite(Date.parse(completedAt))) throw new Error("invalid host clock");
      result = { runId, completedAt };
    } catch (error) {
      executionFailure = error;
    }

    let cleanupFailure: unknown;
    if (storage !== undefined) {
      try {
        await storage.close();
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure !== undefined) {
      throw new ManagedProviderHostError(
        "managed_cleanup_failed",
        "Project storage could not be closed after the managed provider run.",
        {
          cause:
            executionFailure === undefined
              ? cleanupFailure
              : new AggregateError([executionFailure, cleanupFailure]),
        },
      );
    }
    if (executionFailure !== undefined) {
      if (executionFailure instanceof ManagedProviderHostError) throw executionFailure;
      throw new ManagedProviderHostError(
        "managed_execution_failed",
        "The managed provider run did not complete.",
        { cause: executionFailure },
      );
    }
    if (result === undefined) {
      throw new ManagedProviderHostError(
        "managed_execution_failed",
        "The managed provider run result is missing.",
      );
    }
    return result;
  }
}
