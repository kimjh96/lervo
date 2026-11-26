import type { IntlShape } from "react-intl";

import { firstSentence } from "../model/decisions";

/**
 * One line on what a role does, for the hire menu (Lervo ADE agents, "Hiring"): a built-in role's
 * short summary from the catalog, or the first sentence of a project role's description.
 */
export function roleSummary(intl: IntlShape, roleId: string, description: string): string {
  switch (roleId) {
    case "ceo":
      return intl.formatMessage({ id: "agents.roleSummary.ceo" });
    case "designer":
      return intl.formatMessage({ id: "agents.roleSummary.designer" });
    case "developer":
      return intl.formatMessage({ id: "agents.roleSummary.developer" });
    case "ideation":
      return intl.formatMessage({ id: "agents.roleSummary.ideation" });
    case "marketer":
      return intl.formatMessage({ id: "agents.roleSummary.marketer" });
    case "researcher":
      return intl.formatMessage({ id: "agents.roleSummary.researcher" });
    case "writer":
      return intl.formatMessage({ id: "agents.roleSummary.writer" });
    case "product-owner":
      return intl.formatMessage({ id: "agents.roleSummary.productOwner" });
    default:
      return firstSentence(description);
  }
}
