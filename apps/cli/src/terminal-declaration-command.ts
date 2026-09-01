import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type TerminalTurnDeclaredEventPayload } from "@lervo/schemas";
import {
  assessCanonicalization,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { terminalUsage } from "./terminal-command-usage.js";
import {
  allTerminalEvents,
  newTerminalIdentifier,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import { readPreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import { terminalDeliberationDeclarationMatches } from "./terminal-turn-observation.js";
import type { CliIo } from "./types.js";

function parseTurnDeclarationDraft(
  value: string,
): Pick<
  TerminalTurnDeclaredEventPayload,
  | "taskMode"
  | "canonicalizationDisposition"
  | "knowledgeDisposition"
  | "deliberationDisposition"
  | "deliberationId"
> {
  if (Buffer.byteLength(value) > 16 * 1024)
    throw new Error("The terminal turn declaration exceeds 16 KiB.");
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const allowed = new Set([
    "taskMode",
    "canonicalizationDisposition",
    "knowledgeDisposition",
    "deliberationDisposition",
    "deliberationId",
  ]);
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some((key) => !allowed.has(key))
  )
    throw new Error("The terminal turn declaration contains unsupported fields.");
  const taskModes = ["inquiry", "change", "review", "continuation", "approval_response"] as const;
  const canonicalization = [
    "not_applicable_read_only",
    "canonical_sources_current",
    "canonical_sources_updated",
    "pending_user_approval",
  ] as const;
  const knowledge = [
    "not_applicable_read_only",
    "current",
    "refreshed",
    "pending_user_approval",
  ] as const;
  const deliberation = ["not_requested", "completed", "no_consensus", "failed"] as const;
  if (!taskModes.includes(parsed.taskMode as (typeof taskModes)[number]))
    throw new Error("The terminal taskMode is invalid.");
  if (
    !canonicalization.includes(
      parsed.canonicalizationDisposition as (typeof canonicalization)[number],
    )
  )
    throw new Error("The canonicalizationDisposition is invalid.");
  if (!knowledge.includes(parsed.knowledgeDisposition as (typeof knowledge)[number]))
    throw new Error("The knowledgeDisposition is invalid.");
  if (!deliberation.includes(parsed.deliberationDisposition as (typeof deliberation)[number]))
    throw new Error("The deliberationDisposition is invalid.");
  if (
    parsed.deliberationId !== null &&
    (typeof parsed.deliberationId !== "string" ||
      !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(parsed.deliberationId))
  )
    throw new Error("The deliberationId is invalid.");
  return parsed as ReturnType<typeof parseTurnDeclarationDraft>;
}

export async function runTerminalDeclareCommand(args: string[], io: CliIo): Promise<number> {
  let storage: ProjectStorage | undefined;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        provider: { type: "string" },
        observation: { type: "string" },
        stdin: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
      throw new Error("--provider must be codex or claude.");
    const provider: TerminalIntegrationProvider = parsed.values.provider;
    if (
      typeof parsed.values.observation !== "string" ||
      !/^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(parsed.values.observation)
    )
      throw new Error("--observation is invalid.");
    if (!parsed.values.stdin || io.stdin === undefined)
      throw new Error("The declaration must be supplied through --stdin.");
    const draft = parseTurnDeclarationDraft(await io.stdin());
    const root = await resolveTerminalRepositoryRoot(resolve(io.cwd, parsed.values.root ?? "."));
    storage = await openProjectStorage(root);
    const context = allTerminalEvents(storage.events)
      .filter(
        (event) =>
          event.type === "terminal.context.prepared" &&
          event.actor.kind === "provider" &&
          event.actor.provider === parsed.values.provider &&
          event.payload.observationId === parsed.values.observation,
      )
      .at(-1);
    if (context === undefined) throw new Error("No matching prepared terminal observation exists.");
    const contextRevision = context.payload.repositoryRevision;
    if (typeof contextRevision !== "string")
      throw new Error("The prepared terminal observation has no repository revision.");
    const repository = await captureRepositorySnapshot(root);
    const repositoryChanged = contextRevision !== repository.revision;
    if (repositoryChanged && draft.taskMode === "inquiry")
      throw new Error("An inquiry declaration cannot bind changed repository bytes.");
    if (
      repositoryChanged &&
      (draft.canonicalizationDisposition === "not_applicable_read_only" ||
        draft.knowledgeDisposition === "not_applicable_read_only")
    )
      throw new Error(
        "A repository-changing turn requires canonicalization and knowledge dispositions.",
      );
    if (
      !repositoryChanged &&
      (draft.canonicalizationDisposition !== "not_applicable_read_only" ||
        draft.knowledgeDisposition !== "not_applicable_read_only")
    )
      throw new Error(
        "An unchanged turn must use read-only canonicalization and knowledge dispositions.",
      );
    const preparedSnapshot = await readPreparedRepositorySnapshot(root, parsed.values.observation);
    const canonicalizationAssessment =
      repositoryChanged && preparedSnapshot !== null
        ? await assessCanonicalization({
            repositoryRoot: root,
            beforeRevision: preparedSnapshot.revision,
            afterRevision: repository.revision,
            beforeFiles: preparedSnapshot.files,
            afterFiles: repository.files,
            disposition:
              draft.canonicalizationDisposition === "not_applicable_read_only"
                ? "canonical_sources_current"
                : draft.canonicalizationDisposition,
            now: new Date(),
          })
        : null;
    const occurredAt = new Date().toISOString();
    const payload: TerminalTurnDeclaredEventPayload = {
      declarationId: newTerminalIdentifier("tdecl"),
      contextEventId: context.eventId,
      repositoryRevision: repository.revision,
      ...draft,
      declaredAt: occurredAt,
    };
    const validation = validateSchema("terminalTurnDeclaredEventPayload", payload);
    if (!validation.valid)
      throw new Error("The terminal turn declaration does not satisfy the bounded contract.");
    if (!terminalDeliberationDeclarationMatches(storage.events, payload))
      throw new Error(
        "The declared deliberation result is not bound to a matching completed deliberation event.",
      );
    const providerSessionDigest = context.payload.providerSessionDigest;
    const providerTurnDigest = context.payload.providerTurnDigest;
    if (
      typeof providerSessionDigest !== "string" ||
      (providerTurnDigest !== null && typeof providerTurnDigest !== "string")
    )
      throw new Error("The prepared provider coordinates are invalid.");
    const recorded = storage.events.append(
      terminalEventDraft({
        projectId: storage.manifest.projectId,
        coordinates: {
          runId: context.runId,
          sessionId: context.sessionId,
          providerSessionDigest,
          providerTurnDigest,
        },
        provider,
        actorKind: "agent",
        type: "terminal.turn.declared",
        occurredAt,
        payload,
      }),
    );
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, status: "declared", eventId: recorded.event.eventId, canonicalizationAssessment, ...payload }, null, 2)}\n`
        : `Terminal turn disposition declared.\nobservation: ${parsed.values.observation}\nrepositoryRevision: ${repository.revision}\ncanonicalization: ${canonicalizationAssessment?.status ?? "not_applicable"}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
    return 1;
  } finally {
    await storage?.close();
  }
}
