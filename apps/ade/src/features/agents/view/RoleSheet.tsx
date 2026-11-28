import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Presence } from "../../../ui/Presence";
import { Sheet, SheetHeading, sheetStyles } from "../../../ui/Sheet";
import { Waiting } from "../../../ui/Waiting";
import { changeFailureCode, closeAgentSheet, editRole, removeRole } from "../model/roles";
import { useAgentStore } from "../model/store";
import { RoleFields, type RoleWords, wordsReady } from "./RoleFields";

/**
 * A project role's sheet (Lervo ADE agents, "Roles"; ADR-0662): its name and what it does, which
 * Save changes for every agent with the role, and "Remove Role", which the core refuses while an
 * agent or open work holds the role. Lervo's own templates have no sheet.
 */
export function RoleSheet(props: { roleId: string; dismissed: boolean; onGone: () => void }) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const projectId = useAgentStore((store) => store.projectId);
  const role = useAgentStore((store) => store.roles.find((item) => item.roleId === props.roleId));
  const [words, setWords] = useState<RoleWords>({
    name: role?.name ?? "",
    description: role?.description ?? "",
  });
  const [busy, setBusy] = useState<"saving" | "removing" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = busy === null && wordsReady(words);
  const change = (kind: "saving" | "removing", run: (projectId: string) => Promise<void>) => {
    if (busy !== null || projectId === null) return;
    setBusy(kind);
    setFailure(null);
    run(projectId)
      .then(closeAgentSheet)
      .catch((error: unknown) => setFailure(changeFailureCode(error)))
      .finally(() => setBusy(null));
  };
  const save = () =>
    ready &&
    change("saving", (project) =>
      editRole(commands, project, props.roleId, {
        name: words.name.trim(),
        description: words.description.trim(),
      }),
    );
  const remove = () => change("removing", (project) => removeRole(commands, project, props.roleId));

  return (
    <Sheet
      labelledBy="role-sheet-title"
      dismissed={props.dismissed}
      onClose={closeAgentSheet}
      onGone={props.onGone}
    >
      {(close) => (
        <>
          <SheetHeading
            id="role-sheet-title"
            title={<FormattedMessage id="agents.sheet.role.title" />}
            subtitle={<FormattedMessage id="agents.sheet.role.subtitle" />}
          />
          <RoleFields words={words} disabled={busy !== null} onChange={setWords} />
          <Presence className={sheetStyles.failure}>
            {/* motion: Inline errors */}
            {failure === null ? null : (
              <InlineAlert size="caption">
                <FormattedMessage id="agents.sheet.role.failed" values={{ code: failure }} />
              </InlineAlert>
            )}
          </Presence>
          <div className={sheetStyles.actions}>
            <button
              type="button"
              className={sheetStyles.secondary}
              data-apart=""
              disabled={busy !== null}
              onClick={remove}
            >
              <FormattedMessage id="agents.sheet.role.remove" />
            </button>
            <Presence as="span">
              {busy === null ? null : (
                <Waiting
                  label={
                    busy === "saving"
                      ? intl.formatMessage({ id: "agents.sheet.role.saving" })
                      : intl.formatMessage({ id: "agents.sheet.role.removing" })
                  }
                />
              )}
            </Presence>
            <button type="button" className={sheetStyles.secondary} onClick={close}>
              <FormattedMessage id="agents.sheet.cancel" />
            </button>
            <button type="button" className={sheetStyles.primary} disabled={!ready} onClick={save}>
              <FormattedMessage id="agents.sheet.role.save" />
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
