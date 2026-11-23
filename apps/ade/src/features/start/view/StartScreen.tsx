import { useEffect, useRef } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { transition } from "../../../platform/transition";
import { useApplicationCommands } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { ArrowUpIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Select } from "../../../ui/Select";
import { useWorkspaceStore } from "../../workspaces";
import { canStart, type StartDraft, startWork } from "../model/start";
import { useStartStore } from "../model/store";
import styles from "./StartScreen.module.css";

const PROVIDERS = ["claude", "codex"] as const;

/** The text of each start failure the interface explains; other codes show with their code. */
const errorMessages: Readonly<Record<string, MessageDescriptor>> = {
  application_unavailable: { id: "start.error.application_unavailable" },
  conversation_mode_unsupported: { id: "start.error.conversation_mode_unsupported" },
  provider_cli_unavailable: { id: "start.error.provider_cli_unavailable" },
  session_host_unavailable: { id: "start.error.session_host_unavailable" },
  workspace_start_failed: { id: "start.error.workspace_start_failed" },
};

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

  const submit = () => {
    if (!ready) return;
    const name = repositories.find((item) => item.projectId === repository)?.name ?? "";
    transition(() => void startWork(commands, { ...draft, repository }, name));
  };

  return (
    <div className={styles.start}>
      <div className={styles.column}>
        <h1 className={styles.question}>
          <FormattedMessage id="start.question" />
        </h1>
        <InputCard surface="input" layout="stacked" onSubmit={submit}>
          <InputField
            ref={input}
            size="input"
            rows={3}
            label={intl.formatMessage({ id: "start.instruction.label" })}
            placeholder={intl.formatMessage({ id: "start.instruction.placeholder" })}
            value={draft.instruction}
            onChange={(instruction) => setDraft({ ...draft, instruction })}
            onSubmit={submit}
          />
          <div className={styles.bar}>
            {repositories.length === 0 ? null : (
              <Select
                label={intl.formatMessage({ id: "start.repository.label" })}
                value={repository}
                options={repositories.map((item) => ({ value: item.projectId, text: item.name }))}
                onChange={(value) => setDraft({ ...draft, repository: value })}
              />
            )}
            <Select
              label={intl.formatMessage({ id: "start.provider.label" })}
              value={draft.provider}
              options={PROVIDERS.map((value) => ({
                value,
                text: intl.formatMessage({ id: `start.provider.${value}` }),
              }))}
              onChange={(value) => setDraft({ ...draft, provider: value })}
            />
            <IconButton
              type="submit"
              className={styles.submit}
              disabled={!ready}
              label={intl.formatMessage({ id: "start.submit" })}
              icon={<ArrowUpIcon size="lg" />}
            />
          </div>
        </InputCard>
        <p className={styles.explain}>
          {repositories.length === 0 ? (
            <FormattedMessage id="start.repository.none" />
          ) : (
            <FormattedMessage id="start.explain" values={{ provider }} />
          )}
        </p>
        {error === null ? null : (
          <InlineAlert size="note" className={styles.error}>
            <FormattedMessage
              {...(Object.hasOwn(errorMessages, error.code)
                ? errorMessages[error.code]
                : { id: "start.error.other" })}
              values={{ code: error.code, stage: error.stage ?? "none" }}
            />
          </InlineAlert>
        )}
      </div>
    </div>
  );
}
