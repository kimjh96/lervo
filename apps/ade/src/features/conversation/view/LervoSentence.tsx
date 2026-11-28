import type { LervoCommandId, ToolDetail } from "@lervo/session-host-contract";
import { FormattedMessage } from "react-intl";

import { lervoCommandMessages } from "./lervo-command-messages";
import styles from "./ToolLine.module.css";

type LervoCall = NonNullable<ToolDetail["lervo"]>;

const knows = (command: string): command is LervoCommandId =>
  Object.hasOwn(lervoCommandMessages, command);

/**
 * What Lervo did, in its own words, for a Lervo command the agent ran (approved mockup 3, "Lervo's
 * own work", 2026-11-25). The agent's tools read as code; this reads as a plain sentence a step
 * quieter. A failure, a help lookup, and a command this app has no sentence for name the command
 * itself in the mono face. A `shared` sentence keeps its width before the line's other commands.
 */
export function LervoSentence(props: { lervo: LervoCall; failed: boolean; shared?: boolean }) {
  const { lervo } = props;
  const command = (
    <span className={styles.inlineCommand}>
      {lervo.command === "" ? "lervo" : `lervo ${lervo.command}`}
    </span>
  );
  let sentence;
  if (props.failed)
    sentence = <FormattedMessage id="conversation.lervo.failed" values={{ command }} />;
  else if (lervo.flag === "version")
    sentence = <FormattedMessage id="conversation.lervo.version" />;
  else if (lervo.flag === "help" && lervo.command === "")
    sentence = <FormattedMessage id="conversation.lervo.help.root" />;
  else if (lervo.flag === "help")
    sentence = <FormattedMessage id="conversation.lervo.help" values={{ command }} />;
  else if (knows(lervo.command))
    sentence = (
      <FormattedMessage
        {...lervoCommandMessages[lervo.command]}
        values={{
          hasSubject: lervo.subject === undefined ? "no" : "yes",
          subject: lervo.subject ?? "",
        }}
      />
    );
  else sentence = <FormattedMessage id="conversation.lervo.unknown" values={{ command }} />;
  return (
    <span
      className={styles.said}
      data-status={props.failed ? "failed" : undefined}
      data-shared={props.shared === true ? "" : undefined}
    >
      {sentence}
    </span>
  );
}
