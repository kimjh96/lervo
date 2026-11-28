import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { useApplicationCommands } from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Presence } from "../../../ui/Presence";
import { Sheet, SheetField, SheetHeading, sheetStyles } from "../../../ui/Sheet";
import { Waiting } from "../../../ui/Waiting";
import { useWorkspaceStore } from "../../workspaces";
import {
  changeFailureCode,
  closeAgentSheet,
  hireWithRole,
  NEW_ROLE,
  openRoleSheet,
  ownRole,
} from "../model/roles";
import { useAgentStore } from "../model/store";
import { RoleFields, RoleMenu, type RoleWords, wordsReady } from "./RoleFields";

/** The template a new role starts from unless the person picks another. */
const DEFAULT_TEMPLATE = "developer";

/**
 * The "Hire an Agent" sheet (Lervo ADE agents, "Hiring"; ADR-0662): the agent's name, a nickname
 * such as Bora, and its role, which carries its specialty. "New role" asks the new role's name,
 * what it does, and the template it starts from, and the core adds it before hiring. A project
 * role chosen here can be edited from its own sheet.
 */
export function HireSheet(props: {
  roleId: string | null;
  dismissed: boolean;
  onGone: () => void;
}) {
  const intl = useIntl();
  const commands = useApplicationCommands();
  const projectId = useAgentStore((store) => store.projectId);
  const roles = useAgentStore((store) => store.roles);
  const addsRoles = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("role.add") === true,
  );
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(props.roleId ?? NEW_ROLE);
  const [words, setWords] = useState<RoleWords>({ name: "", description: "" });
  const [from, setFrom] = useState(
    roles.some((role) => role.roleId === DEFAULT_TEMPLATE)
      ? DEFAULT_TEMPLATE
      : (roles[0]?.roleId ?? ""),
  );
  const [hiring, setHiring] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const creating = roleId === NEW_ROLE;
  const chosen = roles.find((role) => role.roleId === roleId);
  const ready = !hiring && (creating ? wordsReady(words) && from !== "" : chosen !== undefined);
  const submit = () => {
    if (!ready || projectId === null) return;
    setHiring(true);
    setFailure(null);
    const role = creating
      ? { name: words.name.trim(), description: words.description.trim(), from }
      : roleId;
    hireWithRole(commands, projectId, { name, role }, setRoleId)
      .then(closeAgentSheet)
      .catch((error: unknown) => setFailure(changeFailureCode(error)))
      .finally(() => setHiring(false));
  };

  return (
    <Sheet
      labelledBy="hire-sheet-title"
      dismissed={props.dismissed}
      onClose={closeAgentSheet}
      onGone={props.onGone}
    >
      {(close) => (
        <>
          <SheetHeading
            id="hire-sheet-title"
            title={<FormattedMessage id="agents.sheet.hire.title" />}
            subtitle={<FormattedMessage id="agents.sheet.hire.subtitle" />}
          />
          <SheetField label={<FormattedMessage id="agents.sheet.name" />}>
            <input
              ref={field}
              className={sheetStyles.input}
              value={name}
              maxLength={40}
              spellCheck={false}
              placeholder={intl.formatMessage({ id: "agents.sheet.name.placeholder" })}
              disabled={hiring}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
              }}
            />
          </SheetField>
          <SheetField label={<FormattedMessage id="agents.sheet.role" />}>
            <RoleMenu
              roles={roles}
              value={roleId}
              disabled={hiring}
              {...(addsRoles
                ? {
                    extra: {
                      value: NEW_ROLE,
                      text: intl.formatMessage({ id: "agents.sheet.role.new" }),
                    },
                  }
                : {})}
              onChange={setRoleId}
            />
          </SheetField>
          {/* motion: Overlays: command palette, menus, popovers */}
          {creating ? (
            <>
              <RoleFields words={words} disabled={hiring} onChange={setWords} />
              <SheetField label={<FormattedMessage id="agents.sheet.from" />}>
                <RoleMenu roles={roles} value={from} disabled={hiring} onChange={setFrom} />
              </SheetField>
            </>
          ) : null}
          <Presence className={sheetStyles.failure}>
            {/* motion: Inline errors */}
            {failure === null ? null : (
              <InlineAlert size="caption">
                <FormattedMessage id="agents.sheet.failed" values={{ code: failure }} />
              </InlineAlert>
            )}
          </Presence>
          <div className={sheetStyles.actions}>
            {/* motion: Overlays: command palette, menus, popovers */}
            {ownRole(chosen) && !creating ? (
              <button
                type="button"
                className={sheetStyles.secondary}
                data-apart=""
                disabled={hiring}
                onClick={() => openRoleSheet(roleId)}
              >
                <FormattedMessage id="agents.sheet.role.edit" />
              </button>
            ) : null}
            <Presence as="span">
              {hiring ? (
                <Waiting label={intl.formatMessage({ id: "agents.sheet.hire.hiring" })} />
              ) : null}
            </Presence>
            <button type="button" className={sheetStyles.secondary} onClick={close}>
              <FormattedMessage id="agents.sheet.cancel" />
            </button>
            <button
              type="button"
              className={sheetStyles.primary}
              disabled={!ready}
              onClick={submit}
            >
              <FormattedMessage id="agents.sheet.hire.submit" />
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
