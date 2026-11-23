// `lervo workspace hook`: Lervo's handler for a hosted session's start and end, which the
// session-scoped settings file registers (Lervo ADE sessions, "Hosted launches"). The provider
// adds a start handler's output to the model's context, so it never prints to stdout. A hook
// must never stop the provider's session, so it always exits 0.
import { parseArgs } from "node:util";

import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { hostedLaunchOfSession, hostedLaunchRecordsPath } from "./hosted-launch-records.js";
import {
  endedEvent,
  launchedEvent,
  recordHostedSessionEvents,
  type HostedSessionEndReason,
} from "./hosted-session-events.js";
import type { CliIo } from "./types.js";

const MAX_HOOK_INPUT_BYTES = 64 * 1024;

export const workspaceHookUsage = `  lervo workspace hook --provider <provider> < hook-input`;

/** The hook input fields Lervo reads. Every other field, such as the transcript path, is ignored. */
interface HookInput {
  readonly sessionId: string;
  readonly event: "start" | "end";
  readonly reason: unknown;
}

function parseHookInput(text: string): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.session_id !== "string") return null;
  const event =
    input.hook_event_name === "SessionStart"
      ? "start"
      : input.hook_event_name === "SessionEnd"
        ? "end"
        : null;
  if (event === null) return null;
  return { sessionId: input.session_id, event, reason: input.reason };
}

/** The provider's end reason, with any reason it adds later recorded as `other`. */
export function hostedEndReason(reason: unknown): HostedSessionEndReason {
  return reason === "clear" || reason === "logout" || reason === "prompt_input_exit"
    ? reason
    : "other";
}

export async function runWorkspaceHookCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const { values } = parseArgs({ args, strict: true, options: { provider: { type: "string" } } });
    if (values.provider === undefined || io.stdin === undefined) return 0;
    const input = parseHookInput(await io.stdin(MAX_HOOK_INPUT_BYTES));
    if (input === null) return 0;
    const record = await hostedLaunchOfSession(
      hostedLaunchRecordsPath(),
      values.provider,
      input.sessionId,
    );
    // A session Lervo did not prepare is not a hosted session.
    if (record === null) return 0;
    const repository = await resolveRegisteredRepository({
      registryPath: defaultRepositoryRegistryPath(),
      projectId: record.projectId,
    });
    const now = new Date().toISOString();
    await recordHostedSessionEvents(repository.repositoryRoot, [
      input.event === "start"
        ? launchedEvent(record, now)
        : endedEvent(record, now, hostedEndReason(input.reason), null),
    ]);
  } catch {
    // The session goes on; a missing `launched` reads as `launch_unconfirmed`.
  }
  return 0;
}
