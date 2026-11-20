import type { ProjectStorage } from "@lervo/project-storage";

import {
  watchHubKnowledgeChanges,
  type KnowledgeHubChangeTransport,
} from "./hub-knowledge-changes.js";
import { repositoryWatchReporter } from "./repository-watch-state.js";
import { subscribeKnowledgeWakeups } from "./knowledge-worker-wakeups.js";
import { watchFiles } from "./resident-file-watch.js";
import { watchResidentInputs } from "./resident-input-watch.js";

/**
 * ADR-0602: every signal that can give a resident work, wired once. Events and repository edits
 * coalesce through the caller's debounce; the projection inputs, the host hold store, this
 * checkout's owner fence and the Hub's `knowledge` change token each have their own handler.
 * The resident arms no timer for any of them, so a ref'd message port keeps a foreground host
 * alive while it waits, at no cost.
 */
export function wireResidentWakes(input: {
  storage: ProjectStorage;
  subscribe?: (notify: () => void, lastVerdictIsOwner: () => boolean) => () => void;
  ownsQueue: () => boolean;
  projection: boolean;
  hubChanges: KnowledgeHubChangeTransport | undefined;
  onChange: () => void;
  onProjectionInput: () => void;
  onHoldStore: () => void;
  onOwnerFence: () => void;
  onHubChange: () => void;
  /** Host-local continuity inputs outside every other watch, and the handler for their change. */
  continuityInputs?: readonly string[];
  onContinuityInput?: () => void;
}): { hubToken(): string | null; ready(): Promise<void>; stop(): Promise<void> } {
  const keepAlive = new MessageChannel();
  keepAlive.port1.on("message", () => undefined);
  const unsubscribe = input.subscribe
    ? input.subscribe(input.onChange, input.ownsQueue)
    : subscribeKnowledgeWakeups(input.storage, input.onChange, undefined, input.ownsQueue);
  const inputs = watchResidentInputs({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projection: input.projection,
    onProjectionInput: input.onProjectionInput,
    onHoldStore: input.onHoldStore,
    onOwnerFence: input.onOwnerFence,
  });
  // A failing Hub wait is attention for as long as it fails (`hub_knowledge_changes_unavailable`).
  const hubIssues = repositoryWatchReporter(
    input.storage.paths.repositoryRoot,
    "hub_knowledge_changes_unavailable",
  );
  let hubIssue: Promise<void> = Promise.resolve();
  const continuity =
    input.continuityInputs === undefined || input.continuityInputs.length === 0
      ? null
      : watchFiles(input.continuityInputs, input.onContinuityInput ?? (() => undefined));
  const hub = watchHubKnowledgeChanges({
    storage: input.storage,
    transport: input.hubChanges,
    onChange: input.onHubChange,
    onIssue: (issue, error) => {
      hubIssue = hubIssue.then(() =>
        issue === null ? hubIssues.armed() : hubIssues.failed(error),
      );
    },
  });
  return {
    hubToken: () => hub.token(),
    ready: () => hub.ready(),
    stop: async () => {
      unsubscribe?.();
      continuity?.stop();
      await Promise.all([inputs.stop(), hub.stop()]);
      await hubIssue;
      await hubIssues.armed();
      keepAlive.port1.close();
    },
  };
}
