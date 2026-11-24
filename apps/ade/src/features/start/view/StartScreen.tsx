import { useEffect, useRef } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { ArrowUpIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Select } from "../../../ui/Select";
import { Presence } from "../../../ui/Presence";
import { chooseProvider, useProviderStore } from "../../providers";
import { useWorkspaceStore } from "../../workspaces";
import { canStart, type StartDraft, startWork } from "../model/start";
import { useStartStore } from "../model/store";
import styles from "./StartScreen.module.css";

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
  const registry = useProviderStore((store) => store.registry);
  const draft = useStartStore((store) => store.draft);
  const error = useStartStore((store) => store.error);
  const setDraft = (next: StartDraft) => useStartStore.setState({ draft: next, error: null });
  const repository = draft.repository || repositories[0]?.projectId || "";
  const provider = chooseProvider(registry, draft.provider);
  // The registry holds only providers with the native conversation; one needs no choice.
  const offered = registry.status === "loaded" ? registry.providers : [];
  const ready = canStart({ ...draft, repository });

  // The input takes focus when the screen opens and on each "New work".
  useEffect(() => input.current?.focus(), [newWork]);

  const submit = () => {
    if (!ready) return;
    const name = repositories.find((item) => item.projectId === repository)?.name ?? "";
    const chosen = { ...draft, repository, provider: provider?.provider ?? "" };
    void startWork(commands, chosen, name);
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
            <Presence as="span">
              {repositories.length === 0 ? null : (
                <Select
                  label={intl.formatMessage({ id: "start.repository.label" })}
                  value={repository}
                  options={repositories.map((item) => ({ value: item.projectId, text: item.name }))}
                  onChange={(value) => setDraft({ ...draft, repository: value })}
                />
              )}
            </Presence>
            <Presence as="span">
              {offered.length < 2 || provider === null ? null : (
                <Select
                  label={intl.formatMessage({ id: "start.provider.label" })}
                  value={provider.provider}
                  options={offered.map((item) => ({
                    value: item.provider,
                    text: item.installed
                      ? item.displayName
                      : intl.formatMessage(
                          { id: "start.provider.missing" },
                          { name: item.displayName },
                        ),
                    disabled: !item.installed,
                  }))}
                  onChange={(value) => setDraft({ ...draft, provider: value })}
                />
              )}
            </Presence>
            <IconButton
              type="submit"
              className={styles.submit}
              disabled={!ready}
              label={intl.formatMessage({ id: "start.submit" })}
              icon={<ArrowUpIcon size="lg" />}
            />
          </div>
        </InputCard>
        <Presence>
          {repositories.length === 0 ? (
            <p className={styles.explain}>
              <FormattedMessage id="start.repository.none" />
            </p>
          ) : null}
        </Presence>
        <Presence>
          {registry.status === "older" ? (
            <p className={styles.explain}>
              <FormattedMessage id="start.provider.older" />
            </p>
          ) : null}
        </Presence>
        <Presence className={styles.error}>
          {error === null ? null : (
            <InlineAlert size="note">
              <FormattedMessage
                {...(Object.hasOwn(errorMessages, error.code)
                  ? errorMessages[error.code]
                  : { id: "start.error.other" })}
                values={{ code: error.code, stage: error.stage ?? "none" }}
              />
            </InlineAlert>
          )}
        </Presence>
      </div>
    </div>
  );
}
