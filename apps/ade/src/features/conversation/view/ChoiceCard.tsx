import type { Choices, ConversationItem } from "@lervo/session-host-contract";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { FormattedMessage } from "react-intl";

import { failureCode } from "../../../ports";
import { Button } from "../../../ui/Button";
import { CheckIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { Presence } from "../../../ui/Presence";
import { answersOf, toggled } from "../model/questions";
import styles from "./ChoiceCard.module.css";
import { useAnswerQuestion, useQuestionOpen } from "./questions-context";

type QuestionItem = Extract<ConversationItem, { kind: "question" }>;
type Question = Choices["questions"][number];

/** Moves the focus between a group's options with the arrow keys, as a radio group does. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const step =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
  if (step === 0) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-option]")];
  const at = options.findIndex((option) => option === document.activeElement);
  const next = options[(at + step + options.length) % options.length];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
}

/** One question's options; the chosen ones carry a check. */
function Options(props: {
  question: Question;
  chosen: readonly string[];
  sending: boolean;
  onChoose: (label: string) => void;
}) {
  const { question, chosen } = props;
  // The group takes Tab once, at its chosen or first option, as a select does.
  const focusable = Math.max(
    0,
    question.options.findIndex((option) => chosen.includes(option.label)),
  );
  return (
    <div
      role={question.multiSelect ? "group" : "radiogroup"}
      aria-label={question.header === "" ? question.question : question.header}
      className={styles.options}
      onKeyDown={moveFocus}
    >
      {question.options.map((option, index) => {
        const checked = chosen.includes(option.label);
        return (
          <button
            key={option.label}
            type="button"
            role={question.multiSelect ? "checkbox" : "radio"}
            aria-checked={checked}
            data-option=""
            tabIndex={index === focusable ? 0 : -1}
            className={styles.option}
            disabled={props.sending}
            onClick={() => props.onChoose(option.label)}
          >
            <span className={styles.text}>
              <span className={styles.label}>{option.label}</span>
              {/* motion: A message arrives live */}
              {option.description === "" ? null : (
                <span className={styles.description}>{option.description}</span>
              )}
            </span>
            <Presence as="span" className={styles.check}>
              {checked ? <CheckIcon size="md" /> : null}
            </Presence>
          </button>
        );
      })}
    </div>
  );
}

/**
 * An agent's question with choices (Lervo ADE sessions, "Questions"). While it waits, its options
 * sit under each question: one question with one answer sends as soon as it is chosen, and
 * otherwise "Send answers" sends them once each question has one. A reply in the reply card
 * answers it in the person's own words instead. Answered, the options close and the question
 * stays as the agent's text, with the answer as the person's message after it.
 */
export function QuestionChoices(props: {
  item: QuestionItem & { choices: Choices };
  /** The agent's text, as the conversation renders it. */
  text: (text: string) => ReactNode;
}) {
  const { item } = props;
  const { choices } = item;
  const open = useQuestionOpen(item.itemId);
  const answer = useAnswerQuestion();
  const [chosen, setChosen] = useState<ReadonlyMap<number, readonly string[]>>(new Map());
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const answerable = open && answer !== undefined && failure !== "question_not_open";
  const several = choices.questions.length > 1;
  const instant = !several && choices.questions[0]?.multiSelect !== true;
  const send = async (picked: ReadonlyMap<number, readonly string[]>) => {
    const answers = answersOf(choices, picked);
    if (answers === null || answer === undefined) return;
    setSending(true);
    setFailure(null);
    try {
      await answer(item.itemId, choices.requestId, answers);
    } catch (error) {
      setFailure(failureCode(error));
    } finally {
      setSending(false);
    }
  };
  const choose = (index: number, question: Question, label: string) => {
    const next = new Map(chosen);
    next.set(index, toggled(chosen.get(index) ?? [], label, question.multiSelect));
    setChosen(next);
    if (instant) void send(next);
  };
  return (
    <div className={styles.question} data-open={answerable ? "" : undefined}>
      {choices.questions.map((question, index) => (
        // A question has no identity beyond its place in one immutable item.
        <div key={index} className={styles.part}>
          {/* motion: A message arrives live */}
          {several && question.header !== "" ? (
            <p className={styles.header}>{question.header}</p>
          ) : null}
          {props.text(question.question)}
          {/* motion: Disclosure: tool activity, details */}
          <Presence enterOnMount={false}>
            {answerable ? (
              <Options
                question={question}
                chosen={chosen.get(index) ?? []}
                sending={sending}
                onChoose={(label) => choose(index, question, label)}
              />
            ) : null}
          </Presence>
        </div>
      ))}
      <Presence enterOnMount={false}>
        {answerable ? (
          <div className={styles.actions}>
            {/* motion: A message arrives live */}
            {instant ? null : (
              <Button
                variant="outlined"
                disabled={sending || answersOf(choices, chosen) === null}
                onClick={() => void send(chosen)}
              >
                <FormattedMessage id="conversation.question.send" />
              </Button>
            )}
            <span className={styles.hint}>
              <FormattedMessage id="conversation.question.reply" />
            </span>
          </div>
        ) : null}
      </Presence>
      <Presence>
        {failure === null ? null : (
          <InlineAlert size="meta" className={styles.failure}>
            {failure === "question_not_open" ? (
              <FormattedMessage id="conversation.question.closed" />
            ) : (
              <FormattedMessage id="conversation.question.failed" values={{ code: failure }} />
            )}
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
