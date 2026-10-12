import { runNodeRuntimeCli } from "./cli.js";
import { runKnowledgeWorkerCli } from "./knowledge-worker-cli.js";
import { runConversationSnapshotCli } from "./conversation-snapshot-cli.js";
import { runDiscordWorkforceReconciliationCli } from "./discord-workforce-reconciliation-cli.js";
import { runRepositoryReplicaCli } from "./repository-replica-cli.js";
import { runLocalSupervisionCli } from "./local-supervision-cli.js";
import { runAbandonedTurnRecoveryCli } from "./supervision-abandoned-turn-recovery-cli.js";
import { runPreTurnRecoveryCli } from "./supervision-pre-turn-recovery-cli.js";
import { runInterruptedOwnerRecoveryCli } from "./supervision-interrupted-owner-recovery-cli.js";

export async function runNodeRuntimeEntry(args: string[], entrypoint: string): Promise<number> {
  if (args[0] === "knowledge-worker") {
    return await runKnowledgeWorkerCli(args.slice(1));
  } else if (args[0] === "conversation-snapshot") {
    return await runConversationSnapshotCli(args.slice(1));
  } else if (args[0] === "recover-abandoned-turn") {
    return await runAbandonedTurnRecoveryCli(args.slice(1), {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  } else if (args[0] === "recover-pre-turn") {
    return await runPreTurnRecoveryCli(args.slice(1), {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  } else if (args[0] === "reconcile-interrupted-owner") {
    return await runInterruptedOwnerRecoveryCli(args.slice(1), {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  } else if (args[0] === "supervise") {
    return await runLocalSupervisionCli(args.slice(1), {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  } else if (args[0] === "discord-workforce-reconcile") {
    return await runDiscordWorkforceReconciliationCli(args.slice(1), {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
    });
  } else if (args[0] === "repository-replica") {
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      return await runRepositoryReplicaCli(args.slice(1), {
        cwd: process.cwd(),
        stdinBytes: async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
          return new Uint8Array(Buffer.concat(chunks));
        },
        stdout: (message) => process.stdout.write(message),
        stdoutBytes: (bytes) => process.stdout.write(bytes),
        stderr: (message) => process.stderr.write(message),
        signal: abort.signal,
      });
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  } else {
    return await runNodeRuntimeCli(args, {
      knowledgeWorkerEntry: entrypoint,
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
    });
  }
}
