import { useEffect, useState } from "react";
import { useIntl } from "react-intl";

import { motion } from "../../../design/generated/motion";
import { useClipboard } from "../../../ports";
import { Button } from "../../../ui/Button";
import { BranchIcon } from "../../../ui/icons";
import { Presence } from "../../../ui/Presence";
import styles from "./BranchControl.module.css";

const branchMessage = { id: "workspace.branch.action" };
const copiedMessage = { id: "workspace.branch.copied" };

/**
 * The workspace's branch behind a quiet icon: the branch is a detail the person rarely needs, so
 * hovering or focusing names it, and pressing copies it. A copy shows no result of its own, so a
 * past-tense line beside the icon says what was copied for `motion.duration.settle` (ADE design
 * patterns, "Waiting").
 */
export function BranchControl(props: { branch: string }) {
  const intl = useIntl();
  const clipboard = useClipboard();
  const [copies, setCopies] = useState(0);
  useEffect(() => {
    if (copies === 0) return;
    const timer = setTimeout(() => setCopies(0), motion.settleMs);
    return () => clearTimeout(timer);
  }, [copies]);
  const copy = () =>
    void clipboard.copy(props.branch).then(
      () => setCopies((count) => count + 1),
      () => undefined,
    );
  return (
    <span className={styles.branch}>
      <Presence as="span">
        {copies === 0 ? null : (
          <span className={styles.copied} role="status">
            {intl.formatMessage(copiedMessage, { branch: props.branch })}
          </span>
        )}
      </Presence>
      <Button
        variant="quiet"
        label={intl.formatMessage(branchMessage, { branch: props.branch })}
        onClick={copy}
      >
        <BranchIcon size="md" />
      </Button>
    </span>
  );
}
