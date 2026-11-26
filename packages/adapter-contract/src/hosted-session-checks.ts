// The common hosted-session checks (ADR-0613): each adapter's tests run them against its own
// launches, so every provider keeps the same launch contract without the contract naming one.
import { hasStreamDecoder } from "./hosted-conversation.js";
import {
  HostedLaunchError,
  type HostedSessionAdapter,
  hostedConversationModes,
  preferredConversationMode,
} from "./hosted-session.js";

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
  const name = adapter.displayName;
  if (name.length === 0 || name.length > 64 || name.trim() !== name)
    violations.push(
      `${adapter.provider}: the display name must be 1 to 64 characters without outer spaces`,
    );
  const modes = hostedConversationModes(adapter.capabilities);
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
  violations.push(...hookViolations(adapter, workingDirectory, sessionId, instruction));
  if (adapter.capabilities.nativeConversation !== hasStreamDecoder(adapter))
    violations.push(
      `${adapter.provider}: nativeConversation and a stream decoder must come together`,
    );
  if (hasStreamDecoder(adapter)) {
    const sent = adapter.createStreamDecoder().send(instruction);
    if (sent.input.length === 0)
      violations.push(`${adapter.provider}: the decoder sends no bytes for the user's text`);
    const shown = sent.events.some(
      (event) =>
        event.kind === "item" &&
        event.content.kind === "user_message" &&
        event.content.text === instruction,
    );
    if (!shown) violations.push(`${adapter.provider}: the decoder does not show the user's text`);
  }
  violations.push(...readAccessViolations(adapter, workingDirectory, sessionId, instruction));
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

/**
 * A read-access launch differs from the write launch of the same intent, so the provider is told
 * to refuse changes; an adapter that does not declare `readAccess` refuses it with a code.
 */
function readAccessViolations(
  adapter: HostedSessionAdapter,
  workingDirectory: string,
  sessionId: string,
  instruction: string,
): string[] {
  const mode = preferredConversationMode(adapter.capabilities);
  const intent = {
    sessionId,
    mode,
    workingDirectory,
    start: { kind: "new", instruction },
  } as const;
  if (!adapter.capabilities.readAccess) {
    try {
      adapter.prepareLaunch({ ...intent, access: "read" });
      return [`${adapter.provider}: an undeclared read-access launch did not fail`];
    } catch (error) {
      return error instanceof HostedLaunchError && error.code === "access_unsupported"
        ? []
        : [`${adapter.provider}: an undeclared read-access launch failed without its code`];
    }
  }
  const write = adapter.prepareLaunch(intent);
  const read = adapter.prepareLaunch({ ...intent, access: "read" });
  return JSON.stringify(read.arguments) === JSON.stringify(write.arguments)
    ? [`${adapter.provider}: readAccess is declared, but a read launch is the write launch`]
    : [];
}

/**
 * A launch carries a settings file only for an adapter that declares `hooks`, at the path Lervo
 * chose, with the hook command in it; an undeclared adapter refuses hooks with a code.
 */
function hookViolations(
  adapter: HostedSessionAdapter,
  workingDirectory: string,
  sessionId: string,
  instruction: string,
): string[] {
  const violations: string[] = [];
  const hooks = {
    settingsPath: `${workingDirectory}/.hosted-settings.json`,
    command: "lervo hook",
  };
  const plain = adapter.prepareLaunch({
    sessionId,
    mode: preferredConversationMode(adapter.capabilities),
    workingDirectory,
    start: { kind: "new", instruction },
  });
  if (plain.settingsFile !== null)
    violations.push(`${adapter.provider}: a launch without hooks carries a settings file`);
  const intent = {
    sessionId,
    mode: preferredConversationMode(adapter.capabilities),
    workingDirectory,
    start: { kind: "new" as const, instruction },
    hooks,
  };
  if (!adapter.capabilities.hooks) {
    try {
      adapter.prepareLaunch(intent);
      violations.push(`${adapter.provider}: undeclared hooks did not fail`);
    } catch (error) {
      if (!(error instanceof HostedLaunchError))
        violations.push(`${adapter.provider}: undeclared hooks failed without a code`);
    }
    return violations;
  }
  for (const mode of hostedConversationModes(adapter.capabilities)) {
    const launch = adapter.prepareLaunch({ ...intent, mode });
    const where = `${adapter.provider} ${mode}`;
    if (launch.settingsFile?.path !== hooks.settingsPath)
      violations.push(`${where}: hooks are declared, but the launch writes no settings file there`);
    else if (!launch.settingsFile.content.includes(JSON.stringify(hooks.command)))
      violations.push(`${where}: the settings file does not run the hook command`);
    if (!launch.arguments.includes(hooks.settingsPath))
      violations.push(`${where}: the launch does not pass the settings file`);
    // Terminal hooks: a handler for every listed event, with its matcher, or none at all.
    const terminal = {
      command: "lervo terminal",
      events: [
        { name: "SessionStart" as const, matcher: "resume|compact" },
        { name: "Stop" as const },
      ],
    };
    const content =
      adapter.prepareLaunch({ ...intent, mode, hooks: { ...hooks, terminal } }).settingsFile
        ?.content ?? "";
    if (
      content.includes(JSON.stringify(terminal.command)) &&
      !terminal.events.every(
        (event) =>
          content.includes(JSON.stringify(event.name)) &&
          ("matcher" in event ? content.includes(JSON.stringify(event.matcher)) : true),
      )
    )
      violations.push(`${where}: the settings file answers only some terminal hook events`);
  }
  return violations;
}
