import type { openProjectStorage } from "@lervo/project-storage";

type History = Pick<Awaited<ReturnType<typeof openProjectStorage>>["events"], "list">;

/** Match only canonical application events, scanning beyond the first history page. */
export function materializationEventRecorded(history: History, planId: string): boolean {
  let afterSeq = 0;
  while (true) {
    const events = history.list({ afterSeq, limit: 1000 });
    for (const event of events) {
      if (
        (event.type === "knowledge.materialization.applied" ||
          event.type === "terminal.integration.applied") &&
        event.payload.planId === planId
      )
        return true;
      afterSeq = event.seq;
    }
    if (events.length < 1000) return false;
  }
}
