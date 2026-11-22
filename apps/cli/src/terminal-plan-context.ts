import type { ProjectStorage } from "@lervo/project-storage";
import { planLedgerLines, planItemOpen } from "@lervo/repository-knowledge";
import { readPlanLedger } from "@lervo/repository-knowledge-runtime";

/** At most this many open items reach a turn; the rest stay one `lervo plan list` away. */
export const MAXIMUM_PLAN_CONTEXT_ITEMS = 6;
const MAXIMUM_TITLE_BYTES = 200;

function bounded(value: string): string {
  if (Buffer.byteLength(value) <= MAXIMUM_TITLE_BYTES) return value;
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(`${result}${character}…`) > MAXIMUM_TITLE_BYTES) break;
    result += character;
  }
  return `${result}…`;
}

/**
 * ADR-0563: the open plan items every turn receives, so a plan survives compaction and new
 * sessions without the agent's memory. In-progress items come first, then the rest in tree order.
 * The lines are optional context: owner rules keep priority when the budget is short. A ledger
 * that cannot be read yet (schema 9 inactive or unreadable) gives no lines and never fails a turn.
 */
export function terminalPlanContextLines(storage: ProjectStorage): string[] {
  let lines;
  try {
    lines = planLedgerLines(readPlanLedger(storage), { open: true }).filter(({ item }) =>
      planItemOpen(item),
    );
  } catch {
    return [];
  }
  if (lines.length === 0) return [];
  const ordered = [
    ...lines.filter(({ item }) => item.state === "in_progress"),
    ...lines.filter(({ item }) => item.state !== "in_progress"),
  ];
  return [
    `Lervo plan: ${lines.length} open item${lines.length === 1 ? "" : "s"}; act on or defer each related one before you stop (\`lervo plan list\`).`,
    ...ordered
      .slice(0, MAXIMUM_PLAN_CONTEXT_ITEMS)
      .map(({ item }) => `- [${item.state}] ${bounded(item.title)} (${item.itemId})`),
  ];
}
