import { useEffect, useState } from "react";
import { useIntl } from "react-intl";

import { useClipboard } from "../../../ports";
import { Button } from "../../../ui/Button";
import { BranchIcon } from "../../../ui/icons";

/** How long the button's name says the branch was copied. */
const COPIED_MS = 1500;

const branchMessage = { id: "workspace.branch.action" };
const copiedMessage = { id: "workspace.branch.copied" };

/**
 * The workspace's branch behind a quiet icon: the branch is a detail the person rarely needs, so
 * hovering or focusing names it, and pressing copies it.
 */
export function BranchControl(props: { branch: string }) {
  const intl = useIntl();
  const clipboard = useClipboard();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    void clipboard.copy(props.branch).then(
      () => setCopied(true),
      () => undefined,
    );
  return (
    <Button
      variant="quiet"
      label={intl.formatMessage(copied ? copiedMessage : branchMessage, { branch: props.branch })}
      onClick={copy}
    >
      <BranchIcon size="md" />
    </Button>
  );
}
