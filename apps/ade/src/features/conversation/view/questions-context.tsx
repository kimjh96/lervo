import { createContext, type PropsWithChildren, useContext } from "react";

/** Sends the person's answers to the question `itemId` names; rejects with the failure. */
export type AnswerQuestion = (
  itemId: string,
  questionId: string,
  answers: Readonly<Record<string, string>>,
) => Promise<void>;

const AnswerContext = createContext<AnswerQuestion | undefined>(undefined);
const OpenContext = createContext<ReadonlySet<string>>(new Set());

/** How the conversation answers its agents' questions; without it, choices show as text. */
export function QuestionAnswers(props: PropsWithChildren<{ answer: AnswerQuestion | undefined }>) {
  return <AnswerContext.Provider value={props.answer}>{props.children}</AnswerContext.Provider>;
}

/** The questions of the timeline that still wait for the person's choice. */
export function OpenQuestions(props: PropsWithChildren<{ open: ReadonlySet<string> }>) {
  return <OpenContext.Provider value={props.open}>{props.children}</OpenContext.Provider>;
}

export function useAnswerQuestion(): AnswerQuestion | undefined {
  return useContext(AnswerContext);
}

export function useQuestionOpen(itemId: string): boolean {
  return useContext(OpenContext).has(itemId);
}
