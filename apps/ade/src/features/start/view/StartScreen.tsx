import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../app/session-host-context";
import { transition } from "../../../platform/transition";
import { ArrowUpIcon, ChevronDownIcon } from "../../../ui/icons";
import { useWorkspaceStore } from "../../workspaces";
import { canStart, type StartDraft, startWork } from "../model/start";
import { useStartStore } from "../model/store";
import styles from "./StartScreen.module.css";

const PROVIDERS = ["claude", "codex"] as const;

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
  const draft = useStartStore((store) => store.draft);
  const error = useStartStore((store) => store.error);
  const setDraft = (next: StartDraft) => useStartStore.setState({ draft: next, error: null });
  const repository = draft.repository || repositories[0]?.projectId || "";
  const ready = canStart({ ...draft, repository });
  const provider = intl.formatMessage({ id: `start.provider.${draft.provider}` });

  // The input takes focus when the screen opens and on each "New work".
  useEffect(() => input.current?.focus(), [newWork]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    const name = repositories.find((item) => item.projectId === repository)?.name ?? "";
    transition(() => void startWork(commands, { ...draft, repository }, name));
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
        <form className={styles.card} onSubmit={submit}>
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
            <FormattedMessage
              id={
                `start.error.${error.code}` in intl.messages
                  ? `start.error.${error.code}`
                  : "start.error.other"
              }
              values={{ code: error.code, stage: error.stage ?? "none" }}
            />
          </p>
        )}
      </div>
    </div>
  );
}
