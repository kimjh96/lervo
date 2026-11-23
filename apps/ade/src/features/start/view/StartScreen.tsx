import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../app/session-host-context";
import { RequestFailure } from "../../../platform/session-host";
import { ArrowUpIcon, ChevronDownIcon } from "../../../ui/icons";
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

/** A compact chooser inside the instruction card: a native select drawn as a chip. */
function Chip(props: {
  label: string;
  value: string;
  options: readonly { value: string; text: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span className={styles.chip}>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={12} />
    </span>
  );
}

/** The start screen: one instruction, the repository, and the agent; Lervo does the rest. */
export function StartScreen() {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const repositories = useWorkspaceStore((store) => store.repositories);
  const newWork = useWorkspaceStore((store) => store.newWorkRequests);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<StartDraft>({
    instruction: "",
    repository: "",
    provider: "claude",
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repository = draft.repository || repositories[0]?.projectId || "";
  const ready = canStart({ ...draft, repository }) && !starting;
  const provider = intl.formatMessage({ id: `start.provider.${draft.provider}` });

  // The input takes focus when the screen opens and on each "New work".
  useEffect(() => input.current?.focus(), [newWork]);

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
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className={styles.start}>
      <div className={styles.column}>
        <h1 className={styles.question}>
          <FormattedMessage id="start.question" />
        </h1>
        <form className={styles.card} onSubmit={submit} aria-busy={starting}>
          <textarea
            ref={input}
            className={styles.instruction}
            aria-label={intl.formatMessage({ id: "start.instruction.label" })}
            placeholder={intl.formatMessage({ id: "start.instruction.placeholder" })}
            value={draft.instruction}
            rows={3}
            onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
            onKeyDown={keyDown}
          />
          <div className={styles.bar}>
            {repositories.length === 0 ? null : (
              <Chip
                label={intl.formatMessage({ id: "start.repository.label" })}
                value={repository}
                options={repositories.map((item) => ({ value: item.projectId, text: item.name }))}
                onChange={(value) => setDraft({ ...draft, repository: value })}
              />
            )}
            <Chip
              label={intl.formatMessage({ id: "start.provider.label" })}
              value={draft.provider}
              options={PROVIDERS.map((value) => ({
                value,
                text: intl.formatMessage({ id: `start.provider.${value}` }),
              }))}
              onChange={(value) => setDraft({ ...draft, provider: value })}
            />
            <button
              type="submit"
              className={styles.submit}
              disabled={!ready}
              aria-label={intl.formatMessage({ id: "start.submit" })}
            >
              <ArrowUpIcon size={16} />
            </button>
          </div>
        </form>
        <p className={styles.explain}>
          {repositories.length === 0 ? (
            <FormattedMessage id="start.repository.none" />
          ) : (
            <FormattedMessage id="start.explain" values={{ provider }} />
          )}
        </p>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            <FormattedMessage id={`start.error.${error}`} />
          </p>
        )}
      </div>
    </div>
  );
}
