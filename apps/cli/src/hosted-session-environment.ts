// What Lervo adds to a hosted session's provider process environment: the agent whose session it
// is, and the Lervo state the core that launched it uses, so the session's own lervo commands read
// the same registry and workspaces as the core.
import type { HostedLaunch } from "@lervo/adapter-contract";

/**
 * Lervo's state locations. A core started with any of them set launches sessions whose shells
 * would otherwise fall back to the defaults, and then see another registry than the core's.
 */
const SHARED_STATE = [
  "LERVO_USER_STATE_DIRECTORY",
  "LERVO_USER_CAPABILITY_ROOT",
  "LERVO_WORKSPACES_HOME",
] as const;

/**
 * The launch with the writing agent named, so the session's hooks and turn evidence attribute its
 * work (Lervo ADE agents, "Participants and sessions"), and with the core's Lervo state locations
 * that are set.
 */
export function withSessionEnvironment(
  launch: HostedLaunch,
  agentId: string | undefined,
  core: NodeJS.ProcessEnv = process.env,
): HostedLaunch {
  const shared = Object.fromEntries(
    SHARED_STATE.flatMap((name) => {
      const value = core[name];
      return value === undefined || value.length === 0 ? [] : [[name, value]];
    }),
  );
  return {
    ...launch,
    environment: {
      ...launch.environment,
      ...shared,
      ...(agentId === undefined ? {} : { LERVO_AGENT_ID: agentId }),
    },
  };
}
