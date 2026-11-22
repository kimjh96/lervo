import { type FormEvent, type KeyboardEvent, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../app/session-host-context";
import { RequestFailure } from "../../../platform/session-host";
import { useWorkspaceStore } from "../../workspaces";
import { canStart, type StartDraft, startWork } from "../model/start";
import styles from "./StartScreen.module.css";

const PROVIDERS = ["claude", "codex"] as const;
const KNOWN_ERRORS = new Set([
  "workspace_start_failed",
  "provider_cli_unavailable",
  "conversation_mode_unsupported",
  "application_unavailable",
  "session_host_unavailable",
]);

/** The start screen: an instruction, a repository, and how the agent should run. */
export function StartScreen() {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const repositories = useWorkspaceStore((store) => store.repositories);
  const [draft, setDraft] = useState<StartDraft>({
    instruction: "",
    repository: "",
    provider: "claude",
    mode: "native",
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repository = draft.repository || repositories[0]?.projectId || "";
  const ready = canStart({ ...draft, repository }) && !starting;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    setStarting(true);
    setError(null);
    startWork(commands, { ...draft, repository })
      .then(() => setDraft((current) => ({ ...current, instruction: "" })))
      .catch((failure: unknown) => {
        const code = failure instanceof RequestFailure ? failure.code : "workspace_start_failed";
        setError(KNOWN_ERRORS.has(code) ? code : "workspace_start_failed");
      })
      .finally(() => setStarting(false));
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit();
  };

  return (
    <form className={styles.start} onSubmit={submit}>
      <h1 className={styles.question}>
        <FormattedMessage id="start.question" />
      </h1>
      <textarea
        className={styles.instruction}
        aria-label={intl.formatMessage({ id: "start.instruction.label" })}
        placeholder={intl.formatMessage({ id: "start.instruction.placeholder" })}
        value={draft.instruction}
        rows={3}
        onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
        onKeyDown={keyDown}
      />
      <div className={styles.options}>
        <select
          aria-label={intl.formatMessage({ id: "start.repository.label" })}
          value={repository}
          onChange={(event) => setDraft({ ...draft, repository: event.target.value })}
        >
          {repositories.map((item) => (
            <option key={item.projectId} value={item.projectId}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={intl.formatMessage({ id: "start.provider.label" })}
          value={draft.provider}
          onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {intl.formatMessage({ id: `start.provider.${provider}` })}
            </option>
          ))}
        </select>
        <select
          aria-label={intl.formatMessage({ id: "start.mode.label" })}
          value={draft.mode}
          onChange={(event) =>
            setDraft({ ...draft, mode: event.target.value as StartDraft["mode"] })
          }
        >
          <option value="native">{intl.formatMessage({ id: "start.mode.native" })}</option>
          <option value="cli">{intl.formatMessage({ id: "start.mode.cli" })}</option>
        </select>
        <button type="submit" className={styles.submit} disabled={!ready}>
          <FormattedMessage id={starting ? "start.starting" : "start.submit"} />
        </button>
      </div>
      {repositories.length === 0 ? (
        <p className={styles.hint}>
          <FormattedMessage id="start.repository.none" />
        </p>
      ) : null}
      {error === null ? null : (
        <p className={styles.error} role="alert">
          <FormattedMessage id={`start.error.${error}`} />
        </p>
      )}
    </form>
  );
}
