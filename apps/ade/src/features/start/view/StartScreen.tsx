import { useEffect, useRef } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { useApplicationCommands, useFiles } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { AttachmentTray } from "../../../ui/AttachmentTray";
import { ArrowUpIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Select } from "../../../ui/Select";
import { Presence } from "../../../ui/Presence";
import { ViewPresence } from "../../../ui/ViewPresence";
import {
  defaultParticipants,
  ParticipantsChip,
  takesParticipants,
  teamAgents,
  useAgentStore,
} from "../../agents";
import { useHostIsCurrent } from "../../connection";
import {
  attachmentNoticeValues,
  ConversationImagesProvider,
  useAttachments,
  useFileDrop,
  useOpenImages,
} from "../../conversation";
import { useCurrentProject } from "../../projects";
import { chooseProvider, useProviderStore } from "../../providers";
import { useWorkspaceStore } from "../../workspaces";
import { canStart, type StartDraft, startWork } from "../model/start";
import { useStartStore } from "../model/store";
import { FirstRunWelcome } from "./FirstRunWelcome";
import { useFirstRun } from "./first-run";
import styles from "./StartScreen.module.css";

/** The text of each start failure the interface explains; other codes show with their code. */
const errorMessages: Readonly<Record<string, MessageDescriptor>> = {
  application_unavailable: { id: "start.error.application_unavailable" },
  conversation_mode_unsupported: { id: "start.error.conversation_mode_unsupported" },
  provider_cli_unavailable: { id: "start.error.provider_cli_unavailable" },
  session_host_unavailable: { id: "start.error.session_host_unavailable" },
  workspace_start_failed: { id: "start.error.workspace_start_failed" },
};

/** Work not started yet keeps no images in a session host; the tray shows its own. */
const readNothing = () => Promise.reject(new Error("image_not_found"));

/**
 * The start screen: one instruction and the agent, in the switcher's project; Lervo does the rest. Images
 * pasted with the instruction wait above it and go with the first message (image mockup,
 * "5"); other files pasted or dropped wait beside them and go as their paths (file mockup, "5").
 */
export function StartScreen() {
  const firstRun = useFirstRun();
  // Until the core's lists or the kept ones arrive, whether this is the first run is unknown, so
  // nothing shows rather than a screen that the lists would then replace and move.
  const known = useWorkspaceStore((store) => store.loaded || store.cached);
  // Adding the first project changes the view to the usual start screen (ADE motion, "Changing
  // views").
  return (
    <ViewPresence view={!known ? "unknown" : firstRun.active ? "first-run" : "start"}>
      {/* motion: Changing views */}
      {!known ? null : firstRun.active ? (
        <FirstRunWelcome />
      ) : (
        <ConversationImagesProvider read={readNothing}>
          <StartForm />
        </ConversationImagesProvider>
      )}
    </ViewPresence>
  );
}

function StartForm() {
  const intl = useIntl();
  const open = useOpenImages();
  const files = useFiles();
  const commands = useApplicationCommands();
  const repositories = useWorkspaceStore((store) => store.repositories);
  const newWork = useWorkspaceStore((store) => store.newWorkRequests);
  const input = useRef<HTMLTextAreaElement>(null);
  const registry = useProviderStore((store) => store.registry);
  const draft = useStartStore((store) => store.draft);
  const error = useStartStore((store) => store.error);
  const setDraft = (next: StartDraft) => useStartStore.setState({ draft: next, error: null });
  // New work goes into the project the switcher shows.
  const project = useCurrentProject();
  const repository = project?.projectId ?? "";
  const provider = chooseProvider(registry, draft.provider);
  // The registry holds only providers with the native conversation; one needs no choice.
  const offered = registry.status === "loaded" ? registry.providers : [];
  // Images go only through a session host as current as this interface, to a core that carries
  // them (Lervo ADE sessions, "Images in a message").
  const hostIsCurrent = useHostIsCurrent();
  const coreTakesImages = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("decoder.images") === true,
  );
  const returnedImages = useStartStore((store) => store.returnedImages);
  const returnedFiles = useStartStore((store) => store.returnedFiles);
  const attachments = useAttachments({
    acceptsImages: hostIsCurrent && coreTakesImages,
    resetKey: "start",
    initialImages: returnedImages,
    initialFiles: returnedFiles,
  });
  // With no project yet, the card adds the first one.
  const firstRun = useFirstRun();
  const dragging = useFileDrop(attachments.drop);
  useEffect(() => {
    if (returnedImages.length > 0 || returnedFiles.length > 0)
      useStartStore.setState({ returnedImages: [], returnedFiles: [] });
  }, [returnedImages, returnedFiles]);
  const ready = canStart({ ...draft, repository }, attachments.holds) && !attachments.preparing;
  // The conversation starts with the project's team agents the person chose, or its default;
  // only a core that takes participants is sent them (Lervo ADE agents, "Participants").
  const team = teamAgents(useAgentStore((store) => store.agents));
  const shownProject = useAgentStore((store) => store.projectId);
  const takes = useWorkspaceStore((store) => takesParticipants(store.advertisedCommands));
  const offeredTeam = takes && shownProject === repository ? team : [];
  const participants = draft.participants ?? defaultParticipants(offeredTeam);
  const tray = attachments.tray(intl);

  // The input takes focus when the screen opens and on each "New work".
  useEffect(() => input.current?.focus(), [newWork]);

  const submit = () => {
    if (!ready) return;
    // The manifest name, which the workspace list reports for the workspace that results.
    const name = project?.name ?? "";
    const chosen = {
      ...draft,
      repository,
      provider: provider?.provider ?? "",
      participants: offeredTeam.length === 0 ? [] : participants,
    };
    const taken = attachments.take();
    void startWork(commands, chosen, name, taken.images, taken.files);
  };

  return (
    <div className={styles.start}>
      {/* Paste reaches the card from its field, where the person pastes. */}
      <div className={styles.column} onPaste={attachments.paste}>
        <h1 className={styles.question}>
          <FormattedMessage id="start.question" />
        </h1>
        <InputCard
          surface="input"
          layout="stacked"
          onSubmit={submit}
          dropHint={dragging ? intl.formatMessage({ id: "conversation.files.drop" }) : undefined}
          attachments={
            /* motion: Coming and going */
            tray.images.length === 0 && tray.files.length === 0 ? undefined : (
              <AttachmentTray
                images={tray.images}
                files={tray.files}
                onRemove={attachments.remove}
                onOpenImage={(index) => open(tray.images, index)}
                onOpenFile={(key) => {
                  const path = attachments.pathOf(key);
                  if (path !== undefined) files.reveal(path);
                }}
              />
            )
          }
        >
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
              {offeredTeam.length === 0 ? null : (
                <ParticipantsChip
                  team={offeredTeam}
                  chosen={participants}
                  onChange={(next) => setDraft({ ...draft, participants: next })}
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
          {repositories.length === 0 && !firstRun.managed ? (
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
          {/* motion: Inline errors */}
          {attachments.notice !== null && error === null ? (
            <InlineAlert size="note">
              <FormattedMessage {...attachments.notice} values={attachmentNoticeValues} />
            </InlineAlert>
          ) : error === null ? null : (
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
