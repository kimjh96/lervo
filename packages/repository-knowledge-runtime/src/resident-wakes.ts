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
  /** `cycle` is false for a Hub change only continuity reads. */
  onHubChange: (cycle: boolean) => void;
  /** Host-local continuity inputs outside every other watch, and the handler for their change. */
  continuityInputs?: readonly string[];
  onContinuityInput?: () => void;
}): {
  hubToken(): string | null;
  hubPushing(): boolean;
  ready(): Promise<void>;
  stop(): Promise<void>;
} {
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
  // A failing Hub wait, or a Hub too old to push, is attention for as long as it lasts.
  const root = input.storage.paths.repositoryRoot;
  const reporters = {
    hub_knowledge_changes_unavailable: repositoryWatchReporter(
      root,
      "hub_knowledge_changes_unavailable",
    ),
    hub_upgrade_required: repositoryWatchReporter(root, "hub_upgrade_required"),
  };
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
      hubIssue = hubIssue.then(async () => {
        for (const [code, reporter] of Object.entries(reporters))
          if (code !== issue) await reporter.armed();
        if (issue !== null) await reporters[issue].failed(error);
      });
    },
  });
  return {
    hubToken: () => hub.token(),
    hubPushing: () => hub.pushing(),
    ready: () => hub.ready(),
    stop: async () => {
      unsubscribe?.();
      continuity?.stop();
      await Promise.all([inputs.stop(), hub.stop()]);
      await hubIssue;
      for (const reporter of Object.values(reporters)) await reporter.armed();
      keepAlive.port1.close();
    },
  };
}
