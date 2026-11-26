/**
 * The hosted-session adapter contract (ADR-0613, Lervo ADE sessions). A hosted session runs the
 * user's installed provider CLI under the user's own sign-in. The adapter turns a launch intent
 * into the process the session host runs, and declares what its provider supports, so the ADE
 * and the session host read capabilities instead of provider names.
 */

import { isAbsolute } from "node:path";

import { type HostedSessionHooks, hostedSessionHooksProblem } from "./hosted-session-hooks.js";

/** How the user sees a hosted session. */
export type HostedConversationMode = "native" | "cli";

/** What a hosted-session adapter supports. Each value is a claim the common checks hold. */
export interface HostedSessionCapabilities {
  /** The CLI runs with structured streams that the ADE renders. */
  readonly nativeConversation: boolean;
  /** Lervo chooses the provider's session ID before launch, so hooks bind to it. */
  readonly sessionIdBinding: boolean;
  /** A session-scoped settings file can add Lervo's hook handlers. */
  readonly hooks: boolean;
  /** A session-scoped MCP configuration can add Lervo's MCP server. */
  readonly mcp: boolean;
  /** A file of role instructions can be appended to the system prompt. */
  readonly systemPromptFile: boolean;
  /** A session can continue later from its session ID. */
  readonly resume: boolean;
  /**
   * A session can run with read access: it reads, searches, and answers, and the provider refuses
   * every tool that would change the worktree (Lervo ADE rooms, "Participants and their sessions").
   */
  readonly readAccess: boolean;
  /**
   * The native conversation can carry the agent's questions with choices and the person's answers,
   * through a stream decoder that answers questions.
   */
  readonly questions: boolean;
}

/** What a hosted session may do in its worktree: the lead writes, a joined participant reads. */
export type HostedSessionAccess = "write" | "read";

/**
 * The conversation a hosted session uses when the user asks for none: the native conversation
 * when the provider offers it, otherwise the provider's own terminal interface (Lervo ADE
 * sessions, "Conversation modes").
 */
export function preferredConversationMode(
  capabilities: HostedSessionCapabilities,
): HostedConversationMode {
  return capabilities.nativeConversation ? "native" : "cli";
}

/**
 * The conversation modes a provider offers, the preferred one first: the native conversation
 * only with `nativeConversation`, and the provider's own terminal interface always.
 */
export function hostedConversationModes(
  capabilities: HostedSessionCapabilities,
): HostedConversationMode[] {
  return capabilities.nativeConversation ? ["native", "cli"] : ["cli"];
}

/** What Lervo asks for. The session ID is a lowercase UUID that Lervo generated. */
export interface HostedLaunchIntent {
  readonly sessionId: string;
  readonly mode: HostedConversationMode;
  readonly workingDirectory: string;
  readonly start:
    { readonly kind: "new"; readonly instruction: string } | { readonly kind: "resume" };
  /** The model that Lervo's model selection chose for the role, when it chose one. */
  readonly model?: string;
  /** How much the model works before it answers, when Lervo chose it (ADR-0647). */
  readonly effort?: HostedEffort;
  /** Lervo's hook handler, for an adapter that declares `hooks`. */
  readonly hooks?: HostedSessionHooks;
  /** `write` when absent. `read` needs an adapter that declares `readAccess`. */
  readonly access?: HostedSessionAccess;
  /**
   * Whether the person answers the agent's questions with choices in the interface, so the
   * provider asks through its stream rather than in prose. Needs an adapter that declares
   * `questions` and a native conversation.
   */
  readonly questions?: boolean;
}

/** The process the session host runs. It never carries credentials. */
export interface HostedLaunch {
  readonly program: string;
  readonly arguments: readonly string[];
  /** Variables added to the session host's environment. Their values are never persisted. */
  readonly environment: Readonly<Record<string, string>>;
  /**
   * Variables the session host must not pass on from its own environment, such as the markers
   * of an agent session that started Lervo. Without this, a provider started from inside its own
   * agent's session would take itself for that session's child.
   */
  readonly environmentRemove: readonly string[];
  readonly workingDirectory: string;
  readonly mode: HostedConversationMode;
  /**
   * Text the session host sends through the stream decoder once the process runs, such as the
   * first instruction of a native conversation. `null` when the arguments already carry it.
   */
  readonly initialInput: string | null;
  /**
   * The session-scoped settings file at the intent's `settingsPath`, which Lervo writes before
   * the launch returns, or null without hooks. It adds to the user's settings and never replaces
   * a file the user owns.
   */
  readonly settingsFile: { readonly path: string; readonly content: string } | null;
}

