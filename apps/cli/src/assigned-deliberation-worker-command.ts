import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { inspectManagedDeliberation } from "./deliberation-inspection.js";
import type { RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "deliberation_failed";
}

export async function runAssignedDeliberationWorkerCommand(
  args: string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  let recoveryCoordinates:
    { repositoryRoot: string; deliberationId: string; expectedProjectId: string } | undefined;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        "deliberation-id": { type: "string" },
        "project-id": { type: "string" },
        root: { type: "string" },
        stdin: { type: "boolean" },
        "codex-executable": { type: "string" },
        "claude-executable": { type: "string" },
        "codex-model": { type: "string" },
        "claude-model": { type: "string" },
        "codex-reasoning-effort": { type: "string" },
        "claude-reasoning-effort": { type: "string" },
      },
    });
    if (parsed.values.stdin !== true || io.stdin === undefined) {
      throw new Error("Assigned deliberation input must be supplied through stdin.");
    }
    const deliberationId = parsed.values["deliberation-id"];
    const expectedProjectId = parsed.values["project-id"];
    if (
      deliberationId === undefined ||
      expectedProjectId === undefined ||
      !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(deliberationId) ||
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(expectedProjectId)
    ) {
      throw new Error("Assigned deliberation coordinates are invalid.");
    }
    const payload = JSON.parse(await io.stdin()) as {
      operation?: unknown;
      policyId?: unknown;
      topic?: unknown;
      responseLanguage?: unknown;
      executionMaximumElapsedMs?: unknown;
    };
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    recoveryCoordinates = { repositoryRoot, deliberationId, expectedProjectId };
    const providerExecutables = {
      ...(parsed.values["codex-executable"] === undefined
        ? {}
        : { codex: parsed.values["codex-executable"] }),
      ...(parsed.values["claude-executable"] === undefined
        ? {}
        : { claude: parsed.values["claude-executable"] }),
    };
    const providerModels = {
      ...(parsed.values["codex-model"] === undefined
        ? {}
        : { codex: parsed.values["codex-model"] }),
      ...(parsed.values["claude-model"] === undefined
        ? {}
        : { claude: parsed.values["claude-model"] }),
    };
    const providerReasoningEfforts = {
      ...(parsed.values["codex-reasoning-effort"] === undefined
        ? {}
        : { codex: parsed.values["codex-reasoning-effort"] }),
      ...(parsed.values["claude-reasoning-effort"] === undefined
        ? {}
        : { claude: parsed.values["claude-reasoning-effort"] }),
    } as Partial<Record<RunProvider, "low" | "medium" | "high" | "xhigh" | "max">>;
    const executionDeadlineIsValid =
      payload.executionMaximumElapsedMs === undefined ||
      (Number.isSafeInteger(payload.executionMaximumElapsedMs) &&
        Number(payload.executionMaximumElapsedMs) >= 1_000 &&
        Number(payload.executionMaximumElapsedMs) <= 3_600_000);
    const request =
      payload.operation === "resume" && executionDeadlineIsValid
        ? ({
            repositoryRoot,
            resumeDeliberationId: deliberationId,
            ...(typeof payload.executionMaximumElapsedMs === "number"
              ? { executionMaximumElapsedMs: payload.executionMaximumElapsedMs }
              : {}),
            ...(Object.keys(providerExecutables).length === 0 ? {} : { providerExecutables }),
            ...(Object.keys(providerModels).length === 0 ? {} : { providerModels }),
            ...(Object.keys(providerReasoningEfforts).length === 0
              ? {}
              : { providerReasoningEfforts }),
          } as const)
        : payload.operation === "start" &&
            typeof payload.policyId === "string" &&
            typeof payload.topic === "string" &&
            executionDeadlineIsValid &&
            (payload.responseLanguage === undefined ||
              ["en", "ko"].includes(String(payload.responseLanguage)))
          ? ({
              repositoryRoot,
              policyId: payload.policyId,
              topic: payload.topic,
              responseLanguage:
                payload.responseLanguage === "ko" ||
                (payload.responseLanguage === undefined && /\p{Script=Hangul}/u.test(payload.topic))
                  ? "ko"
                  : "en",
              ...(typeof payload.executionMaximumElapsedMs === "number"
                ? { executionMaximumElapsedMs: payload.executionMaximumElapsedMs }
                : {}),
              ...(Object.keys(providerExecutables).length === 0 ? {} : { providerExecutables }),
              ...(Object.keys(providerModels).length === 0 ? {} : { providerModels }),
              ...(Object.keys(providerReasoningEfforts).length === 0
                ? {}
                : { providerReasoningEfforts }),
            } as const)
          : null;
    if (request === null) throw new Error("Assigned deliberation payload is invalid.");
    const outcome = await services.executeAssignedManagedDeliberation({
      deliberationId,
      expectedProjectId,
      request,
    });
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        deliberationId: outcome.deliberationId,
        status: outcome.status,
        artifactCount: outcome.artifactCount,
      })}\n`,
    );
    return outcome.status === "converged" ? 0 : 2;
  } catch (error) {
    if (recoveryCoordinates !== undefined) {
      let storage;
      try {
        storage = await services.openProjectStorage(recoveryCoordinates.repositoryRoot);
        const report = await inspectManagedDeliberation({
          storage,
          deliberationId: recoveryCoordinates.deliberationId,
        });
        if (
          report.projectId === recoveryCoordinates.expectedProjectId &&
          report.sourceStatus === "consistent" &&
          report.phase === "completed" &&
          report.completionStatus === "failed"
        ) {
          io.stdout(
            `${JSON.stringify({
              schemaVersion: 1,
              deliberationId: recoveryCoordinates.deliberationId,
              status: "failed",
              artifactCount: report.artifactCount,
            })}\n`,
          );
          io.stderr(
            `${JSON.stringify({
              code: errorCode(error),
              message:
                error instanceof Error ? error.message : "Could not run assigned deliberation.",
            })}\n`,
          );
          return 2;
        }
      } catch {
        // Preserve the original worker failure when canonical terminal evidence is unavailable.
      } finally {
        await storage?.close().catch(() => undefined);
      }
    }
    io.stderr(
      `${JSON.stringify({
        code: errorCode(error),
        message: error instanceof Error ? error.message : "Could not run assigned deliberation.",
      })}\n`,
    );
    return 1;
  }
}
