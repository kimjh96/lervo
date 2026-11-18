import { spawn } from "node:child_process";

import { redactDiagnosticText } from "@lervo/event-contract";
import type {
  KnowledgeSupersessionEntry,
  KnowledgeSupersessionReconciliation,
} from "@lervo/repository-knowledge-runtime";
import { assertRepositoryReplicaSnapshot, type RepositoryReplicaSnapshot } from "@lervo/sync";

import type {
  RepositoryReplicaPeerPort,
  RepositoryReplicaReceipt,
} from "./repository-replica-coordinator.js";
import type { RepositoryReplicaSideSnapshot } from "./repository-replica-peer-port.js";
import {
  RepositoryReplicaPeerError,
  RepositoryReplicaStageError,
  parseRepositoryReplicaPeerFailure,
} from "./repository-replica-failure.js";
import { parseRepositoryReplicaCaptureVersion } from "./repository-replica-capture-compatibility.js";
import { LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION } from "./repository-replica-capture-version.js";
import { parseReplicaKnowledgeSupersession } from "./repository-replica-knowledge-supersession.js";

const MAXIMUM_SSH_OUTPUT_BYTES = 512 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
/** The usage line of every runtime before ADR-0483; newer runtimes list `capture-version` first. */
const LEGACY_USAGE = "Usage: lervo-node repository-replica <snapshot|";
const CAPTURE_VERSION_UNSUPPORTED = "repository_replica_capture_version_unsupported";

/**
 * Keeps the peer's structured failure when the remote command reported one; otherwise the SSH
 * transport itself failed and only its redacted stderr digest is known.
 */
function peerCommandFailure(
  action: string,
  exitCode: number | null,
  stderr: Buffer,
): RepositoryReplicaPeerError {
  const text = stderr.toString("utf8");
  // The raw stderr is checked because a runtime's uncaught usage error follows a long source line.
  if (action === "capture-version" && exitCode === 1 && text.includes(LEGACY_USAGE))
    return new RepositoryReplicaPeerError(
      {
        code: CAPTURE_VERSION_UNSUPPORTED,
        stage: "protocol",
        gitExitCode: null,
        stderrDigest: null,
        causeChain: ["The peer runtime predates the capture-version action."],
      },
      "The peer repository replica runtime predates the capture-version action.",
    );
  const reported = parseRepositoryReplicaPeerFailure(text);
  if (reported !== null)
    return new RepositoryReplicaPeerError(
      reported,
      `The peer repository replica ${action} failed with ${reported.code}.`,
    );
  const digest = redactDiagnosticText(text);
  return new RepositoryReplicaPeerError(
    {
      code: "repository_replica_transfer_failed",
      stage: "transfer",
      gitExitCode: null,
      stderrDigest: digest.length === 0 ? null : digest,
      causeChain: [`SSH ${action} exited with ${exitCode ?? "a signal"}.`],
    },
    `Repository replica SSH ${action} failed (${exitCode ?? "signal"}).`,
  );
}

export class SshRepositoryReplicaPeer implements RepositoryReplicaPeerPort {
  constructor(
    private readonly options: {
      executable: string;
      arguments: readonly string[];
      destination: string;
      remoteNodeExecutable: string;
      remoteRuntimeExecutable: string;
      remoteCommandPrefix?: readonly string[];
      commandTimeoutMs?: number;
    },
  ) {}

  private command(args: readonly string[], hasInput: boolean): string[] {
    return [
      ...this.options.arguments,
      ...(hasInput ? [] : ["-n"]),
      this.options.destination,
      ...(this.options.remoteCommandPrefix ?? []),
      this.options.remoteNodeExecutable,
      this.options.remoteRuntimeExecutable,
      "repository-replica",
      ...args,
    ];
  }