/** One provider's hosted sessions. */
/**
 * The tiers of a provider's line-up an agent can run on (ADR-0647): its most capable model, a
 * strong one, a balanced one, and a fast one.
 */
export type HostedModelTier = "frontier" | "strong" | "balanced" | "fast";

/** How much the model works before it answers, lowest first. */
export type HostedEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** The provider's model for each tier, with the name the interface shows for it. */
export type HostedModels = Readonly<
  Record<HostedModelTier, { readonly model: string; readonly displayName: string }>
>;

export interface HostedSessionAdapter {
  readonly provider: string;
  /**
   * The provider's product name, such as "Claude Code": a proper noun that interfaces show as
   * given, without translation.
   */
  readonly displayName: string;
  readonly capabilities: HostedSessionCapabilities;
  /**
   * The provider's model for each tier, which an agent's model and effort choose from. Absent when
   * the provider cannot be told which model to run, and its own default runs.
   */
  readonly models?: HostedModels;
  /** Throws `HostedLaunchError` for an intent the provider cannot run. */
  prepareLaunch(intent: HostedLaunchIntent): HostedLaunch;
  /**
   * Whether someone is signed in to the provider CLI: `true`, `false`, or `null` when the adapter
   * cannot tell (Lervo ADE projects, "Provider sign-in"). It reads only that one fact and never
   * the account's details, finishes within a few seconds, and never throws. An adapter without it
   * reports nothing, which callers treat as `null`.
   */
  signInState?(environment?: NodeJS.ProcessEnv): Promise<boolean | null>;
}

export type HostedLaunchErrorCode =
  | "conversation_mode_unsupported"
  | "resume_unsupported"
  | "access_unsupported"
  | "launch_intent_invalid";

/** A launch intent the adapter refuses, with a stable code. */
export class HostedLaunchError extends Error {
  constructor(
    readonly code: HostedLaunchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostedLaunchError";
  }
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_INSTRUCTION_CHARACTERS = 65_536;

/** Rejects an intent no adapter may run. Adapters call it before they build a launch. */
export function assertHostedLaunchIntent(
  intent: HostedLaunchIntent,
  capabilities: HostedSessionCapabilities,
): void {
  if (!SESSION_ID.test(intent.sessionId))
    throw new HostedLaunchError(
      "launch_intent_invalid",
      "The session ID must be a lowercase UUID.",
    );
  if (!isAbsolute(intent.workingDirectory))
    throw new HostedLaunchError(
      "launch_intent_invalid",
      "The working directory must be an absolute path.",
    );
  if (
    intent.start.kind === "new" &&
    (intent.start.instruction.trim().length === 0 ||
      intent.start.instruction.length > MAX_INSTRUCTION_CHARACTERS)
  )
    throw new HostedLaunchError(
      "launch_intent_invalid",
      `The instruction must have 1 to ${MAX_INSTRUCTION_CHARACTERS} characters.`,
    );
  if (intent.mode === "native" && !capabilities.nativeConversation)
    throw new HostedLaunchError(
      "conversation_mode_unsupported",
      "This provider offers only the CLI conversation.",
    );
  if (intent.start.kind === "resume" && !capabilities.resume)
    throw new HostedLaunchError("resume_unsupported", "This provider cannot resume a session.");
  if (intent.questions === true && !(capabilities.questions && intent.mode === "native"))
    throw new HostedLaunchError(
      "launch_intent_invalid",
      "This provider cannot ask questions with choices in this conversation.",
    );
  if (intent.access === "read" && !capabilities.readAccess)
    throw new HostedLaunchError(
      "access_unsupported",
      "This provider cannot run a session with read access.",
    );
  if (intent.hooks !== undefined) {
    if (!capabilities.hooks)
      throw new HostedLaunchError(
        "launch_intent_invalid",
        "This provider cannot add Lervo's hook handlers.",
      );
    const problem = hostedSessionHooksProblem(intent.hooks);
    if (problem !== null) throw new HostedLaunchError("launch_intent_invalid", problem);
  }
}
