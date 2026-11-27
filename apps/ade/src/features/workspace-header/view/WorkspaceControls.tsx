import { type KeyboardEvent, useState } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import {
  RequestFailure,
  useApplicationCommands,
  useListCache,
  useSessionHost,
} from "../../../ports";
import { Button } from "../../../ui/Button";
import { TrashIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Waiting } from "../../../ui/Waiting";
import { Presence } from "../../../ui/Presence";
import { type RetireStep, retireWorkspace } from "../../workspaces";
import { BranchControl } from "./BranchControl";
import styles from "./WorkspaceControls.module.css";

type Step =
  | { kind: "idle" }
  /** `discard` asks to remove the workspace with the changes the core refused it for. */
  | { kind: "asking"; discard: boolean }
  | { kind: "waiting"; step: RetireStep }
  | { kind: "failed"; code: string };

/** What Lervo is doing at each step, in place of the question once it is answered. */
const stepMessages: Readonly<Record<RetireStep, MessageDescriptor>> = {
  stopping: { id: "workspace.retire.stopping" },
  removing: { id: "workspace.retire.removing" },
};

/** The refusals a person can act on; any other code shows the generic text with the code. */
const failureMessages: Readonly<Record<string, MessageDescriptor>> = {
  workspace_in_use: { id: "workspace.retire.failed.workspace_in_use" },
  workspace_has_changes: { id: "workspace.retire.failed.workspace_has_changes" },
  workspace_changes_not_kept: { id: "workspace.retire.failed.workspace_changes_not_kept" },
  workspace_nested_repository: { id: "workspace.retire.failed.workspace_nested_repository" },
  session_stop_timeout: { id: "workspace.retire.failed.session_stop_timeout" },
  workspace_integration_pending: { id: "workspace.retire.failed.workspace_integration_pending" },
  workspace_worktree_unresolved: { id: "workspace.retire.failed.workspace_worktree_unresolved" },
};

/** The core's code for a refusal the session host passed on, or the session host's own code. */
function refusal(failure: unknown): string {
  if (!(failure instanceof RequestFailure)) return "session_host_unavailable";
  const core = failure.parameters.coreCode;
  return typeof core === "string" ? core : failure.code;
}

/**
 * The header's controls (Lervo ADE sessions, "Retiring a workspace"): the branch icon and, when
 * the core answers `workspace.retire`, a quiet trash button. Pressing the trash button turns the
 * whole group into the question in place, with Cancel focused and Escape cancelling, and once
 * answered into what Lervo is doing, step by step. The group keeps its right edge while it changes,
 * so nothing beside it moves (ADE motion, "Changing in place"). The core refuses a workspace with
 * changes; the refusal offers to remove it with them, after asking again, and the core keeps a copy
 * of them first.
 */
export function WorkspaceControls(props: {
  workspaceId: string;
  branch: string;
  retirable: boolean;
}) {
  const intl = useIntl();
  const host = useSessionHost();
  const commands = useApplicationCommands();
  const lists = useListCache();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const retire = (discardChanges: boolean) => {
    setStep({ kind: "waiting", step: "removing" });
    retireWorkspace({
      host,
      commands,
      lists,
      workspaceId: props.workspaceId,
      discardChanges,
      onStep: (step) => setStep({ kind: "waiting", step }),
    }).catch((failure: unknown) => setStep({ kind: "failed", code: refusal(failure) }));
  };
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") setStep({ kind: "idle" });
  };

  const key = step.kind === "failed" ? "idle" : step.kind;
  return (
    <Presence as="span" contentKey={key} justify="end">
      {step.kind === "waiting" ? (
        <Waiting label={intl.formatMessage(stepMessages[step.step])} justify="end" />
      ) : step.kind === "asking" ? (
        // The question's answers are buttons; Escape on either cancels.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <span className={styles.group} onKeyDown={cancelOnEscape}>
          <span className={styles.text}>
            {step.discard
              ? intl.formatMessage({ id: "workspace.retire.questionWithChanges" })
              : intl.formatMessage({ id: "workspace.retire.question" })}
          </span>
          <Button variant="outlined" onClick={() => retire(step.discard)}>
            <FormattedMessage id="workspace.retire.confirm" />
          </Button>
          <Button
            variant="quiet"
            // The safe answer holds the focus, so Return never removes by accident.
            takesFocus
            onClick={() => setStep({ kind: "idle" })}
          >
            <FormattedMessage id="workspace.retire.cancel" />
          </Button>
        </span>
      ) : (
        <span className={styles.group}>
          <Presence as="span">
            {step.kind === "failed" ? (
              <span className={styles.group}>
                <InlineAlert size="meta">
                  <FormattedMessage
                    {...(failureMessages[step.code] ?? { id: "workspace.retire.failed.other" })}
                    values={{ code: step.code }}
                  />
                </InlineAlert>
                {/* The owner may remove it anyway; the core keeps a copy of the changes first. */}
                {/* motion: Inline errors */}
                {step.code === "workspace_has_changes" ? (
                  <Button
                    variant="quiet"
                    onClick={() => setStep({ kind: "asking", discard: true })}
                  >
                    <FormattedMessage id="workspace.retire.withChanges" />
                  </Button>
                ) : null}
              </span>
            ) : null}
          </Presence>
          <BranchControl branch={props.branch} />
          <Presence as="span">
            {props.retirable ? (
              <Button
                variant="quiet"
                label={intl.formatMessage({ id: "workspace.retire.action" })}
                onClick={() => setStep({ kind: "asking", discard: false })}
              >
                <TrashIcon size="md" />
              </Button>
            ) : null}
          </Presence>
        </span>
      )}
    </Presence>
  );
}
