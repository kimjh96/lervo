/**
 * The hosted-session adapter contract (ADR-0613, Lervo ADE sessions). A hosted session runs the
 * user's installed provider CLI under the user's own sign-in. The adapter turns a launch intent
 * into the process the session host runs, and declares what its provider supports, so the ADE
 * and the session host read capabilities instead of provider names.
 */

import { isAbsolute } from "node:path";

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
}

/** The process the session host runs. It never carries credentials. */
export interface HostedLaunch {
  readonly program: string;
  readonly arguments: readonly string[];
  /** Variables added to the session host's environment. Their values are never persisted. */
  readonly environment: Readonly<Record<string, string>>;
  readonly workingDirectory: string;
  readonly mode: HostedConversationMode;
  /**
   * Text the session host sends through the stream decoder once the process runs, such as the
   * first instruction of a native conversation. `null` when the arguments already carry it.
   */
  readonly initialInput: string | null;
}

/** One provider's hosted sessions. */
export interface HostedSessionAdapter {
  readonly provider: string;
  readonly capabilities: HostedSessionCapabilities;
  /** Throws `HostedLaunchError` for an intent the provider cannot run. */
  prepareLaunch(intent: HostedLaunchIntent): HostedLaunch;
}

export type HostedLaunchErrorCode =
  "conversation_mode_unsupported" | "resume_unsupported" | "launch_intent_invalid";

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
}

/** Environment names that carry credentials. A hosted launch never adds them (provider terms). */
const CREDENTIAL_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/iu;

/**
 * The common hosted-session checks. Each adapter's tests run them against its own launches; an
 * empty result means the adapter keeps the contract for those intents.
 */
export function evaluateHostedSessionContract(
  adapter: HostedSessionAdapter,
  workingDirectory: string,
): string[] {
  const violations: string[] = [];
  const sessionId = "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c";
  const instruction = "Fix the failing test and explain the cause.";
  const modes: HostedConversationMode[] = adapter.capabilities.nativeConversation
    ? ["native", "cli"]
    : ["cli"];
  for (const mode of modes) {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode,
      workingDirectory,
      start: { kind: "new", instruction },
    });
    const where = `${adapter.provider} ${mode}`;
    if (launch.mode !== mode) violations.push(`${where}: the launch changed the conversation mode`);
    if (launch.workingDirectory !== workingDirectory)
      violations.push(`${where}: the launch changed the working directory`);
    if (launch.program.length === 0) violations.push(`${where}: the launch names no program`);
    for (const name of Object.keys(launch.environment))
      if (CREDENTIAL_NAME.test(name))
        violations.push(`${where}: the launch adds the credential variable ${name}`);
    const delivered = launch.initialInput === instruction || launch.arguments.includes(instruction);
    if (!delivered) violations.push(`${where}: the launch does not deliver the instruction`);
    if (launch.initialInput !== null && launch.arguments.includes(instruction))
      violations.push(`${where}: the launch delivers the instruction twice`);
    if (adapter.capabilities.sessionIdBinding && !launch.arguments.includes(sessionId))
      violations.push(
        `${where}: sessionIdBinding is declared, but the launch omits the session ID`,
      );
  }
  for (const [mode, unsupported] of [
    ["native", !adapter.capabilities.nativeConversation],
    ["resume", !adapter.capabilities.resume],
  ] as const) {
    if (!unsupported) continue;
    try {
      adapter.prepareLaunch({
        sessionId,
        mode: mode === "native" ? "native" : "cli",
        workingDirectory,
        start: mode === "resume" ? { kind: "resume" } : { kind: "new", instruction },
      });
      violations.push(`${adapter.provider}: an undeclared ${mode} launch did not fail`);
    } catch (error) {
      if (!(error instanceof HostedLaunchError))
        violations.push(`${adapter.provider}: an undeclared ${mode} launch failed without a code`);
    }
  }
  return violations;
}