  private execute(args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const hasInput = input !== undefined;
      const child = spawn(this.options.executable, this.command(args, hasInput), {
        stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(
          new RepositoryReplicaStageError(
            "repository_replica_transfer_timeout",
            "transfer",
            "Repository replica SSH command exceeded its execution deadline.",
          ),
        );
      }, this.options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      timeout.unref();
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAXIMUM_SSH_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          fail(
            new RepositoryReplicaStageError(
              "repository_replica_transfer_failed",
              "transfer",
              "Repository replica SSH output exceeded its bound.",
            ),
          );
          return;
        }
        target.push(chunk);
      };
      child.stdout!.on("data", collect(stdout));
      child.stderr!.on("data", collect(stderr));
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") fail(error);
      });
      child.once("error", fail);
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(peerCommandFailure(args[0] ?? "command", code, Buffer.concat(stderr)));
          return;
        }
        resolve(new Uint8Array(Buffer.concat(stdout)));
      });
      child.stdin?.end(input);
    });
  }

  subscribe(repositoryRoot: string, changed: () => void, failed: () => void): () => void {
    const child = spawn(
      this.options.executable,
      this.command(["watch", "--root", repositoryRoot], false),
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let pending = "";
    let stopped = false;
    let watchdog: ReturnType<typeof setTimeout>;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(watchdog);
      child.kill("SIGTERM");
    };
    const failure = () => {
      if (!stopped) {
        stop();
        failed();
      }
    };
    watchdog = setTimeout(failure, 75_000);
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      if (pending.length > 1_024) {
        failure();
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line !== '{"schemaVersion":1,"status":"changed"}') {
          failure();
          return;
        }
        if (!stopped) {
          clearTimeout(watchdog);
          watchdog = setTimeout(failure, 75_000);
          changed();
        }
      }
    });
    child.once("error", failure);
    child.once("close", failure);
    return stop;
  }

  /**
   * ADR-0483: the remote runtime's capture semantics. A runtime that predates the action rejects
   * it with its usage line, which lists no `capture-version`; it captures with the legacy
   * semantics. Any other failure stays a transport failure.
   */
  async captureVersion(): Promise<string> {
    try {
      return parseRepositoryReplicaCaptureVersion(
        JSON.parse(Buffer.from(await this.execute(["capture-version"])).toString("utf8")),
      );
    } catch (error) {
      if (error instanceof RepositoryReplicaPeerError && error.code === CAPTURE_VERSION_UNSUPPORTED)
        return LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION;
      throw error;
    }
  }

  /**
   * The peer's snapshot and its own host's owner hold (ADR-0561). A peer runtime that predates
   * the hold reports none, and the coordinator then counts the peer as held.
   */
  async snapshot(repositoryRoot: string): Promise<RepositoryReplicaSideSnapshot> {
    const output = await this.execute(["snapshot", "--root", repositoryRoot]);
    const snapshot = JSON.parse(
      Buffer.from(output).toString("utf8"),
    ) as RepositoryReplicaSideSnapshot;
    assertRepositoryReplicaSnapshot(snapshot);
    const { ownerHold, ...observed } = snapshot;
    return { ...observed, ...(typeof ownerHold === "boolean" ? { ownerHold } : {}) };
  }

  bundle(repositoryRoot: string, expectedSnapshotHash: string): Promise<Uint8Array> {
    return this.execute(["bundle", "--root", repositoryRoot, "--expected", expectedSnapshotHash]);
  }

  async apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    allowHistoryReplacement?: boolean;
  }): Promise<RepositoryReplicaSnapshot> {
    const output = await this.execute(
      [
        input.allowHistoryReplacement === true ? "adopt" : "apply",
        "--root",
        input.repositoryRoot,
        "--expected",
        input.expectedCurrentSnapshotHash,
      ],
      input.bundle,
    );
    const snapshot = JSON.parse(Buffer.from(output).toString("utf8")) as RepositoryReplicaSnapshot;
    assertRepositoryReplicaSnapshot(snapshot);
    return snapshot;
  }

  async reconcileKnowledgeSupersession(input: {
    repositoryRoot: string;
    entries: readonly KnowledgeSupersessionEntry[];
  }): Promise<KnowledgeSupersessionReconciliation> {
    const output = await this.execute(
      ["knowledge-supersession", "--root", input.repositoryRoot],
      Buffer.from(`${JSON.stringify({ entries: input.entries })}\n`, "utf8"),
    );
    return parseReplicaKnowledgeSupersession(JSON.parse(Buffer.from(output).toString("utf8")));
  }

  /**
   * ADR-0561: saves this peer's own side to a backup branch in the peer's repository, the host
   * the undo restores it on. A peer runtime that predates the action fails, and the coordinator
   * then holds the conflict instead of changing either side.
   */
  async backup(input: {
    repositoryRoot: string;
    branch: string;
    bundle: Uint8Array | null;
    expectedSnapshotHash: string;
  }): Promise<{ branch: string; snapshotHash: string }> {
    if (input.bundle !== null)
      throw new Error("A peer saves only its own side; its backup takes no bundle.");
    const output = await this.execute([
      "backup",
      "--root",
      input.repositoryRoot,
      "--branch",
      input.branch,
      "--expected",
      input.expectedSnapshotHash,
    ]);
    const saved = JSON.parse(Buffer.from(output).toString("utf8")) as {
      branch?: unknown;
      snapshotHash?: unknown;
    };
    if (typeof saved.branch !== "string" || typeof saved.snapshotHash !== "string")
      throw new Error("The peer returned an invalid replica backup.");
    return { branch: saved.branch, snapshotHash: saved.snapshotHash };
  }

  /** ADR-0561 undo: puts a saved backup branch back into the peer's repository. */
  async restoreBackup(input: {
    repositoryRoot: string;
    branch: string;
  }): Promise<RepositoryReplicaSnapshot> {
    const output = await this.execute([
      "restore-backup",
      "--root",
      input.repositoryRoot,
      "--branch",
      input.branch,
    ]);
    const snapshot = JSON.parse(Buffer.from(output).toString("utf8")) as RepositoryReplicaSnapshot;
    assertRepositoryReplicaSnapshot(snapshot);
    return snapshot;
  }

  async recordReceipt(input: RepositoryReplicaReceipt): Promise<void> {
    await this.execute(
      ["receipt", "--root", input.repositoryRoot],
      Buffer.from(`${JSON.stringify(input)}\n`, "utf8"),
    );
  }
}
