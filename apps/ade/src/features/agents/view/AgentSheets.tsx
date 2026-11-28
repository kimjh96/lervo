import { useCallback, useState } from "react";

import type { AgentSheet } from "../model/roles";
import { useAgentStore } from "../model/store";
import { HireSheet } from "./HireSheet";
import { RoleSheet } from "./RoleSheet";

const sheetKey = (sheet: AgentSheet) => (sheet.kind === "hire" ? "hire" : `role:${sheet.roleId}`);

/**
 * The agents' sheet over Lervo, hiring or a project role's words, once one is opened. It stays
 * while it closes: Cancel, Escape, and a change that succeeds all play its closing before it
 * unmounts (ADE motion, "Overlays: command palette, menus, popovers").
 */
export function AgentSheets() {
  const sheet = useAgentStore((store) => store.sheet);
  const [shown, setShown] = useState(sheet);
  if (sheet !== null && (shown === null || sheetKey(sheet) !== sheetKey(shown))) setShown(sheet);
  const gone = useCallback(() => setShown(null), []);
  if (shown === null) return null;
  const dismissed = sheet === null;
  // motion: Overlays: command palette, menus, popovers
  return shown.kind === "hire" ? (
    <HireSheet key={sheetKey(shown)} roleId={shown.roleId} dismissed={dismissed} onGone={gone} />
  ) : (
    <RoleSheet key={sheetKey(shown)} roleId={shown.roleId} dismissed={dismissed} onGone={gone} />
  );
}
