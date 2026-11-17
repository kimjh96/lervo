/**
 * What a user service manager's own answer says about the job's process (ADR-0511, ADR-0573).
 * The service manager and the terminal service inspection read the same answers, without root.
 */

/**
 * `launchctl print` exits 0 for any loaded job, running or not. Only the job's own top-level
 * state line, indented by one tab, says whether its process runs.
 */
export function launchdJobRunning(output) {
  return /^\tstate = running$/mu.test(output);
}

/** The job's own top-level `pid` line from `launchctl print`; nested sections indent deeper. */
export function launchdJobProcessId(output) {
  return positiveProcessId(/^\tpid = ([0-9]+)$/mu.exec(output)?.[1]);
}

/** The arguments that make `systemctl` print only a unit's main process id. */
export function systemdMainProcessIdArguments(unit) {
  return ["--user", "show", "--property=MainPID", "--value", unit];
}

/** `systemctl --user show --property=MainPID --value` prints 0 when no process runs. */
export function systemdMainProcessId(output) {
  return positiveProcessId(/^([0-9]+)\n?$/u.exec(output)?.[1]);
}

function positiveProcessId(value) {
  const processId = Number(value);
  return value !== undefined && Number.isSafeInteger(processId) && processId > 0 ? processId : null;
}
