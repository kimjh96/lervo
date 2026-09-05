import type { WorkforceEvent } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";

export async function mutateWorkforceState<T>(
  root: string,
  operation: (recordEvent: (event: WorkforceEvent) => void) => Promise<T>,
): Promise<T> {
  const storage = await openProjectStorage(root);
  try {
    return await operation((event) => recordWorkforceEvent(storage, event));
  } finally {
    await storage.close();
  }
}
