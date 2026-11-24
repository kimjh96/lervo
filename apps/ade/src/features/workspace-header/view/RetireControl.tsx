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
import styles from "./RetireControl.module.css";

type Step =
  | { kind: "idle" }
  | { kind: "asking" }
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
  session_stop_timeout: { id: "workspace.retire.failed.session_stop_timeout" },
};

/** The core's code for a refusal the session host passed on, or the session host's own code. */
function refusal(failure: unknown): string {
  if (!(failure instanceof RequestFailure)) return "session_host_unavailable";
  const core = failure.parameters.coreCode;
  return typeof core === "string" ? core : failure.code;
}

/**
 * Removes the workspace from its header (Lervo ADE sessions, "Retiring a workspace"): a quiet
 * trash button asks in place, Cancel holds the focus, and Escape cancels. Once answered, the
 * question gives way to what Lervo is doing, step by step. The core refuses a workspace with
 * changes, so removing never discards work.
 */
export function RetireControl(props: { workspaceId: string }) {
  const intl = useIntl();
  const host = useSessionHost();
  const commands = useApplicationCommands();
  const lists = useListCache();
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const retire = () => {
    setStep({ kind: "waiting", step: "removing" });
    retireWorkspace({
      host,
      commands,
      lists,
      workspaceId: props.workspaceId,
      onStep: (step) => setStep({ kind: "waiting", step }),
    }).catch((failure: unknown) => setStep({ kind: "failed", code: refusal(failure) }));
  };
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") setStep({ kind: "idle" });
  };

  if (step.kind === "waiting")
    return <Waiting label={intl.formatMessage(stepMessages[step.step])} />;
  if (step.kind === "asking")
    return (
      // The question's answers are buttons; Escape on either cancels.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <span className={styles.question} onKeyDown={cancelOnEscape}>
        <span className={styles.text}>
          <FormattedMessage id="workspace.retire.question" />
        </span>
        <Button variant="outlined" onClick={retire}>
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
    );
  return (
    <span className={styles.question}>
      <Presence as="span">
        {step.kind === "failed" ? (
          <InlineAlert size="meta">
            <FormattedMessage
              {...(failureMessages[step.code] ?? { id: "workspace.retire.failed.other" })}
              values={{ code: step.code }}
            />
          </InlineAlert>
        ) : null}
      </Presence>
      <Button
        variant="quiet"
        label={intl.formatMessage({ id: "workspace.retire.action" })}
        onClick={() => setStep({ kind: "asking" })}
      >
        <TrashIcon size="md" />
      </Button>
    </span>
  );
}
