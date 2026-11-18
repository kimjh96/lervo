import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type TerminalTurnDeclaredEventPayload } from "@lervo/schemas";
import {
  assessCanonicalization,
  parseCanonicalizationOutcome,
  type CanonicalizationOutcome,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { terminalUsage } from "./terminal-command-usage.js";
import {
  latestTerminalEventOfType,
  newTerminalIdentifier,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import { inspectTerminalRepositoryKnowledgeLifecycle } from "./terminal-knowledge-lifecycle-inspection.js";
import { readPreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import { terminalDeliberationDeclarationMatches } from "./terminal-turn-observation.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import type { CliIo } from "./types.js";

type TerminalTurnDeclarationDraft = Pick<
  TerminalTurnDeclaredEventPayload,
  | "taskMode"
  | "canonicalizationDisposition"
  | "knowledgeDisposition"
  | "deliberationDisposition"
  | "deliberationId"
> & { canonicalizationOutcome: CanonicalizationOutcome | null };

const PENDING_USER_APPROVAL_REMOVED =
  "pending_user_approval was removed: no change waits for the owner. Write the canonical change yourself and declare canonical_sources_updated with a canonical_update outcome, or canonical_sources_current. Declare knowledgeDisposition current or refreshed, or pending_background when knowledge lifecycle work remains for Lervo's background reviewer. Git undoes any change.";

function parseTurnDeclarationDraft(value: string): TerminalTurnDeclarationDraft {
  if (Buffer.byteLength(value) > 16 * 1024)
    throw new Error("The terminal turn declaration exceeds 16 KiB.");
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const allowed = new Set([
    "taskMode",
    "canonicalizationDisposition",
    "canonicalizationOutcome",
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
  // ADR-0561: nothing waits for the owner, so a new declaration cannot claim
  // `pending_user_approval`. The value stays in the event schema only so stored declarations parse.
  if (
    parsed.canonicalizationDisposition === "pending_user_approval" ||
    parsed.knowledgeDisposition === "pending_user_approval"
  )
    throw new Error(PENDING_USER_APPROVAL_REMOVED);
  const canonicalization = [
    "not_applicable_read_only",
    "canonical_sources_current",
    "canonical_sources_updated",
  ] as const;
  const knowledge = [
    "not_applicable_read_only",
    "current",
    "refreshed",
    "pending_background",
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
  const canonicalizationOutcome =
    parsed.canonicalizationOutcome === null
      ? null
      : parseCanonicalizationOutcome(parsed.canonicalizationOutcome);
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
  return {
    ...(parsed as Omit<TerminalTurnDeclarationDraft, "canonicalizationOutcome">),
    canonicalizationOutcome,
  };
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
    const context = latestTerminalEventOfType(
      storage.events,
      "terminal.context.prepared",
      (event) =>
        event.actor.kind === "provider" &&
        event.actor.provider === parsed.values.provider &&
        event.payload.observationId === parsed.values.observation,
    );
    if (context === undefined) throw new Error("No matching prepared terminal observation exists.");
    const contextRevision = context.payload.repositoryRevision;
    if (typeof contextRevision !== "string")
      throw new Error("The prepared terminal observation has no repository revision.");
    const repository = await captureTerminalRepositorySnapshot(root);
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
    if (repositoryChanged && draft.canonicalizationOutcome === null)
      throw new Error("A repository-changing turn requires a canonicalizationOutcome.");
    if (!repositoryChanged && draft.canonicalizationOutcome !== null)
      throw new Error("An unchanged turn must use a null canonicalizationOutcome.");
    const preparedSnapshot = await readPreparedRepositorySnapshot(root, parsed.values.observation);
    const supplementalSources = repositoryChanged ? await collectLocalKnowledgeSources(root) : [];
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
            ...(draft.canonicalizationOutcome === null
              ? {}
              : { outcome: draft.canonicalizationOutcome }),
            now: new Date(),
          })
        : null;
    const knowledgeLifecycleIssues = repositoryChanged
      ? await inspectTerminalRepositoryKnowledgeLifecycle({
          root,
          repositoryRevision: repository.revision,
          supplementalSources,
          materialization: foregroundKnowledgeMaterializationSettlement({
            repositoryRoot: root,
            io,
          }),
        })
      : [];
    // ADR-0561: `pending_background` claims that lifecycle work remains for Lervo's background
    // reviewer, which applies it after its own cross-check; nothing waits for the owner.
    if (
      repositoryChanged &&
      draft.knowledgeDisposition !== "pending_background" &&
      knowledgeLifecycleIssues.length > 0
    ) {
      throw new Error(
        `The declared knowledge disposition is not supported by the current repository lifecycle: ${knowledgeLifecycleIssues
          .map((issue) => issue.code)
          .join(", ")}.`,
      );
    }
    const occurredAt = new Date().toISOString();
    const { canonicalizationOutcome: _canonicalizationOutcome, ...eventDraft } = draft;
    const payload: TerminalTurnDeclaredEventPayload = {
      declarationId: newTerminalIdentifier("tdecl"),
      contextEventId: context.eventId,
      repositoryRevision: repository.revision,
      ...eventDraft,
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
    const terminalDraft = terminalEventDraft({
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
    });
    const recorded = storage.events.append(terminalDraft);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, status: "declared", eventId: recorded.event.eventId, canonicalizationAssessment, knowledgeLifecycleIssues, ...payload }, null, 2)}\n`
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
