// The provider session's variables a served hook runs with (resident-context-socket.md). The server
// compares the variables that choose which stores a hook reads; these instead change how the hook's
// child processes behave, and differ between a session and a service, so the server applies the
// session's values for the duration of one served hook instead of declining.

/** Named session variables; every `GIT_` variable is carried too. */
export const TERMINAL_CONTEXT_SESSION_NAMES = [
  // Where `git`, `launchctl`, `systemctl`, and `ps` are found.
  "PATH",
  // Whether the replica service inspection can reach the user's service manager on Linux.
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

const GIT_VARIABLE = /^GIT_[A-Z0-9_]{1,60}$/u;
const MAXIMUM_VARIABLES = 48;
const MAXIMUM_VALUE_BYTES = 16 * 1024;

export type TerminalContextSessionEnvironment = Record<string, string | null>;

function sessionName(name: string): boolean {
  return (
    (TERMINAL_CONTEXT_SESSION_NAMES as readonly string[]).includes(name) || GIT_VARIABLE.test(name)
  );
}

/** The session's values, as the hook's client sends them; an unset named variable is null. */
export function terminalContextSessionEnvironment(
  environment: NodeJS.ProcessEnv,
): TerminalContextSessionEnvironment {
  const values: TerminalContextSessionEnvironment = {};
  for (const name of TERMINAL_CONTEXT_SESSION_NAMES) values[name] = environment[name] ?? null;
  for (const [name, value] of Object.entries(environment))
    if (GIT_VARIABLE.test(name) && value !== undefined) values[name] = value;
  return values;
}

/** Whether a request's session environment is well formed; older clients send none. */
export function validTerminalContextSessionEnvironment(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length <= MAXIMUM_VARIABLES &&
    TERMINAL_CONTEXT_SESSION_NAMES.every((name) => name in (value as object)) &&
    entries.every(
      ([name, entry]) =>
        sessionName(name) &&
        (entry === null ||
          (typeof entry === "string" &&
            !entry.includes("\0") &&
            Buffer.byteLength(entry) <= MAXIMUM_VALUE_BYTES)),
    )
  );
}

/**
 * Gives this process the session's values until the returned function restores its own. The server
 * runs one hook at a time, so the values reach exactly that hook and the work it leaves running
 * until the server drains it. A `GIT_` variable the session lacks is removed for the duration.
 */
export function applyTerminalContextSessionEnvironment(
  session: TerminalContextSessionEnvironment | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): () => void {
  if (session === undefined) return () => undefined;
  const names = new Set([
    ...Object.keys(session),
    ...Object.keys(environment).filter((name) => GIT_VARIABLE.test(name)),
  ]);
  const saved = new Map([...names].map((name) => [name, environment[name]]));
  for (const name of names) {
    const value = session[name] ?? null;
    if (value === null) delete environment[name];
    else environment[name] = value;
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete environment[name];
      else environment[name] = value;
    }
  };
}
