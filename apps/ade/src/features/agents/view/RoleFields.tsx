import type { HireableRole } from "@lervo/session-host-contract";
import { FormattedMessage, useIntl } from "react-intl";

import { SheetField, sheetStyles } from "../../../ui/Sheet";

/** A role's words as a sheet edits them. */
export interface RoleWords {
  readonly name: string;
  readonly description: string;
}

/** Whether a role's words are filled in. */
export const wordsReady = (words: RoleWords): boolean =>
  words.name.trim() !== "" && words.description.trim() !== "";

/**
 * A role's name and what it does, as the hire sheet asks them of a new role and the role sheet
 * changes them (Lervo ADE agents, "Roles"). The name names the specialty, never a person.
 */
export function RoleFields(props: {
  words: RoleWords;
  disabled: boolean;
  onChange: (words: RoleWords) => void;
}) {
  const intl = useIntl();
  const { words } = props;
  return (
    <>
      <SheetField label={<FormattedMessage id="agents.sheet.roleName" />}>
        <input
          className={sheetStyles.input}
          value={words.name}
          maxLength={100}
          placeholder={intl.formatMessage({ id: "agents.sheet.roleName.placeholder" })}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ ...words, name: event.target.value })}
        />
      </SheetField>
      <SheetField label={<FormattedMessage id="agents.sheet.roleDescription" />}>
        <textarea
          className={sheetStyles.input}
          data-multiline=""
          rows={3}
          value={words.description}
          maxLength={1000}
          placeholder={intl.formatMessage({ id: "agents.sheet.roleDescription.placeholder" })}
          disabled={props.disabled}
          onChange={(event) => props.onChange({ ...words, description: event.target.value })}
        />
      </SheetField>
    </>
  );
}

/** A native menu of roles, with the input's surface, as a sheet's field holds it. */
export function RoleMenu(props: {
  roles: readonly HireableRole[];
  value: string;
  disabled: boolean;
  /** One more choice after the roles, such as a new role. */
  extra?: { readonly value: string; readonly text: string };
  onChange: (roleId: string) => void;
}) {
  const choices = [
    ...props.roles.map((role) => ({ value: role.roleId, text: role.name })),
    ...(props.extra === undefined ? [] : [props.extra]),
  ];
  return (
    <select
      className={sheetStyles.input}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.text}
        </option>
      ))}
    </select>
  );
}
